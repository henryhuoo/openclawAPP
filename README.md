<p align="center">
  <img src="https://img.shields.io/badge/OpenClaw-Remote%20AI%20Agent-00bcd4?style=for-the-badge&logo=robot&logoColor=white" alt="OpenClaw" />
</p>

<h1 align="center">🦞 OpenClaw App</h1>

<p align="center">
  <strong>随时随地，掌控你的 AI 龙虾</strong><br/>
  在手机上远程操控本地运行的 OpenClaw AI Agent —— 安全、便捷、零暴露。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Mobile-Ready-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/Security-HMAC--SHA256-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/Protocol-WebSocket-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" />
</p>

---

## 为什么选择 OpenClaw App？

你在家里的电脑上运行着强大的 **OpenClaw AI Agent**，但你只能坐在电脑前才能使用它。

**OpenClaw App 改变了这一切。**

- 📱 **手机随时操控** — 掏出手机打开浏览器，就能和你的 AI 龙虾对话
- 🔒 **零端口暴露** — 你的电脑不需要开放任何端口，所有通信通过云端中转
- 🛡️ **企业级安全** — HMAC-SHA256 挑战-应答认证，密码永远不在网络上传输
- ⚡ **实时流式响应** — 基于 WebSocket 的流式输出，打字机效果实时显示
- 💬 **多会话管理** — 像微信一样管理多个对话，随时切换上下文
- 🎨 **移动端深度适配** — 专为手机屏幕优化的 UI，支持 iOS 安全区域、手势操作

## 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    📱 你的手机 / 任意浏览器                    │
│                  http://你的服务器IP:3009/                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket + HMAC-SHA256 认证
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    ☁️  云端中转服务器                          │
│                                                             │
│   • 随机生成 Token + AES Key（30天有效）                      │
│   • HMAC-SHA256 挑战-应答认证                                 │
│   • WebSocket 双向消息中转                                    │
│   • 托管 Web 客户端静态文件                                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket（插件主动连接）
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   🖥️ 你的电脑（无需开放端口）                  │
│                                                             │
│   OpenClaw Plugin ──► OpenClaw CLI ──► AI Agent 执行任务     │
└─────────────────────────────────────────────────────────────┘
```

**核心思路**：你的电脑上的 Plugin 主动连接云端服务器，手机通过云端服务器与你的电脑间接通信。你的电脑不需要暴露任何端口，安全无忧。

---

## 🚀 快速开始

### 前置要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 运行环境 |
| OpenClaw CLI | 最新 | 本地 AI Agent（`openclaw --version` 验证） |
| 云服务器 | 任意 | 用于部署中转服务（推荐 1核1G 即可） |

### 第 1 步：克隆项目

```bash
git clone https://github.com/henryhuoo/openclawAPP.git
cd openclawAPP

# 一键安装所有模块依赖（server + client + plugin）
npm run install:all
```

### 第 2 步：部署中转服务器

#### 方式一：一键部署（推荐）

```bash
# 修改 deploy.sh 中的服务器 IP 和用户
vim deploy.sh

# 执行部署
bash deploy.sh
```

脚本会自动完成：构建客户端 → 上传代码 → 安装依赖 → 编译启动（PM2 守护）。

#### 方式二：手动部署

```bash
# 在云服务器上
cd server
npm install && npm run build

# 使用 PM2 守护进程
pm2 start dist/index.js --name openclaw-server
pm2 save
```

启动后控制台输出如下：

```
═══════════════════════════════════════════════════════
            OpenClaw Server 已启动
