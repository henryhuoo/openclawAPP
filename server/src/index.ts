import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { OpenClawBridge } from './openclaw-bridge';
import type { Message, ServerToClientEvents, ClientToServerEvents } from '../../shared/types';

const app = express();
const httpServer = createServer(app);

// 配置 Socket.IO
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

// 存储会话消息
const sessions: Map<string, Message[]> = new Map();

// OpenClaw 桥接器
const openclawBridge = new OpenClawBridge();

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  const sessionId = socket.id;
  sessions.set(sessionId, []);
  
  socket.emit('connected');

  // 处理发送消息
  socket.on('sendMessage', async (content, callback) => {
    try {
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

      // 创建助手消息ID
      const assistantMessageId = uuidv4();
      
      // 通知流开始
      socket.emit('streamStart', assistantMessageId);

      // 调用 OpenClaw
      let fullResponse = '';
      
      await openclawBridge.sendMessage(content, {
        onChunk: (chunk) => {
          fullResponse += chunk;
          socket.emit('streamChunk', assistantMessageId, chunk);
        },
        onComplete: () => {
          socket.emit('streamEnd', assistantMessageId);
          
          // 保存助手消息
          const assistantMessage: Message = {
            id: assistantMessageId,
            role: 'assistant',
            content: fullResponse,
            timestamp: Date.now(),
          };
          sessionMessages.push(assistantMessage);
          sessions.set(sessionId, sessionMessages);
        },
        onError: (error) => {
          socket.emit('error', error);
        },
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
    console.log(`Client disconnected: ${socket.id}`);
    // 可选：保留或清除会话
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`🚀 OpenClaw Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  httpServer.close(() => {
    process.exit(0);
  });
});
