import fs from 'fs';
import path from 'path';

export interface PluginConfig {
  serverUrl: string;
  token: string;
  encodingAESKey: string;
  openclawPath: string;
  reconnectDelayMs: number;
}

export const PLUGIN_CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');

const DEFAULT_CONFIG: PluginConfig = {
  serverUrl: 'http://43.160.192.190:3001',
  token: '',
  encodingAESKey: '',
  openclawPath: 'openclaw',
  reconnectDelayMs: 3000,
};

function ensureConfigFile(): void {
  if (fs.existsSync(PLUGIN_CONFIG_PATH)) {
    return;
  }

  fs.writeFileSync(PLUGIN_CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf-8');
}

export function loadPluginConfig(): PluginConfig {
  ensureConfigFile();

  const raw = fs.readFileSync(PLUGIN_CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<PluginConfig>;

  const serverUrl = typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim()
    ? parsed.serverUrl.trim().replace(/\/+$/, '')
    : DEFAULT_CONFIG.serverUrl;
  const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
  const encodingAESKey = typeof parsed.encodingAESKey === 'string' ? parsed.encodingAESKey.trim() : '';
  const openclawPath = typeof parsed.openclawPath === 'string' && parsed.openclawPath.trim()
    ? parsed.openclawPath.trim()
    : DEFAULT_CONFIG.openclawPath;
  const reconnectDelayMs = Number(parsed.reconnectDelayMs ?? DEFAULT_CONFIG.reconnectDelayMs);

  if (!Number.isInteger(reconnectDelayMs) || reconnectDelayMs < 1000) {
    throw new Error(`openclaw-plugin/config.json 中的 reconnectDelayMs 无效: ${parsed.reconnectDelayMs}`);
  }

  return {
    serverUrl,
    token,
    encodingAESKey,
    openclawPath,
    reconnectDelayMs,
  };
}