═══════════════════════════════════════════════════════
Port: 3009
Token: a1b2c3d4e5f6...
encodingAESKey: XYZABC123456...
Credential Version: 8f3a...
```

> ⚠️ **请记下 `Token` 和 `encodingAESKey`**，后面步骤需要使用。
> 
> 凭证有效期 30 天，到期自动重新生成。使用 `--force-renew` 参数可随时强制更新。

### 第 3 步：配置并启动本地插件

在你的电脑上编辑 `openclaw-plugin/config.json`：

```json
{
  "serverUrl": "http://你的服务器IP:3009",
  "token": "粘贴服务器输出的 Token",
  "encodingAESKey": "粘贴服务器输出的 encodingAESKey",
  "openclawPath": "openclaw",
  "reconnectDelayMs": 3000
}
```

启动插件：

```bash
cd openclaw-plugin
npm run dev
```

看到 `✅ 插件安全认证成功` 即表示连接成功。

> 💡 **提示**：如果服务器和插件在同一台机器上运行，deploy.sh 会自动同步凭证到插件配置文件，无需手动复制。

### 第 4 步：手机打开浏览器访问

在手机浏览器输入：

```
http://你的服务器IP:3009
```

1. 首次访问会弹出安全认证弹框
2. 输入第 2 步中获得的 **Token** 和 **encodingAESKey**
3. 点击「认证」—— 凭证会自动保存，下次访问无需重新输入
4. 开始和你的 AI 龙虾对话！🦞

---

## 📱 移动端体验

OpenClaw App 专为移动端设计优化：

- **自适应布局** — 自动适配手机屏幕，消息气泡、按钮均为触摸友好尺寸
- **侧边栏手势** — 汉堡菜单 + 滑出式会话列表，单手即可操作
- **iOS 安全区域** — 完美适配刘海屏和底部横条
- **智能服务器检测** — 手机访问时自动使用当前页面地址作为服务器地址，无需手动配置

---

## 🔒 安全机制

OpenClaw App 在安全设计上做了充分考虑，确保你可以放心地在手机上远程控制 AI Agent。

### 认证流程

```
客户端连接
    ↓
服务器下发挑战 (nonce + timestamp + credentialVersion)
    ↓
客户端计算 HMAC-SHA256(token:key, "v1:role:socketId:nonce:ts")
    ↓
