import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "blackbook.db")


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
            CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                relationship TEXT NOT NULL DEFAULT 'contact',
                tags TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                note_type TEXT NOT NULL DEFAULT 'general',
                created_at TEXT NOT NULL,
                FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_notes_person_id ON notes(person_id);
            CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
        """)
        conn.commit()
    finally:
        conn.close()


# ── People ──────────────────────────────────────────────────────────────────

def list_people():
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT p.*, COUNT(n.id) AS note_count
            FROM people p
            LEFT JOIN notes n ON n.person_id = p.id
            GROUP BY p.id
            ORDER BY p.name COLLATE NOCASE
        """).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_person(name: str, relationship: str, tags: str) -> dict:
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO people (name, relationship, tags, created_at, updated_at) VALUES (?,?,?,?,?)",
            (name, relationship, tags, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT *, 0 AS note_count FROM people WHERE id=?", (cur.lastrowid,)
        ).fetchone()
        return dict(row)
    finally:
        conn.close()


def get_person(person_id: int) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM people WHERE id=?", (person_id,)
        ).fetchone()
        if row is None:
            return None
        person = dict(row)
        notes = conn.execute(
            "SELECT * FROM notes WHERE person_id=? ORDER BY created_at ASC",
            (person_id,),
        ).fetchall()
        person["notes"] = [dict(n) for n in notes]
        return person
    finally:
        conn.close()


def update_person(person_id: int, name: str, relationship: str, tags: str) -> dict | None:
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE people SET name=?, relationship=?, tags=?, updated_at=? WHERE id=?",
            (name, relationship, tags, now, person_id),
        )
        conn.commit()
        return get_person(person_id)
    finally:
        conn.close()


def delete_person(person_id: int) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM people WHERE id=?", (person_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ── Notes ────────────────────────────────────────────────────────────────────

def create_note(person_id: int, content: str, note_type: str) -> dict:
    now = datetime.utcnow().isoformat()
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO notes (person_id, content, note_type, created_at) VALUES (?,?,?,?)",
            (person_id, content, note_type, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM notes WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def delete_note(note_id: int) -> bool:
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ── Search ───────────────────────────────────────────────────────────────────

def search(query: str) -> list[dict]:
    like = f"%{query}%"
    conn = get_connection()
    try:
        rows = conn.execute("""
            SELECT DISTINCT p.*, COUNT(n2.id) AS note_count
            FROM people p
            LEFT JOIN notes n ON n.person_id = p.id
            LEFT JOIN notes n2 ON n2.person_id = p.id
            WHERE p.name LIKE ?
               OR p.tags LIKE ?
               OR n.content LIKE ?
            GROUP BY p.id
            ORDER BY p.name COLLATE NOCASE
        """, (like, like, like)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ── Briefing ──────────────────────────────────────────────────────────────────

def get_briefing(person_id: int) -> dict | None:
    person = get_person(person_id)
    if person is None:
        return None

    type_order = ["context", "personal", "meeting", "general"]
    type_labels = {
        "context": "Background & Context",
        "personal": "Personal Details",
        "meeting": "Meeting Notes",
        "general": "General Notes",
    }

    grouped: dict[str, list] = {t: [] for t in type_order}
    for note in person["notes"]:
        nt = note["note_type"] if note["note_type"] in grouped else "general"
        grouped[nt].append(note)

    sections = []
    for t in type_order:
        if grouped[t]:
            sections.append({
                "label": type_labels[t],
                "notes": grouped[t],
            })

    tags = [t.strip() for t in (person.get("tags") or "").split(",") if t.strip()]

    return {
        "person": {
            "id": person["id"],
            "name": person["name"],
            "relationship": person["relationship"],
            "tags": tags,
        },
        "sections": sections,
        "total_notes": len(person["notes"]),
    }
