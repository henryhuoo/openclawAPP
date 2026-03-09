// 消息类型
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// Socket.IO 事件类型
export interface ServerToClientEvents {
  connected: () => void;
  message: (message: Message) => void;
  streamStart: (messageId: string) => void;
  streamChunk: (messageId: string, chunk: string) => void;
  streamEnd: (messageId: string) => void;
  error: (error: string) => void;
}

export interface ClientToServerEvents {
  sendMessage: (
    content: string,
    callback: (response: { success: boolean; messageId?: string; error?: string }) => void
  ) => void;
  getHistory: (callback: (messages: Message[]) => void) => void;
  clearHistory: (callback: (success: boolean) => void) => void;
}

// OpenClaw 相关类型
export interface OpenClawConfig {
  apiEndpoint?: string;
  apiKey?: string;
  model?: string;
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}
