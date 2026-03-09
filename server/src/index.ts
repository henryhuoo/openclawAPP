import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { Message, ServerToClientEvents, ClientToServerEvents } from './types';

const app = express();
const httpServer = createServer(app);

// 配置 Socket.IO
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// 存储会话消息
const sessions: Map<string, Message[]> = new Map();

// ============ OpenClaw 插件管理 ============
let openclawPlugin: Socket | null = null;
const pendingRequests: Map<string, {
  socket: Socket;
  assistantMessageId: string;
  fullResponse: string;
  sessionMessages: Message[];
}> = new Map();

// 插件命名空间 - 用于本地插件反向连接
const pluginNamespace = io.of('/plugin');

pluginNamespace.on('connection', (pluginSocket: any) => {
  console.log(`🔌 OpenClaw Plugin connected: ${pluginSocket.id}`);
  openclawPlugin = pluginSocket;

  // 插件发送消息块
  pluginSocket.on('chunk', (requestId: string, chunk: string) => {
    const request = pendingRequests.get(requestId);
    if (request) {
      request.fullResponse += chunk;
      request.socket.emit('streamChunk', request.assistantMessageId, chunk);
    }
  });

  // 插件完成响应
  pluginSocket.on('complete', (requestId: string) => {
    const request = pendingRequests.get(requestId);
    if (request) {
      request.socket.emit('streamEnd', request.assistantMessageId);
      
      // 保存助手消息
      const assistantMessage: Message = {
        id: request.assistantMessageId,
        role: 'assistant',
        content: request.fullResponse,
        timestamp: Date.now(),
      };
      request.sessionMessages.push(assistantMessage);
      
      pendingRequests.delete(requestId);
      console.log(`✅ Request [${requestId}] completed`);
    }
  });

  // 插件发送错误
  pluginSocket.on('pluginError', (requestId: string, error: string) => {
    const request = pendingRequests.get(requestId);
    if (request) {
      request.socket.emit('error', error);
      request.socket.emit('streamEnd', request.assistantMessageId);
      pendingRequests.delete(requestId);
      console.log(`❌ Request [${requestId}] error: ${error}`);
    }
  });

  pluginSocket.on('disconnect', () => {
    console.log(`🔌 OpenClaw Plugin disconnected: ${pluginSocket.id}`);
    if (openclawPlugin === pluginSocket) {
      openclawPlugin = null;
    }
  });
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    pluginConnected: openclawPlugin !== null 
  });
});

// ============ 客户端连接处理 ============
io.on('connection', (socket) => {
  console.log(`📱 Client connected: ${socket.id}`);
  
  const sessionId = socket.id;
  sessions.set(sessionId, []);
  
  socket.emit('connected');

  // 处理发送消息
  socket.on('sendMessage', async (content, callback) => {
    try {
      // 检查插件是否连接
      if (!openclawPlugin) {
        callback({ success: false, error: 'OpenClaw 插件未连接，请在本地启动插件' });
        socket.emit('error', 'OpenClaw 插件未连接');
        return;
      }

      const userMessage: Message = {
        id: uuidv4(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      // 保存用户消息
      const sessionMessages = sessions.get(sessionId) || [];
      sessionMessages.push(userMessage);
      sessions.set(sessionId, sessionMessages);

      // 发送给客户端确认
      socket.emit('message', userMessage);

      // 创建请求
      const requestId = uuidv4();
      const assistantMessageId = uuidv4();
      
      // 存储请求上下文
      pendingRequests.set(requestId, {
        socket,
        assistantMessageId,
        fullResponse: '',
        sessionMessages,
      });

      // 通知流开始
      socket.emit('streamStart', assistantMessageId);

      // 发送请求到插件
      openclawPlugin.emit('request', {
        requestId,
        type: 'chat',
        content,
      });

      callback({ success: true, messageId: userMessage.id });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      callback({ success: false, error: errorMessage });
      socket.emit('error', errorMessage);
    }
  });

  // 获取历史消息
  socket.on('getHistory', (callback) => {
    const messages = sessions.get(sessionId) || [];
    callback(messages);
  });

  // 清除历史
  socket.on('clearHistory', (callback) => {
    sessions.set(sessionId, []);
    callback(true);
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`📱 Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`🚀 OpenClaw Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   等待 OpenClaw 插件连接到 /plugin 命名空间...`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  httpServer.close(() => {
    process.exit(0);
  });
});
