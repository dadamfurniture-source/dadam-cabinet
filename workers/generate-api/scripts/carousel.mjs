#!/usr/bin/env node
/**
 * 홍보용 캐러셀 만들기 (2026-11-20). 찍어 둔 색 조합 사진에 색 이름 · 「AI 연출 이미지」 · 주소를 찍고,
 * 마지막에 사이트로 부르는 장을 붙여 1080 × 1350 JPEG 묶음으로 낸다. 게시 글도 같이 쓴다.
 *
 *   node scripts/carousel.mjs --spec <spec.json> --out <폴더> [--source threads]
 *
 * spec.json:
 *   {
 *     "title": "같은 주방, 다른 색",
 *     "subject": "kitchen",
 *     "campaign": "kitchen-tones_2026-11",
 *     "source": "instagram",          // 게시 글 링크의 utm_source — 채널마다 (없으면 instagram, --source 가 먼저)
 *     "slides": [ { "file": "사진 경로", "tone": "그레이 · 월넛" }, … ]   // 경로는 spec 파일 기준
 *   }
 *
 * 필요한 것은 크롬(또는 엣지)뿐이다 — 환경 변수 CHROME_PATH 로 바꿀 수 있다. 크롬을 화면 없이 띄워
 * 개발자 도구 통로(CDP)로 HTML 한 장씩을 JPEG 로 찍는다. 다른 패키지는 쓰지 않는다 (Node 22 이상의 WebSocket).
 * 인스타그램 게시 API 는 JPEG 만 받는다.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CAROUSEL_SIZE, slideHtml, ctaHtml, buildCaption } from './carousel-html.mjs';

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return o;
}

function findChrome() {
  const list = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = list.find((p) => existsSync(p));
  if (!found) throw new Error('크롬을 찾지 못했습니다 — CHROME_PATH 를 주세요');
  return found;
}

/** 크롬을 화면 없이 띄우고 개발자 도구 주소(ws://…)가 찍힐 때까지 기다린다. */
function launch(chrome, profile) {
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const ready = new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('크롬이 30초 안에 뜨지 않았습니다')), 30_000);
    child.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    child.on('exit', (code) => reject(new Error(`크롬이 끝났습니다 (종료 ${code})`)));
  });
  return { child, ready };
}

/** 개발자 도구 통로 — 보낸 번호로 답을 짝짓고, 이벤트는 이름으로 한 번 기다린다. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const waiting = new Map();
  const events = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      const key = `${msg.sessionId || ''}:${msg.method}`;
      const list = events.get(key);
      if (list && list.length) list.shift()(msg.params);
    }
  });
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('개발자 도구에 붙지 못했습니다')));
  });
  return {
    open,
    send(method, params = {}, sessionId) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
    },
    once(method, sessionId) {
      const key = `${sessionId || ''}:${method}`;
      return new Promise((resolve) => {
        if (!events.has(key)) events.set(key, []);
        events.get(key).push(resolve);
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.spec || !a.out) throw new Error('--spec <spec.json> --out <폴더> 가 필요합니다');
  const specFile = path.resolve(a.spec);
  const spec = JSON.parse(await readFile(specFile, 'utf8'));
  const base = path.dirname(specFile);
  const out = path.resolve(a.out);
  const tmp = path.join(os.tmpdir(), `carousel-${process.pid}`);
  await mkdir(tmp, { recursive: true });
  await mkdir(out, { recursive: true });

  const slides = spec.slides || [];
  for (const s of slides) {
    if (!existsSync(path.resolve(base, s.file))) throw new Error(`사진이 없습니다: ${s.file}`);
  }
  const tones = slides.map((s) => s.tone);
  const pages = slides.map((s, i) => ({
    name: `${String(i + 1).padStart(2, '0')}`,
    html: slideHtml({
      src: pathToFileURL(path.resolve(base, s.file)).href,
      tone: s.tone,
      index: i + 1,
      total: slides.length,
      title: i === 0 ? spec.title : undefined,
      subject: spec.subject || 'kitchen',
    }),
  }));
  pages.push({
    name: `${String(slides.length + 1).padStart(2, '0')}-cta`,
    html: ctaHtml({ tones, subject: spec.subject || 'kitchen', headline: spec.headline }),
  });

  const { child, ready } = launch(findChrome(), path.join(tmp, 'profile'));
  const files = [];
  try {
    const cdp = connect(await ready);
    await cdp.open;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: CAROUSEL_SIZE.width,
        height: CAROUSEL_SIZE.height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      sessionId
    );
    for (const p of pages) {
      const html = path.join(tmp, `${p.name}.html`);
      await writeFile(html, p.html);
      const loaded = cdp.once('Page.loadEventFired', sessionId);
      await cdp.send('Page.navigate', { url: pathToFileURL(html).href }, sessionId);
      await loaded;
      // 큰 사진이 다 풀릴 때까지 — 그림이 모두 complete 인지 페이지에 묻는다
      await cdp.send(
        'Runtime.evaluate',
        {
          expression:
            'Promise.all([...document.images].map((i) => (i.decode ? i.decode().catch(() => 0) : 0))).then(() => document.fonts.ready).then(() => 1)',
          awaitPromise: true,
        },
        sessionId
      );
      const shot = await cdp.send(
        'Page.captureScreenshot',
        { format: 'jpeg', quality: 92 },
        sessionId
      );
      const jpg = path.join(out, `${p.name}.jpg`);
      await writeFile(jpg, Buffer.from(shot.data, 'base64'));
      files.push(path.basename(jpg));
      console.log(`만듦 ${jpg}`);
    }
    cdp.close();
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }

  const caption = buildCaption({
    title: spec.title,
    tones,
    source: (typeof a.source === 'string' && a.source) || spec.source || undefined,
    campaign: spec.campaign,
    subject: spec.subject || 'kitchen',
    tags: spec.tags,
  });
  await writeFile(path.join(out, 'caption.txt'), caption);
  await writeFile(
    path.join(out, 'manifest.json'),
    JSON.stringify(
      { title: spec.title, made_at: new Date().toISOString(), size: CAROUSEL_SIZE, files, tones },
      null,
      2
    )
  );
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
  console.log(`글 ${path.join(out, 'caption.txt')}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
