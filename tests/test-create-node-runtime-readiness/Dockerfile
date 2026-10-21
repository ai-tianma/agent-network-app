# 选服务器页视觉返工(2026-10-21)的验收镜像:web export + 三档视口截图/断言。
# 用官方 Playwright 镜像,因为它自带 chromium 与系统库;npm ci 在容器内装依赖,
# 不动宿主 node_modules、不起 hub、不碰 127.0.0.1:9200。
FROM mcr.microsoft.com/playwright:v1.56.1-jammy

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npx --no-install expo export --platform web --output-dir /web
# 驱动脚本要 playwright 的 JS 包;镜像里只有浏览器。装一份到 /qa-tools,不去动 app 的 lock。
RUN npm install --prefix /qa-tools --no-save --no-audit --no-fund playwright@1.56.1
ENV WEB_DIR=/web OUT=/artifacts SHOT_TAG=after PLAYWRIGHT_MODULE=/qa-tools/node_modules/playwright/index.mjs
CMD ["node", "tests/test-create-node-runtime-readiness/drive.mjs"]
