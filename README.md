# BambuPlate OCR & Filament Manager

Desktop application for extracting 3D-printing filament information from Bambu Studio screenshots, matching against the Bambu Lab colour catalogue, and exporting to professional Excel workbooks.

**Recommended packaging: Electron** (avoids PyInstaller module issues).

## Quick Start (Electron)

```bat
cd electron
npm install
npm start          # development
npm run build      # Windows installer + portable exe
```

Or from the project root:

```bat
build_electron.bat
```

## Python Backend (optional)

```bat
pip install -r requirements.txt
python main.py
```

## Features

- Project management with SQLite and session recovery
- Filament catalogue (~80 Bambu Lab colours with HEX codes) + fuzzy matching
- Excel export: standard multi-sheet, template-based, per-plate
- Database backups, logging, and error handling
- Electron packaging for reliable Windows builds
