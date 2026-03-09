import WebSocket from 'ws';
import { EventEmitter } from 'events';

interface MessageCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

/**
 * OpenClaw 桥接器
 * 负责与本地 OpenClaw Channel 插件通信
 */
export class OpenClawBridge extends EventEmitter {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private pendingCallbacks: Map<string, MessageCallbacks> = new Map();
  private messageCounter = 0;

  // OpenClaw Channel 插件的 WebSocket 地址
  private channelUrl: string;

  constructor(channelUrl?: string) {
    super();
    this.channelUrl = channelUrl || process.env.OPENCLAW_CHANNEL_URL || 'ws://localhost:3002';
    this.connect();
  }

  private connect(): void {
    try {
      console.log(`Connecting to OpenClaw Channel at ${this.channelUrl}...`);
      
      this.ws = new WebSocket(this.channelUrl);

      this.ws.on('open', () => {
        console.log('✅ Connected to OpenClaw Channel');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        console.log('OpenClaw Channel connection closed');
        this.isConnected = false;
        this.emit('disconnected');
        this.attemptReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('OpenClaw Channel error:', error.message);
        this.emit('error', error.message);
      });
    } catch (error) {
      console.error('Failed to connect to OpenClaw Channel:', error);
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
    
    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  private handleMessage(rawData: string): void {
    try {
      const data = JSON.parse(rawData);
      const { requestId, type, content, error } = data;

      const callbacks = this.pendingCallbacks.get(requestId);
      if (!callbacks) {
        console.warn(`No callbacks found for request ${requestId}`);
        return;
      }

      switch (type) {
        case 'chunk':
          callbacks.onChunk(content);
          break;
        case 'complete':
          callbacks.onComplete();
          this.pendingCallbacks.delete(requestId);
          break;
        case 'error':
          callbacks.onError(error || 'Unknown error from OpenClaw');
          this.pendingCallbacks.delete(requestId);
          break;
        default:
          console.warn(`Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error('Failed to parse message from OpenClaw:', error);
    }
  }

  /**
   * 发送消息到 OpenClaw
   */
  async sendMessage(content: string, callbacks: MessageCallbacks): Promise<void> {
    if (!this.isConnected || !this.ws) {
      // 如果未连接，模拟响应用于测试
      console.warn('OpenClaw Channel not connected, using mock response');
      this.mockResponse(content, callbacks);
      return;
    }

    const requestId = `req_${++this.messageCounter}_${Date.now()}`;
    this.pendingCallbacks.set(requestId, callbacks);

    const message = JSON.stringify({
      requestId,
      type: 'chat',
      content,
    });

    this.ws.send(message);
  }

  /**
   * 模拟响应（用于测试或未连接状态）
   */
  private mockResponse(content: string, callbacks: MessageCallbacks): void {
    const mockReply = `[Mock Response] 收到您的消息: "${content}"\n\n这是一个模拟响应，因为 OpenClaw Channel 尚未连接。请确保 OpenClaw Channel 插件正在运行。`;
    
    // 模拟流式输出
    const words = mockReply.split('');
    let index = 0;

    const streamInterval = setInterval(() => {
      if (index < words.length) {
        callbacks.onChunk(words[index]);
        index++;
      } else {
        clearInterval(streamInterval);
        callbacks.onComplete();
      }
    }, 20);
  }

  /**
   * 检查连接状态
   */
  isConnectionActive(): boolean {
    return this.isConnected;
  }

  /**
   * 关闭连接
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
