import os
import uuid
from urllib.parse import quote
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional

from backend import database as db

app = FastAPI(title="Meal Planner & Shopping List API")

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads")
ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"}
ALLOWED_PLAN_EXT = ALLOWED_IMAGE_EXT | {".pdf"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

os.makedirs(os.path.join(UPLOADS_DIR, "recipes"), exist_ok=True)
os.makedirs(os.path.join(UPLOADS_DIR, "macro_plan"), exist_ok=True)


@app.on_event("startup")
def startup():
    db.init_db()


async def _save_upload(file: UploadFile, subdir: str, allowed_ext: set) -> str:
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext or 'unknown'}")
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 8MB)")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")
    filename = f"{uuid.uuid4().hex}{ext}"
    dest_dir = os.path.join(UPLOADS_DIR, subdir)
    os.makedirs(dest_dir, exist_ok=True)
    with open(os.path.join(dest_dir, filename), "wb") as f:
        f.write(content)
    return f"/uploads/{subdir}/{filename}"


def _delete_upload(url_path: Optional[str]):
    if not url_path or not url_path.startswith("/uploads/"):
        return
    disk_path = os.path.join(UPLOADS_DIR, url_path[len("/uploads/"):])
    if os.path.commonpath([os.path.abspath(disk_path), UPLOADS_DIR]) == UPLOADS_DIR and os.path.isfile(disk_path):
        os.remove(disk_path)


# ── Request models ───────────────────────────────────────────────────────────

class IngredientIn(BaseModel):
    name: str = Field(..., min_length=1)
    quantity: float = 0
    unit: str = ""
    category: str = "Other"


class RecipeIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    servings: int = Field(..., gt=0)
    calories: Optional[float] = None
    carbs_g: float = 0
    fat_g: float = 0
    protein_g: float = 0
    notes: str = ""
    ingredients: list[IngredientIn] = []


class StapleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    quantity: float = 1
    unit: str = ""
    category: str = "Other"


class PlanEntryIn(BaseModel):
    recipe_id: int
    nights: int = Field(1, gt=0)


class PlanIn(BaseModel):
    days: int = Field(..., gt=0)
    people: int = Field(..., gt=0)
    label: str = ""
    entries: list[PlanEntryIn]


class MacroPlanIn(BaseModel):
    target_calories: Optional[float] = None
    target_carbs_g: float = 0
    target_fat_g: float = 0
    target_protein_g: float = 0
    notes: str = ""


# ── Recipes ──────────────────────────────────────────────────────────────────

@app.get("/api/recipes")
def list_recipes():
    return db.list_recipes()


@app.get("/api/recipes/suggest")
def suggest_recipes(max_fat_pct: Optional[float] = None, min_carb_pct: Optional[float] = None):
    return db.suggest_recipes(max_fat_pct, min_carb_pct)


@app.post("/api/recipes", status_code=201)
def create_recipe(body: RecipeIn):
    recipe_id = db.create_recipe(
        body.name.strip(), body.servings, body.calories, body.carbs_g,
        body.fat_g, body.protein_g, body.notes.strip(),
        [i.model_dump() for i in body.ingredients],
    )
    return db.get_recipe(recipe_id)


