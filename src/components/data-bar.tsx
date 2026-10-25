import { useEffect, useRef, useState } from "react";
import type { BackupEntry, DesktopApi, DesktopInfo, UpdateInfo } from "@/lib/desktop";
import type { Project } from "@/lib/project-store";

export function DataBar({
  info,
  api,
  onRestore,
  onError,
}: {
  info: DesktopInfo;
  api: DesktopApi;
  onRestore: (project: Project, entry: BackupEntry) => Promise<void>;
  onError: (error: unknown, fallback: string) => void;
}) {
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      setUpdate(await api.checkForUpdate());
    } catch (error) {
      onError(error, "Could not check for a new version. Check the internet connection.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className={info.askedUser ? "border-b border-primary/50 bg-surface" : "border-b border-border"}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1 text-sm">
        <p className="min-w-0">
          {info.askedUser ? info.message : "Saved projects stay in the portable data folder next to this application."}
          {info.version && <span className="ml-2 font-mono text-xs text-muted">v{info.version}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-x-4">
          {update &&
            (update.newer ? (
              <button type="button" onClick={() => void api.openRelease(update.url)} className="min-h-11 font-medium text-primary">
                Version {update.latest} is available. Download it
              </button>
            ) : (
              <span className="text-muted">{update.latest ? "You have the latest version." : "No release found."}</span>
            ))}
          {!update && (
            <button type="button" onClick={() => void check()} disabled={checking} className="min-h-11 text-primary disabled:opacity-40">
              {checking ? "Checking…" : "Check for updates"}
            </button>
          )}
          <button type="button" onClick={() => setBackupsOpen(true)} className="min-h-11 text-primary">
            Earlier versions
          </button>
          <button type="button" onClick={() => void api.openDataDir()} className="min-h-11 text-primary">
            Open data folder
          </button>
        </div>
      </div>
      {backupsOpen && (
        <BackupsDialog
          api={api}
          onClose={() => setBackupsOpen(false)}
          onError={onError}
          onRestore={async (project, entry) => {
            await onRestore(project, entry);
            setBackupsOpen(false);
          }}
        />
      )}
    </div>
  );
}

function BackupsDialog({
  api,
  onClose,
  onRestore,
  onError,
}: {
  api: DesktopApi;
  onClose: () => void;
  onRestore: (project: Project, entry: BackupEntry) => Promise<void>;
  onError: (error: unknown, fallback: string) => void;
}) {
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const latest = useRef({ onClose, onError });
  latest.current = { onClose, onError };

  useEffect(() => {
    api
      .listBackups()
      .then(setEntries)
      .catch((error: unknown) => {
        latest.current.onError(error, "Backups could not be listed.");
        setEntries([]);
      });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") latest.current.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-bg/80 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="backups-title" className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-md border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 id="backups-title" className="text-base font-medium">Earlier versions</h2>
          <p className="mt-1 text-sm text-muted">
            The app keeps a copy of the session at most once a minute while you work. Restoring one replaces the current set; the
            current set is backed up first, so you can come back to it.
          </p>
        </div>
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {entries === null && <li className="text-sm text-muted">Loading…</li>}
          {entries?.length === 0 && <li className="text-sm text-muted">No backups yet.</li>}
          {entries?.map((entry) => (
            <li key={entry.name} className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg p-2 text-sm">
              <span className="min-w-0">
                <span className="block">{new Date(entry.savedAt).toLocaleString()}</span>
                <span className="block truncate text-xs text-muted">{entry.summary}</span>
              </span>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  setPending(entry.name);
                  api
                    .restoreBackup(entry.name)
                    .then((project) => onRestore(project, entry))
                    .catch((error: unknown) => onError(error, "That backup could not be restored."))
                    .finally(() => setPending(null));
                }}
                className="min-h-11 shrink-0 rounded-md border border-border px-3 text-sm disabled:opacity-40"
              >
                {pending === entry.name ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-border px-3 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
