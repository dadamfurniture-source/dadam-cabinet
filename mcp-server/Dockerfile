# ═══════════════════════════════════════════════════════════════
# 다담AI MCP Server - Multi-stage Dockerfile
# ═══════════════════════════════════════════════════════════════

# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# 의존성 먼저 설치 (캐시 활용)
COPY package.json package-lock.json ./
RUN npm ci

# 소스 복사 + 빌드
COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# --- Production Stage ---
FROM node:20-alpine AS production

WORKDIR /app

# 프로덕션 의존성만 설치
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 빌드 결과 복사
COPY --from=builder /app/dist ./dist

# 보안: non-root 사용자
RUN addgroup -g 1001 -S nodejs && \
    adduser -S dadam -u 1001
USER dadam

# 환경 변수
ENV NODE_ENV=production
ENV HTTP_PORT=3200

EXPOSE 3200

# 헬스체크
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3200/health || exit 1

CMD ["node", "dist/http-server.js"]
