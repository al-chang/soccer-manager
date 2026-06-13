import type { GameState } from '@soccer-manager/engine/types';

// Minimal IndexedDB wrapper. Saves are keyed by slot name so multiple save
// slots can be exposed later without a schema change.

const DB_NAME = 'soccer-manager';
const STORE = 'saves';
const DEFAULT_SLOT = 'default';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveGame(state: GameState, slot = DEFAULT_SLOT): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    // structuredClone strips any accidental non-serializable references.
    tx.objectStore(STORE).put(JSON.parse(JSON.stringify(state)), slot);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadGame(slot = DEFAULT_SLOT): Promise<GameState | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(slot);
    req.onsuccess = () => { db.close(); resolve((req.result as GameState) ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function hasSave(slot = DEFAULT_SLOT): Promise<boolean> {
  return (await loadGame(slot)) !== null;
}

export async function deleteSave(slot = DEFAULT_SLOT): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(slot);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
