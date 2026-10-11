"""
Database models and schema for BambuPlate Manager.
Uses SQLite with a simple ORM-like interface.
"""
import sqlite3
import os
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

DB_PATH = Path.home() / ".bambu_plate_manager" / "projects.db"

def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_database(db_path: Optional[Path] = None):
    """Create all tables if they don't exist."""
    conn = get_connection(db_path)
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT,
        notes TEXT
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        image_hash TEXT,
        width INTEGER,
        height INTEGER,
        imported_at TEXT NOT NULL,
        processing_status TEXT DEFAULT 'pending',
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS plates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        image_id INTEGER,
        plate_label TEXT,
        region_coordinates TEXT,
        detection_confidence REAL,
        review_status TEXT DEFAULT 'pending',
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS filament_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plate_id INTEGER NOT NULL,
        slot_number TEXT,
        raw_ocr_text TEXT,
        material TEXT,
        product_name TEXT,
        colour_name TEXT,
        hex_code TEXT,
        rgb_value TEXT,
        quantity REAL,
        weight_g REAL,
        confidence REAL,
        verification_status TEXT DEFAULT 'unverified',
        user_corrected INTEGER DEFAULT 0,
        source_image_id INTEGER,
        FOREIGN KEY (plate_id) REFERENCES plates(id) ON DELETE CASCADE
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    c.execute("""
    CREATE TABLE IF NOT EXISTS export_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        output_path TEXT,
        export_mode TEXT,
        created_at TEXT,
        record_count INTEGER,
        status TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
    """)
    conn.commit()
    conn.close()

class ProjectManager:
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or DB_PATH
        init_database(self.db_path)

    def create_project(self, name: str) -> int:
        conn = get_connection(self.db_path)
        now = datetime.utcnow().isoformat()
        c = conn.cursor()
        c.execute(
            "INSERT INTO projects (name, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?)",
            (name, now, now, now)
        )
        project_id = c.lastrowid
        conn.commit()
        conn.close()
        return project_id

    def get_project(self, project_id: int) -> Optional[Dict]:
        conn = get_connection(self.db_path)
        c = conn.cursor()
        c.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = c.fetchone()
        conn.close()
        return dict(row) if row else None

    def list_projects(self, limit: int = 20) -> List[Dict]:
        conn = get_connection(self.db_path)
        c = conn.cursor()
        c.execute("SELECT * FROM projects ORDER BY last_opened_at DESC LIMIT ?", (limit,))
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return rows

    def update_project_timestamp(self, project_id: int):
        conn = get_connection(self.db_path)
        now = datetime.utcnow().isoformat()
        conn.execute(
            "UPDATE projects SET updated_at = ?, last_opened_at = ? WHERE id = ?",
            (now, now, project_id)
        )
        conn.commit()
        conn.close()

    def add_image(self, project_id: int, filename: str, file_path: str, width: int = None, height: int = None) -> int:
        conn = get_connection(self.db_path)
        now = datetime.utcnow().isoformat()
        c = conn.cursor()
        c.execute(
            """INSERT INTO images (project_id, filename, file_path, width, height, imported_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (project_id, filename, file_path, width, height, now)
        )
        image_id = c.lastrowid
        conn.commit()
        conn.close()
        self.update_project_timestamp(project_id)
        return image_id

    def get_images(self, project_id: int) -> List[Dict]:
        conn = get_connection(self.db_path)
        c = conn.cursor()
        c.execute("SELECT * FROM images WHERE project_id = ? ORDER BY imported_at", (project_id,))
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return rows

    def save_setting(self, key: str, value: str):
        conn = get_connection(self.db_path)
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value)
        )
        conn.commit()
        conn.close()

    def get_setting(self, key: str, default: str = None) -> Optional[str]:
        conn = get_connection(self.db_path)
        c = conn.cursor()
        c.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = c.fetchone()
        conn.close()
        return row[0] if row else default

    def get_assignments(self, project_id: int = None, plate_id: int = None) -> List[Dict]:
        return []

    def add_export_record(self, project_id: int, output_path: str, export_mode: str, record_count: int, status: str = "success"):
        conn = get_connection(self.db_path)
        now = datetime.utcnow().isoformat()
        conn.execute(
            """INSERT INTO export_history
               (project_id, output_path, export_mode, created_at, record_count, status)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (project_id, output_path, export_mode, now, record_count, status)
        )
        conn.commit()
        conn.close()

    def get_export_history(self, project_id: int = None, limit: int = 20) -> List[Dict]:
        conn = get_connection(self.db_path)
        c = conn.cursor()
        if project_id:
            c.execute(
                "SELECT * FROM export_history WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
                (project_id, limit)
            )
        else:
            c.execute(
                "SELECT * FROM export_history ORDER BY created_at DESC LIMIT ?",
                (limit,)
            )
        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return rows
