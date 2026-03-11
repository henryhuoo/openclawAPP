import { createHash, createHmac } from 'crypto';

export interface AuthChallenge {
  nonce: string;
  timestamp: number;
  expiresAt: number;
  credentialVersion: string;
}

export interface AuthResponse {
  success: boolean;
  credentialVersion: string;
  error?: string;
}

interface ProofInput {
  role: 'plugin';
  socketId: string;
  nonce: string;
  timestamp: number;
  token: string;
  encodingAESKey: string;
}

export function createCredentialVersion(token: string, encodingAESKey: string): string {
  return createHash('sha256')
    .update(`${token}:${encodingAESKey}`)
    .digest('hex');
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

export function maskSecret(secret: string): string {
  if (!secret) {
    return '(未配置)';
  }

  if (secret.length <= 8) {
    return '*'.repeat(secret.length);
  }

  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
