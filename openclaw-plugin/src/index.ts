import WebSocket, { WebSocketServer } from 'ws';
import { OpenClawConnector } from './openclaw-connector';

interface ClientRequest {
  requestId: string;
  type: 'chat' | 'command';
  content: string;
}

interface PluginResponse {
  requestId: string;
  type: 'chunk' | 'complete' | 'error';
  content?: string;
  error?: string;
}

/**
 * OpenClaw Channel Plugin
 * 
 * 这个插件作为 OpenClaw 和后端服务之间的桥梁：
 * 1. 启动 WebSocket 服务器，接收来自后端服务的请求
 * 2. 将请求转发给本地 OpenClaw
 * 3. 将 OpenClaw 的响应流式传回后端服务
 */
class OpenClawChannelPlugin {
  private wss: WebSocketServer;
  private openclawConnector: OpenClawConnector;
  private clients: Set<WebSocket> = new Set();

  constructor(port: number = 3002) {
    // 创建 WebSocket 服务器
    this.wss = new WebSocketServer({ port });
    this.openclawConnector = new OpenClawConnector();

    console.log(`🔌 OpenClaw Channel Plugin started on port ${port}`);

    this.wss.on('connection', (ws) => {
      console.log('📱 Client connected to channel');
      this.clients.add(ws);

      ws.on('message', async (data) => {
        try {
          const request: ClientRequest = JSON.parse(data.toString());
          await this.handleRequest(ws, request);
        } catch (error) {
          console.error('Failed to process message:', error);
          this.sendError(ws, 'unknown', 'Failed to process request');
        }
      });

      ws.on('close', () => {
        console.log('📱 Client disconnected from channel');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  /**
   * 处理来自后端服务的请求
   */
  private async handleRequest(ws: WebSocket, request: ClientRequest): Promise<void> {
    const { requestId, type, content } = request;

    console.log(`📨 Received request [${requestId}]: ${content.substring(0, 50)}...`);

    try {
      await this.openclawConnector.sendMessage(content, {
        onChunk: (chunk) => {
          this.sendResponse(ws, {
            requestId,
            type: 'chunk',
            content: chunk,
          });
        },
        onComplete: () => {
          this.sendResponse(ws, {
            requestId,
            type: 'complete',
          });
          console.log(`✅ Request [${requestId}] completed`);
        },
        onError: (error) => {
          this.sendError(ws, requestId, error);
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(ws, requestId, errorMessage);
    }
  }

  /**
   * 发送响应到后端服务
   */
  private sendResponse(ws: WebSocket, response: PluginResponse): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
    }
  }

  /**
   * 发送错误响应
   */
  private sendError(ws: WebSocket, requestId: string, error: string): void {
    console.error(`❌ Request [${requestId}] error:`, error);
    this.sendResponse(ws, {
      requestId,
      type: 'error',
      error,
    });
  }

  /**
   * 关闭插件
   */
  close(): void {
    this.clients.forEach((ws) => ws.close());
    this.wss.close();
    console.log('🔌 OpenClaw Channel Plugin stopped');
  }
}

// 启动插件
const PORT = parseInt(process.env.PLUGIN_PORT || '3002', 10);
const plugin = new OpenClawChannelPlugin(PORT);

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  plugin.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  plugin.close();
  process.exit(0);
});
