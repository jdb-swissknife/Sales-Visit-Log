import {
  createVisit,
  uploadMedia,
  createEvent,
  type CreateVisitBody,
} from "@workspace/api-client-react";

/**
 * Offline visit queue backed by IndexedDB.
 *
 * Visits (and their voice-note audio blobs) logged without signal are stored
 * locally and synced when the connection returns. IndexedDB stores Blobs
 * natively, so audio survives app restarts.
 */

const DB_NAME = "sales-visit-log";
const DB_VERSION = 1;
const STORE = "queued-visits";

export interface QueuedVoiceNote {
  blob: Blob;
  durationSec: number;
  mimeType: string;
}

export interface QueuedVisit {
  id?: number; // auto-increment key
  queuedAt: string;
  businessName?: string;
  visit: CreateVisitBody;
  voiceNote?: QueuedVoiceNote;
}

export interface SyncResult {
  synced: number;
  failed: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function enqueueVisit(item: Omit<QueuedVisit, "id">): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(item);
    await txDone(tx);
    notifyQueueChanged();
  } finally {
    db.close();
  }
}

export async function listQueuedVisits(): Promise<QueuedVisit[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    await txDone(tx);
    return (req.result as QueuedVisit[]) ?? [];
  } finally {
    db.close();
  }
}

export async function countQueuedVisits(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    await txDone(tx);
    return req.result ?? 0;
  } finally {
    db.close();
  }
}

async function removeQueuedVisit(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

let syncInFlight: Promise<SyncResult> | null = null;

/**
 * Push every queued visit to the server. Items only leave the queue after
 * the visit POST succeeds; a failed voice-note upload won't lose the visit.
 * Concurrent calls share one in-flight sync.
 */
export function syncQueuedVisits(): Promise<SyncResult> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = doSync().finally(() => {
    syncInFlight = null;
    notifyQueueChanged();
  });
  return syncInFlight;
}

async function doSync(): Promise<SyncResult> {
  const items = await listQueuedVisits();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    if (item.id == null) continue;
    try {
      const visit = await createVisit(item.visit);

      if (item.voiceNote) {
        const ext = item.voiceNote.mimeType.includes("mp4")
          ? "m4a"
          : item.voiceNote.mimeType.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File(
          [item.voiceNote.blob],
          `voice-note-${Date.now()}.${ext}`,
          { type: item.voiceNote.mimeType },
        );
        try {
          await uploadMedia(visit.id, { file, type: "voice_note" });
        } catch {
          // Visit is saved; losing the retry here is acceptable — flag in event.
        }
      }

      await removeQueuedVisit(item.id);
      synced += 1;

      void createEvent({
        type: "visit.synced_offline",
        entityType: "visit",
        entityId: visit.id,
        businessId: visit.businessId,
        visitId: visit.id,
        payload: { queuedAt: item.queuedAt, hadVoiceNote: Boolean(item.voiceNote) },
      }).catch(() => undefined);
    } catch {
      failed += 1;
      // Leave it queued; stop early if we appear to be offline again.
      if (typeof navigator !== "undefined" && !navigator.onLine) break;
    }
  }

  return { synced, failed };
}

// ---------------------------------------------------------------------------
// Change notification so React hooks can refresh counts
// ---------------------------------------------------------------------------

export const QUEUE_CHANGED_EVENT = "offline-queue-changed";

function notifyQueueChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT));
  }
}

/** Heuristic: did this error come from being offline rather than the server? */
export function isLikelyOfflineError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return err instanceof TypeError; // fetch network failures reject with TypeError
}
