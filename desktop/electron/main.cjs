const { app, BrowserWindow, dialog, ipcMain, net, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { resolvePortableDataDir, safeId, inside } = require("./paths.cjs");

const WORKBOOK = "Bambu_Lab_Filaments_Complete.xlsx";
const RELEASES = "https://github.com/Saiki1997/bambu-plate-manager/releases";
const LATEST_API = "https://api.github.com/repos/Saiki1997/bambu-plate-manager/releases/latest";

let dataDir = null;
let dataInfo = null;

function log(level, message) {
  const line = `${new Date().toISOString()} ${level} ${message}\n`;
  try {
    if (!dataDir) return;
    const dir = path.join(dataDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "app.log"), line);
  } catch {
    // Logging must not take the app down.
  }
}

function appAnchor() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged) return path.join(__dirname, "..", "dev-data");
  return path.dirname(process.execPath);
}

function resourceFile(...parts) {
  if (app.isPackaged) return path.join(process.resourcesPath, ...parts);
  if (parts[0] === "database") return path.join(__dirname, "..", "..", "attachments", WORKBOOK);
  if (parts[0] === "tessdata") return path.join(__dirname, "..", "..", "eng.traineddata");
  return path.join(__dirname, "..", ...parts);
}

function ensureLayout(dir) {
  for (const name of ["projects", "images", "database", "exports", "backups", "settings", "logs"]) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  }
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function seedCatalogue(dir) {
  const dest = path.join(dir, "database", WORKBOOK);
  const bundled = resourceFile("database", WORKBOOK);
  const bundledBytes = fs.readFileSync(bundled);
  const bundledHash = sha256(bundledBytes);
  if (!fs.existsSync(dest)) {
    const tmp = `${dest}.tmp`;
    fs.writeFileSync(tmp, bundledBytes);
    fs.renameSync(tmp, dest);
    fs.writeFileSync(
      path.join(dir, "database", "manifest.json"),
      JSON.stringify({ file: WORKBOOK, sha256: bundledHash, copiedAt: new Date().toISOString() }, null, 2),
    );
    log("info", "Copied the supplied filament workbook into the portable database folder.");
    return;
  }
  const localHash = sha256(fs.readFileSync(dest));
  if (localHash !== bundledHash) {
    fs.writeFileSync(
      path.join(dir, "database", "update-available.json"),
      JSON.stringify(
        {
          note: "A newer workbook is bundled with this version. The existing database file was left unchanged.",
          bundledSha256: bundledHash,
          localSha256: localHash,
        },
        null,
        2,
      ),
    );
    log("info", "Bundled filament workbook differs from the portable copy. The existing file was kept.");
  }
}

function activateDataDir(dir, info) {
  ensureLayout(dir);
  dataDir = dir;
  dataInfo = info;
  seedCatalogue(dir);
  fs.writeFileSync(
    path.join(dir, "settings", "data-dir.json"),
    JSON.stringify({ dataDir: dir, preferredDir: info.preferredDir, askedUser: info.askedUser }, null, 2),
  );
}

