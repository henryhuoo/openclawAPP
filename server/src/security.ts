import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import path from 'path';

export type AuthRole = 'client' | 'plugin';

export interface RuntimeSecurityCredentials {
  token: string;
  encodingAESKey: string;
  credentialVersion: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SecurityChallengeRecord {
  nonce: string;
  timestamp: number;
  expiresAt: number;
}

interface ProofInput {
  role: AuthRole;
  socketId: string;
  nonce: string;
  timestamp: number;
  token: string;
  encodingAESKey: string;
}

const CREDENTIALS_PATH = path.resolve(__dirname, '..', 'credentials.json');
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

export function createCredentialVersion(token: string, encodingAESKey: string): string {
  return createHash('sha256')
    .update(`${token}:${encodingAESKey}`)
    .digest('hex');
}

function generateNewCredentials(): RuntimeSecurityCredentials {
  const token = randomBytes(16).toString('hex');
  const encodingAESKey = randomBytes(32).toString('base64url');
  const now = Date.now();

  return {
    token,
    encodingAESKey,
    credentialVersion: createCredentialVersion(token, encodingAESKey),
    issuedAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  };
}

function saveCredentials(creds: RuntimeSecurityCredentials): void {
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2) + '\n', 'utf-8');
}

function loadSavedCredentials(): RuntimeSecurityCredentials | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as RuntimeSecurityCredentials;

    if (!parsed.token || !parsed.encodingAESKey || !parsed.issuedAt || !parsed.expiresAt) {
      return null;
    }

    // 重新计算 credentialVersion 以防篡改
    parsed.credentialVersion = createCredentialVersion(parsed.token, parsed.encodingAESKey);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 获取运行时安全凭证。
 * - 优先加载持久化凭证，未过期则复用
 * - 凭证不存在或已过期则重新生成
 * - forceRenew=true 时强制重新生成
 *
 * @returns [credentials, isNewlyGenerated]
 */
export function getOrCreateRuntimeCredentials(forceRenew = false): [RuntimeSecurityCredentials, boolean] {
  if (!forceRenew) {
    const saved = loadSavedCredentials();
    if (saved && Date.now() < saved.expiresAt) {
      return [saved, false];
    }
  }

  const creds = generateNewCredentials();
  saveCredentials(creds);
  return [creds, true];
}

export function createSecurityChallenge(ttlMs: number): SecurityChallengeRecord {
  const timestamp = Date.now();

  return {
    nonce: randomBytes(16).toString('hex'),
    timestamp,
    expiresAt: timestamp + ttlMs,
  };
}

export function createAuthProof({
  role,
  socketId,
  nonce,
  timestamp,
  token,
  encodingAESKey,
}: ProofInput): string {
  const message = ['v1', role, socketId, nonce, String(timestamp)].join(':');
  const secret = `${token}:${encodingAESKey}`;

  return createHmac('sha256', secret)
    .update(message)
    .digest('hex');
}

export function verifyAuthProof(providedProof: string, expectedProof: string): boolean {
  try {
    const provided = Buffer.from(providedProof, 'hex');
    const expected = Buffer.from(expectedProof, 'hex');

    if (provided.length === 0 || provided.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) {
    return '*'.repeat(secret.length);
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
