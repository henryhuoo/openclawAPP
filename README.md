# OpenClaw App

一个与本地 OpenClaw 交互的客户端应用。

## 项目结构

```
openclawAPP/
├── client/              # 前端客户端 (React + Vite)
├── server/              # 后端服务 (Node.js + Socket.IO)
├── openclaw-plugin/     # OpenClaw Channel 插件
└── shared/              # 共享类型定义
```

## 架构说明

```
┌─────────────────┐     WebSocket      ┌─────────────────┐     WebSocket      ┌─────────────────┐
│                 │  ◄──────────────►  │                 │  ◄──────────────►  │                 │
│  Client (Web)   │    Port 3001       │     Server      │    Port 3002       │  OpenClaw       │
│                 │                    │                 │                    │  Channel Plugin │
└─────────────────┘                    └─────────────────┘                    └────────┬────────┘
                                                                                       │
                                                                                       │ CLI/API
                                                                                       ▼
                                                                              ┌─────────────────┐
                                                                              │    OpenClaw     │
                                                                              │    (Local)      │
                                                                              └─────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
# 安装所有依赖
npm run install:all

# 或分别安装
cd server && npm install
cd ../client && npm install
cd ../openclaw-plugin && npm install
```

### 2. 启动服务

需要同时启动三个服务：

```bash
# 终端 1: 启动 OpenClaw Channel 插件
cd openclaw-plugin && npm run dev

# 终端 2: 启动后端服务
cd server && npm run dev

# 终端 3: 启动前端客户端
cd client && npm run dev
```

或使用一键启动脚本：

```bash
npm run dev
```

### 3. 访问应用

打开浏览器访问 http://localhost:5173

## 端口说明

- **5173**: 前端客户端 (Vite dev server)
- **3001**: 后端服务 (Socket.IO)
- **3002**: OpenClaw Channel 插件 (WebSocket)

## 配置

### 环境变量

**Server (.env)**
```
PORT=3001
OPENCLAW_CHANNEL_URL=ws://localhost:3002
```

**OpenClaw Plugin (.env)**
```
PLUGIN_PORT=3002
OPENCLAW_PATH=openclaw
```

## 开发说明

### 前端客户端

- 使用 React + TypeScript
- UI 框架：Tailwind CSS
- 实时通信：Socket.IO Client
- Markdown 渲染：react-markdown

### 后端服务

- 使用 Express + Socket.IO
- 负责管理客户端连接和会话
- 与 OpenClaw Channel 插件通信

### OpenClaw Channel 插件

- 作为 OpenClaw 和后端服务之间的桥梁
- 通过 WebSocket 接收请求
- 调用本地 OpenClaw CLI 或 API

## 自定义 OpenClaw 集成

如果你的 OpenClaw 有不同的调用方式，修改 `openclaw-plugin/src/openclaw-connector.ts` 中的 `sendViaCLI` 方法。

## License

MIT
