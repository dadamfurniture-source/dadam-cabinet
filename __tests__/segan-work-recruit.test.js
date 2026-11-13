/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, document, window */
/**
 * SEGAN 「작업 배정」 줄의 모집 칸 (segan/work-recruit.js — segan/project-work.js · segan/site-map.js 가 같이 쓴다)
 *
 *   2026-11-14 사장님 결정 — 「작업 배정」 줄에 「모집 올리기」. 팩토리가 작업을 올리면 연결된 작업자가 신청하고 팩토리가 뽑는다.
 *   이 파일은 글 · 모양 · 입력 읽기만 한다 (서버를 부르지 않는다). 누른 일은 두 화면의 시험이 본다.
 *   이름은 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const NOW = Date.parse('2026-11-14T03:00:00Z'); // 한국 시간 2026-11-14 (토) 12:00

function mod() {
  delete window.SeganWorkRecruit;
  (0, eval)(read('segan/work-recruit.js'));
  return window.SeganWorkRecruit;
}
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
function draw(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}
const app = (id, name, extra = {}) => ({
  application_id: id,
  name,
  message: null,
  at: '2026-11-14T00:20:00Z',
  ...extra,
});
const ON = (extra = {}) => ({
  on: true,
  state: 'open',
  slots: 3,
  filled: 1,
  deadline: '2026-11-18T09:00:00Z',
  applications: [
    app('ap-1', '시험기사 <b>가</b>', { message: '오전부터 <i>가능</i>합니다' }),
    app('ap-2', ''),
  ],
  ...extra,
});

describe('본문 읽기', () => {
  test('recruitOf — 모양이 틀리면 null, 모르는 상태 · id 없는 신청은 버린다. 모집이 아니면 종료일을 비운다', () => {
    const R = mod();
    expect(R.recruitOf(null)).toBeNull();
    expect(R.recruitOf([])).toBeNull();
    expect(R.recruitOf('x')).toBeNull();
    expect(R.recruitOf(ON())).toEqual({
      on: true,
      state: 'open',
      slots: 3,
      filled: 1,
      deadline: '2026-11-18T09:00:00Z',
      apps: [
        {
          id: 'ap-1',
          name: '시험기사 <b>가</b>',
          message: '오전부터 <i>가능</i>합니다',
          at: '2026-11-14T00:20:00Z',
        },
        { id: 'ap-2', name: '', message: '', at: '2026-11-14T00:20:00Z' },
      ],
    });
    const odd = R.recruitOf({
      on: true,
      state: 'weird',
      slots: -1,
      filled: 1.5,
      applications: [{ application_id: 'bad id!' }, null, app('ap-3', '다')],
    });
    expect([odd.state, odd.slots, odd.filled, odd.apps.map((a) => a.id)]).toEqual([
      'open',
      0,
      0,
      ['ap-3'],
    ]);
    const off = R.recruitOf({
      on: false,
      state: 'open',
      slots: 1,
      filled: 0,
      deadline: '2026-11-18T09:00:00Z',
      applications: [],
    });
    expect([off.on, off.state, off.deadline]).toEqual([false, '', '']);
  });

  test('summaryOf · statusText — 표의 짧은 글과 지금 상태 한 줄', () => {
    const R = mod();
    expect(R.summaryOf(null)).toBe('');
    expect(R.summaryOf(R.recruitOf(ON()))).toBe('모집 중 · 신청 2');
    expect(R.summaryOf(R.recruitOf(ON({ applications: [] })))).toBe('모집 중');
    expect(R.summaryOf(R.recruitOf(ON({ state: 'full' })))).toBe('신청 2');
    expect(R.summaryOf(R.recruitOf({ on: false, applications: [] }))).toBe('');
    expect(R.statusText(R.recruitOf(ON()))).toBe(
      '모집 중입니다 — 정원 3명 가운데 1명 확정 · 지원 종료 11/18 (수) 18:00'
    );
    expect(R.statusText(R.recruitOf(ON({ state: 'full', deadline: null, filled: 3 })))).toBe(
      '정원이 찼습니다 — 작업자 화면의 「모집중」에는 보이지 않습니다 — 정원 3명 가운데 3명 확정'
    );
    expect(R.statusText(R.recruitOf(ON({ state: 'expired' })))).toContain(
      '지원 종료일이 지나 작업자 화면의 「모집중」에 보이지 않습니다'
    );
    expect(R.whenText('2026-11-14T00:20:00Z')).toBe('11/14 (토) 09:20');
    expect(R.whenText('x')).toBe('');
  });
});

describe('그리기', () => {
  test('모집 중 — 상태 한 줄 · 신청한 작업자(이름 · 남긴 글은 글자로만) · 「뽑기」 「반려」 · 「모집 내리기」', () => {
    const R = mod();
    const h = draw(
      R.blockHtml(R.recruitOf(ON()), { prefix: 'pw', manage: true, assign: true, busy: false })
    );
    expect(text(h.querySelector('[data-wr="status"]'))).toContain(
      '모집 중입니다 — 정원 3명 가운데 1명 확정'
    );
    expect([...h.querySelectorAll('.wr-apps .sm-wk-row')].map(text)).toEqual([
      '시험기사 <b>가</b>신청 11/14 (토) 09:20뽑기반려',
      '(이름 없음)신청 11/14 (토) 09:20뽑기반려',
    ]);
    expect(h.querySelector('.wr-apps b')).toBeNull();
    expect(h.querySelector('.wr-apps i')).toBeNull();
    expect(text(h.querySelector('.wr-apps .mk-note'))).toBe('남긴 글: 오전부터 <i>가능</i>합니다');
    expect(
      [...h.querySelectorAll('[data-act]')].map((b) => [
        b.getAttribute('data-act'),
        b.getAttribute('data-id'),
      ])
    ).toEqual([
      ['pw-app-approve', 'ap-1'],
      ['pw-app-reject', 'ap-1'],
      ['pw-app-approve', 'ap-2'],
      ['pw-app-reject', 'ap-2'],
      ['pw-recruit-stop', null],
    ]);
    // 올리는 칸은 없다 (이미 모집 중)
    expect(h.querySelector('[name="pw-people"]')).toBeNull();
    // 새로 사람을 들일 수 없는 줄(끝난 일정 · 내려간 등급)에서는 뽑지 못하고 반려 · 내리기만
    const closed = draw(
      R.blockHtml(R.recruitOf(ON()), { prefix: 'pw', manage: true, assign: false })
    );
    expect(
      [...closed.querySelectorAll('[data-act]')].map((b) => b.getAttribute('data-act'))
    ).toEqual(['pw-app-reject', 'pw-app-reject', 'pw-recruit-stop']);
  });

  test('내리기를 되묻는다 — 신청이 있으면 「반려로 끝납니다」. 바쁠 때는 단추를 잠근다', () => {
    const R = mod();
    const ask = draw(
      R.blockHtml(R.recruitOf(ON()), {
        prefix: 'wk',
        manage: true,
        assign: true,
        asking: true,
        fk: true,
      })
    );
    expect(text(ask.querySelector('[data-wr="ask"] p'))).toBe(
      '모집을 내릴까요? 답을 기다리는 신청은 반려로 끝납니다.'
    );
    expect(
      [...ask.querySelectorAll('[data-wr="ask"] [data-act]')].map((b) => [
        b.getAttribute('data-act'),
        b.getAttribute('data-fk'),
        text(b),
      ])
    ).toEqual([
      ['wk-recruit-stop-yes', 'wk-recruit-stop-yes:', '내리기'],
      ['wk-recruit-stop-no', 'wk-recruit-stop-no:', '취소'],
    ]);
    expect(ask.querySelector('[data-act="wk-recruit-stop"]')).toBeNull();
    const none = draw(
      R.blockHtml(R.recruitOf(ON({ applications: [] })), {
        prefix: 'wk',
        manage: true,
        asking: true,
      })
    );
    expect(text(none.querySelector('[data-wr="ask"] p'))).toBe('모집을 내릴까요?');
    expect(text(none.querySelector('.me-empty'))).toBe('아직 신청한 작업자가 없습니다.');
    const busy = draw(
      R.blockHtml(R.recruitOf(ON()), { prefix: 'wk', manage: true, assign: true, busy: true })
    );
    expect([...busy.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  });

  test('모집이 아닐 때 — 올릴 수 있는 사람에게만 올리는 칸 (인원은 비어 있다 — 미리 적어 둔 값 없음). 직원에게는 칸이 없다', () => {
    const R = mod();
    const h = draw(R.blockHtml(null, { prefix: 'pw', manage: true, assign: true }));
    expect(text(h.querySelector('.cw-label'))).toBe('모집');
    const people = h.querySelector('[name="pw-people"]');
    expect([people.type, people.value, people.min, people.max, people.placeholder]).toEqual([
      'number',
      '',
      '1',
      '10',
      '명',
    ]);
    expect(h.querySelector('[name="pw-until-date"]').value).toBe('');
    expect(h.querySelector('[name="pw-until-time"]').value).toBe('');
    expect(text(h.querySelector('[data-act="pw-recruit"]'))).toBe('모집 올리기');
    expect(text(h)).toContain('종류 · 날짜 · 지역 · 팩토리 이름만 보입니다');
    // 직원 · 새로 사람을 들일 수 없는 줄 — 칸이 없다
    expect(R.blockHtml(null, { prefix: 'pw', manage: false, assign: false })).toBe('');
    expect(R.blockHtml(null, { prefix: 'pw', manage: true, assign: false })).toBe('');
    expect(R.blockHtml(R.recruitOf({ on: false, applications: [] }), { prefix: 'pw' })).toBe('');
    // 직원은 모집 중인 줄을 보기만 — 단추가 없다
    const staff = draw(R.blockHtml(R.recruitOf(ON()), { prefix: 'pw', manage: false }));
    expect(staff.querySelectorAll('[data-act]').length).toBe(0);
    expect(staff.querySelectorAll('.wr-apps .sm-wk-row').length).toBe(2);
  });
});

describe('입력 읽기', () => {
  const form = (R, values) => {
    const h = draw(R.blockHtml(null, { prefix: 'pw', manage: true, assign: true }));
    for (const [k, v] of Object.entries(values)) h.querySelector(`[name="pw-${k}"]`).value = v;
    return R.readForm(h, 'pw', NOW);
  };
  test('인원은 꼭 적는다 (1 ~ 10) · 종료일은 비워도 된다 · 날을 적으면 시각도 · 지금보다 뒤', () => {
    const R = mod();
    expect(form(R, {})).toEqual({
      error: 'people',
      message: '모집 인원을 적어 주세요 (1 ~ 10명).',
    });
    for (const bad of ['0', '11', '-1']) expect(form(R, { people: bad }).error).toBe('people');
    expect(form(R, { people: '2' })).toEqual({ body: { people: 2 } });
    expect(form(R, { people: '10' })).toEqual({ body: { people: 10 } });
    expect(form(R, { people: '1', 'until-date': '2026-11-18' })).toEqual({
      error: 'until-time',
      message: '지원 종료일의 시각을 골라 주세요.',
    });
    expect(form(R, { people: '1', 'until-time': '18:00' })).toEqual({
      error: 'until-date',
      message: '지원 종료일의 날짜를 골라 주세요.',
    });
    expect(form(R, { people: '1', 'until-date': '2026-11-14', 'until-time': '11:59' })).toEqual({
      error: 'until-date',
      message: '지원 종료일은 지금보다 뒤여야 합니다.',
    });
    expect(form(R, { people: '1', 'until-date': '2026-11-18', 'until-time': '18:00' })).toEqual({
      body: { people: 1, apply_deadline: '2026-11-18T18:00:00+09:00' },
    });
  });
});

describe('자리', () => {
  test('me.html 이 project-work.js · site-map.js 앞에서 읽고, 서비스 워커가 담는다. 기기에 남기지 않는다', () => {
    const html = read('segan/me.html');
    const at = (name) => html.indexOf('<script src="' + name + '?v=');
    expect(at('work-recruit.js')).toBeGreaterThan(-1);
    expect(at('work-recruit.js')).toBeLessThan(at('project-work.js'));
    expect(at('work-recruit.js')).toBeLessThan(at('site-map.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'work-recruit.js')");
    const code = read('segan/work-recruit.js')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(/);
  });
});
