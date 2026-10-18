/**
 * 설치 후 한 문항 — 고객 페이지 (feedback.html, 경영 대시보드 2단계 PR-7).
 *
 * 고객은 로그인 없이 문자로 받은 링크를 연다. 토큰은 #t= 로 와서 X-Share-Token 헤더로만 나간다.
 * 0~10 하나를 골라야 보낼 수 있고, 이미 답했거나 기간이 지난 링크는 그렇다고 말한다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'feedback.html'), 'utf8');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>'));
const settle = () => new Promise((r) => setTimeout(r, 0));

function boot({ hash = '#t=TOKEN123', get = { answered: false, question: '지인에게 다담가구를 소개하시겠어요?' }, getStatus = 200, postStatus = 200 } = {}) {
  document.body.innerHTML = BODY;
  window.location.hash = hash;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    if ((init.method || 'GET') === 'GET') {
      return { ok: getStatus === 200, status: getStatus, json: async () => (getStatus === 200 ? { success: true, data: get } : { success: false, message: '링크 기간이 지났습니다' }) };
    }
    return { ok: postStatus === 200, status: postStatus, json: async () => (postStatus === 200 ? { success: true, data: { answered: true } } : { success: false, message: '이미 답해 주셨습니다' }) };
  });
  (0, eval)(SCRIPT);
  return calls;
}
const visible = (id) => !document.getElementById(id).hidden;

test('토큰은 주소가 아니라 헤더로만 나간다', async () => {
  const calls = boot();
  await settle(); await settle();
  expect(calls[0].url).toBe('https://dadam-workflow-api.dadamfurniture.workers.dev/public/feedback');
  expect(calls[0].headers['X-Share-Token']).toBe('TOKEN123');
  expect(calls[0].url).not.toMatch(/TOKEN123/);
});

test('0~10 열한 칸 — 고르기 전에는 보낼 수 없고, 고른 점수와 한 줄을 보낸다', async () => {
  const calls = boot();
  await settle(); await settle();
  expect(visible('askCard')).toBe(true);
  const buttons = [...document.querySelectorAll('#scale button')];
  expect(buttons.map((b) => b.textContent)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  expect(document.getElementById('btnSubmit').disabled).toBe(true);
  buttons[9].click();
  expect(buttons[9].getAttribute('aria-pressed')).toBe('true');
  expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  document.getElementById('comment').value = '설치가 깔끔했어요';
  document.getElementById('btnSubmit').click();
  await settle(); await settle();
  const post = calls.find((c) => c.method === 'POST');
  expect(post.body).toEqual({ score: 9, comment: '설치가 깔끔했어요' });
  expect(post.headers['X-Share-Token']).toBe('TOKEN123');
  expect(visible('doneCard')).toBe(true);
});

test('이미 답한 링크면 고맙다는 말만', async () => {
  boot({ get: { answered: true, score: 8 } });
  await settle(); await settle();
  expect(visible('doneCard')).toBe(true);
  expect(document.getElementById('doneText').textContent).toMatch(/이미 답해 주셨습니다/);
});

test('기간이 지난 링크(410)는 새 링크를 요청하라고', async () => {
  boot({ getStatus: 410 });
  await settle(); await settle();
  expect(visible('errorCard')).toBe(true);
  expect(document.getElementById('errorTitle').textContent).toBe('링크 기간이 지났습니다');
});

test('토큰 없이 열면 서버에 묻지 않고 링크 전체를 열라고', async () => {
  const calls = boot({ hash: '' });
  await settle();
  expect(calls).toHaveLength(0);
  expect(document.getElementById('errorTitle').textContent).toBe('링크가 올바르지 않습니다');
});

test('동시에 두 번 눌러 409 가 와도 고맙다는 화면', async () => {
  boot({ postStatus: 409 });
  await settle(); await settle();
  document.querySelectorAll('#scale button')[10].click();
  document.getElementById('btnSubmit').click();
  await settle(); await settle();
  expect(visible('doneCard')).toBe(true);
});

test('색인 · 리퍼러를 막는다', () => {
  expect(HTML).toMatch(/<meta name="robots" content="noindex, nofollow, noarchive"/);
  expect(HTML).toMatch(/<meta name="referrer" content="no-referrer"/);
});
