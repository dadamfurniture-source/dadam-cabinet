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

// Routes
import healthRoute from './routes/health.route.js';
import interiorRoute from './routes/interior.route.js';
import designToImageRoute from './routes/design-to-image.route.js';
import chatRoute from './routes/chat.route.js';
import themesRoute from './routes/themes.route.js';

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
app.use(chatRoute);
app.use(themesRoute);

// 에러 핸들러 (마지막에 등록)
app.use(errorHandler);

// 서버 시작
app.listen(PORT, () => {
  log.info({ port: PORT }, '다담AI HTTP API Server Started');
  log.info('Endpoints:');
  log.info('  POST /webhook/dadam-interior-v4');
  log.info('  POST /webhook/design-to-image');
  log.info('  POST /webhook/chat');
  log.info('  GET  /api/themes/images');
  log.info('  POST /api/themes/generate');
  log.info('  GET  /health');
});

export default app;
