# Bambu Plate Manager

Portable Windows app for reading Bambu Studio slicing screenshots, matching filament colours against the supplied workbook, and exporting an Excel file.

The catalogue file is `Bambu_Lab_Filaments_Complete.xlsx`. The app copies it into the portable data folder on first launch and does not overwrite that copy later.

## Run from a folder or USB

Keep this pair together:

```
Bambu-Plate-Manager-Portable.exe
BambuPlateManagerData/
```

Double-click the exe. It does not install, and it does not need Node.js or Python. On first launch it creates `BambuPlateManagerData` beside the exe when that folder is writable:

- `projects/` current session
- `images/` imported screenshots
- `database/` the filament workbook
- `exports/` workbooks saved from the app
- `backups/` earlier session files
- `settings/`
- `logs/app.log`

If the exe is in a folder that cannot be written, the app asks for another folder. It does not pick a different folder by itself.

Replacing the exe with a newer copy does not delete `BambuPlateManagerData`. Do not delete that folder when updating.

## What was verified here

- `Bambu-Plate-Manager-Portable.exe` is a Windows PE executable with a 7-Zip payload.
- The payload contains `Bambu-Plate-Manager.exe`, the filament workbook, English OCR data, and the app.
- Catalogue parsing keeps the workbook's 333 rows. Incomplete colour codes `#FFF20`, `#F4E2A`, and `#D4E3B` are not rewritten.
- Colour distance, Excel cell fills, and duplicate merging have automated tests.
- A read-only directory is covered by a logic test only. This build machine cannot launch a Windows executable, so double-click startup, USB move, and a protected Windows folder were not run.

## Build

From `desktop/` on a machine with Node.js 22:

```
npm install
npm run dist:portable
```

The exe is written to `desktop/release/Bambu-Plate-Manager-Portable.exe`.
