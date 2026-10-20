/**
 * 학습 데이터셋 검수(admin/dataset.html)의 저장형 XSS (작업자 포털 1주차 후속 A).
 *
 * 시공사례 샘플의 attrs.title · raw_label · region 은 고객이 시공사례를 올릴 때 적은 글이
 * 그대로 옮겨 온 것이다 (workers/dataset-api/src/adapters.js fromCollectionPost).
 * 예전 show() 는 그 글과 sample_id · 출처 · 그룹을 innerHTML 에 그대로 넣었다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/dataset.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const EVIL_TITLE = '<img src=x onerror="window.__pwned=1">우리집 주방';
const EVIL_LABEL = '<svg onload="window.__pwned=2">';
const EVIL_REGION = '<i>지역</i>';
const EVIL_GROUP = 'dadam:post:<u>g</u>';

function query(result) {
  const q = {};
  for (const m of ['select', 'eq', 'not', 'order', 'limit']) q[m] = () => q;
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

function boot(rows) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.AdminAccess = { isAdmin: async () => true };
  const session = { user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} } };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: () => query({ data: rows, error: null, count: rows.length }),
    }),
  };
  (0, eval)(SCRIPT);
}

const SAMPLE = {
  sample_id: 'dadam:post:<b>s</b>',
  source: 'dadam_collection',
  group_key: EVIL_GROUP,
  image_url: 'https://img.example.test/a.jpg',
  media: 'photo',
  phase: 'after',
  space: 'kitchen',
  furniture: 'sink',
  layout_shape: 'unknown',
  label_source: 'structured',
  confidence: 0.9,
  license: 'user-uploaded',
  consent: true,
  attrs: { title: EVIL_TITLE, raw_label: EVIL_LABEL, region: EVIL_REGION },
};

describe('admin/dataset.html 검수 패널', () => {
  beforeEach(() => {
    delete window.__pwned;
  });

  test('고객이 적은 제목·라벨·지역과 샘플 id·그룹은 글자로만 나온다', async () => {
    boot([SAMPLE]);
    await window.initAdmin();
    const meta = document.getElementById('meta');
    // 굵은 글씨 두 개(샘플 id · 라이선스)는 페이지가 넣은 것 — 그 밖의 태그는 없어야 한다
    expect(meta.querySelectorAll('b')).toHaveLength(2);
    expect(meta.querySelector('img, svg, i, u, script')).toBeNull();
    expect(meta.querySelector('[onerror], [onload]')).toBeNull();
    expect(meta.querySelectorAll('b')[0].textContent).toBe('dadam:post:<b>s</b>');
    expect(meta.textContent).toContain(`제목 ${EVIL_TITLE}`);
    expect(meta.textContent).toContain(`원 라벨 ${EVIL_LABEL}`);
    expect(meta.textContent).toContain(`지역 ${EVIL_REGION}`);
    expect(meta.textContent).toContain(`그룹 ${EVIL_GROUP}`);
    expect(window.__pwned).toBeUndefined();
  });

  test('현재 라벨 칸도 글자로만 넣는다', async () => {
    boot([
      { ...SAMPLE, space: '<img src=x onerror="window.__pwned=3">', label_source: '<b>x</b>' },
    ]);
    await window.initAdmin();
    const guess = document.getElementById('guess');
    expect(guess.querySelector('img, b')).toBeNull();
    expect(guess.querySelectorAll('small')).toHaveLength(1);
    expect(guess.textContent).toBe('<img src=x onerror="window.__pwned=3"><b>x</b> 0.9');
  });

  test('보통 샘플은 그대로 보인다', async () => {
    boot([
      {
        ...SAMPLE,
        sample_id: 'dadam:post:abc',
        group_key: 'dadam:post:abc',
        attrs: { title: '주방 시공', region: '서울' },
      },
    ]);
    await window.initAdmin();
    expect(document.getElementById('guess').textContent).toBe('kitchenstructured 0.9');
    const meta = document.getElementById('meta');
    expect(meta.querySelectorAll('b')[0].textContent).toBe('dadam:post:abc');
    expect(meta.querySelectorAll('b')[1].textContent).toBe('user-uploaded');
    expect(meta.textContent).toContain('제목 주방 시공');
    expect(meta.textContent).toContain('지역 서울');
    expect(meta.textContent).toContain('동의함');
  });
});
