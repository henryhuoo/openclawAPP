// 共享类型定义

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ConversationSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

// ============ 安全认证类型 ============

export interface AuthChallenge {
  nonce: string;
  timestamp: number;
  expiresAt: number;
  credentialVersion: string;
}

export interface AuthRequest {
  nonce: string;
  timestamp: number;
  credentialVersion: string;
  proof: string;
}

export interface AuthResponse {
  success: boolean;
  credentialVersion: string;
  error?: string;
}

export interface SecurityBootstrapResponse {
  credentialVersion: string;
  tokenHint: string;
  encodingAESKeyHint: string;
  issuedAt: number;
}

// ============ Session 相关类型 ============

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// ============ Socket.IO 事件类型 ============

export interface ServerToClientEvents {
  connected: () => void;
  disconnected: () => void;
  authChallenge: (challenge: AuthChallenge) => void;
  message: (msg: Message) => void;
  streamStart: (messageId: string) => void;
  streamChunk: (messageId: string, chunk: string) => void;
  streamEnd: (messageId: string) => void;
  error: (error: string) => void;
  requestStopped: (requestId: string) => void;
}

export interface ClientToServerEvents {
  authenticate: (payload: AuthRequest, callback: (response: AuthResponse) => void) => void;
  sendMessage: (content: string, callback: (response: { success: boolean; messageId?: string; error?: string }) => void) => void;
  getHistory: (callback: (messages: Message[]) => void) => void;
  clearHistory: (callback: (success: boolean) => void) => void;
  // Session management
  createSession: (callback: (response: SessionInfo | { error: string }) => void) => void;
  switchSession: (sessionId: string, callback: (response: { success: boolean; messages: Message[]; error?: string }) => void) => void;
  listSessions: (callback: (sessions: SessionInfo[]) => void) => void;
  deleteSession: (sessionId: string, callback: (success: boolean) => void) => void;
  // Stop request
  stopRequest: (callback: (response: { success: boolean; error?: string }) => void) => void;
}

// ============ OpenClaw 相关类型 ============

export interface OpenClawRequest {
  type: 'chat' | 'command';
  content: string;
  sessionId?: string;
}

export interface OpenClawResponse {
  type: 'message' | 'stream_start' | 'stream_chunk' | 'stream_end' | 'error';
  content?: string;
  messageId?: string;
  error?: string;
}
