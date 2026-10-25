# Bambu Plate Manager

Portable Windows app for reading Bambu Studio slicing screenshots, matching filament colours against the supplied workbook, and exporting an Excel file.

The number beside a colour swatch is the **filament ID** in the Bambu Studio project, not an AMS slot. The ledger and the Excel export both label it Filament ID.

Download the finished portable build:

[Bambu-Plate-Manager-Portable.exe](https://github.com/Saiki1997/bambu-plate-manager/releases/tag/v1.1.0)

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

The catalogue file shipped with the app is `attachments/Bambu_Lab_Filaments_Complete.xlsx`. The app copies it into the portable data folder on first launch and does not overwrite that copy later.

## Using it

1. **Import.** Drop, paste (Ctrl+V) or pick (Ctrl+O) one or more slicing screenshots.
2. **Review.** The step bar at the top shows what is left. "Next to check" (or N) jumps to the next line that needs a look.
3. **Match.** Confirm each colour from the filament database. A colour you choose or lock is remembered in `settings/colour-memory.json` and suggested, unlocked, the next time the same swatch colour appears. Remembered colours can be forgotten from the Filament database view.
4. **Export.** Ctrl+E saves the Excel workbook into `exports/`.

**Totals & cost** sums grams and metres per filament. Set a price per kg and the grams left on each spool to see the project cost and any filament that would run short. These are saved in `settings/` and the export includes a Filament Totals sheet. After printing, the project's grams can be subtracted from the spool stock.

**Earlier versions** in the bar under the header lists the session backups in `backups/` and restores one; the current set is backed up first. **Check for updates** asks GitHub for the latest release and links to it. Nothing is checked unless you press it.

Press ? for the keyboard shortcuts.

Unverified colours stay unverified until you choose a row from that workbook. A manual choice is kept when automatic matching runs again, and the export labels it Manually Confirmed.

## Build

From this repository, with Node.js 22:

```
npm install
cd desktop
npm install
npm run dist:portable
```

The exe is written to `desktop/release/Bambu-Plate-Manager-Portable.exe`.
