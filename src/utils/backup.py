"""
Database backup utilities.
"""
import shutil
from pathlib import Path
from datetime import datetime
from database.models import DB_PATH

BACKUP_DIR = Path.home() / ".bambu_plate_manager" / "backups"

def backup_database(db_path: Path = None, max_keep: int = 10) -> Path:
    """Create a timestamped backup of the projects database."""
    src = db_path or DB_PATH
    if not src.exists():
        raise FileNotFoundError(f"Database not found: {src}")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = BACKUP_DIR / f"projects_{stamp}.db"
    shutil.copy2(src, dest)

    backups = sorted(BACKUP_DIR.glob("projects_*.db"), reverse=True)
    for old in backups[max_keep:]:
        try:
            old.unlink()
        except Exception:
            pass

    return dest

def list_backups() -> list:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(BACKUP_DIR.glob("projects_*.db"), reverse=True)