@app.get("/api/recipes/{recipe_id}")
def get_recipe(recipe_id: int):
    recipe = db.get_recipe(recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@app.put("/api/recipes/{recipe_id}")
def update_recipe(recipe_id: int, body: RecipeIn):
    if db.get_recipe(recipe_id) is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    db.update_recipe(
        recipe_id, body.name.strip(), body.servings, body.calories, body.carbs_g,
        body.fat_g, body.protein_g, body.notes.strip(),
        [i.model_dump() for i in body.ingredients],
    )
    return db.get_recipe(recipe_id)


@app.delete("/api/recipes/{recipe_id}", status_code=204)
def delete_recipe(recipe_id: int):
    if not db.delete_recipe(recipe_id):
        raise HTTPException(status_code=404, detail="Recipe not found")


@app.post("/api/recipes/{recipe_id}/photo")
async def upload_recipe_photo(recipe_id: int, file: UploadFile = File(...)):
    recipe = db.get_recipe(recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    url = await _save_upload(file, "recipes", ALLOWED_IMAGE_EXT)
    _delete_upload(recipe.get("photo_path"))
    db.set_recipe_photo(recipe_id, url)
    return db.get_recipe(recipe_id)


@app.delete("/api/recipes/{recipe_id}/photo")
def delete_recipe_photo(recipe_id: int):
    recipe = db.get_recipe(recipe_id)
    if recipe is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    _delete_upload(recipe.get("photo_path"))
    db.clear_recipe_photo(recipe_id)
    return db.get_recipe(recipe_id)


# ── Staples (standard weekly-shop items) ─────────────────────────────────────

@app.get("/api/staples")
def list_staples():
    return db.list_staples()


@app.post("/api/staples", status_code=201)
def create_staple(body: StapleIn):
    return db.create_staple(body.name.strip(), body.quantity, body.unit.strip(), body.category)


@app.put("/api/staples/{staple_id}")
def update_staple(staple_id: int, body: StapleIn):
    updated = db.update_staple(staple_id, body.name.strip(), body.quantity, body.unit.strip(), body.category)
    if updated is None:
        raise HTTPException(status_code=404, detail="Staple not found")
    return updated


@app.delete("/api/staples/{staple_id}", status_code=204)
def delete_staple(staple_id: int):
    if not db.delete_staple(staple_id):
        raise HTTPException(status_code=404, detail="Staple not found")


# ── Meal plans & shopping list ───────────────────────────────────────────────

@app.get("/api/plans")
def list_plans():
    return db.list_plans()


@app.post("/api/plans", status_code=201)
def create_plan(body: PlanIn):
    for e in body.entries:
        if db.get_recipe(e.recipe_id) is None:
            raise HTTPException(status_code=400, detail=f"Recipe {e.recipe_id} not found")
    plan_id = db.create_plan(body.days, body.people, body.label.strip(), [e.model_dump() for e in body.entries])
    return db.get_plan(plan_id)


@app.get("/api/plans/{plan_id}")
def get_plan(plan_id: int):
    plan = db.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@app.delete("/api/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: int):
    if not db.delete_plan(plan_id):
        raise HTTPException(status_code=404, detail="Plan not found")


@app.get("/api/plans/{plan_id}/shopping-list")
def get_shopping_list(plan_id: int):
    result = db.build_shopping_list(plan_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    for item in result["items"]:
        item["tesco_search_url"] = f"https://www.tesco.com/groceries/en-GB/search?query={quote(item['name'])}"
    return result


# ── Macro / calorie plan ──────────────────────────────────────────────────────

@app.get("/api/macro-plan")
def get_macro_plan():
    return db.get_macro_plan()


@app.put("/api/macro-plan")
def update_macro_plan(body: MacroPlanIn):
    return db.update_macro_plan(
        body.target_calories, body.target_carbs_g, body.target_fat_g,
        body.target_protein_g, body.notes.strip(),
    )


@app.post("/api/macro-plan/file")
async def upload_macro_plan_file(file: UploadFile = File(...)):
    url = await _save_upload(file, "macro_plan", ALLOWED_PLAN_EXT)
    current = db.get_macro_plan()
    _delete_upload(current.get("file_path"))
    return db.set_macro_plan_file(url, file.filename)


@app.delete("/api/macro-plan/file")
def delete_macro_plan_file():
    current = db.get_macro_plan()
    _delete_upload(current.get("file_path"))
    return db.clear_macro_plan_file()


# ── Static files / SPA fallback ───────────────────────────────────────────────

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    file_path = os.path.join(FRONTEND_DIR, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
