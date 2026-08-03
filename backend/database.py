import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "mealplanner.db")

CATEGORIES = [
    "Produce", "Meat & Fish", "Dairy & Eggs", "Bakery",
    "Store Cupboard", "Frozen", "Drinks", "Other",
]


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                servings INTEGER NOT NULL DEFAULT 1,
                calories REAL,
                carbs_g REAL NOT NULL DEFAULT 0,
                fat_g REAL NOT NULL DEFAULT 0,
                protein_g REAL NOT NULL DEFAULT 0,
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ingredients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipe_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                quantity REAL NOT NULL DEFAULT 0,
                unit TEXT DEFAULT '',
                category TEXT DEFAULT 'Other',
                FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS staples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                quantity REAL NOT NULL DEFAULT 1,
                unit TEXT DEFAULT '',
                category TEXT DEFAULT 'Other',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                days INTEGER NOT NULL,
                people INTEGER NOT NULL,
                label TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS plan_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL,
                recipe_id INTEGER NOT NULL,
                nights INTEGER NOT NULL DEFAULT 1,
                order_index INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
                FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ingredients_recipe ON ingredients(recipe_id);
            CREATE INDEX IF NOT EXISTS idx_plan_entries_plan ON plan_entries(plan_id);
        """)
        conn.commit()
    finally:
        conn.close()


# ── Macro helpers ──────────────────────────────────────────────────────────

def compute_macros(calories, carbs_g, fat_g, protein_g):
    carbs_g = carbs_g or 0
    fat_g = fat_g or 0
    protein_g = protein_g or 0
    macro_cals = carbs_g * 4 + fat_g * 9 + protein_g * 4
    total_cals = calories if calories else macro_cals
    if total_cals <= 0:
        return {
            "calories": round(total_cals, 1), "carb_pct": 0, "fat_pct": 0,
            "protein_pct": 0, "is_high_carb_low_fat": False,
        }
    carb_pct = round((carbs_g * 4 / total_cals) * 100, 1)
    fat_pct = round((fat_g * 9 / total_cals) * 100, 1)
    protein_pct = round((protein_g * 4 / total_cals) * 100, 1)
    is_hclf = fat_pct <= 20 and carb_pct >= 55
    return {
        "calories": round(total_cals, 1), "carb_pct": carb_pct, "fat_pct": fat_pct,
        "protein_pct": protein_pct, "is_high_carb_low_fat": is_hclf,
    }


def _hydrate_recipe(row, ingredients):
    recipe = dict(row)
    recipe["ingredients"] = ingredients
    recipe["macros"] = compute_macros(
        recipe.get("calories"), recipe["carbs_g"], recipe["fat_g"], recipe["protein_g"]
    )
    return recipe


# ── Recipes ──────────────────────────────────────────────────────────────────

def list_recipes():
    conn = get_connection()
    try:
        recipes = conn.execute("SELECT * FROM recipes ORDER BY name COLLATE NOCASE").fetchall()
        result = []
        for r in recipes:
            ing = conn.execute(
                "SELECT * FROM ingredients WHERE recipe_id=? ORDER BY id", (r["id"],)
            ).fetchall()
            result.append(_hydrate_recipe(r, [dict(i) for i in ing]))
        return result
    finally:
        conn.close()


def get_recipe(recipe_id: int):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM recipes WHERE id=?", (recipe_id,)).fetchone()
        if row is None:
            return None
        ing = conn.execute(
            "SELECT * FROM ingredients WHERE recipe_id=? ORDER BY id", (recipe_id,)
        ).fetchall()
        return _hydrate_recipe(row, [dict(i) for i in ing])
    finally:
        conn.close()


def create_recipe(name, servings, calories, carbs_g, fat_g, protein_g, notes, ingredients):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO recipes (name, servings, calories, carbs_g, fat_g, protein_g, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (name, servings, calories, carbs_g, fat_g, protein_g, notes, now, now),
        )
        recipe_id = cur.lastrowid
        for ing in ingredients:
            conn.execute(
                "INSERT INTO ingredients (recipe_id, name, quantity, unit, category) VALUES (?,?,?,?,?)",
                (recipe_id, ing["name"], ing.get("quantity") or 0, ing.get("unit") or "", ing.get("category") or "Other"),
            )
        conn.commit()
        return recipe_id
    finally:
        conn.close()


def update_recipe(recipe_id, name, servings, calories, carbs_g, fat_g, protein_g, notes, ingredients):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE recipes SET name=?, servings=?, calories=?, carbs_g=?, fat_g=?, protein_g=?, notes=?, updated_at=?
               WHERE id=?""",
            (name, servings, calories, carbs_g, fat_g, protein_g, notes, now, recipe_id),
        )
        conn.execute("DELETE FROM ingredients WHERE recipe_id=?", (recipe_id,))
        for ing in ingredients:
            conn.execute(
                "INSERT INTO ingredients (recipe_id, name, quantity, unit, category) VALUES (?,?,?,?,?)",
                (recipe_id, ing["name"], ing.get("quantity") or 0, ing.get("unit") or "", ing.get("category") or "Other"),
            )
        conn.commit()
    finally:
        conn.close()


