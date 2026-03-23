import express from 'express';
import { Router } from 'express';

const app = express();
app.use(express.json());

// Simple inline router (same structure as agent.route.ts)
const router = Router();

router.post('/api/agent/chat/stream', async (req, res) => {
  console.log('[STREAM] handler reached');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });
  res.flushHeaders();
  res.write('event: text\ndata: {"chunk":"hello from stream"}\n\n');
  res.write('event: done\ndata: {"session_id":"test-123"}\n\n');
  res.end();
});

router.post('/api/agent/test', (req, res) => {
  console.log('[TEST] handler reached');
  res.json({ ok: true, body: req.body });
});

router.get('/api/agent/sessions', (req, res) => {
  console.log('[SESSIONS] handler reached');
  res.json({ count: 0 });
});

app.use(router);

app.listen(3200, () => {
  console.log('Test server ready on 3200');
});
