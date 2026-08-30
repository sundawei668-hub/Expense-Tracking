import type { TransactionRecord } from './db';

const ACCOUNT_STORAGE_KEY = 'yibenzhang-local-account-v2';
const ACCOUNT_VERSION = 2;
const BACKUP_VERSION = 2;
const DEFAULT_ITERATIONS = 600_000;
const CHECK_TEXT = 'yi-ben-zhang-unlocked-v2';
const BACKUP_AAD = 'yi-ben-zhang-backup-v2';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface CipherPayload {
  iv: string;
  ciphertext: string;
}

export interface LocalAccountConfig {
  version: 2;
  username: string;
  salt: string;
  iterations: number;
  check: CipherPayload;
}

export interface EncryptedStoredRecord extends CipherPayload {
  id: string;
  encrypted: true;
  version: 1;
}

export interface EncryptedBackupFile {
  version: 2;
  encrypted: true;
  exportedAt: string;
  account: {
    username: string;
    salt: string;
    iterations: number;
  };
  payload: CipherPayload;
}

let activeKey: CryptoKey | null = null;

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptText(key: CryptoKey, text: string, additionalData: string): Promise<CipherPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(additionalData) },
    key,
    encoder.encode(text),
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptText(key: CryptoKey, payload: CipherPayload, additionalData: string) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(payload.iv),
      additionalData: encoder.encode(additionalData),
    },
    key,
    base64ToBytes(payload.ciphertext),
  );
  return decoder.decode(plaintext);
}

function isCipherPayload(value: unknown): value is CipherPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<CipherPayload>;
  return typeof payload.iv === 'string' && payload.iv.length > 0
    && typeof payload.ciphertext === 'string' && payload.ciphertext.length > 0;
}

export function getLocalAccount(): LocalAccountConfig | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const config = JSON.parse(raw) as Partial<LocalAccountConfig>;
    if (
      config.version !== ACCOUNT_VERSION
      || typeof config.username !== 'string'
      || config.username.length < 2
      || typeof config.salt !== 'string'
      || config.salt.length === 0
      || typeof config.iterations !== 'number'
      || config.iterations < 100_000
      || config.iterations > 1_000_000
      || !isCipherPayload(config.check)
    ) return null;
    return config as LocalAccountConfig;
  } catch {
    return null;
  }
}

export async function createLocalAccount(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  const check = await encryptText(key, CHECK_TEXT, normalizedUsername);
  const config: LocalAccountConfig = {
    version: ACCOUNT_VERSION,
    username: normalizedUsername,
    salt: bytesToBase64(salt),
    iterations: DEFAULT_ITERATIONS,
    check,
  };
  return { config, key };
}

export function saveLocalAccount(config: LocalAccountConfig) {
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(config));
}

export async function verifyLocalAccount(username: string, password: string) {
  const config = getLocalAccount();
  if (!config || username.trim().toLowerCase() !== config.username) return null;
  try {
    const key = await deriveKey(password, base64ToBytes(config.salt), config.iterations);
    return await verifyLocalAccountKey(config, key) ? key : null;
  } catch {
    return null;
  }
}

export async function verifyLocalAccountKey(config: LocalAccountConfig, key: CryptoKey) {
  try {
    const check = await decryptText(key, config.check, config.username);
    return check === CHECK_TEXT;
  } catch {
    return false;
  }
}

export function activateEncryptionKey(key: CryptoKey) {
  activeKey = key;
}

export function clearEncryptionKey() {
  activeKey = null;
}

function requireEncryptionKey() {
  if (!activeKey) throw new Error('账本尚未解锁');
  return activeKey;
}

export function isEncryptedStoredRecord(value: unknown): value is EncryptedStoredRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<EncryptedStoredRecord>;
  return record.encrypted === true
    && record.version === 1
    && typeof record.id === 'string'
    && record.id.length > 0
    && isCipherPayload(record);
}

export async function encryptStoredRecord(record: TransactionRecord): Promise<EncryptedStoredRecord> {
  const encrypted = await encryptText(requireEncryptionKey(), JSON.stringify(record), `record:${record.id}`);
  return { id: record.id, encrypted: true, version: 1, ...encrypted };
}

export async function decryptStoredRecord(record: EncryptedStoredRecord): Promise<TransactionRecord> {
  const plaintext = await decryptText(requireEncryptionKey(), record, `record:${record.id}`);
  const parsed = JSON.parse(plaintext) as TransactionRecord;
  if (parsed.id !== record.id) throw new Error('加密账目校验失败');
  return parsed;
}

export async function createEncryptedBackup(records: TransactionRecord[]): Promise<EncryptedBackupFile> {
  const config = getLocalAccount();
  if (!config) throw new Error('找不到本地账户');
  const payload = await encryptText(
    requireEncryptionKey(),
    JSON.stringify({ records }),
    BACKUP_AAD,
  );
  return {
    version: BACKUP_VERSION,
    encrypted: true,
    exportedAt: new Date().toISOString(),
    account: {
      username: config.username,
      salt: config.salt,
      iterations: config.iterations,
    },
    payload,
  };
}

export function isEncryptedBackupFile(value: unknown): value is EncryptedBackupFile {
  if (!value || typeof value !== 'object') return false;
  const backup = value as Partial<EncryptedBackupFile>;
  const account = backup.account as Partial<EncryptedBackupFile['account']> | undefined;
  return backup.version === BACKUP_VERSION
    && backup.encrypted === true
    && typeof backup.exportedAt === 'string'
    && !!account
    && typeof account.username === 'string'
    && typeof account.salt === 'string'
    && typeof account.iterations === 'number'
    && account.iterations >= 100_000
    && account.iterations <= 1_000_000
    && isCipherPayload(backup.payload);
}

export async function decryptEncryptedBackup(backup: EncryptedBackupFile, password: string) {
  const key = await deriveKey(password, base64ToBytes(backup.account.salt), backup.account.iterations);
  const plaintext = await decryptText(key, backup.payload, BACKUP_AAD);
  const parsed = JSON.parse(plaintext) as { records?: TransactionRecord[] };
  if (!Array.isArray(parsed.records)) throw new Error('备份内容无效');
  return parsed.records;
}
