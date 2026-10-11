#!/usr/bin/env python3
"""
BambuPlate OCR & Filament Manager
Entry point for the desktop application.
"""
import sys
from pathlib import Path

src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

from gui.main_window import main

if __name__ == "__main__":
    main()
