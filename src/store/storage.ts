import type { StateStorage } from 'zustand/middleware';

// ─────────────────────────────────────────────
// 앱 데이터 저장소
//
// 카드 사진 때문에 데이터가 커서 localStorage(약 5MB)로는 금방 가득 찬다.
// → IndexedDB(훨씬 큰 공간)에 저장하고, 예전에 localStorage에 있던 데이터는
//   처음 한 번 자동으로 옮겨 온다. 저장에 실패하면 화면에 알린다.
// ─────────────────────────────────────────────

const DB_NAME = 'card-football';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error('저장이 취소됐어요'));
      }),
  );
}

// ─────────────── 저장 실패 알림 ───────────────

type Listener = (message: string | null) => void;
const listeners = new Set<Listener>();

export function onSaveStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function report(message: string | null) {
  listeners.forEach((fn) => fn(message));
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

// ─────────────── localStorage 보조 (IndexedDB를 못 쓰는 브라우저용) ───────────────

const local = {
  get(name: string): string | null {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  set(name: string, value: string) {
    localStorage.setItem(name, value);
  },
  remove(name: string) {
    try {
      localStorage.removeItem(name);
    } catch {
      /* 무시 */
    }
  },
};

const hasIndexedDb = typeof indexedDB !== 'undefined';

export const appStorage: StateStorage = {
  async getItem(name) {
    if (!hasIndexedDb) return local.get(name);
    try {
      const saved = await run<string | undefined>('readonly', (s) => s.get(name));
      if (saved != null) return saved;
      // 예전 버전(localStorage) 데이터가 있으면 옮겨 오기
      const legacy = local.get(name);
      if (legacy != null) {
        await run('readwrite', (s) => s.put(legacy, name));
        local.remove(name);
      }
      return legacy;
    } catch {
      return local.get(name);
    }
  },

  async setItem(name, value) {
    try {
      if (hasIndexedDb) await run('readwrite', (s) => s.put(value, name));
      else local.set(name, value);
      report(null);
    } catch (err) {
      report(
        isQuotaError(err)
          ? '기기 저장 공간이 부족해서 마지막 변경이 저장되지 않았어요. 쓰지 않는 팀이나 선수를 지워 주세요.'
          : '저장하지 못했어요. 브라우저 설정(사생활 보호 모드 등)을 확인해 주세요.',
      );
    }
  },

  async removeItem(name) {
    local.remove(name);
    if (hasIndexedDb) await run('readwrite', (s) => s.delete(name)).catch(() => undefined);
  },
};