服务器验证 proof → 通过 / 拒绝
```

### 安全特性

| 特性 | 说明 |
|------|------|
| **密码零传输** | 基于 HMAC 挑战-应答，Token 和 Key 永远不在网络上明文传输 |
| **随机凭证** | `Token`（16字节 hex）+ `encodingAESKey`（32字节 base64url），暴力破解不可行 |
| **凭证有效期** | 30 天自动过期，支持 `--force-renew` 强制更新 |
| **版本检测** | `credentialVersion` 基于 SHA-256 哈希，检测凭证是否过期或被更改 |
| **时序攻击防护** | 服务端使用 `crypto.timingSafeEqual` 对比 proof，防止时序侧信道攻击 |
| **自动重认证** | 凭证未变更时，客户端自动静默认证；变更后自动弹框提示输入新凭证 |
| **插件零暴露** | 本地电脑不开放任何端口，由插件主动向外发起连接 |

### 为什么安全？

1. **你的电脑不暴露端口** — 插件主动连接服务器，不需要在本地开任何端口
2. **密码不上网** — 只传输 HMAC proof，原始 Token/Key 不会出现在任何网络报文中
3. **每个连接独立认证** — 每次连接都收到新的 nonce 挑战，杜绝重放攻击
4. **凭证定期轮换** — 30 天自动过期，降低泄露风险

---

## 🛠️ 项目结构

```
openclawAPP/
├── client/                # 前端 Web 客户端 (React + Vite + Tailwind)
│   └── src/
│       ├── App.tsx        # 主应用（含安全认证、移动端适配）
│       └── index.css      # 样式（含响应式适配）
│
├── server/                # 后端中转服务 (Node.js + Express + Socket.IO)
│   ├── config.json        # 服务器配置
│   └── src/
│       ├── index.ts       # 服务器主逻辑（认证、消息中转、会话管理）
│       ├── config.ts      # 配置加载
│       ├── security.ts    # 凭证生成 & HMAC 认证
│       └── logger.ts      # 结构化日志
│
├── openclaw-plugin/       # 本地 OpenClaw 连接插件
│   ├── config.json        # 插件配置（服务器地址、凭证）
│   └── src/
│       ├── index.ts       # 插件入口
│       ├── security.ts    # 客户端侧认证
│       └── openclaw-connector.ts  # OpenClaw CLI 调用器
│
├── shared/                # 共享类型定义
│   └── types.ts
│
├── deploy.sh              # 一键部署脚本
└── package.json           # 根包管理
```

---

## ⚙️ 配置参考

### 服务器配置 (`server/config.json`)

```json
{
  "port": 3009,
  "corsOrigin": "*",
  "authChallengeTtlMs": 60000
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `port` | 服务监听端口 | `3009` |
| `corsOrigin` | CORS 允许来源，生产环境建议设为具体域名 | `"*"` |
| `authChallengeTtlMs` | 认证挑战有效时长（毫秒） | `60000` |

### 插件配置 (`openclaw-plugin/config.json`)

```json
{
  "serverUrl": "http://你的服务器IP:3009",
  "token": "服务器生成的 Token",
  "encodingAESKey": "服务器生成的 AES Key",
  "openclawPath": "openclaw",
  "reconnectDelayMs": 3000
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `serverUrl` | 中转服务器地址 | — |
| `token` | 服务器生成的认证令牌 | — |
| `encodingAESKey` | 服务器生成的 AES 密钥 | — |
| `openclawPath` | OpenClaw CLI 路径 | `"openclaw"` |
| `reconnectDelayMs` | 断线重连间隔（毫秒） | `3000` |

---

## 🔧 本地开发

```bash
# 方式一：一键启动所有服务
npm run dev

# 方式二：分别在三个终端启动
cd server && npm run dev          # 终端 1：中转服务器
cd openclaw-plugin && npm run dev # 终端 2：本地插件
cd client && npm run dev          # 终端 3：前端开发服务器
```

开发模式下访问 `http://localhost:5173`。

---

## ❓ 常见问题

<details>
<summary><b>服务器重启后怎么办？</b></summary>

如果凭证在有效期内（30天），重启会自动复用原有凭证，无需做任何操作。

如果凭证过期或使用了 `--force-renew`：
1. 从服务器日志获取新的 Token 和 encodingAESKey
2. 更新 `openclaw-plugin/config.json` 并重启插件
3. 客户端会自动弹出认证弹框，输入新凭证即可
</details>

<details>
<summary><b>手机无法连接？</b></summary>

1. 确认云服务器防火墙已放行对应端口（默认 3009）
2. 在手机浏览器输入 `http://服务器IP:3009/health`，应返回 `{"status":"ok"}`
3. 确认插件已连接（health 接口返回 `pluginConnected: true`）
</details>

<details>
<summary><b>插件显示「缺少安全凭证」？</b></summary>

编辑 `openclaw-plugin/config.json`，确保 `token` 和 `encodingAESKey` 不为空。
</details>

<details>
<summary><b>如何查看服务器状态？</b></summary>

```bash
# 健康检查
curl http://服务器IP:3009/health

# 查看凭证指纹（不暴露明文）
curl http://服务器IP:3009/security/bootstrap

# PM2 查看日志
pm2 logs openclaw-server --lines 30
```
</details>

<details>
<summary><b>如何强制更新凭证？</b></summary>

```bash
pm2 stop openclaw-server
pm2 delete openclaw-server
pm2 start dist/index.js --name openclaw-server -- --force-renew
```
</details>

---

## 📋 技术栈

| 模块 | 技术 |
|------|------|
| 前端 | React 18 + Vite + Tailwind CSS + Socket.IO Client |
| 后端 | Node.js + Express + Socket.IO |
| 认证 | HMAC-SHA256 挑战-应答 + crypto.timingSafeEqual |
| 部署 | PM2 + Bash 脚本 |
| 通信 | WebSocket (Socket.IO) |

---

## License

MIT
