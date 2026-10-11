# Bambu Plate Manager

Portable Windows app for Bambu Studio screenshot OCR, filament matching, and Excel export.

The filament catalogue is the supplied workbook `Bambu_Lab_Filaments_Complete.xlsx` (333 rows). It is not regenerated. Incomplete colour values in that file (`#FFF20`, `#F4E2A`, `#D4E3B`) are kept as written.

## Portable use

```
Bambu-Plate-Manager-Portable.exe
BambuPlateManagerData/
```

Double-click the exe. No installer, Node.js, or Python is required. On first launch the app creates `BambuPlateManagerData` beside the exe when that location is writable:

- projects/
- images/
- database/
- exports/
- backups/
- settings/
- logs/

If the exe directory is not writable, the app asks for a folder. It does not choose another location silently. Replacing the exe does not delete `BambuPlateManagerData`.

## Build

From the `desktop` directory, with Node.js 22:

```
npm install
npm run dist:portable
```

Output: `desktop/release/Bambu-Plate-Manager-Portable.exe`

## Verification

Checked on the build machine:

- The output is a Windows PE file (MZ/PE) with a 7-Zip payload.
- The payload includes `Bambu-Plate-Manager.exe`, both copies of the filament workbook, English OCR data, and the app.
- Workbook parsing, CIEDE2000 matching, Excel swatch fills, duplicate merging, and portable-path logic tests passed.

Not checked, because this build was not launched on Windows:

- Double-click startup on Windows 10 or 11.
- Creating the data folder on a real Windows disk.
- Moving the folder to another drive or PC.
- A read-only Windows directory. The read-only behaviour is covered by a logic test only.
