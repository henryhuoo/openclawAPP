# OpenClaw Web Client

一个让你可以通过 Web 界面与本地 OpenClaw AI Agent 进行对话的应用。

## 🎯 项目简介

OpenClaw Web Client 解决了一个关键问题：**如何在任何设备上访问你本地运行的 OpenClaw AI Agent**。

通过云端中转架构，你可以：
- 在手机、平板或任何浏览器上与 OpenClaw 对话
- 让 OpenClaw 在你的本地环境中执行任务
- 无需暴露本地端口，安全地远程访问

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              任意设备 / 浏览器                                    │
│                         http://43.160.192.190/                                  │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (Socket.IO)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           云端服务器 (Server)                                    │
│                         43.160.192.190:3001                                     │
│                                                                                 │
│  • 托管静态 Web 客户端                                                           │
│  • WebSocket 消息中转                                                           │
│  • 管理客户端和插件连接                                                          │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (主动连接)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      你的本地电脑 (OpenClaw Plugin)                              │
│                                                                                 │
│  ┌─────────────────────┐         ┌─────────────────────────────────────────┐   │
│  │   OpenClaw Plugin   │ ──────► │           OpenClaw CLI                  │   │
│  │                     │  调用    │   openclaw agent --agent main           │   │
│  │  • 连接云端服务器     │ ◄────── │         --message "内容"                 │   │
│  │  • 转发消息          │  输出    │                                         │   │
│  └─────────────────────┘         └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 工作流程

1. **用户发送消息** → Web 客户端通过 WebSocket 发送到云端服务器
2. **服务器转发** → 云端服务器将消息转发给已连接的本地插件
3. **插件调用 OpenClaw** → 本地插件执行 `openclaw agent --message "..."` 命令
4. **流式返回** → OpenClaw 的输出实时流式传回 Web 客户端

## 📁 项目结构

```
openclawAPP/
├── client/              # 前端客户端 (React + Vite + Tailwind)
│   ├── src/
│   │   ├── App.tsx      # 主应用组件
│   │   └── main.tsx     # 入口文件
│   └── dist/            # 打包后的静态文件
│
├── server/              # 后端服务 (Node.js + Express + Socket.IO)
│   └── src/
│       ├── index.ts     # 服务器入口
│       └── types.ts     # 类型定义
│
├── openclaw-plugin/     # OpenClaw 连接插件
│   └── src/
│       ├── index.ts     # 插件入口
│       └── openclaw-connector.ts  # OpenClaw CLI 调用器
│
└── shared/              # 共享类型定义
    └── types.ts
```

## 🚀 快速开始

### 前置要求

- Node.js 18+
- 本地已安装并配置好 OpenClaw CLI
- 云服务器（用于部署中转服务）

### 1. 克隆项目

```bash
git clone https://github.com/henryhuoo/openclawAPP.git
cd openclawAPP
```

### 2. 安装依赖

```bash
# 安装所有依赖
npm run install:all

# 或分别安装
cd server && npm install
cd ../client && npm install
cd ../openclaw-plugin && npm install
```

### 3. 配置服务器地址

编辑 `openclaw-plugin/src/index.ts`，修改服务器地址：
```typescript
const RELAY_SERVER = 'http://你的服务器IP:3001';
```

编辑 `client/.env.production`：
```
VITE_SERVER_URL=http://你的服务器IP:3001
```

### 4. 部署服务器

```bash
# 在云服务器上
cd server && npm install && npm run build
node dist/index.js

# 或使用 PM2
pm2 start dist/index.js --name openclaw-server
```

### 5. 部署客户端

```bash
# 打包
cd client && npm run build

# 将 dist 目录部署到 nginx
scp -r dist/* root@你的服务器:/var/www/openclaw-client/
```

### 6. 在本地运行插件

```bash
cd openclaw-plugin
npm run dev
```

插件启动后会自动连接到云端服务器。

## 🖥️ 使用方法

1. 确保本地 OpenClaw 已安装：`openclaw --version`
2. 启动本地插件：`cd openclaw-plugin && npm run dev`
3. 打开浏览器访问：`http://你的服务器IP/`
4. 发送消息，开始与 OpenClaw 对话！

## ⚙️ 端口说明

| 端口 | 服务 | 说明 |
|------|------|------|
| 80 | Nginx | 托管静态客户端 |
| 3001 | Server | WebSocket 中转服务 |
| 5173 | Vite | 本地开发服务器 |

## 🔧 开发模式

本地开发时，启动三个终端：

```bash
# 终端 1: 服务器
cd server && npm run dev

# 终端 2: 客户端
cd client && npm run dev

# 终端 3: 插件
cd openclaw-plugin && npm run dev
```

然后访问 `http://localhost:5173`

## 📝 自定义 OpenClaw 调用

如果你的 OpenClaw 有不同的命令格式，修改 `openclaw-plugin/src/openclaw-connector.ts`：

```typescript
// 修改这里的命令参数
const args = ['agent', '--agent', 'main', '--message', content, '--local'];
```

## 🛡️ 安全说明

- 插件主动连接服务器，无需暴露本地端口
- 建议在生产环境中使用 HTTPS
- 可以添加认证机制保护 WebSocket 连接

## 📄 License

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
