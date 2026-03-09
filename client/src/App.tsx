import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { Send, Trash2, Loader2, Wifi, WifiOff, Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

const SERVER_URL = 'http://localhost:3001';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 初始化 Socket 连接
  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('connected', () => {
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('message', (msg: Message) => {
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === msg.id);
        if (exists) return prev;
        return [...prev, msg];
      });
    });

    socket.on('streamStart', (messageId: string) => {
      setStreamingMessageId(messageId);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        },
      ]);
    });

    socket.on('streamChunk', (messageId: string, chunk: string) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, content: msg.content + chunk }
            : msg
        )
      );
    });

    socket.on('streamEnd', (messageId: string) => {
      setStreamingMessageId(null);
      setIsLoading(false);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, isStreaming: false }
            : msg
        )
      );
    });

    socket.on('error', (error: string) => {
      console.error('Server error:', error);
      setIsLoading(false);
      setStreamingMessageId(null);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // 发送消息
  const handleSend = useCallback(() => {
    if (!input.trim() || !socketRef.current || isLoading) return;

    const content = input.trim();
    setInput('');
    setIsLoading(true);

    socketRef.current.emit('sendMessage', content, (response) => {
      if (!response.success) {
        console.error('Failed to send message:', response.error);
        setIsLoading(false);
      }
    });

    // 聚焦输入框
    inputRef.current?.focus();
  }, [input, isLoading]);

  // 清空历史
  const handleClear = useCallback(() => {
    if (!socketRef.current) return;
    
    socketRef.current.emit('clearHistory', (success) => {
      if (success) {
        setMessages([]);
      }
    });
  }, []);

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-screen bg-slate-900">
      {/* 顶部栏 */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-800/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">OpenClaw</h1>
            <p className="text-xs text-slate-400">AI Assistant Client</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <Wifi className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-400">已连接</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-400" />
                <span className="text-sm text-red-400">未连接</span>
              </>
            )}
          </div>
          
          <button
            onClick={handleClear}
            className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white"
            title="清空对话"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 消息区域 */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center mb-6">
                <Bot className="w-10 h-10 text-cyan-400" />
              </div>
              <h2 className="text-xl font-medium text-white mb-2">欢迎使用 OpenClaw</h2>
              <p className="text-slate-400 text-center max-w-md">
                开始与 OpenClaw 对话，它可以帮助你完成各种任务
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 ${
                  msg.role === 'user' ? 'flex-row-reverse' : ''
                }`}
              >
                <div
                  className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                    msg.role === 'user'
                      ? 'bg-blue-600'
                      : 'bg-gradient-to-br from-cyan-500 to-blue-600'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <User className="w-5 h-5 text-white" />
                  ) : (
                    <Bot className="w-5 h-5 text-white" />
                  )}
                </div>
                
                <div
                  className={`flex-1 max-w-[80%] ${
                    msg.role === 'user' ? 'text-right' : ''
                  }`}
                >
                  <div
                    className={`inline-block px-4 py-3 rounded-2xl ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-slate-800 text-slate-100 rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="markdown-content">
                        <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
                        {msg.isStreaming && (
                          <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse ml-1" />
                        )}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 px-1">
                    {formatTime(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 输入区域 */}
      <footer className="border-t border-slate-700 bg-slate-800/50 px-4 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Shift+Enter 换行)"
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none"
                rows={1}
                style={{
                  minHeight: '48px',
                  maxHeight: '200px',
                }}
                disabled={!isConnected || isLoading}
              />
            </div>
            
            <button
              onClick={handleSend}
              disabled={!input.trim() || !isConnected || isLoading}
              className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          
          <p className="text-xs text-slate-500 mt-2 text-center">
            OpenClaw Client v1.0.0 · 按 Enter 发送，Shift+Enter 换行
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
