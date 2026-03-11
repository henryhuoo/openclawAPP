import fs from 'fs';
import path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LoggerOptions {
  logDir?: string;
  filePrefix?: string;
  maxFileSizeMB?: number;
  maxFiles?: number;
  minLevel?: LogLevel;
  consoleOutput?: boolean;
}

class Logger {
  private logDir: string;
  private filePrefix: string;
  private maxFileSize: number;
  private maxFiles: number;
  private minLevel: number;
  private consoleOutput: boolean;
  private currentStream: fs.WriteStream | null = null;
  private currentFilePath = '';
  private currentFileSize = 0;

  constructor(options: LoggerOptions = {}) {
    this.logDir = options.logDir ?? path.resolve(__dirname, '..', 'logs');
    this.filePrefix = options.filePrefix ?? 'plugin';
    this.maxFileSize = (options.maxFileSizeMB ?? 10) * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 10;
    this.minLevel = LOG_LEVELS[options.minLevel ?? 'debug'];
    this.consoleOutput = options.consoleOutput ?? true;

    this.ensureLogDir();
    this.openLogFile();
    this.cleanOldFiles();
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private getLogFileName(): string {
    const date = new Date().toISOString().slice(0, 10);
    return `${this.filePrefix}-${date}.log`;
  }

  private openLogFile(): void {
    const fileName = this.getLogFileName();
    const filePath = path.join(this.logDir, fileName);

    if (this.currentFilePath === filePath && this.currentStream) {
      return;
    }

    if (this.currentStream) {
      this.currentStream.end();
    }

    this.currentFilePath = filePath;
    this.currentFileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    this.currentStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' });
  }

  private rotateIfNeeded(): void {
    if (this.currentFileSize < this.maxFileSize) {
      return;
    }

    if (this.currentStream) {
      this.currentStream.end();
      this.currentStream = null;
    }

    const ts = Date.now();
    const rotated = this.currentFilePath.replace('.log', `-${ts}.log`);
    fs.renameSync(this.currentFilePath, rotated);

    this.currentFileSize = 0;
    this.currentStream = fs.createWriteStream(this.currentFilePath, { flags: 'a', encoding: 'utf-8' });
    this.cleanOldFiles();
  }

  private cleanOldFiles(): void {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.startsWith(this.filePrefix) && f.endsWith('.log'))
        .map((f) => ({
          name: f,
          time: fs.statSync(path.join(this.logDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.time - a.time);

      if (files.length > this.maxFiles) {
        files.slice(this.maxFiles).forEach((f) => {
          fs.unlinkSync(path.join(this.logDir, f.name));
        });
      }
    } catch {
      // ignore cleanup errors
    }
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] [${level.toUpperCase().padEnd(5)}] ${message}${metaStr}`;
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < this.minLevel) {
      return;
    }

    const formatted = this.formatMessage(level, message, meta);

    if (this.consoleOutput) {
      const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      consoleFn(formatted);
    }

    this.openLogFile();
    this.rotateIfNeeded();

    if (this.currentStream) {
      const line = `${formatted}\n`;
      this.currentStream.write(line);
      this.currentFileSize += Buffer.byteLength(line);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  close(): void {
    if (this.currentStream) {
      this.currentStream.end();
      this.currentStream = null;
    }
  }
}

export const logger = new Logger({
  logDir: path.resolve(__dirname, '..', 'logs'),
  filePrefix: 'plugin',
  maxFileSizeMB: 10,
  maxFiles: 10,
  minLevel: 'debug',
  consoleOutput: true,
});
