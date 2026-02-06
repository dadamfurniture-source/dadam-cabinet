// ═══════════════════════════════════════════════════════════════
// Chat Route
// POST /webhook/chat
// ═══════════════════════════════════════════════════════════════

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger.js';
import { validateMessage } from '../middleware/input-validator.js';
import { generateChatResponse } from '../services/chat.service.js';

const log = createLogger('route:chat');
const router = Router();

router.post('/webhook/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    const message = validateMessage(body.message);
    const context = body.context || {};

    log.info({ messagePreview: message.substring(0, 50) }, 'Processing chat request');

    const aiResponse = await generateChatResponse(message, context);

    res.json({
      success: true,
      response: aiResponse,
      output: aiResponse,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
