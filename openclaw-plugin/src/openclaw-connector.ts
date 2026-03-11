import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { logger } from './logger';

interface MessageCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

export class OpenClawConnector extends EventEmitter {
  private readonly openclawPath: string;
  private activeProcess: ChildProcess | null = null;
  private sessionId: string;

  constructor(openclawPath?: string) {
    super();
    this.openclawPath = openclawPath || process.env.OPENCLAW_PATH || 'openclaw';
    this.sessionId = randomUUID();
    logger.info('初始化 OpenClaw 会话', { sessionId: this.sessionId });
  }

  async sendMessage(content: string, callbacks: MessageCallbacks): Promise<void> {
    try {
      await this.sendViaCLI(content, callbacks);
    } catch (error) {
      logger.warn('OpenClaw CLI 调用失败，使用 mock 响应', { error: String(error) });
      this.mockResponse(content, callbacks);
    }
  }

  private async sendViaCLI(content: string, callbacks: MessageCallbacks): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['agent', '--agent', 'main', '--message', content, '--local', '--session-id', this.sessionId];

      logger.debug(`执行命令: ${this.openclawPath} ${args.join(' ')}`);

      const proc = spawn(this.openclawPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.activeProcess = proc;
      let hasOutput = false;
      let stderrOutput = '';

      proc.stdout.on('data', (data) => {
        hasOutput = true;
        callbacks.onChunk(data.toString());
      });

      proc.stderr.on('data', (data) => {
        stderrOutput += data.toString();
        logger.warn('OpenClaw stderr', { output: data.toString().trim() });
      });

      proc.on('close', (code) => {
        this.activeProcess = null;

        if (code === 0 && hasOutput) {
          logger.debug('OpenClaw 进程正常退出', { code });
          callbacks.onComplete();
          resolve();
          return;
        }

        if (code === 0) {
          logger.warn('OpenClaw 进程退出但无输出');
          callbacks.onError('OpenClaw 没有返回响应');
          reject(new Error('No output from OpenClaw'));
          return;
        }

        const errorMsg = `OpenClaw 退出码: ${code}${stderrOutput ? `\n${stderrOutput}` : ''}`;
        logger.error('OpenClaw 进程异常退出', { code, stderr: stderrOutput.trim() });
        callbacks.onError(errorMsg);
        reject(new Error(errorMsg));
      });

      proc.on('error', (error) => {
        this.activeProcess = null;
        logger.error('OpenClaw 进程启动失败', { error: error.message });
        callbacks.onError(error.message);
        reject(error);
      });
    });
  }

  private mockResponse(content: string, callbacks: MessageCallbacks): void {
    const mockReply = this.generateMockResponse(content);
    const chars = mockReply.split('');
    let index = 0;

    const streamInterval = setInterval(() => {
      if (index < chars.length) {
        const chunkSize = Math.floor(Math.random() * 3) + 1;
        const chunk = chars.slice(index, index + chunkSize).join('');
        callbacks.onChunk(chunk);
        index += chunkSize;
        return;
      }

      clearInterval(streamInterval);
      callbacks.onComplete();
    }, 30);
  }

  private generateMockResponse(content: string): string {
    const responses = [
      `我收到了你的消息："${content}"\n\n这是来自 OpenClaw 的模拟响应。要使用真实的 OpenClaw，请确保：\n\n1. OpenClaw 已正确安装\n2. openclaw-plugin/config.json 中配置了正确的 openclawPath\n3. OpenClaw 服务正在运行\n\n如需帮助，请查阅 OpenClaw 文档。`,
      `**模拟响应**\n\n你问的是："${content}"\n\n当前 OpenClaw 未连接。这是一个演示模式的响应。\n\n### 功能说明\n\n- 发送消息\n- 接收流式响应\n- 查看历史记录\n\n请配置真实的 OpenClaw 连接以获得完整功能。`,
      `收到消息：${content}\n\n---\n\n这是 **OpenClaw Channel Plugin** 的测试响应。\n\n系统状态：\n- 插件：运行中 ✅\n- OpenClaw：未连接 ⚠️\n- 模式：演示模式\n\n请启动 OpenClaw 以获得真实的 AI 响应。`,
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  resetSession(): void {
    const oldSessionId = this.sessionId;
    this.sessionId = randomUUID();
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
    logger.info('OpenClaw 会话已重置', { oldSessionId, newSessionId: this.sessionId });
  }

  cancel(): void {
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }
}
