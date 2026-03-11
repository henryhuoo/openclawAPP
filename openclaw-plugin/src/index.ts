import { io, Socket } from 'socket.io-client';
import { loadPluginConfig, PLUGIN_CONFIG_PATH, type PluginConfig } from './config';
import { OpenClawConnector } from './openclaw-connector';
import { logger } from './logger';
import { createAuthProof, createCredentialVersion, maskSecret, type AuthChallenge, type AuthResponse } from './security';

interface PluginRequest {
  requestId: string;
  type: 'chat' | 'command';
  content: string;
}

class OpenClawChannelPlugin {
  private readonly socket: Socket;
  private readonly openclawConnector: OpenClawConnector;
  private readonly config: PluginConfig;
  private isAuthenticated = false;

  constructor(config: PluginConfig) {
    this.config = config;
    this.openclawConnector = new OpenClawConnector(config.openclawPath);
    this.socket = io(`${config.serverUrl}/plugin`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: config.reconnectDelayMs,
      autoConnect: false,
    });

    this.setupEventHandlers();
  }

  start(): void {
    if (!this.hasCredentials()) {
      this.printMissingCredentialTips();
      return;
    }

    this.socket.connect();
  }

  private hasCredentials(): boolean {
    return Boolean(this.config.token && this.config.encodingAESKey);
  }

  private setupEventHandlers(): void {
    this.socket.on('connect', () => {
      this.isAuthenticated = false;
      logger.info(`已连接到服务器传输层`, { serverUrl: this.config.serverUrl, socketId: this.socket.id });
      logger.info('等待安全认证...');
    });

    this.socket.on('authChallenge', (challenge: AuthChallenge) => {
      logger.debug('收到认证挑战', { credentialVersion: challenge.credentialVersion });
      void this.handleAuthChallenge(challenge);
    });

    this.socket.on('disconnect', (reason) => {
      this.isAuthenticated = false;
      logger.warn(`与服务器断开连接`, { reason });
    });

    this.socket.on('connect_error', (error) => {
      logger.error(`连接错误`, { error: error.message, retryDelay: this.config.reconnectDelayMs });
    });

    this.socket.on('request', async (request: PluginRequest) => {
      if (!this.isAuthenticated) {
        logger.warn('收到未认证状态下的请求，已忽略');
        return;
      }

      await this.handleRequest(request);
    });

    this.socket.on('resetSession', () => {
      if (!this.isAuthenticated) {
        logger.warn('收到未认证状态下的 resetSession，已忽略');
        return;
      }

      logger.info('收到重置会话请求');
      this.openclawConnector.resetSession();
    });

    this.socket.on('cancelRequest', (_requestId: string) => {
      if (!this.isAuthenticated) {
        logger.warn('收到未认证状态下的 cancelRequest，已忽略');
        return;
      }

      logger.info('收到取消请求，终止活跃进程');
      this.openclawConnector.cancel();
    });
  }

  private async handleAuthChallenge(challenge: AuthChallenge): Promise<void> {
    if (!this.socket.id) {
      return;
    }

    if (!this.hasCredentials()) {
      this.printMissingCredentialTips();
      this.socket.disconnect();
      return;
    }

    const credentialVersion = createCredentialVersion(this.config.token, this.config.encodingAESKey);
    const proof = createAuthProof({
      role: 'plugin',
      socketId: this.socket.id,
      nonce: challenge.nonce,
      timestamp: challenge.timestamp,
      token: this.config.token,
      encodingAESKey: this.config.encodingAESKey,
    });

    this.socket.emit(
      'authenticate',
      {
        nonce: challenge.nonce,
        timestamp: challenge.timestamp,
        credentialVersion,
        proof,
      },
      (response: AuthResponse) => {
        if (response.success) {
          this.isAuthenticated = true;
          logger.info('插件安全认证成功');
          return;
        }

        this.isAuthenticated = false;
        logger.error(`插件安全认证失败`, { error: response.error });

        if (response.credentialVersion !== credentialVersion) {
          logger.warn('服务器凭证已更新，请修改 openclaw-plugin/config.json 后重新启动插件');
        }

        this.socket.disconnect();
      }
    );
  }

  private async handleRequest(request: PluginRequest): Promise<void> {
    const { requestId, content } = request;

    logger.info(`收到请求`, { requestId, contentPreview: content.substring(0, 80) });

    try {
      await this.openclawConnector.sendMessage(content, {
        onChunk: (chunk) => {
          this.socket.emit('chunk', requestId, chunk);
        },
        onComplete: () => {
          this.socket.emit('complete', requestId);
          logger.info(`请求完成`, { requestId });
        },
        onError: (error) => {
          this.socket.emit('pluginError', requestId, error);
          logger.error(`请求错误`, { requestId, error });
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`请求异常`, { requestId, error: errorMessage });
      this.socket.emit('pluginError', requestId, errorMessage);
    }
  }

  close(): void {
    this.socket.disconnect();
    logger.info('OpenClaw Channel Plugin 已停止');
    logger.close();
  }

  printSummary(): void {
    logger.info('═══════════════════════════════════════════════════════');
    logger.info('       OpenClaw Channel Plugin (安全连接模式)');
    logger.info('═══════════════════════════════════════════════════════');
    logger.info(`配置文件: ${PLUGIN_CONFIG_PATH}`);
    logger.info(`目标服务器: ${this.config.serverUrl}`);
    logger.info(`Token: ${maskSecret(this.config.token)}`);
    logger.info(`encodingAESKey: ${maskSecret(this.config.encodingAESKey)}`);
    logger.info(`OpenClaw CLI: ${this.config.openclawPath}`);
    logger.info('───────────────────────────────────────────────────────');
  }

  private printMissingCredentialTips(): void {
    logger.error('插件缺少安全凭证，未启动连接');
    logger.error(`请编辑文件: ${PLUGIN_CONFIG_PATH}`);
    logger.error('填写最新的 token 和 encodingAESKey 后重新启动插件');
  }
}

const config = loadPluginConfig();
const plugin = new OpenClawChannelPlugin(config);
plugin.printSummary();
plugin.start();

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  plugin.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  plugin.close();
  process.exit(0);
});
