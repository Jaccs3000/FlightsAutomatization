import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { getAppSecret, resetAppSecrets, setAppSecret } from "./db";

const CHECK_VALUE = "vuela-vault-check-v1";
// Share in-memory state between Next's server bundle and the scheduler entrypoint.
// The key stays in this process and is never persisted unencrypted.
const SESSION_KEY = Symbol.for("vuela.vault.session-key");
function getSessionKey(): Buffer | null {
  return ((globalThis as Record<symbol, unknown>)[SESSION_KEY] as Buffer | undefined) ?? null;
}
function setSessionKey(key: Buffer | null) {
  (globalThis as Record<symbol, unknown>)[SESSION_KEY] = key;
}

interface VaultMeta {
  version: 1;
  salt: string;
  nonce: string;
  tag: string;
  verifier: string;
}

function encode(data: Buffer) {
  return data.toString("base64url");
}

function decode(data: string) {
  return Buffer.from(data, "base64url");
}

async function deriveKey(passphrase: string, salt: Buffer) {
  return await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(passphrase, salt, 32, { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function encrypt(key: Buffer, plaintext: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { nonce: encode(nonce), tag: encode(cipher.getAuthTag()), ciphertext: encode(ciphertext) };
}

function decrypt(key: Buffer, value: { nonce: string; tag: string; ciphertext: string }) {
  const decipher = createDecipheriv("aes-256-gcm", key, decode(value.nonce));
  decipher.setAuthTag(decode(value.tag));
  return Buffer.concat([decipher.update(decode(value.ciphertext)), decipher.final()]).toString("utf8");
}

export async function vaultStatus() {
  return { configured: Boolean(await getAppSecret("vault_meta")), unlocked: getSessionKey() !== null };
}

export async function setupVault(passphrase: string) {
  if (passphrase.length < 12) throw new Error("La clave maestra debe tener al menos 12 caracteres.");
  if (await getAppSecret("vault_meta")) throw new Error("La bóveda ya está configurada.");
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  const sealed = encrypt(key, CHECK_VALUE);
  const meta: VaultMeta = { version: 1, salt: encode(salt), ...sealed, verifier: sealed.ciphertext };
  await setAppSecret("vault_meta", JSON.stringify(meta));
  setSessionKey(key);
}

export async function unlockVault(passphrase: string) {
  const raw = await getAppSecret("vault_meta");
  if (!raw) throw new Error("Configura primero la clave maestra.");
  const meta = JSON.parse(raw) as VaultMeta;
  if (meta.version !== 1) throw new Error("La versión de la bóveda no es compatible.");
  const key = await deriveKey(passphrase, decode(meta.salt));
  try {
    if (decrypt(key, { nonce: meta.nonce, tag: meta.tag, ciphertext: meta.verifier }) !== CHECK_VALUE) {
      key.fill(0);
      return false;
    }
    getSessionKey()?.fill(0);
    setSessionKey(key);
    return true;
  } catch {
    key.fill(0);
    return false;
  }
}

export function lockVault() {
  getSessionKey()?.fill(0);
  setSessionKey(null);
}

export async function resetVault() {
  lockVault();
  await resetAppSecrets();
}

export function isVaultUnlocked() {
  return getSessionKey() !== null;
}

export async function storeVaultSecret(name: string, value: unknown) {
  const key = getSessionKey();
  if (!key) throw new Error("Desbloquea la bóveda para guardar credenciales.");
  const encrypted = encrypt(key, JSON.stringify(value));
  await setAppSecret(`secret:${name}`, JSON.stringify(encrypted));
}

export async function readVaultSecret<T>(name: string): Promise<T | null> {
  const key = getSessionKey();
  if (!key) throw new Error("Desbloquea la bóveda para usar la cuenta de correo.");
  const raw = await getAppSecret(`secret:${name}`);
  if (!raw) return null;
  return JSON.parse(decrypt(key, JSON.parse(raw))) as T;
}

export async function deleteVaultSecret(name: string) {
  await setAppSecret(`secret:${name}`, null);
}
