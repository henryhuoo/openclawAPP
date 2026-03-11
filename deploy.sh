#!/bin/bash
# OpenClaw App 远程部署脚本
# 用法: ./deploy.sh [--force-renew]

SERVER_IP="43.160.192.190"
SERVER_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/openclawAPP"

FORCE_RENEW=""
for arg in "$@"; do
  if [ "$arg" = "--force-renew" ]; then
    FORCE_RENEW="--force-renew"
    echo ">>> 将强制更新安全凭证"
  fi
done

echo "=== OpenClaw App 部署脚本 ==="

# 0. 本地构建客户端
echo ">>> 本地构建客户端..."
cd "$(dirname "$0")/client"
npm run build || { echo "❌ 客户端构建失败"; exit 1; }
cd ..

# 1. 在服务器上创建目录
echo ">>> 创建远程目录..."
ssh ${SERVER_USER}@${SERVER_IP} "mkdir -p ${REMOTE_DIR}/client"

# 2. 上传服务端代码
echo ">>> 上传服务端代码..."
scp -r ./server/src ./server/package.json ./server/package-lock.json ./server/tsconfig.json ./server/config.json ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/server/
# 上传凭证文件（如果存在）
if [ -f ./server/credentials.json ]; then
  scp ./server/credentials.json ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/server/
fi
scp -r ./shared ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/

# 3. 上传客户端构建产物
echo ">>> 上传客户端构建产物..."
scp -r ./client/dist ${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/client/

# 4. 在服务器上安装依赖、编译并启动
echo ">>> 远程安装依赖并启动服务..."
ssh ${SERVER_USER}@${SERVER_IP} << EOF
cd /home/ubuntu/openclawAPP/server

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 使用 PM2 重启服务
pm2 stop openclaw-server 2>/dev/null || true
pm2 delete openclaw-server 2>/dev/null || true
pm2 start dist/index.js --name openclaw-server -- ${FORCE_RENEW}
pm2 save

echo ""
echo "=== 服务启动完成 ==="
pm2 status

# 等待启动完成并获取凭证
sleep 3
echo ""
echo "=== 服务器凭证（需要复制到插件配置） ==="
# 从日志文件中获取最新凭证
LATEST_LOG=$(ls -t /home/ubuntu/openclawAPP/server/logs/server-*.log 2>/dev/null | head -1)
if [ -n "$LATEST_LOG" ]; then
  grep -E "(Token:|encodingAESKey:)" "$LATEST_LOG" | tail -2
else
  echo "日志文件未找到，请通过 pm2 logs 查看凭证"
fi

echo ""
echo "也可以通过以下命令查看凭证："
echo "  pm2 logs openclaw-server --lines 20"
echo ""
echo "Health check:"
curl -s http://localhost:3001/health
echo ""
EOF

echo ""
echo ">>> 部署完成！"
echo ">>> 服务运行在: http://${SERVER_IP}:3001"
echo ">>> 客户端访问: http://${SERVER_IP}:3001"
echo ""
echo "下一步："
echo "  1. 从远程服务器日志获取 Token 和 encodingAESKey"
echo "  2. 更新本地 openclaw-plugin/config.json 中的凭证"
echo "  3. 本地启动 openclaw-plugin: cd openclaw-plugin && npm run dev"
