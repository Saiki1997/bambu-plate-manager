import { getImageBlob, putImageBlob } from "./image-db.ts";
import type { Project } from "./project-store.ts";

export type ProjectArchive = {
  version: 1;
  project: Project;
  images: Array<{ id: string; type: string; data: string }>;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function createArchive(project: Project): Promise<Blob> {
  const images: ProjectArchive["images"] = [];
  for (const image of project.images) {
    const blob = await getImageBlob(image.id);
    if (!blob) continue;
    images.push({
      id: image.id,
      type: blob.type || "image/png",
      data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    });
  }
  const payload: ProjectArchive = { version: 1, project, images };
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export async function readArchive(file: File): Promise<ProjectArchive> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<ProjectArchive>;
  if (parsed.version !== 1 || !parsed.project || !Array.isArray(parsed.project.rows) || !Array.isArray(parsed.images)) {
    throw new Error("That file is not a Bambu Plate Manager archive.");
  }
  return parsed as ProjectArchive;
}

export async function restoreArchiveImages(archive: ProjectArchive): Promise<number> {
  let restored = 0;
  for (const image of archive.images) {
    const bytes = base64ToBytes(image.data);
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    await putImageBlob(image.id, new Blob([copy], { type: image.type }));
    restored += 1;
  }
  return restored;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