def delete_recipe(recipe_id: int) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM recipes WHERE id=?", (recipe_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def suggest_recipes(max_fat_pct=None, min_carb_pct=None):
    recipes = list_recipes()
    if max_fat_pct is None and min_carb_pct is None:
        return recipes
    filtered = []
    for r in recipes:
        m = r["macros"]
        if max_fat_pct is not None and m["fat_pct"] > max_fat_pct:
            continue
        if min_carb_pct is not None and m["carb_pct"] < min_carb_pct:
            continue
        filtered.append(r)
    filtered.sort(key=lambda r: r["macros"]["carb_pct"], reverse=True)
    return filtered


# ── Staples ──────────────────────────────────────────────────────────────────

def list_staples():
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM staples ORDER BY category, name COLLATE NOCASE").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_staple(name, quantity, unit, category):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO staples (name, quantity, unit, category, created_at) VALUES (?,?,?,?,?)",
            (name, quantity, unit, category, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM staples WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def update_staple(staple_id, name, quantity, unit, category):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE staples SET name=?, quantity=?, unit=?, category=? WHERE id=?",
            (name, quantity, unit, category, staple_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM staples WHERE id=?", (staple_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_staple(staple_id: int) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM staples WHERE id=?", (staple_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ── Plans & shopping list ───────────────────────────────────────────────────

def create_plan(days, people, label, entries):
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO plans (days, people, label, created_at) VALUES (?,?,?,?)",
            (days, people, label, now),
        )
        plan_id = cur.lastrowid
        for idx, e in enumerate(entries):
            conn.execute(
                "INSERT INTO plan_entries (plan_id, recipe_id, nights, order_index) VALUES (?,?,?,?)",
                (plan_id, e["recipe_id"], e.get("nights") or 1, idx),
            )
        conn.commit()
        return plan_id
    finally:
        conn.close()


def list_plans():
    conn = get_connection()
    try:
        rows = conn.execute("SELECT * FROM plans ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_plan(plan_id: int):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM plans WHERE id=?", (plan_id,)).fetchone()
        if row is None:
            return None
        plan = dict(row)
        entries = conn.execute(
            """SELECT pe.*, r.name as recipe_name, r.servings as recipe_servings
               FROM plan_entries pe JOIN recipes r ON r.id = pe.recipe_id
               WHERE pe.plan_id=? ORDER BY pe.order_index""",
            (plan_id,),
        ).fetchall()
        plan["entries"] = [dict(e) for e in entries]
        plan["nights_covered"] = sum(e["nights"] for e in plan["entries"])
        return plan
    finally:
        conn.close()


def delete_plan(plan_id: int) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM plans WHERE id=?", (plan_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def build_shopping_list(plan_id: int):
    """Aggregate recipe ingredients (scaled by people/servings/nights) plus staples."""
    plan = get_plan(plan_id)
    if plan is None:
        return None

    conn = get_connection()
    try:
        aggregated: dict[tuple, dict] = {}

        for entry in plan["entries"]:
            recipe = get_recipe(entry["recipe_id"])
            if recipe is None:
                continue
            servings = recipe["servings"] or 1
            multiplier = (plan["people"] / servings) * entry["nights"]
            for ing in recipe["ingredients"]:
                key = (ing["name"].strip().lower(), ing["unit"].strip().lower())
                qty = (ing["quantity"] or 0) * multiplier
                if key not in aggregated:
                    aggregated[key] = {
                        "name": ing["name"], "unit": ing["unit"], "quantity": 0,
                        "category": ing["category"], "source": "recipe", "recipes": [],
                    }
                aggregated[key]["quantity"] += qty
                if recipe["name"] not in aggregated[key]["recipes"]:
                    aggregated[key]["recipes"].append(recipe["name"])

        for staple in list_staples():
            key = (staple["name"].strip().lower(), (staple["unit"] or "").strip().lower())
            if key not in aggregated:
                aggregated[key] = {
                    "name": staple["name"], "unit": staple["unit"], "quantity": 0,
                    "category": staple["category"], "source": "staple", "recipes": [],
                }
            aggregated[key]["quantity"] += staple["quantity"] or 0
            aggregated[key]["source"] = "staple" if aggregated[key]["quantity"] == staple["quantity"] and not aggregated[key]["recipes"] else "both"

        items = []
        for v in aggregated.values():
            v["quantity"] = round(v["quantity"], 2)
            items.append(v)

        items.sort(key=lambda i: (i["category"], i["name"].lower()))
        return {"plan": plan, "items": items}
    finally:
        conn.close()
