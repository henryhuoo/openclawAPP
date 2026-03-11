import fs from 'fs';
import path from 'path';

export interface ServerConfig {
  port: number;
  corsOrigin: string | string[];
  authChallengeTtlMs: number;
}

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');
const DEFAULT_CONFIG: ServerConfig = {
  port: 3001,
  corsOrigin: '*',
  authChallengeTtlMs: 60_000,
};

function ensureConfigFile(): void {
  if (fs.existsSync(CONFIG_PATH)) {
    return;
  }

  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf-8');
}

export function loadServerConfig(): ServerConfig {
  ensureConfigFile();

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<ServerConfig>;

  const port = Number(parsed.port ?? DEFAULT_CONFIG.port);
  const authChallengeTtlMs = Number(parsed.authChallengeTtlMs ?? DEFAULT_CONFIG.authChallengeTtlMs);
  const corsOrigin = parsed.corsOrigin ?? DEFAULT_CONFIG.corsOrigin;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`server/config.json 中的 port 无效: ${parsed.port}`);
  }

  if (!Number.isInteger(authChallengeTtlMs) || authChallengeTtlMs < 5_000) {
    throw new Error(`server/config.json 中的 authChallengeTtlMs 无效: ${parsed.authChallengeTtlMs}`);
  }

  if (typeof corsOrigin !== 'string' && !Array.isArray(corsOrigin)) {
    throw new Error('server/config.json 中的 corsOrigin 必须是字符串或字符串数组');
  }

  return {
    port,
    corsOrigin,
    authChallengeTtlMs,
  };
}
