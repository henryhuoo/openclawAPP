import express from 'express';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { loadServerConfig } from './config';
import { logger } from './logger';
import {
  createAuthProof,
  createSecurityChallenge,
  getOrCreateRuntimeCredentials,
  maskSecret,
  type AuthRole,
  type SecurityChallengeRecord,
  verifyAuthProof,
} from './security';
import type {
  AuthRequest,
  AuthResponse,
  ClientToServerEvents,
  ConversationSession,
  Message,
  SecurityBootstrapResponse,
  ServerToClientEvents,
  SessionInfo,
} from './types';

const config = loadServerConfig();

// 解析命令行参数
const forceRenew = process.argv.includes('--force-renew');
const [runtimeSecurity, isNewCredentials] = getOrCreateRuntimeCredentials(forceRenew);

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// 生产模式下托管客户端静态文件
const clientDistPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDistPath));

type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type PluginSocket = Socket;

interface PendingRequestContext {
  socket: ClientSocket;
  assistantMessageId: string;
  fullResponse: string;
  session: ConversationSession;
}

// Map<socketId, Map<sessionId, ConversationSession>>
const clientSessions = new Map<string, Map<string, ConversationSession>>();
// Map<socketId, currentSessionId>
const activeSessionId = new Map<string, string>();
const pendingRequests = new Map<string, PendingRequestContext>();
// Map<socketId, requestId> — track active request per client for stop
const clientActiveRequest = new Map<string, string>();
const clientChallenges = new Map<string, SecurityChallengeRecord>();
const pluginChallenges = new Map<string, SecurityChallengeRecord>();

let openclawPlugin: PluginSocket | null = null;