async function chooseDataDir(parent) {
  const picked = await dialog.showOpenDialog(parent ?? undefined, {
    title: "Choose a writable folder for Bambu Plate Manager",
    message: dataInfo?.message || "Choose where projects and screenshots should be stored.",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const dir = path.join(picked.filePaths[0], "BambuPlateManagerData");
  const probe = resolvePortableDataDir({ portableDir: picked.filePaths[0], execDir: picked.filePaths[0] });
  if (!probe.dir) {
    await dialog.showMessageBox({
      type: "error",
      title: "Folder is not writable",
      message: "That folder is not writable. The portable data was not moved.",
    });
    return null;
  }
  return { ...probe, dir };
}

async function prepareDataDir() {
  const anchor = appAnchor();
  const resolved = resolvePortableDataDir({ portableDir: anchor, execDir: anchor });
  if (resolved.dir) {
    activateDataDir(resolved.dir, resolved);
    return;
  }
  await dialog.showMessageBox({
    type: "error",
    title: "Cannot store data next to the application",
    message: resolved.message,
  });
  const chosen = await chooseDataDir();
  if (!chosen?.dir) {
    log("error", "Quit because no writable data folder was chosen.");
    app.quit();
    return;
  }
  activateDataDir(chosen.dir, { ...resolved, dir: chosen.dir, askedUser: true, message: resolved.message });
}

function sessionPaths() {
  const file = path.join(dataDir, "projects", "session.json");
  return { file, tmp: `${file}.tmp` };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function loadSession() {
  const { file, tmp } = sessionPaths();
  const missingImages = [];
  let project = null;
  const candidates = [file, tmp].filter((item) => fs.existsSync(item));
  for (const candidate of candidates) {
    try {
      project = readJson(candidate);
      if (candidate === tmp && !fs.existsSync(file)) {
        fs.renameSync(tmp, file);
        log("info", "Recovered a session that had not finished saving.");
      }
      break;
    } catch (error) {
      log("error", `Could not read ${candidate}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const images = [];
  const ids = project?.images?.map((image) => image.id) ?? [];
  for (const id of ids) {
    if (!safeId(id)) continue;
    const metaFile = path.join(dataDir, "images", `${id}.json`);
    const bin = path.join(dataDir, "images", id);
    if (!fs.existsSync(bin) || !fs.existsSync(metaFile)) {
      missingImages.push(id);
      continue;
    }
    try {
      images.push(readJson(metaFile));
    } catch {
      missingImages.push(id);
    }
  }
  return { project, images, missingImages };
}

function saveSession(project) {
  if (!project || typeof project !== "object") throw new Error("The project could not be saved.");
  const { file } = sessionPaths();
  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stampFile = path.join(backupDir, "last-backup.txt");
  const now = Date.now();
  const last = fs.existsSync(stampFile) ? Number(fs.readFileSync(stampFile, "utf8")) || 0 : 0;
  if (fs.existsSync(file) && now - last > 60_000) {
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(file, path.join(backupDir, `session-${stamp}.json`));
    fs.writeFileSync(stampFile, String(now));
    const backups = fs
      .readdirSync(backupDir)
      .filter((name) => name.startsWith("session-"))
      .sort();
    while (backups.length > 12) fs.unlinkSync(path.join(backupDir, backups.shift()));
  }
  writeJsonAtomic(file, project);
}

function listBackups() {
  const dir = path.join(dataDir, "backups");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^session-[\w-]+\.json$/.test(name))
    .sort()
    .reverse()
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      let summary = "";
      try {
        const project = readJson(file);
        const rows = Array.isArray(project?.rows) ? project.rows.filter((row) => !row.isTotal).length : 0;
        summary = `${String(project?.name || "Untitled").slice(0, 80)} · ${rows} line${rows === 1 ? "" : "s"}`;
      } catch {
        summary = "Unreadable backup";
      }
      return { name, savedAt: stat.mtime.toISOString(), summary };
    });
}

function restoreBackup(name) {
  if (!/^session-[\w-]+\.json$/.test(String(name))) throw new Error("Unknown backup.");
  const file = path.join(dataDir, "backups", name);
  if (!inside(path.join(dataDir, "backups"), file) || !fs.existsSync(file)) throw new Error("That backup is no longer there.");
  const project = readJson(file);
  const { file: current } = sessionPaths();
  if (fs.existsSync(current)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(current, path.join(dataDir, "backups", `session-${stamp}-before-restore.json`));
  }
  writeJsonAtomic(current, project);
  log("info", `Restored session from ${name}.`);
  return project;
}

function newerVersion(latest, current) {
  const parse = (value) => String(value).replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

async function checkForUpdate() {
  const current = app.getVersion();
  const response = await net.fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}. Try again later.`);
  const release = await response.json();
  const latest = String(release.tag_name || "").replace(/^v/i, "");
  const url = typeof release.html_url === "string" && release.html_url.startsWith(RELEASES) ? release.html_url : RELEASES;
  return { current, latest: latest || null, newer: latest ? newerVersion(latest, current) : false, url };
}

function imageFile(id) {
  if (!safeId(id)) throw new Error("Invalid image id.");
  const bin = path.join(dataDir, "images", id);
  if (!inside(path.join(dataDir, "images"), bin)) throw new Error("Invalid image path.");
  return bin;
}

const SETTING_NAMES = new Set(["colour-memory", "filament-prices", "spool-stock"]);

function settingsFile(name) {
  if (!SETTING_NAMES.has(name)) throw new Error("Unknown setting.");
  return path.join(dataDir, "settings", `${name}.json`);
}

function createWindow() {
  const icon = app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(__dirname, "..", "build", "icon.png");
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 640,
    title: "Bambu Plate Manager",
    icon: fs.existsSync(icon) ? icon : undefined,
    backgroundColor: "#121417",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  const index = path.join(__dirname, "..", "dist", "index.html");
  win.loadFile(index);
  win.on("close", () => {
    log("info", "Window closing.");
  });
}

function registerIpc() {
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    dataDir,
    preferredDir: dataInfo?.preferredDir ?? dataDir,
    askedUser: Boolean(dataInfo?.askedUser),
    message: dataInfo?.message ?? null,
  }));
  ipcMain.handle("session:load", () => loadSession());
  ipcMain.handle("session:save", (_event, project) => {
    saveSession(project);
  });
  ipcMain.on("session:flush", (event, project) => {
    try {
      saveSession(project);
      event.returnValue = true;
    } catch (error) {
      log("error", `Flush failed: ${error instanceof Error ? error.message : error}`);
      event.returnValue = false;
    }
  });
  ipcMain.handle("image:save", (_event, payload) => {
    const file = imageFile(payload.id);
    const data = Buffer.from(payload.data);
    if (data.length > 30 * 1024 * 1024) throw new Error("That screenshot is larger than 30 MB.");
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
    writeJsonAtomic(`${file}.json`, {
      id: payload.id,
      name: String(payload.name || "screenshot").slice(0, 180),
      type: String(payload.type || "image/png").slice(0, 80),
    });
  });
  ipcMain.handle("image:read", (_event, id) => {
    const file = imageFile(id);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  });
  ipcMain.handle("image:delete", (_event, ids) => {
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (!safeId(id)) continue;
      for (const file of [imageFile(id), `${imageFile(id)}.json`]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
  });
  ipcMain.handle("catalogue:read", () => fs.readFileSync(path.join(dataDir, "database", WORKBOOK)));
  ipcMain.handle("export:save", (_event, payload) => {
    const name = String(payload.name || "plates.xlsx").replace(/[^A-Za-z0-9._-]+/g, "-");
    const file = path.join(dataDir, "exports", name);
    if (!inside(path.join(dataDir, "exports"), file)) throw new Error("Invalid export name.");
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(payload.data));
    fs.renameSync(tmp, file);
    return file;
  });
  ipcMain.handle("data:choose", async () => {
    const chosen = await chooseDataDir(BrowserWindow.getFocusedWindow() ?? undefined);
    if (!chosen?.dir) return dataInfo;
    if (dataDir && dataDir !== chosen.dir) {
      fs.cpSync(dataDir, chosen.dir, { recursive: true });
      log("info", `Copied portable data from ${dataDir} to ${chosen.dir}. The old folder was kept.`);
    }
    activateDataDir(chosen.dir, chosen);
    return {
      dataDir,
      preferredDir: dataInfo.preferredDir,
      askedUser: true,
      message: `Data is now stored in ${chosen.dir}. The previous folder was not deleted.`,
    };
  });
  ipcMain.handle("data:open", () => {
    if (dataDir) shell.openPath(dataDir);
  });
  ipcMain.handle("backups:list", () => listBackups());
  ipcMain.handle("backups:restore", (_event, name) => restoreBackup(name));
  ipcMain.handle("update:check", () => checkForUpdate());
  ipcMain.handle("update:open", (_event, url) => {
    const target = String(url || "");
    if (target.startsWith(RELEASES)) shell.openExternal(target);
  });
  ipcMain.handle("settings:read", (_event, name) => {
    const file = settingsFile(name);
    if (!fs.existsSync(file)) return null;
    try {
      return readJson(file);
    } catch (error) {
      log("error", `Could not read ${file}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  });
  ipcMain.handle("settings:write", (_event, name, value) => {
    writeJsonAtomic(settingsFile(name), value);
  });
  ipcMain.handle("log:write", (_event, message) => {
    log("info", String(message).slice(0, 500));
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId("com.saiki1997.bambuplatemanager");
    app.setName("Bambu Plate Manager");
    registerIpc();
    await prepareDataDir();
    if (!dataDir) return;
    log("info", `Data directory ${dataDir}`);
    createWindow();
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
}
