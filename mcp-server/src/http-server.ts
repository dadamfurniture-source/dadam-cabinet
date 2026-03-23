// ═══════════════════════════════════════════════════════════════
// 다담AI HTTP API Server - Express Bootstrap
// n8n 웹훅을 대체하는 REST API 서버
// ═══════════════════════════════════════════════════════════════

import express from 'express';
import { config } from 'dotenv';
import { createLogger } from './utils/logger.js';
import { corsMiddleware } from './middleware/cors-config.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireAuth } from './middleware/auth.js';

// Routes
import healthRoute from './routes/health.route.js';
import interiorRoute from './routes/interior.route.js';
import designToImageRoute from './routes/design-to-image.route.js';
import controlnetImageRoute from './routes/controlnet-image.route.js';
import generateRoute from './routes/generate.route.js';
import chatRoute from './routes/chat.route.js';
import themesRoute from './routes/themes.route.js';
import agentRoute from './routes/agent.route.js';
import designsRoute from './routes/designs.route.js';
import imagesRoute from './routes/images.route.js';

// 환경 변수 로드
config();

const log = createLogger('server');
const app = express();
const PORT = process.env.HTTP_PORT || 3200;

// 미들웨어
app.use(corsMiddleware);
app.use(express.json({ limit: '50mb' }));
app.use(requestLogger);

// 라우트
app.use(healthRoute);
app.use(interiorRoute);
app.use(designToImageRoute);
app.use(controlnetImageRoute);
app.use(generateRoute);
app.use(chatRoute);
app.use(themesRoute);
app.use(agentRoute);
app.use(designsRoute);
app.use(imagesRoute);

// 인증 확인 엔드포인트
app.post('/api/auth/verify', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

// 에러 핸들러 (마지막에 등록)
app.use(errorHandler);

// 서버 시작
app.listen(PORT, () => {
  log.info({ port: PORT }, '다담AI HTTP API Server Started');
  log.info('Endpoints:');
  log.info('  POST /webhook/dadam-interior-v4');
  log.info('  POST /webhook/design-to-image');
  log.info('  POST /webhook/controlnet-image');
  log.info('  POST /api/generate (Gemini 3.1 Flash Image direct)');
  log.info('  POST /webhook/chat');
  log.info('  GET  /api/themes/images');
  log.info('  POST /api/themes/generate');
  log.info('  POST /api/agent/chat/stream (SSE)');
  log.info('  CRUD /api/designs (auth required)');
  log.info('  CRUD /api/images  (auth required)');
  log.info('  GET  /health');
});

export default app;