function createNewSession(): ConversationSession {
  const now = Date.now();
  return {
    id: uuidv4(),
    title: '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function deriveSessionTitle(messages: Message[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return '新对话';
  const text = firstUserMsg.content.trim();
  return text.length > 30 ? text.slice(0, 30) + '...' : text;
}

function toSessionInfo(session: ConversationSession): SessionInfo {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

function getOrCreateClientSessions(socketId: string): Map<string, ConversationSession> {
  let map = clientSessions.get(socketId);
  if (!map) {
    map = new Map();
    clientSessions.set(socketId, map);
  }
  return map;
}

function getOrCreateActiveSession(socketId: string): ConversationSession {
  const sessionsMap = getOrCreateClientSessions(socketId);
  let sessionId = activeSessionId.get(socketId);
  if (sessionId) {
    const session = sessionsMap.get(sessionId);
    if (session) return session;
  }
  // Create default session
  const session = createNewSession();
  sessionsMap.set(session.id, session);
  activeSessionId.set(socketId, session.id);
  return session;
}

function buildSecurityBootstrap(): SecurityBootstrapResponse {
  return {
    credentialVersion: runtimeSecurity.credentialVersion,
    tokenHint: maskSecret(runtimeSecurity.token),
    encodingAESKeyHint: maskSecret(runtimeSecurity.encodingAESKey),
    issuedAt: runtimeSecurity.issuedAt,
  };
}

function syncCredentialsToPlugin(token: string, encodingAESKey: string): void {
  const pluginConfigPath = path.resolve(__dirname, '../../openclaw-plugin/config.json');
  try {
    if (!fs.existsSync(pluginConfigPath)) {
      logger.debug('openclaw-plugin/config.json 不存在，跳过凭证同步');
      return;
    }

    const raw = fs.readFileSync(pluginConfigPath, 'utf-8');
    const pluginConfig = JSON.parse(raw);

    if (pluginConfig.token === token && pluginConfig.encodingAESKey === encodingAESKey) {
      logger.info('Plugin 凭证已是最新，无需同步');
      return;
    }

    pluginConfig.token = token;
    pluginConfig.encodingAESKey = encodingAESKey;
    fs.writeFileSync(pluginConfigPath, JSON.stringify(pluginConfig, null, 2) + '\n', 'utf-8');
    logger.info('已自动同步凭证到 openclaw-plugin/config.json');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('同步凭证到 plugin 失败（可忽略，远程部署时无此文件）', { error: msg });
  }
}

function issueChallenge(socket: Socket, store: Map<string, SecurityChallengeRecord>): void {
  const challenge = createSecurityChallenge(config.authChallengeTtlMs);
  store.set(socket.id, challenge);
  socket.emit('authChallenge', {
    ...challenge,
    credentialVersion: runtimeSecurity.credentialVersion,
  });
}

function authenticateSocket(
  socket: Socket,
  role: AuthRole,
  store: Map<string, SecurityChallengeRecord>,
  payload: AuthRequest
): AuthResponse {
  const challenge = store.get(socket.id);

  if (!challenge) {
    logger.warn(`认证挑战不存在`, { socketId: socket.id, role });
    issueChallenge(socket, store);
    return {
      success: false,
      credentialVersion: runtimeSecurity.credentialVersion,
      error: '认证挑战不存在，请重试连接',
    };
  }

  if (Date.now() > challenge.expiresAt) {
    logger.warn(`认证挑战已过期`, { socketId: socket.id, role });
    issueChallenge(socket, store);
    return {
      success: false,
      credentialVersion: runtimeSecurity.credentialVersion,
      error: '认证挑战已过期，请重新输入安全凭证',
    };
  }

  if (payload.credentialVersion !== runtimeSecurity.credentialVersion) {
    logger.warn(`凭证版本不匹配`, { socketId: socket.id, role });
    issueChallenge(socket, store);
    return {
      success: false,
      credentialVersion: runtimeSecurity.credentialVersion,
      error: '服务器安全凭证已更新，请重新输入 token 和 encodingAESKey',
    };
  }

  if (payload.nonce !== challenge.nonce || payload.timestamp !== challenge.timestamp) {
    logger.warn(`挑战校验失败 (nonce/timestamp 不匹配)`, { socketId: socket.id, role });
    issueChallenge(socket, store);
    return {
      success: false,
      credentialVersion: runtimeSecurity.credentialVersion,
      error: '认证挑战校验失败，请重新连接后重试',
    };
  }

  const expectedProof = createAuthProof({
    role,
    socketId: socket.id,
    nonce: challenge.nonce,
    timestamp: challenge.timestamp,
    token: runtimeSecurity.token,
    encodingAESKey: runtimeSecurity.encodingAESKey,
  });

  if (!verifyAuthProof(payload.proof, expectedProof)) {
    logger.warn(`身份认证失败 (proof 不匹配)`, { socketId: socket.id, role });
    issueChallenge(socket, store);
    return {
      success: false,
      credentialVersion: runtimeSecurity.credentialVersion,
      error: '身份认证失败，请检查 token 和 encodingAESKey 是否正确',
    };
  }

  store.delete(socket.id);
  socket.data.authenticated = true;
  socket.data.authenticatedRole = role;

  return {
    success: true,
    credentialVersion: runtimeSecurity.credentialVersion,
  };
}

function ensureClientAuthenticated(
  socket: ClientSocket,
  callback: (response: { success: boolean; error?: string }) => void
): boolean {
  if (socket.data.authenticated === true && socket.data.authenticatedRole === 'client') {
    return true;
  }

  issueChallenge(socket, clientChallenges);
  callback({ success: false, error: '请先完成安全认证' });
  socket.emit('error', '请先完成安全认证');
  return false;
}

function failPendingRequest(requestId: string, errorMessage: string): void {
  const request = pendingRequests.get(requestId);
  if (!request) {
    return;
  }

  request.socket.emit('error', errorMessage);
  request.socket.emit('streamEnd', request.assistantMessageId);
  pendingRequests.delete(requestId);
}

function failAllPendingRequests(errorMessage: string): void {
  const requestIds = Array.from(pendingRequests.keys());
  requestIds.forEach((requestId) => {
    failPendingRequest(requestId, errorMessage);
  });
}

const pluginNamespace = io.of('/plugin');

pluginNamespace.on('connection', (pluginSocket: PluginSocket) => {
  logger.info(`OpenClaw Plugin 传输层连接`, { socketId: pluginSocket.id });
  issueChallenge(pluginSocket, pluginChallenges);

  pluginSocket.on('authenticate', (payload: AuthRequest, callback: (response: AuthResponse) => void) => {
    const response = authenticateSocket(pluginSocket, 'plugin', pluginChallenges, payload);
    callback(response);

    if (!response.success) {
      logger.warn(`OpenClaw Plugin 认证失败`, { socketId: pluginSocket.id, error: response.error });
      return;
    }

    if (openclawPlugin && openclawPlugin.id !== pluginSocket.id) {
      logger.info(`替换旧插件连接`, { oldSocketId: openclawPlugin.id, newSocketId: pluginSocket.id });
      openclawPlugin.disconnect(true);
    }

    openclawPlugin = pluginSocket;
    logger.info(`OpenClaw Plugin 认证成功`, { socketId: pluginSocket.id });
  });

  pluginSocket.on('chunk', (requestId: string, chunk: string) => {
    if (openclawPlugin !== pluginSocket || pluginSocket.data.authenticated !== true) {
      return;
    }

    const request = pendingRequests.get(requestId);
    if (!request) {
      return;
    }

    request.fullResponse += chunk;
    request.socket.emit('streamChunk', request.assistantMessageId, chunk);
  });

  pluginSocket.on('complete', (requestId: string) => {
    if (openclawPlugin !== pluginSocket || pluginSocket.data.authenticated !== true) {
      return;
    }

    const request = pendingRequests.get(requestId);
    if (!request) {
      return;
    }

    request.socket.emit('streamEnd', request.assistantMessageId);

    const assistantMessage: Message = {
      id: request.assistantMessageId,
      role: 'assistant',
      content: request.fullResponse,
      timestamp: Date.now(),
    };

    request.session.messages.push(assistantMessage);
    request.session.updatedAt = Date.now();
    // Auto-update title from first user message
    if (request.session.title === '新对话') {
      request.session.title = deriveSessionTitle(request.session.messages);
    }
    pendingRequests.delete(requestId);
    clientActiveRequest.delete(request.socket.id);
    logger.info(`请求完成`, { requestId });
  });

  pluginSocket.on('pluginError', (requestId: string, error: string) => {
    if (openclawPlugin !== pluginSocket || pluginSocket.data.authenticated !== true) {
      return;
    }

    logger.error(`请求错误`, { requestId, error });
    failPendingRequest(requestId, error);
    // Clean up active request tracking
    const request = pendingRequests.get(requestId);
    if (request) {
      clientActiveRequest.delete(request.socket.id);
    }
  });

  pluginSocket.on('disconnect', () => {
    pluginChallenges.delete(pluginSocket.id);
    logger.info(`OpenClaw Plugin 断开连接`, { socketId: pluginSocket.id });

    if (openclawPlugin === pluginSocket) {
      openclawPlugin = null;
      failAllPendingRequests('OpenClaw 插件已断开连接');
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    pluginConnected: openclawPlugin !== null,
  });
});

app.get('/security/bootstrap', (_req, res) => {
  logger.debug(`Bootstrap 接口被访问`);
  res.setHeader('Cache-Control', 'no-store');
  res.json(buildSecurityBootstrap());
});

io.on('connection', (socket: ClientSocket) => {
  logger.info(`客户端传输层连接`, { socketId: socket.id });
  issueChallenge(socket, clientChallenges);

  socket.on('authenticate', (payload, callback) => {
    const response = authenticateSocket(socket, 'client', clientChallenges, payload);
    callback(response);

    if (!response.success) {
      logger.warn(`客户端认证失败`, { socketId: socket.id, error: response.error });
      return;
    }

    // Ensure client has at least one session
    getOrCreateActiveSession(socket.id);
    socket.emit('connected');
    logger.info(`客户端认证成功`, { socketId: socket.id });
  });

  socket.on('sendMessage', async (content, callback) => {
    if (!ensureClientAuthenticated(socket, callback)) {
      return;
    }

    if (!openclawPlugin) {
      logger.warn(`客户端发送消息但插件未连接`, { socketId: socket.id });
      callback({ success: false, error: 'OpenClaw 插件未连接，请检查插件配置和认证状态' });
      socket.emit('error', 'OpenClaw 插件未连接');
      return;
    }

    try {
      const session = getOrCreateActiveSession(socket.id);

      const userMessage: Message = {
        id: uuidv4(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      session.messages.push(userMessage);
      session.updatedAt = Date.now();
      // Auto-update title
      if (session.title === '新对话') {
        session.title = deriveSessionTitle(session.messages);
      }

      socket.emit('message', userMessage);

      const requestId = uuidv4();
      const assistantMessageId = uuidv4();

      pendingRequests.set(requestId, {
        socket,
        assistantMessageId,
        fullResponse: '',
        session,
      });

      clientActiveRequest.set(socket.id, requestId);

      socket.emit('streamStart', assistantMessageId);
      openclawPlugin.emit('request', {
        requestId,
        type: 'chat',
        content,
      });

      logger.info(`新消息请求`, { requestId, socketId: socket.id, contentLength: content.length });
      callback({ success: true, messageId: userMessage.id });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`消息处理异常`, { socketId: socket.id, error: errorMessage });
      callback({ success: false, error: errorMessage });
      socket.emit('error', errorMessage);
    }
  });

  socket.on('getHistory', (callback) => {
    if (socket.data.authenticated !== true || socket.data.authenticatedRole !== 'client') {
      callback([]);
      socket.emit('error', '请先完成安全认证');
      return;
    }

    const session = getOrCreateActiveSession(socket.id);
    callback(session.messages);
  });

  socket.on('clearHistory', (callback) => {
    if (socket.data.authenticated !== true || socket.data.authenticatedRole !== 'client') {
      callback(false);
      socket.emit('error', '请先完成安全认证');
      return;
    }

    // Clear current session messages
    const session = getOrCreateActiveSession(socket.id);
    session.messages = [];
    session.updatedAt = Date.now();
    session.title = '新对话';

    // Notify plugin to reset OpenClaw CLI session
    if (openclawPlugin) {
      openclawPlugin.emit('resetSession');
      logger.info(`已通知插件重置 OpenClaw 会话`);
    }

    // Cancel pending requests for this client
    const pendingIds = Array.from(pendingRequests.keys());
    for (const requestId of pendingIds) {
      const req = pendingRequests.get(requestId);
      if (req && req.socket.id === socket.id) {
        failPendingRequest(requestId, '对话已清空');
      }
    }
    clientActiveRequest.delete(socket.id);

    logger.info(`客户端清空历史记录`, { socketId: socket.id });
    callback(true);
  });

  // ---- Session management ----

  socket.on('createSession', (callback) => {
    if (socket.data.authenticated !== true || socket.data.authenticatedRole !== 'client') {
      callback({ error: '请先完成安全认证' });
      return;
    }

    const sessionsMap = getOrCreateClientSessions(socket.id);
    const session = createNewSession();
    sessionsMap.set(session.id, session);
    activeSessionId.set(socket.id, session.id);

    // Notify plugin to reset CLI session for clean context
    if (openclawPlugin) {
      openclawPlugin.emit('resetSession');
    }

    logger.info(`客户端创建新会话`, { socketId: socket.id, sessionId: session.id });
    callback(toSessionInfo(session));
  });

  socket.on('switchSession', (sessionId, callback) => {
    if (socket.data.authenticated !== true || socket.data.authenticatedRole !== 'client') {
      callback({ success: false, messages: [], error: '请先完成安全认证' });
      return;
    }

    const sessionsMap = getOrCreateClientSessions(socket.id);
    const session = sessionsMap.get(sessionId);

    if (!session) {
      callback({ success: false, messages: [], error: '会话不存在' });
      return;
    }

    activeSessionId.set(socket.id, sessionId);

    // Reset plugin session when switching
    if (openclawPlugin) {
      openclawPlugin.emit('resetSession');
    }

    logger.info(`客户端切换会话`, { socketId: socket.id, sessionId });
    callback({ success: true, messages: session.messages });
  });

  socket.on('listSessions', (callback) => {
    if (socket.data.authenticated !== true || socket.data.authenticatedRole !== 'client') {
      callback([]);
      return;
    }

    const sessionsMap = getOrCreateClientSessions(socket.id);
    const list = Array.from(sessionsMap.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toSessionInfo);

    callback(list);
  });

  socket.on('deleteSession', (sessionId, callback) => {
    if (socket.data.authenticated !== true || socket.data.authenticatedRole !== 'client') {
      callback(false);
      return;
    }

    const sessionsMap = getOrCreateClientSessions(socket.id);
    const currentActiveId = activeSessionId.get(socket.id);

    // Don't allow deleting the last session
    if (sessionsMap.size <= 1) {
      callback(false);
      return;
    }

    sessionsMap.delete(sessionId);

    // If deleted active session, switch to most recent remaining
    if (currentActiveId === sessionId) {
      const remaining = Array.from(sessionsMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      if (remaining.length > 0) {
        activeSessionId.set(socket.id, remaining[0].id);
      }
    }

    logger.info(`客户端删除会话`, { socketId: socket.id, sessionId });
    callback(true);
  });

  // ---- Stop request ----

  socket.on('stopRequest', (callback) => {
    if (socket.data.authenticated !== true || socket.data.authenticatedRole !== 'client') {
      callback({ success: false, error: '请先完成安全认证' });
      return;
    }

    const requestId = clientActiveRequest.get(socket.id);
    if (!requestId) {
      callback({ success: false, error: '当前没有正在进行的请求' });
      return;
    }

    const request = pendingRequests.get(requestId);
    if (!request) {
      clientActiveRequest.delete(socket.id);
      callback({ success: false, error: '请求已完成' });
      return;
    }

    // Save partial response as assistant message
    if (request.fullResponse.trim()) {
      const assistantMessage: Message = {
        id: request.assistantMessageId,
        role: 'assistant',
        content: request.fullResponse + '\n\n*[已停止]*',
        timestamp: Date.now(),
      };
      request.session.messages.push(assistantMessage);
      request.session.updatedAt = Date.now();
      if (request.session.title === '新对话') {
        request.session.title = deriveSessionTitle(request.session.messages);
      }
    }

    request.socket.emit('streamEnd', request.assistantMessageId);
    request.socket.emit('requestStopped', requestId);

    pendingRequests.delete(requestId);
    clientActiveRequest.delete(socket.id);

    // Tell plugin to cancel current process
    if (openclawPlugin) {
      openclawPlugin.emit('cancelRequest', requestId);
    }

    logger.info(`客户端停止请求`, { socketId: socket.id, requestId });
    callback({ success: true });
  });

  socket.on('disconnect', () => {
    clientChallenges.delete(socket.id);
    clientSessions.delete(socket.id);
    activeSessionId.delete(socket.id);
    clientActiveRequest.delete(socket.id);
    logger.info(`客户端断开连接`, { socketId: socket.id });
  });
});

// SPA fallback: 所有未匹配的路由返回 index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

httpServer.listen(config.port, () => {
  const expiresDate = new Date(runtimeSecurity.expiresAt).toLocaleDateString('zh-CN');
  const remainDays = Math.ceil((runtimeSecurity.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));

  logger.info('═══════════════════════════════════════════════════════');
  logger.info('            OpenClaw Server 已启动');
  logger.info('═══════════════════════════════════════════════════════');
  logger.info(`Port: ${config.port}`);

  if (isNewCredentials) {
    logger.info(`凭证状态: ★ 新生成${forceRenew ? '（强制更新）' : ''}`);
  } else {
    logger.info(`凭证状态: 复用已有凭证（剩余 ${remainDays} 天，${expiresDate} 过期）`);
  }

  logger.info(`Token: ${runtimeSecurity.token}`);
  logger.info(`encodingAESKey: ${runtimeSecurity.encodingAESKey}`);
  logger.info(`Token Hint: ${maskSecret(runtimeSecurity.token)}`);
  logger.info(`Key Hint: ${maskSecret(runtimeSecurity.encodingAESKey)}`);
  logger.info(`Credential Version: ${runtimeSecurity.credentialVersion}`);
  logger.info(`Health check: http://localhost:${config.port}/health`);
  logger.info(`Bootstrap: http://localhost:${config.port}/security/bootstrap`);
  logger.info('凭证有效期 30 天，使用 --force-renew 参数可强制更新');

  // 自动同步凭证到本地 openclaw-plugin/config.json
  syncCredentialsToPlugin(runtimeSecurity.token, runtimeSecurity.encodingAESKey);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  logger.close();
  httpServer.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down...');
  logger.close();
  httpServer.close(() => {
    process.exit(0);
  });
});
