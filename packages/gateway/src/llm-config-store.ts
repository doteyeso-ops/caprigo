import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { caprigoDataRoot } from '@caprigo/shared';

export type PersistedLLMConfig = {
  provider: 'ollama' | 'openai_compatible';
  ollamaUrl: string;
  openaiBase: string;
  openaiApiKey: string;
};

type EncryptedBlob = {
  version: 1;
  algo: 'aes-256-gcm';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
};

function storePath(): string {
  return path.join(caprigoDataRoot(), 'gateway', 'llm-config.enc.json');
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function keyMaterial(): string {
  const explicit = process.env.CAPRIGO_LLM_CONFIG_SECRET?.trim();
  if (explicit) return explicit;
  const parts = [os.hostname(), os.userInfo().username, process.env.USERPROFILE || process.env.HOME || ''];
  return parts.join('|');
}

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(keyMaterial(), salt, 32, { N: 1 << 14, r: 8, p: 1 });
}

function encryptConfig(data: PersistedLLMConfig): EncryptedBlob {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algo: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    updatedAt: new Date().toISOString(),
  };
}

function decryptConfig(blob: EncryptedBlob): PersistedLLMConfig {
  const salt = Buffer.from(blob.salt, 'base64');
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const ciphertext = Buffer.from(blob.ciphertext, 'base64');
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const parsed = JSON.parse(plaintext) as PersistedLLMConfig;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid persisted LLM config payload');
  return {
    provider: parsed.provider === 'openai_compatible' ? 'openai_compatible' : 'ollama',
    ollamaUrl: String(parsed.ollamaUrl || '').trim(),
    openaiBase: String(parsed.openaiBase || '').trim(),
    openaiApiKey: String(parsed.openaiApiKey || '').trim(),
  };
}

export function loadPersistedLLMConfig(): PersistedLLMConfig | null {
  const p = storePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const blob = JSON.parse(raw) as EncryptedBlob;
    if (blob?.version !== 1) return null;
    return decryptConfig(blob);
  } catch (e: any) {
    console.warn('[Gateway] Failed to read persisted LLM config:', e?.message || e);
    return null;
  }
}

export function savePersistedLLMConfig(config: PersistedLLMConfig): void {
  const p = storePath();
  ensureParentDir(p);
  const blob = encryptConfig(config);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(blob, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

