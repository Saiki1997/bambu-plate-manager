# Electron Packaging (Recommended)

This folder contains an Electron shell that packages cleanly with `electron-builder`.
It avoids the PyInstaller module-missing problems.

## Prerequisites

- Node.js 18+
- npm

## Quick start

```bat
cd electron
npm install
npm start
```

## Build Windows executable

```bat
cd electron
npm install
npm run build
```

The installer and portable `.exe` appear in `electron/dist/`.
