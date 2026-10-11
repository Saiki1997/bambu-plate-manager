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
};

export function desktopApi(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as Window & { bambuDesktop?: DesktopApi }).bambuDesktop;
  return api ?? null;
}
