# Bambu Plate Manager

Audit of this repository (commit history through the Electron stub): it is **not** a working Windows application.

## What is actually in this repository

- `electron/` — a small browser window shell. It does not import screenshots, run OCR, match colours, or write Excel files.
- `src/` — Python package stubs. The OCR engine is a placeholder. There is no filament catalogue file, no Excel exporter, and no application window.
- `build_electron.bat` — does not produce `Bambu-Plate-Manager-Setup-1.0.0.exe`.

Do not treat `npm run build` inside `electron/` as a release. That script is not configured to bundle OCR, a colour database, or an installer that preserves user data.

## What is not in this repository

- A tested Windows installer or portable executable
- Offline Tesseract or PaddleOCR wired to Bambu Studio screenshots
- The 318-colour Bambu Studio catalogue with CIEDE2000 matching
- Excel workbooks with colour fills, frozen headers, and autofilter
- SQLite project storage, backups, or last-session restore

No installer path exists because none was built from this tree.

## Next release, if packaging on Windows

A release build has to be made on a Windows machine (or a cross-compile setup with NSIS), from a complete Electron + React app, not from the current shell. Until that app exists in this repo, there is nothing to install.
