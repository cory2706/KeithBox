import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional

from backend import database as db

app = FastAPI(title="Black Book API")

# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    db.init_db()


# ── Request / Response models ────────────────────────────────────────────────

VALID_RELATIONSHIPS = {"friend", "colleague", "family", "contact", "other"}
VALID_NOTE_TYPES = {"general", "meeting", "personal", "context"}


class PersonCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    relationship: str = "contact"
    tags: str = ""


class PersonUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    relationship: str = "contact"
    tags: str = ""


class NoteCreate(BaseModel):
    content: str = Field(..., min_length=1)
    note_type: str = "general"


# ── People endpoints ─────────────────────────────────────────────────────────

@app.get("/api/people")
def list_people():
    return db.list_people()


@app.post("/api/people", status_code=201)
def create_person(body: PersonCreate):
    rel = body.relationship if body.relationship in VALID_RELATIONSHIPS else "contact"
    return db.create_person(body.name.strip(), rel, body.tags.strip())


@app.get("/api/people/{person_id}")
def get_person(person_id: int):
    person = db.get_person(person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


@app.put("/api/people/{person_id}")
def update_person(person_id: int, body: PersonUpdate):
    existing = db.get_person(person_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Person not found")
    rel = body.relationship if body.relationship in VALID_RELATIONSHIPS else "contact"
    updated = db.update_person(person_id, body.name.strip(), rel, body.tags.strip())
    return updated


@app.delete("/api/people/{person_id}", status_code=204)
def delete_person(person_id: int):
    if not db.delete_person(person_id):
        raise HTTPException(status_code=404, detail="Person not found")


# ── Notes endpoints ───────────────────────────────────────────────────────────

@app.post("/api/people/{person_id}/notes", status_code=201)
def add_note(person_id: int, body: NoteCreate):
    if db.get_person(person_id) is None:
        raise HTTPException(status_code=404, detail="Person not found")
    nt = body.note_type if body.note_type in VALID_NOTE_TYPES else "general"
    return db.create_note(person_id, body.content.strip(), nt)


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: int):
    if not db.delete_note(note_id):
        raise HTTPException(status_code=404, detail="Note not found")


# ── Search ────────────────────────────────────────────────────────────────────

@app.get("/api/search")
def search(q: str = ""):
    if not q.strip():
        return []
    return db.search(q.strip())


# ── Briefing ──────────────────────────────────────────────────────────────────

@app.get("/api/people/{person_id}/briefing")
def get_briefing(person_id: int):
    briefing = db.get_briefing(person_id)
    if briefing is None:
        raise HTTPException(status_code=404, detail="Person not found")
    return briefing


# ── Static files / SPA fallback ───────────────────────────────────────────────

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/{full_path:path}")
def serve_spa(full_path: str):
    # Serve actual static files; fall back to index.html for SPA routing
    file_path = os.path.join(FRONTEND_DIR, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
