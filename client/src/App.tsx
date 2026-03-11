import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Send, Trash2, Wifi, WifiOff, Bot, User, Server, Globe,
  ShieldCheck, ShieldAlert, Download, Plus, MessageSquare, Settings,
  X, Square, ChevronLeft, ChevronRight, Trash, Menu,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Mobile detection hook                                              */
/* ------------------------------------------------------------------ */

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return isMobile;
}
import ReactMarkdown from 'react-markdown';
import CryptoJS from 'crypto-js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface AuthChallenge {
  nonce: string;
  timestamp: number;
  expiresAt: number;
  credentialVersion: string;
}

interface AuthResponse {
  success: boolean;
  credentialVersion: string;
  error?: string;
}

interface StoredCredentials {
  token: string;
  encodingAESKey: string;
  credentialVersion: string;
}

interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface ClientConfig {
  token: string;
  encodingAESKey: string;
  serverUrl: string;
}

/* ------------------------------------------------------------------ */
/*  Client Logger                                                      */
/* ------------------------------------------------------------------ */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_STORAGE_KEY = 'openclaw_client_logs';
const MAX_LOG_LINES = 2000;

class ClientLogger {
  private buffer: string[] = [];

  constructor() {
    try {
      const stored = localStorage.getItem(LOG_STORAGE_KEY);
      if (stored) {
        this.buffer = JSON.parse(stored) as string[];
      }
    } catch {
      this.buffer = [];
    }
  }

  private format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] [${level.padEnd(5)}] ${message}${metaStr}`;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = this.format(level, message, meta);
    const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    fn(line);
    this.buffer.push(line);
    if (this.buffer.length > MAX_LOG_LINES) {
      this.buffer = this.buffer.slice(-MAX_LOG_LINES);
    }
    try {
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(this.buffer));
    } catch {
      this.buffer = this.buffer.slice(-500);
      try { localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(this.buffer)); } catch { /* */ }
    }
  }

  debug(msg: string, meta?: Record<string, unknown>) { this.write('DEBUG', msg, meta); }
  info(msg: string, meta?: Record<string, unknown>) { this.write('INFO', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>) { this.write('WARN', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>) { this.write('ERROR', msg, meta); }

  getLogText(): string { return this.buffer.join('\n'); }
  clear(): void { this.buffer = []; localStorage.removeItem(LOG_STORAGE_KEY); }
  download(): void {
    const blob = new Blob([this.getLogText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `client-${new Date().toISOString().slice(0, 10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

const clientLogger = new ClientLogger();

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                 */
/* ------------------------------------------------------------------ */

const LOCAL_SERVER = 'http://localhost:3009';
const REMOTE_SERVER = 'http://43.160.192.190:3009';
const CRED_STORAGE_KEY = 'openclaw_credentials';
const CONFIG_STORAGE_KEY = 'openclaw_client_config';

/**
 * 自动检测当前服务器地址：
 * - 如果通过远程 IP/域名访问页面，直接使用 window.location.origin
 * - 只有在 localhost / 127.0.0.1 访问时才默认本地
 */
function detectServerUrl(): string {
  const { hostname, port, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return LOCAL_SERVER;
  }
  // 用当前页面的 origin（协议+主机+端口）作为服务器地址
  return `${protocol}//${hostname}${port ? ':' + port : ''}`;
}

function loadStoredCredentials(): StoredCredentials | null {
  try {
    const raw = localStorage.getItem(CRED_STORAGE_KEY);
    return raw ? JSON.parse(raw) as StoredCredentials : null;
  } catch { return null; }
}

function saveCredentials(creds: StoredCredentials): void {
  localStorage.setItem(CRED_STORAGE_KEY, JSON.stringify(creds));
}

function clearCredentials(): void {
  localStorage.removeItem(CRED_STORAGE_KEY);
}

function loadClientConfig(): ClientConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) as ClientConfig : null;
  } catch { return null; }
}

