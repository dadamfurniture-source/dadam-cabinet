/**
 * 관리자 상담 관리(admin/consultations.html)의 저장형 XSS (작업자 포털 1주차 후속 A).
 *
 * 상담 신청은 비로그인 공개 폼이고 consultations 의 INSERT 정책은 WITH CHECK (true) 라,
 * 이름·이메일·전화·제목·내용뿐 아니라 status·admin_memo·가구 종류까지 남이 정한다.
 * 예전 renderConsultationCard 는 그 글을 innerHTML 에 그대로 넣고, 단추는 onclick="…('${c.id}')" 였다.
 * 페이지 스크립트를 jsdom 에 올리고 가짜 Supabase 로 initAdmin 을 끝까지 돌린다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/consultations.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const ID = '11111111-1111-4111-8111-111111111111';
const EVIL_NAME = '<img src=x onerror="window.__pwned=1">';
const EVIL_EMAIL = '"><svg onload="window.__pwned=2">@example.test';
const EVIL_TITLE = '<script>window.__pwned=3</script>제목';
const EVIL_DESC = '<img src=x onerror="window.__pwned=4"> 내용';
const EVIL_MEMO = '<u>메모</u>';

/** 어떤 메서드를 이어 불러도 자기를 돌려주고, await 하면 정해 둔 결과를 내는 가짜 쿼리 */
function query(result, calls) {
  const q = {};
  for (const m of ['select', 'order', 'limit', 'eq', 'update', 'single']) {
    q[m] = (...args) => {
      if (calls) calls.push([m, ...args]);
      return q;
    };
  }
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

function boot(rows, calls) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.AdminAccess = { isAdmin: async () => true };
  const session = { user: { id: 'admin-id', email: 'admin@example.test', user_metadata: {} } };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: () => query({ data: rows, error: null }, calls),
    }),
  };
  (0, eval)(SCRIPT);
}

const EVIL_ROW = {
  id: ID,
  name: EVIL_NAME,
  email: EVIL_EMAIL,
  phone: '000-<b>0000</b>',
  consultation_type: '<i>유형</i>',
  title: EVIL_TITLE,
  description: EVIL_DESC,
  admin_memo: EVIL_MEMO,
  status: 'pending',
  preferred_date: '2026-10-25',
  preferred_time: '<s>오후</s>',
  furniture_categories: ['sink', '<em>가구</em>'],
  space_type: '<q>공간</q>',
  budget_range: '<mark>예산</mark>',
  style_preference: '<small>스타일</small>',
  space_width_mm: 1000,
  created_at: '2026-10-20T00:00:00Z',
};

describe('admin/consultations.html 상담 카드', () => {
  beforeEach(() => {
    delete window.__pwned;
  });

  test('공개 폼에서 온 글은 모두 글자로만 나온다', async () => {
    boot([EVIL_ROW]);
    await window.initAdmin();
    const list = document.getElementById('consultationList');
    expect(list.querySelectorAll('.consultation-card')).toHaveLength(1);
    expect(list.querySelector('img, svg, script, b, i, u, s, em, q, mark, small')).toBeNull();
    expect(list.querySelector('[onerror], [onload]')).toBeNull();
    for (const t of [
      EVIL_NAME,
      EVIL_EMAIL,
      EVIL_TITLE,
      EVIL_DESC,
      EVIL_MEMO,
      '<em>가구</em>',
      '<s>오후</s>',
    ]) {
      expect(list.textContent).toContain(t);
    }
    expect(list.querySelector('.user-avatar').textContent).toBe('<');
    expect(window.__pwned).toBeUndefined();
  });

  test('status 로 배지 class 속성을 깨고 나오지 못한다', async () => {
    boot([{ ...EVIL_ROW, status: 'x" onmouseover="window.__pwned=5' }]);
    await window.initAdmin();
    const list = document.getElementById('consultationList');
    expect(list.querySelector('[onmouseover]')).toBeNull();
    expect(list.querySelectorAll('.badge')).toHaveLength(1);
    expect(list.querySelector('.badge').textContent).toBe('x" onmouseover="window.__pwned=5');
  });

  test('단추에 인라인 onclick 이 없고, id 는 data-id 에 글자 그대로 실린다', async () => {
    const evilId = "x');window.__pwned=6;('";
    boot([{ ...EVIL_ROW, id: evilId }]);
    await window.initAdmin();
    const list = document.getElementById('consultationList');
    expect(list.querySelectorAll('[onclick]')).toHaveLength(0);
    const buttons = list.querySelectorAll('button[data-act]');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((b) => expect(b.dataset.id).toBe(evilId));
    expect(window.__pwned).toBeUndefined();
  });

  test('「내용 정리」를 누르면 그 상담이 수정 창에 글자로 채워진다', async () => {
    boot([EVIL_ROW]);
    await window.initAdmin();
    document.querySelector('#consultationList button[data-act="edit"]').click();
    expect(document.getElementById('editModal').classList.contains('active')).toBe(true);
    expect(document.getElementById('editTitle').value).toBe(EVIL_TITLE);
    expect(document.getElementById('editDescription').value).toBe(EVIL_DESC);
  });

  test('「취소」는 data-id 의 id 로 update 한다', async () => {
    const calls = [];
    boot([EVIL_ROW], calls);
    await window.initAdmin();
    window.confirm = () => true;
    window.alert = () => {};
    document.querySelector('#consultationList button[data-act="cancel"]').click();
    await new Promise((r) => setTimeout(r, 0));
    const upd = calls.findIndex((c) => c[0] === 'update');
    expect(upd).toBeGreaterThanOrEqual(0);
    expect(calls[upd][1].status).toBe('cancelled');
    expect(calls[upd + 1]).toEqual(['eq', 'id', ID]);
  });

  test('보통 상담은 그대로 보인다', async () => {
    boot([
      {
        id: ID,
        name: '테스트 고객',
        email: 'test@example.test',
        phone: '000-0000',
        consultation_type: 'estimate',
        title: '싱크대 견적',
        status: 'confirmed',
        furniture_categories: ['sink'],
        created_at: '2026-10-20T00:00:00Z',
      },
    ]);
    await window.initAdmin();
    const card = document.querySelector('#consultationList .consultation-card');
    expect(card.querySelector('.user-details h4').textContent).toContain('테스트 고객');
    expect(card.querySelector('.user-details h4 .type-badge').textContent).toBe('견적 상담');
    expect(card.querySelector('.user-details > span').textContent).toBe(
      'test@example.test | 000-0000'
    );
    expect(card.querySelector('.badge').className).toBe('badge confirmed');
    expect(card.querySelector('.badge').textContent).toBe('확정');
    expect(card.textContent).toContain('싱크대 견적');
    expect(card.textContent).toContain('싱크대');
    expect([...card.querySelectorAll('button[data-act]')].map((b) => b.dataset.act)).toEqual([
      'complete',
      'edit',
      'confirm',
      'cancel',
    ]);
  });
});
