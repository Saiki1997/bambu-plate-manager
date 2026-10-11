const fs = require("fs");
const path = require("path");

const DATA_FOLDER = "BambuPlateManagerData";

function defaultCanWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".write-probe");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolvePortableDataDir(options) {
  const canWrite = options.canWrite || defaultCanWrite;
  const root = options.portableDir || options.execDir;
  if (!root) throw new Error("No application directory was provided.");
  const preferred = path.join(root, DATA_FOLDER);
  if (canWrite(preferred)) {
    return { dir: preferred, preferredDir: preferred, askedUser: false, message: null };
  }
  return {
    dir: null,
    preferredDir: preferred,
    askedUser: true,
    message: `Bambu Plate Manager cannot write its data folder at ${preferred}. Choose a writable folder. Nothing was saved somewhere else.`,
  };
}

function safeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9-]{8,80}$/.test(id);
}

function inside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

module.exports = {
  DATA_FOLDER,
  resolvePortableDataDir,
  safeId,
  inside,
};
