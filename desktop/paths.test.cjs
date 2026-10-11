const assert = require("node:assert/strict");
const test = require("node:test");
const { resolvePortableDataDir, safeId, inside } = require("./electron/paths.cjs");

test("writable portable directory stays beside the executable", () => {
  const result = resolvePortableDataDir({
    portableDir: "/usb/Bambu",
    canWrite: () => true,
  });
  assert.equal(result.askedUser, false);
  assert.equal(result.dir, "/usb/Bambu/BambuPlateManagerData");
});

test("a read-only directory asks instead of switching silently", () => {
  const result = resolvePortableDataDir({
    portableDir: "/cdrom/Bambu",
    canWrite: () => false,
  });
  assert.equal(result.dir, null);
  assert.equal(result.askedUser, true);
  assert.match(result.message, /cannot write/i);
  assert.match(result.preferredDir, /BambuPlateManagerData$/);
});

test("image ids cannot escape the data directory", () => {
  assert.equal(safeId("not a path"), false);
  assert.equal(safeId("../secrets"), false);
  assert.equal(safeId("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(inside("/data/images", "/data/images/abc"), true);
  assert.equal(inside("/data/images", "/data/images-other"), false);
});
