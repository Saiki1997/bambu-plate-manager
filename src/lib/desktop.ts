import type { Project } from "./project-store.ts";

export type DesktopImageMeta = {
  id: string;
  name: string;
  type: string;
};

export type DesktopInfo = {
  dataDir: string;
  preferredDir: string;
  askedUser: boolean;
  message: string | null;
};

export type DesktopApi = {
  info: () => Promise<DesktopInfo>;
  loadSession: () => Promise<{ project: Project | null; images: DesktopImageMeta[]; missingImages: string[] }>;
  saveSession: (project: Project) => Promise<void>;
  flushSession: (project: Project) => void;
  saveImage: (payload: { id: string; name: string; type: string; data: Uint8Array }) => Promise<void>;
  readImage: (id: string) => Promise<Uint8Array | null>;
  deleteImages: (ids: string[]) => Promise<void>;
  readCatalogue: () => Promise<Uint8Array>;
  saveExport: (name: string, data: Uint8Array) => Promise<string>;
  chooseDataDir: () => Promise<DesktopInfo>;
  openDataDir: () => Promise<void>;
  readSetting: (name: SettingName) => Promise<unknown>;
  writeSetting: (name: SettingName, value: unknown) => Promise<void>;
};

/** Files kept in the portable data folder's settings directory. */
export type SettingName = "colour-memory" | "filament-prices" | "spool-stock";

/** Read a setting from the portable data folder, or from this browser outside the desktop app. */
export async function loadSetting(name: SettingName): Promise<unknown> {
  const api = desktopApi();
  if (api) return api.readSetting(name);
  try {
    const raw = window.localStorage.getItem(`bambu-setting:${name}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveSetting(name: SettingName, value: unknown): Promise<void> {
  const api = desktopApi();
  if (api) return api.writeSetting(name, value);
  try {
    window.localStorage.setItem(`bambu-setting:${name}`, JSON.stringify(value));
  } catch {
    // Browser storage can be unavailable. The setting lasts until the page closes.
  }
}

export function desktopApi(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as Window & { bambuDesktop?: DesktopApi }).bambuDesktop;
  return api ?? null;
}
