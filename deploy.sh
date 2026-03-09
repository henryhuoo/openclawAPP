#!/bin/bash
# OpenClaw App 部署脚本

SERVER_IP="43.160.192.190"
SERVER_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/openclawAPP"

echo "=== OpenClaw App 部署脚本 ==="

# 1. 在服务器上创建目录
echo ">>> 创建远程目录..."
ssh ${SERVER_USER}@${SERVER_IP} "mkdir -p ${REMOTE_DIR}"

# 2. 上传服务端代码
echo ">>> 上传服务端代码..."
scp -r ./server ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/
scp -r ./shared ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/

# 3. 在服务器上安装依赖和启动
echo ">>> 安装依赖并启动服务..."
ssh ${SERVER_USER}@${SERVER_IP} << 'EOF'
cd /home/ubuntu/openclawAPP/server

# 安装 PM2（如果没有）
which pm2 || sudo npm install -g pm2

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 使用 PM2 启动服务
pm2 stop openclaw-server 2>/dev/null || true
pm2 start dist/index.js --name openclaw-server

# 保存 PM2 配置（开机自启）
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

echo "=== 服务启动完成 ==="
pm2 status
EOF

echo ">>> 部署完成！服务运行在 http://${SERVER_IP}:3001"
