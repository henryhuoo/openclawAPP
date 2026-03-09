import { io, Socket } from 'socket.io-client';
import { OpenClawConnector } from './openclaw-connector';

interface PluginRequest {
  requestId: string;
  type: 'chat' | 'command';
  content: string;
}

/**
 * OpenClaw Channel Plugin (反向连接模式)
 * 
 * 这个插件主动连接到远程服务器：
 * 1. 作为 Socket.IO 客户端连接到服务器的 /plugin 命名空间
 * 2. 接收来自服务器的请求
 * 3. 将请求转发给本地 OpenClaw
 * 4. 将 OpenClaw 的响应流式传回服务器
 */
class OpenClawChannelPlugin {
  private socket: Socket;
  private openclawConnector: OpenClawConnector;
  private serverUrl: string;
  private reconnectInterval: NodeJS.Timeout | null = null;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.openclawConnector = new OpenClawConnector();
    
    // 连接到服务器的插件命名空间
    this.socket = io(`${serverUrl}/plugin`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 3000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.socket.on('connect', () => {
      console.log(`🔌 已连接到服务器: ${this.serverUrl}`);
      console.log(`   Socket ID: ${this.socket.id}`);
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
        this.reconnectInterval = null;
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`❌ 与服务器断开连接: ${reason}`);
    });

    this.socket.on('connect_error', (error) => {
      console.log(`⚠️ 连接错误: ${error.message}`);
      console.log(`   将在 3 秒后重试...`);
    });

    // 接收来自服务器的请求
    this.socket.on('request', async (request: PluginRequest) => {
      await this.handleRequest(request);
    });
  }

  /**
   * 处理来自服务器的请求
   */
  private async handleRequest(request: PluginRequest): Promise<void> {
    const { requestId, content } = request;

    console.log(`📨 收到请求 [${requestId}]: ${content.substring(0, 50)}...`);

    try {
      await this.openclawConnector.sendMessage(content, {
        onChunk: (chunk) => {
          this.socket.emit('chunk', requestId, chunk);
        },
        onComplete: () => {
          this.socket.emit('complete', requestId);
          console.log(`✅ 请求 [${requestId}] 完成`);
        },
        onError: (error) => {
          this.socket.emit('pluginError', requestId, error);
          console.log(`❌ 请求 [${requestId}] 错误: ${error}`);
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.socket.emit('pluginError', requestId, errorMessage);
    }
  }

  /**
   * 关闭插件
   */
  close(): void {
    this.socket.disconnect();
    console.log('🔌 OpenClaw Channel Plugin 已停止');
  }
}

// 从命令行参数或环境变量获取服务器地址
const DEFAULT_SERVER = 'http://43.160.192.190:3001';
const serverUrl = process.argv[2] || process.env.SERVER_URL || DEFAULT_SERVER;

console.log('═══════════════════════════════════════════════════════');
console.log('       OpenClaw Channel Plugin (反向连接模式)');
console.log('═══════════════════════════════════════════════════════');
console.log(`📡 目标服务器: ${serverUrl}`);
console.log('───────────────────────────────────────────────────────');

const plugin = new OpenClawChannelPlugin(serverUrl);

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  plugin.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down...');
  plugin.close();
  process.exit(0);
});
