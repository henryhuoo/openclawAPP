// 共享类型定义

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ConversationSession {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface ServerToClientEvents {
  message: (msg: Message) => void;
  connected: () => void;
  disconnected: () => void;
  error: (error: string) => void;
  streamStart: (messageId: string) => void;
  streamChunk: (messageId: string, chunk: string) => void;
  streamEnd: (messageId: string) => void;
}

export interface ClientToServerEvents {
  sendMessage: (content: string, callback: (response: { success: boolean; messageId?: string; error?: string }) => void) => void;
  getHistory: (callback: (messages: Message[]) => void) => void;
  clearHistory: (callback: (success: boolean) => void) => void;
}

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
