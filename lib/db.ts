export type TransactionType = 'expense' | 'income';

import {
  activateEncryptionKey,
  clearEncryptionKey,
  decryptStoredRecord,
  encryptStoredRecord,
  EncryptedStoredRecord,
  isEncryptedStoredRecord,
} from './crypto';

export interface TransactionRecord {
  id: string;
  date: string;
  type: TransactionType;
  amount: number;
  category: string;
  account: string;
  note: string;
  createdAt: string;
  updatedAt?: string;
}

const DB_NAME = 'yi-ben-zhang';
const DB_VERSION = 3;
const STORE_NAME = 'transactions';
const SESSION_STORE_NAME = 'remembered-session';
const SESSION_ID = 'current';
const SETTINGS_STORE_NAME = 'app-settings';
const AUTO_CSV_SETTING_ID = 'auto-csv-file';

type StoredRecord = TransactionRecord | EncryptedStoredRecord;

export interface RememberedSession {
  id: typeof SESSION_ID;
  username: string;
  key: CryptoKey;
  expiresAt: number;
}

export interface WritableFileHandle {
  kind: 'file';
  name: string;
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
}

export interface AutoCsvSetting {
  id: typeof AUTO_CSV_SETTING_ID;
  handle: WritableFileHandle;
  lastSavedAt: string | null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('date', 'date');
        store.createIndex('type', 'type');
        store.createIndex('category', 'category');
      }
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
        db.createObjectStore(SESSION_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
        db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    let result: T;
    let settled = false;

    request.onsuccess = () => { result = request.result; };
    request.onerror = () => {
      if (!settled) {
        settled = true;
        db.close();
        reject(request.error);
      }
    };
    transaction.oncomplete = () => {
      if (!settled) {
        settled = true;
        db.close();
        resolve(result);
      }
    };
    transaction.onerror = () => {
      if (!settled) {
        settled = true;
        db.close();
        reject(transaction.error);
      }
    };
    transaction.onabort = () => {
      if (!settled) {
        settled = true;
        db.close();
        reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      }
    };
  }));
}

async function migratePlaintextRecords(): Promise<void> {
  const stored = await runTransaction<StoredRecord[]>('readonly', (store) => store.getAll());
  const plaintext = stored.filter((record): record is TransactionRecord => !isEncryptedStoredRecord(record));
  if (!plaintext.length) return;

  const encrypted = await Promise.all(plaintext.map(encryptStoredRecord));
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    encrypted.forEach((record) => store.put(record));
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('IndexedDB transaction aborted')); };
  });
}

export async function unlockDatabase(key: CryptoKey): Promise<void> {
  activateEncryptionKey(key);
  try {
    await migratePlaintextRecords();
  } catch (error) {
    clearEncryptionKey();
    throw error;
  }
}

export function lockDatabase() {
  clearEncryptionKey();
}

export async function getRememberedSession(): Promise<RememberedSession | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE_NAME, 'readonly');
    const request = transaction.objectStore(SESSION_STORE_NAME).get(SESSION_ID);
    request.onsuccess = () => {
      const value = request.result as Partial<RememberedSession> | undefined;
      db.close();
      if (
        value?.id === SESSION_ID
        && typeof value.username === 'string'
        && typeof value.expiresAt === 'number'
        && value.key
      ) {
        resolve(value as RememberedSession);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function saveRememberedSession(username: string, key: CryptoKey, expiresAt: number): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE_NAME, 'readwrite');
    transaction.objectStore(SESSION_STORE_NAME).put({ id: SESSION_ID, username, key, expiresAt });
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('IndexedDB transaction aborted')); };
  });
}

export async function clearRememberedSession(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE_NAME, 'readwrite');
    transaction.objectStore(SESSION_STORE_NAME).delete(SESSION_ID);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('IndexedDB transaction aborted')); };
  });
}

export async function getAutoCsvSetting(): Promise<AutoCsvSetting | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE_NAME, 'readonly');
    const request = transaction.objectStore(SETTINGS_STORE_NAME).get(AUTO_CSV_SETTING_ID);
    request.onsuccess = () => {
      const value = request.result as Partial<AutoCsvSetting> | undefined;
      db.close();
      if (
        value?.id === AUTO_CSV_SETTING_ID
        && value.handle?.kind === 'file'
        && typeof value.handle.name === 'string'
        && typeof value.handle.createWritable === 'function'
      ) {
        resolve(value as AutoCsvSetting);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function saveAutoCsvSetting(handle: WritableFileHandle, lastSavedAt: string | null): Promise<AutoCsvSetting> {
  const setting: AutoCsvSetting = { id: AUTO_CSV_SETTING_ID, handle, lastSavedAt };
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite');
    transaction.objectStore(SETTINGS_STORE_NAME).put(setting);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('IndexedDB transaction aborted')); };
  });
  return setting;
}

export async function clearAutoCsvSetting(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE_NAME, 'readwrite');
    transaction.objectStore(SETTINGS_STORE_NAME).delete(AUTO_CSV_SETTING_ID);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('IndexedDB transaction aborted')); };
  });
}

export async function getAllRecords(): Promise<TransactionRecord[]> {
  const stored = await runTransaction<StoredRecord[]>('readonly', (store) => store.getAll());
  if (stored.some((record) => !isEncryptedStoredRecord(record))) {
    throw new Error('发现尚未加密的账目');
  }
  const records = await Promise.all(stored.map((record) => decryptStoredRecord(record as EncryptedStoredRecord)));
  return records.sort((a, b) => {
    const dateOrder = b.date.localeCompare(a.date);
    return dateOrder || b.createdAt.localeCompare(a.createdAt);
  });
}

export async function saveRecord(record: TransactionRecord): Promise<IDBValidKey> {
  const encrypted = await encryptStoredRecord(record);
  return runTransaction<IDBValidKey>('readwrite', (store) => store.put(encrypted));
}

export function removeRecord(id: string): Promise<undefined> {
  return runTransaction<undefined>('readwrite', (store) => store.delete(id));
}

export function clearRecords(): Promise<undefined> {
  return runTransaction<undefined>('readwrite', (store) => store.clear());
}

export async function replaceRecords(records: TransactionRecord[]): Promise<void> {
  const encryptedRecords = await Promise.all(records.map(encryptStoredRecord));
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    encryptedRecords.forEach((record) => store.put(record));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}
