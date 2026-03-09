import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface MessageCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

/**
 * OpenClaw 连接器
 * 
 * 负责与本地 OpenClaw CLI 进行交互
 * 使用 `openclaw agent --message` 命令发送消息
 */
export class OpenClawConnector extends EventEmitter {
  private openclawPath: string;
  private activeProcess: ChildProcess | null = null;
  private sessionId: string | null = null;

  constructor() {
    super();
    // OpenClaw CLI 路径，可以通过环境变量配置
    this.openclawPath = process.env.OPENCLAW_PATH || 'openclaw';
  }

  /**
   * 通过 CLI 发送消息给 OpenClaw
   */
  async sendMessage(content: string, callbacks: MessageCallbacks): Promise<void> {
    try {
      await this.sendViaCLI(content, callbacks);
    } catch (error) {
      // 如果 CLI 方式失败，使用模拟响应
      console.warn('OpenClaw CLI error, using mock response:', error);
      this.mockResponse(content, callbacks);
    }
  }

  /**
   * 通过 CLI 命令调用 OpenClaw
   */
  private async sendViaCLI(content: string, callbacks: MessageCallbacks): Promise<void> {
    return new Promise((resolve, reject) => {
      // 构建命令参数
      // 使用 openclaw agent --agent main --message "内容" --local
      const args = ['agent', '--agent', 'main', '--message', content, '--local'];
      
      // 如果有会话ID，继续同一会话
      if (this.sessionId) {
        args.push('--session-id', this.sessionId);
      }

      console.log(`🔄 执行命令: ${this.openclawPath} ${args.join(' ')}`);

      const proc = spawn(this.openclawPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.activeProcess = proc;
      let hasOutput = false;
      let stderrOutput = '';

      // 处理 stdout 流式输出
      proc.stdout.on('data', (data) => {
        hasOutput = true;
        const text = data.toString();
        callbacks.onChunk(text);
      });

      // 处理 stderr
      proc.stderr.on('data', (data) => {
        stderrOutput += data.toString();
        console.error('OpenClaw stderr:', data.toString());
      });

      proc.on('close', (code) => {
        this.activeProcess = null;
        
        if (code === 0 && hasOutput) {
          callbacks.onComplete();
          resolve();
        } else if (code === 0 && !hasOutput) {
          // 命令成功但无输出，可能需要其他处理
          callbacks.onError('OpenClaw 没有返回响应');
          reject(new Error('No output from OpenClaw'));
        } else {
          const errorMsg = `OpenClaw 退出码: ${code}${stderrOutput ? '\n' + stderrOutput : ''}`;
          callbacks.onError(errorMsg);
          reject(new Error(errorMsg));
        }
      });

      proc.on('error', (error) => {
        this.activeProcess = null;
        callbacks.onError(error.message);
        reject(error);
      });
    });
  }

  /**
   * 模拟响应（当 OpenClaw 不可用时）
   */
  private mockResponse(content: string, callbacks: MessageCallbacks): void {
    const mockReply = this.generateMockResponse(content);
    
    // 模拟流式输出
    const chars = mockReply.split('');
    let index = 0;

    const streamInterval = setInterval(() => {
      if (index < chars.length) {
        // 每次发送1-3个字符，模拟真实的流式效果
        const chunkSize = Math.floor(Math.random() * 3) + 1;
        const chunk = chars.slice(index, index + chunkSize).join('');
        callbacks.onChunk(chunk);
        index += chunkSize;
      } else {
        clearInterval(streamInterval);
        callbacks.onComplete();
      }
    }, 30);
  }

  /**
   * 生成模拟响应内容
   */
  private generateMockResponse(content: string): string {
    const responses = [
      `我收到了你的消息："${content}"\n\n这是来自 OpenClaw 的模拟响应。要使用真实的 OpenClaw，请确保：\n\n1. OpenClaw 已正确安装\n2. 配置了正确的环境变量 \`OPENCLAW_PATH\`\n3. OpenClaw 服务正在运行\n\n如需帮助，请查阅 OpenClaw 文档。`,
      
      `**模拟响应**\n\n你问的是："${content}"\n\n当前 OpenClaw 未连接。这是一个演示模式的响应。\n\n### 功能说明\n\n- 发送消息\n- 接收流式响应\n- 查看历史记录\n\n请配置真实的 OpenClaw 连接以获得完整功能。`,
      
      `收到消息：${content}\n\n---\n\n这是 **OpenClaw Channel Plugin** 的测试响应。\n\n系统状态：\n- 插件：运行中 ✅\n- OpenClaw：未连接 ⚠️\n- 模式：演示模式\n\n请启动 OpenClaw 以获得真实的 AI 响应。`,
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * 取消当前正在进行的请求
   */
  cancel(): void {
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }
}