function saveClientConfig(config: ClientConfig): void {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

function createCredentialVersion(token: string, encodingAESKey: string): string {
  return CryptoJS.SHA256(`${token}:${encodingAESKey}`).toString();
}

function createAuthProof(
  role: string, socketId: string, nonce: string, timestamp: number,
  token: string, encodingAESKey: string,
): string {
  const message = ['v1', role, socketId, nonce, String(timestamp)].join(':');
  const secret = `${token}:${encodingAESKey}`;
  return CryptoJS.HmacSHA256(message, secret).toString();
}

/* ------------------------------------------------------------------ */
/*  Credential Modal                                                   */
/* ------------------------------------------------------------------ */

function CredentialModal({
  visible, errorMessage, onSubmit, onCancel,
}: {
  visible: boolean; errorMessage: string;
  onSubmit: (token: string, key: string) => void; onCancel: () => void;
}) {
  const [token, setToken] = useState('');
  const [key, setKey] = useState('');

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">安全认证</h2>
            <p className="text-xs text-slate-400">请输入服务器启动时生成的安全凭证</p>
          </div>
        </div>

        {errorMessage && (
          <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
            {errorMessage}
          </div>
        )}

        <div>
          <label className="block text-sm text-slate-300 mb-1.5">Token</label>
          <input type="text" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="粘贴服务器控制台输出的 Token"
            className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm font-mono"
            autoFocus />
        </div>

        <div>
          <label className="block text-sm text-slate-300 mb-1.5">encodingAESKey</label>
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="粘贴服务器控制台输出的 encodingAESKey"
            className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm font-mono" />
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          每次服务器重启都会重新生成 Token 和 encodingAESKey。请从服务器控制台获取最新凭证。
        </p>

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-700 transition-colors">取消</button>
          <button onClick={() => { if (token.trim() && key.trim()) onSubmit(token.trim(), key.trim()); }}
            disabled={!token.trim() || !key.trim()}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
            认证
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings Panel                                                     */
/* ------------------------------------------------------------------ */

function SettingsPanel({
  visible, onClose, config, onSave,
}: {
  visible: boolean; onClose: () => void;
  config: ClientConfig; onSave: (config: ClientConfig) => void;
}) {
  const [token, setToken] = useState(config.token);
  const [key, setKey] = useState(config.encodingAESKey);
  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setToken(config.token);
    setKey(config.encodingAESKey);
    setServerUrl(config.serverUrl);
  }, [config]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">客户端配置</h2>
              <p className="text-xs text-slate-400">配置服务器连接和安全凭证</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-sm text-slate-300 mb-1.5">服务器地址</label>
          <input type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://43.160.192.190:3009"
            className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm font-mono" />
          <div className="flex gap-2 mt-2">
            <button onClick={() => setServerUrl(LOCAL_SERVER)}
              className="px-3 py-1 rounded text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">本地</button>
            <button onClick={() => setServerUrl(REMOTE_SERVER)}
              className="px-3 py-1 rounded text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors">远程</button>
          </div>
        </div>

        <div>
          <label className="block text-sm text-slate-300 mb-1.5">Token</label>
          <input type="text" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="粘贴服务器 Token"
            className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm font-mono" />
        </div>

        <div>
          <label className="block text-sm text-slate-300 mb-1.5">encodingAESKey</label>
          <input type="text" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder="粘贴服务器 encodingAESKey"
            className="w-full px-4 py-2.5 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm font-mono" />
        </div>

        {saved && (
          <div className="text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-4 py-2">
            配置已保存，将自动重连服务器
          </div>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-700 transition-colors">取消</button>
          <button onClick={() => {
            const cfg: ClientConfig = { token: token.trim(), encodingAESKey: key.trim(), serverUrl: serverUrl.trim() };
            onSave(cfg);
            setSaved(true);
            setTimeout(() => { setSaved(false); onClose(); }, 1200);
          }}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-90 transition-opacity">
            保存并应用
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Session Sidebar                                                    */
/* ------------------------------------------------------------------ */

function SessionSidebar({
  visible, sessions, activeSessionId, isMobile,
  onNewSession, onSwitchSession, onDeleteSession, onToggle,
}: {
  visible: boolean; sessions: SessionInfo[]; activeSessionId: string; isMobile: boolean;
  onNewSession: () => void; onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void; onToggle: () => void;
}) {
  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const handleSessionClick = (id: string) => {
    onSwitchSession(id);
    if (isMobile) onToggle();
  };

  return (
    <>
      {/* Toggle button when sidebar is hidden (desktop only) */}
      {!visible && !isMobile && (
        <button onClick={onToggle}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-6 h-16 bg-slate-700 hover:bg-slate-600 rounded-r-lg flex items-center justify-center text-slate-400 hover:text-white transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Mobile overlay backdrop */}
      {isMobile && visible && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onToggle} />
      )}

      {/* Sidebar */}
      <div className={`
        ${isMobile
          ? `fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 ease-in-out ${visible ? 'translate-x-0' : '-translate-x-full'}`
          : `flex-shrink-0 transition-all duration-200 ${visible ? 'w-64' : 'w-0 overflow-hidden'}`
        }
        bg-slate-800 border-r border-slate-700 flex flex-col
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <span className="text-sm font-medium text-slate-300">会话列表</span>
          <div className="flex items-center gap-1">
            <button onClick={onNewSession}
              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="新建会话">
              <Plus className="w-4 h-4" />
            </button>
            <button onClick={onToggle}
              className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors" title="收起侧边栏">
              {isMobile ? <X className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <div key={s.id}
              className={`group flex items-center gap-2 px-3 py-3 cursor-pointer border-l-2 transition-colors ${
                s.id === activeSessionId
                  ? 'bg-slate-700/50 border-cyan-500 text-white'
                  : 'border-transparent text-slate-400 hover:bg-slate-700/30 hover:text-slate-200'
              }`}
              onClick={() => handleSessionClick(s.id)}>
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{s.title}</p>
                <p className="text-xs text-slate-500">{formatDate(s.updatedAt)} · {s.messageCount} 条</p>
              </div>
              {sessions.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                  className={`p-1.5 rounded hover:bg-slate-600 text-slate-500 hover:text-red-400 transition-all ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <Trash className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [, setStreamingMessageId] = useState<string | null>(null);

  // Server URL - initialize from config or localStorage
  const [serverUrl, setServerUrl] = useState(() => {
    const cfg = loadClientConfig();
    if (cfg?.serverUrl) return cfg.serverUrl;
    const stored = localStorage.getItem('serverUrl');
    if (stored) return stored;
    // 自动检测：手机/远程访问时使用当前页面地址
    return detectServerUrl();
  });

  const isRemote = serverUrl === REMOTE_SERVER;
  const isMobile = useIsMobile();

  // Credential modal state
  const [showCredModal, setShowCredModal] = useState(false);
  const [credError, setCredError] = useState('');

  // Settings panel state
  const [showSettings, setShowSettings] = useState(false);

  // Session state
  const [sessionList, setSessionList] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [showSidebar, setShowSidebar] = useState(() => !window.matchMedia('(max-width: 768px)').matches);

  // Message queue: messages waiting to be sent while a request is in progress
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const messageQueueRef = useRef<string[]>([]);

  // Refs
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingChallengeRef = useRef<AuthChallenge | null>(null);
  const storedCredsRef = useRef<StoredCredentials | null>(loadStoredCredentials());
  const isLoadingRef = useRef(false);

  /* ---- scroll ---- */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  /* ---- refresh session list ---- */
  const refreshSessions = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('listSessions', (list: SessionInfo[]) => {
      setSessionList(list);
    });
  }, []);

  /* ---- process next message from queue ---- */
  const processQueue = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || isLoadingRef.current) return;

    const queue = messageQueueRef.current;
    if (queue.length === 0) return;

    const nextContent = queue.shift()!;
    setMessageQueue([...queue]);

    isLoadingRef.current = true;
    setIsLoading(true);

    socket.emit('sendMessage', nextContent, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        clientLogger.error('队列消息发送失败', { error: response.error });
        isLoadingRef.current = false;
        setIsLoading(false);
        if (response.error?.includes('安全认证')) {
          setCredError(response.error);
          setShowCredModal(true);
        }
        // Try next in queue
        processQueue();
      }
    });
  }, []);

  /* ---- attempt auth ---- */
  const attemptAuth = useCallback(
    (socket: Socket, challenge: AuthChallenge, token: string, encodingAESKey: string) => {
      const socketId = socket.id;
      if (!socketId) return;

      const credentialVersion = createCredentialVersion(token, encodingAESKey);
      const proof = createAuthProof('client', socketId, challenge.nonce, challenge.timestamp, token, encodingAESKey);

      clientLogger.info('发送认证请求', { socketId, credentialVersion: credentialVersion.slice(0, 8) + '...' });

      socket.emit('authenticate', {
        nonce: challenge.nonce,
        timestamp: challenge.timestamp,
        credentialVersion,
        proof,
      }, (response: AuthResponse) => {
        if (response.success) {
          setIsAuthenticated(true);
          setShowCredModal(false);
          setCredError('');
          const creds: StoredCredentials = { token, encodingAESKey, credentialVersion };
          saveCredentials(creds);
          storedCredsRef.current = creds;
          clientLogger.info('安全认证成功');
          return;
        }

        setIsAuthenticated(false);
        clientLogger.warn('认证失败', { error: response.error });

        const storedVersion = storedCredsRef.current?.credentialVersion;
        if (storedVersion && storedVersion !== response.credentialVersion) {
          clearCredentials();
          storedCredsRef.current = null;
          clientLogger.info('凭证版本不匹配，已清除本地凭证');
        }

        setCredError(response.error || '认证失败');
        setShowCredModal(true);
      });
    }, [],
  );

  /* ---- socket lifecycle ---- */
  useEffect(() => {
    clientLogger.info('初始化 Socket 连接', { serverUrl });

    const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      clientLogger.info('传输层已连接', { serverUrl, socketId: socket.id });
      setIsAuthenticated(false);
    });

    socket.on('authChallenge', (challenge: AuthChallenge) => {
      clientLogger.debug('收到认证挑战', { credentialVersion: challenge.credentialVersion });
      pendingChallengeRef.current = challenge;

      // Try auto-auth from config first, then stored creds
      const cfg = loadClientConfig();
      if (cfg?.token && cfg?.encodingAESKey) {
        const cfgVersion = createCredentialVersion(cfg.token, cfg.encodingAESKey);
        if (cfgVersion === challenge.credentialVersion) {
          clientLogger.info('使用配置文件凭证自动认证');
          attemptAuth(socket, challenge, cfg.token, cfg.encodingAESKey);
          return;
        }
      }

      const stored = storedCredsRef.current;
      if (stored && stored.credentialVersion === challenge.credentialVersion) {
        clientLogger.info('凭证版本匹配，自动认证');
        attemptAuth(socket, challenge, stored.token, stored.encodingAESKey);
        return;
      }

      if (stored && stored.credentialVersion !== challenge.credentialVersion) {
        clearCredentials();
        storedCredsRef.current = null;
        clientLogger.warn('服务器凭证版本变更，需重新输入凭证');
        setCredError('服务器安全凭证已更新，请重新输入 Token 和 encodingAESKey');
      } else {
        setCredError('');
      }

      setShowCredModal(true);
    });

    socket.on('connected', () => {
      setIsConnected(true);
      clientLogger.info('连接就绪');
      // Load sessions after connected
      socket.emit('listSessions', (list: SessionInfo[]) => {
        setSessionList(list);
        if (list.length > 0) {
          const first = list[0];
          setCurrentSessionId(first.id);
          // Load messages for active session
          socket.emit('switchSession', first.id, (resp: { success: boolean; messages: Message[] }) => {
            if (resp.success) setMessages(resp.messages);
          });
        }
      });
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      setIsAuthenticated(false);
      clientLogger.warn('连接断开', { reason });
    });

    socket.on('connect_error', (error) => {
      clientLogger.error('连接错误', { error: error.message });
    });

    socket.on('message', (msg: Message) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('streamStart', (messageId: string) => {
      setStreamingMessageId(messageId);
      setMessages((prev) => [
        ...prev,
        { id: messageId, role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true },
      ]);
    });

    socket.on('streamChunk', (messageId: string, chunk: string) => {
      setMessages((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, content: msg.content + chunk } : msg)),
      );
    });

    socket.on('streamEnd', (messageId: string) => {
      setStreamingMessageId(null);
      isLoadingRef.current = false;
      setIsLoading(false);
      setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, isStreaming: false } : msg)));
      // Process next message in queue
      setTimeout(() => processQueue(), 100);
    });

    socket.on('requestStopped', () => {
      isLoadingRef.current = false;
      setIsLoading(false);
      setStreamingMessageId(null);
      // Process next message in queue
      setTimeout(() => processQueue(), 100);
    });

    socket.on('error', (error: string) => {
      clientLogger.error('服务器错误', { error });
      isLoadingRef.current = false;
      setIsLoading(false);
      setStreamingMessageId(null);

      if (error.includes('安全认证')) {
        setCredError(error);
        setShowCredModal(true);
      } else {
        // Try next message in queue on non-auth errors
        setTimeout(() => processQueue(), 100);
      }
    });

    return () => {
      clientLogger.info('Socket 连接断开清理');
      socket.disconnect();
    };
  }, [serverUrl, attemptAuth]);

  /* ---- credential modal submit ---- */
  const handleCredSubmit = useCallback((token: string, encodingAESKey: string) => {
    const socket = socketRef.current;
    const challenge = pendingChallengeRef.current;
    if (!socket || !challenge) {
      setCredError('连接异常，请刷新页面后重试');
      return;
    }
    attemptAuth(socket, challenge, token, encodingAESKey);
  }, [attemptAuth]);

  /* ---- settings save ---- */
  const handleSettingsSave = useCallback((config: ClientConfig) => {
    saveClientConfig(config);
    // Update credentials
    if (config.token && config.encodingAESKey) {
      const credentialVersion = createCredentialVersion(config.token, config.encodingAESKey);
      const creds: StoredCredentials = { token: config.token, encodingAESKey: config.encodingAESKey, credentialVersion };
      saveCredentials(creds);
      storedCredsRef.current = creds;
    }
    // Update server URL if changed
    if (config.serverUrl && config.serverUrl !== serverUrl) {
      setServerUrl(config.serverUrl);
      localStorage.setItem('serverUrl', config.serverUrl);
      setMessages([]);
      setIsAuthenticated(false);
    } else {
      // Reconnect to re-authenticate with new creds
      const socket = socketRef.current;
      if (socket) {
        socket.disconnect();
        socket.connect();
      }
    }
    clientLogger.info('配置已保存', { serverUrl: config.serverUrl });
  }, [serverUrl]);

  /* ---- toggle server ---- */
  const toggleServer = useCallback(() => {
    const newUrl = isRemote ? LOCAL_SERVER : REMOTE_SERVER;
    setServerUrl(newUrl);
    localStorage.setItem('serverUrl', newUrl);
    // Update config
    const cfg = loadClientConfig();
    if (cfg) {
      cfg.serverUrl = newUrl;
      saveClientConfig(cfg);
    }
    setMessages([]);
    setIsAuthenticated(false);
    clientLogger.info('切换服务器', { newUrl });
  }, [isRemote]);

  /* ---- send message ---- */
  const handleSend = useCallback(() => {
    if (!input.trim() || !socketRef.current || !isAuthenticated) return;

    const content = input.trim();
    setInput('');

    // If currently loading, add to queue
    if (isLoading) {
      messageQueueRef.current.push(content);
      setMessageQueue([...messageQueueRef.current]);
      clientLogger.info('消息已加入队列', { queueLength: messageQueueRef.current.length });
      inputRef.current?.focus();
      return;
    }

    isLoadingRef.current = true;
    setIsLoading(true);

    socketRef.current.emit('sendMessage', content, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        clientLogger.error('消息发送失败', { error: response.error });
        isLoadingRef.current = false;
        setIsLoading(false);
        if (response.error?.includes('安全认证')) {
          setCredError(response.error);
          setShowCredModal(true);
        }
      }
    });

    inputRef.current?.focus();
  }, [input, isLoading, isAuthenticated]);

  /* ---- stop request ---- */
  const handleStop = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('stopRequest', (response: { success: boolean; error?: string }) => {
      if (response.success) {
        setIsLoading(false);
        clientLogger.info('请求已停止');
        refreshSessions();
      } else {
        clientLogger.warn('停止请求失败', { error: response.error });
      }
    });
  }, [refreshSessions]);

  /* ---- clear history ---- */
  const handleClear = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.emit('clearHistory', (success: boolean) => {
      if (success) {
        setMessages([]);
        refreshSessions();
        clientLogger.info('对话历史已清空');
      }
    });
  }, [refreshSessions]);

  /* ---- session management ---- */
  const handleNewSession = useCallback(() => {
    if (!socketRef.current || !isAuthenticated) {
      clientLogger.warn('无法创建会话', { connected: !!socketRef.current, authenticated: isAuthenticated });
      return;
    }
    clientLogger.info('请求创建新会话...');
    const timeout = setTimeout(() => {
      clientLogger.error('创建会话超时');
    }, 10000);
    socketRef.current.emit('createSession', (session: SessionInfo & { error?: string }) => {
      clearTimeout(timeout);
      if (session.error) {
        clientLogger.error('创建会话失败', { error: session.error });
        return;
      }
      setCurrentSessionId(session.id);
      setMessages([]);
      refreshSessions();
      clientLogger.info('创建新会话', { sessionId: session.id });
    });
  }, [refreshSessions, isAuthenticated]);

  const handleSwitchSession = useCallback((sessionId: string) => {
    if (!socketRef.current || sessionId === currentSessionId) return;
    socketRef.current.emit('switchSession', sessionId, (response: { success: boolean; messages: Message[] }) => {
      if (response.success) {
        setCurrentSessionId(sessionId);
        setMessages(response.messages);
        setIsLoading(false);
        clientLogger.info('切换到会话', { sessionId });
      }
    });
  }, [currentSessionId]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('deleteSession', sessionId, (success: boolean) => {
      if (success) {
        refreshSessions();
        // If deleted the active one, switch to first remaining
        if (sessionId === currentSessionId) {
          socketRef.current?.emit('listSessions', (list: SessionInfo[]) => {
            if (list.length > 0) {
              handleSwitchSession(list[0].id);
            }
          });
        }
        clientLogger.info('删除会话', { sessionId });
      }
    });
  }, [currentSessionId, refreshSessions, handleSwitchSession]);

  const handleDownloadLogs = useCallback(() => { clientLogger.download(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const canInput = isConnected && isAuthenticated;
  const canSend = canInput && input.trim().length > 0;

  const currentConfig: ClientConfig = (() => {
    const cfg = loadClientConfig();
    return cfg || { token: storedCredsRef.current?.token || '', encodingAESKey: storedCredsRef.current?.encodingAESKey || '', serverUrl };
  })();

  /* ---- render ---- */
  return (
    <div className="flex h-screen bg-slate-900 relative">
      {/* Credential Modal */}
      <CredentialModal visible={showCredModal} errorMessage={credError}
        onSubmit={handleCredSubmit} onCancel={() => setShowCredModal(false)} />

      {/* Settings Panel */}
      <SettingsPanel visible={showSettings} onClose={() => setShowSettings(false)}
        config={currentConfig} onSave={handleSettingsSave} />

      {/* Session Sidebar */}
      <SessionSidebar visible={showSidebar} sessions={sessionList}
        activeSessionId={currentSessionId} isMobile={isMobile}
        onNewSession={handleNewSession} onSwitchSession={handleSwitchSession}
        onDeleteSession={handleDeleteSession} onToggle={() => setShowSidebar(!showSidebar)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className={`flex items-center justify-between border-b border-slate-700 bg-slate-800/50 ${isMobile ? 'px-3 py-2.5' : 'px-6 py-4'}`}>
          <div className="flex items-center gap-2">
            {/* Mobile: hamburger menu */}
            {isMobile && (
              <button onClick={() => setShowSidebar(true)}
                className="p-2 -ml-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div className={`rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center ${isMobile ? 'w-8 h-8' : 'w-10 h-10'}`}>
              <Bot className={`text-white ${isMobile ? 'w-5 h-5' : 'w-6 h-6'}`} />
            </div>
            <div>
              <h1 className={`font-semibold text-white ${isMobile ? 'text-base' : 'text-lg'}`}>OpenClaw</h1>
              {!isMobile && <p className="text-xs text-slate-400">AI Assistant Client</p>}
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-3">
            {/* Server toggle - compact on mobile */}
            {!isMobile && (
              <button onClick={toggleServer}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                  isRemote ? 'bg-purple-600/20 text-purple-400 hover:bg-purple-600/30'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                }`} title={isRemote ? '远程服务器' : '本地服务器'}>
                {isRemote ? <Globe className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                <span className="text-xs">{isRemote ? '远程' : '本地'}</span>
              </button>
            )}

            {/* Connection + Auth status indicator */}
            <div className="flex items-center gap-1">
              {isConnected ? (
                <Wifi className="w-4 h-4 text-emerald-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-400" />
              )}
              {!isMobile && (
                <span className={`text-sm ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isConnected ? '已连接' : '未连接'}
                </span>
              )}
            </div>

            {/* Auth status */}
            {isConnected && (
              <div className="flex items-center">
                {isAuthenticated ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                ) : (
                  <button onClick={() => setShowCredModal(true)}
                    className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 transition-colors">
                    <ShieldAlert className="w-4 h-4" />
                  </button>
                )}
                {!isMobile && (
                  <span className={`text-xs ml-1 ${isAuthenticated ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {isAuthenticated ? '已认证' : '未认证'}
                  </span>
                )}
              </div>
            )}

            {/* Settings */}
            <button onClick={() => setShowSettings(true)}
              className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white" title="设置">
              <Settings className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'}`} />
            </button>

            {/* Download logs - hidden on mobile */}
            {!isMobile && (
              <button onClick={handleDownloadLogs}
                className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white" title="下载日志">
                <Download className="w-5 h-5" />
              </button>
            )}

            {/* Clear */}
            <button onClick={handleClear}
              className="p-2 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white" title="清空当前对话">
              <Trash2 className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'}`} />
            </button>
          </div>
        </header>

        {/* Messages */}
        <main className={`flex-1 overflow-y-auto ${isMobile ? 'px-3 py-4' : 'px-4 py-6'}`}>
          <div className={`mx-auto space-y-4 md:space-y-6 ${isMobile ? 'max-w-full' : 'max-w-4xl'}`}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20">
                <div className={`rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center mb-6 ${isMobile ? 'w-16 h-16' : 'w-20 h-20'}`}>
                  <Bot className={`text-cyan-400 ${isMobile ? 'w-8 h-8' : 'w-10 h-10'}`} />
                </div>
                <h2 className={`font-medium text-white mb-2 ${isMobile ? 'text-lg' : 'text-xl'}`}>欢迎使用 OpenClaw</h2>
                <p className={`text-slate-400 text-center max-w-md ${isMobile ? 'text-sm px-4' : ''}`}>
                  {!isConnected ? '正在连接服务器...'
                    : !isAuthenticated ? '请先完成安全认证后开始对话'
                      : '开始与 OpenClaw 对话，它可以帮助你完成各种任务'}
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex ${isMobile ? 'gap-2' : 'gap-4'} ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`flex-shrink-0 rounded-lg flex items-center justify-center ${
                    isMobile ? 'w-7 h-7' : 'w-9 h-9'
                  } ${
                    msg.role === 'user' ? 'bg-blue-600' : 'bg-gradient-to-br from-cyan-500 to-blue-600'
                  }`}>
                    {msg.role === 'user'
                      ? <User className={`text-white ${isMobile ? 'w-4 h-4' : 'w-5 h-5'}`} />
                      : <Bot className={`text-white ${isMobile ? 'w-4 h-4' : 'w-5 h-5'}`} />}
                  </div>
                  <div className={`flex-1 ${isMobile ? 'max-w-[85%]' : 'max-w-[80%]'} ${msg.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`inline-block rounded-2xl ${isMobile ? 'px-3 py-2 text-sm' : 'px-4 py-3'} ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-slate-800 text-slate-100 rounded-tl-sm'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <div className="markdown-content">
                          <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
                          {msg.isStreaming && <span className="inline-block w-2 h-4 bg-cyan-400 animate-pulse ml-1" />}
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 px-1">{formatTime(msg.timestamp)}</p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Input */}
        <footer className={`border-t border-slate-700 bg-slate-800/50 ${isMobile ? 'px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]' : 'px-4 py-4'}`}>
          <div className={`mx-auto ${isMobile ? 'max-w-full' : 'max-w-4xl'}`}>
            {/* Queue indicator */}
            {messageQueue.length > 0 && (
              <div className="mb-2 px-3 py-1.5 bg-cyan-900/30 border border-cyan-700/30 rounded-lg flex items-center justify-between">
                <span className="text-xs text-cyan-400">
                  队列中有 {messageQueue.length} 条消息等待发送
                </span>
                <button onClick={() => { messageQueueRef.current = []; setMessageQueue([]); }}
                  className="text-xs text-slate-400 hover:text-red-400 transition-colors">清空队列</button>
              </div>
            )}
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <textarea ref={inputRef} value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={canInput
                    ? (isLoading
                      ? (isMobile ? '输入消息加入队列...' : '输入消息加入队列... (Shift+Enter 换行)')
                      : (isMobile ? '输入消息...' : '输入消息... (Shift+Enter 换行)'))
                    : '请先完成安全认证'}
                  className={`w-full bg-slate-700 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none ${isMobile ? 'px-3 py-2.5 text-sm' : 'px-4 py-3'}`}
                  rows={1} style={{ minHeight: isMobile ? '42px' : '48px', maxHeight: '200px' }}
                  disabled={!canInput} />
              </div>

              {/* Stop / Send button */}
              {isLoading ? (
                <button onClick={handleStop}
                  className={`flex-shrink-0 rounded-xl bg-red-600 text-white flex items-center justify-center hover:bg-red-500 transition-colors border border-transparent ${isMobile ? 'w-[42px]' : 'w-[48px]'}`}
                  style={{ minHeight: isMobile ? '42px' : '48px', alignSelf: 'stretch' }}
                  title="停止生成">
                  <Square className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'}`} />
                </button>
              ) : (
                <button onClick={handleSend}
                  disabled={!canSend}
                  className={`flex-shrink-0 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity border border-transparent ${isMobile ? 'w-[42px]' : 'w-[48px]'}`}
                  style={{ minHeight: isMobile ? '42px' : '48px', alignSelf: 'stretch' }}>
                  <Send className={`${isMobile ? 'w-4 h-4' : 'w-5 h-5'}`} />
                </button>
              )}
            </div>
            {!isMobile && (
              <p className="text-xs text-slate-500 mt-2 text-center">
                OpenClaw Client v1.3.0 · Enter 发送 · Shift+Enter 换行 · {isLoading ? '点击红色按钮停止生成' : ''}
                {messageQueue.length > 0 ? ` · 队列: ${messageQueue.length}` : ''}
              </p>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;
