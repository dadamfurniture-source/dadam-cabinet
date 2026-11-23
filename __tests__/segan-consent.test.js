/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, document, window, sessionStorage, beforeEach */
/**
 * SEGAN 가입 동의 창 (segan/consent.js) — 2026-11-23 대표님 「동의 체크 갯수 줄이기」
 *   - 전체 동의 한 번 = [필수] 만 14세 · 이용약관 · 처리방침 (한 칸) + [선택] 혜택 · 새 소식 (따로)
 *   - profiles.terms_agreed_at 이 빈 회원에게만, 이 접속에 한 번 저절로 뜬다
 *   - 「나중에」는 창만 닫는다 — need() 는 false, 다음 need() 때 다시 뜬다 (계정 지우기 없음)
 *   - 동의하면 terms · privacy · age = 지금, marketing = 지금 또는 null
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CODE = read('segan/consent.js');
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup({
  session = { user: { id: ME } },
  agreedAt = null,
  readFail = false,
  updateRows = 1,
} = {}) {
  document.body.innerHTML = '';
  sessionStorage.clear();
  delete window.SeganConsent;
  const calls = { updates: [], opened: [], closed: 0 };
  const sb = {
    from: (table) => {
      const q = { table };
      const chain = {
        select: () => chain,
        eq: (k, v) => {
          q.eq = [k, v];
          return chain;
        },
        maybeSingle: async () =>
          readFail
            ? { data: null, error: { message: 'x' } }
            : { data: { terms_agreed_at: agreedAt }, error: null },
        update: (row) => {
          q.update = row;
          calls.updates.push(q);
          return {
            eq: (k, v) => {
              q.eq = [k, v];
              return {
                select: async () => ({
                  data: Array.from({ length: updateRows }, () => ({ id: ME })),
                  error: null,
                }),
              };
            },
          };
        },
      };
      return chain;
    },
  };
  window.SeganShell = {
    ready: Promise.resolve({ session }),
    client: () => sb,
    sheet: {
      open: (opts) => {
        const box = document.createElement('section');
        box.className = 'test-dialog';
        box.appendChild(opts.body);
        document.body.appendChild(box);
        const h = {
          opts,
          close: async () => {
            box.remove();
            calls.closed++;
            if (opts.onClose) opts.onClose('close');
          },
        };
        calls.opened.push(h);
        return h;
      },
    },
  };
  new Function(CODE)();
  return calls;
}

const $ = (id) => document.getElementById(id);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const toggle = (el, on) => {
  el.checked = on;
  el.dispatchEvent(new window.Event('change'));
};

beforeEach(() => {
  sessionStorage.clear();
});

describe('언제 뜨나', () => {
  test('동의 기록이 빈 회원 — 화면을 열면 한 번 뜬다 (가운데 작은 창)', async () => {
    const calls = setup();
    await tick();
    await tick();
    expect(calls.opened).toHaveLength(1);
    expect(calls.opened[0].opts.kind).toBe('dialog');
    expect(calls.opened[0].opts.title).toBe('시작하기 전에 한 번만 확인해 주세요');
    expect(sessionStorage.getItem('segan.consent.asked')).toBe('1');
  });

  test('이미 동의한 회원 · 로그인 전 · 기록을 못 읽으면 뜨지 않고 막지 않는다', async () => {
    for (const opts of [
      { agreedAt: '2026-11-23T00:00:00Z' },
      { session: null },
      { readFail: true },
    ]) {
      const calls = setup(opts);
      await tick();
      await tick();
      expect(calls.opened).toHaveLength(0);
      await expect(window.SeganConsent.need()).resolves.toBe(true);
    }
  });

  test('이 접속에 이미 띄웠으면 저절로는 다시 뜨지 않는다', async () => {
    sessionStorage.setItem('segan.consent.asked', '1');
    const calls = setup();
    sessionStorage.setItem('segan.consent.asked', '1');
    await tick();
    await tick();
    expect(calls.opened).toHaveLength(0);
  });
});

describe('칸', () => {
  test('전체 동의 · [필수] 한 칸(만 14세 · 약관 · 처리방침) · [선택] 혜택 · 새 소식, 링크 둘', async () => {
    setup();
    await tick();
    await tick();
    const rows = [...document.querySelectorAll('.sgc-row')].map((l) => [
      l.querySelector('input').id,
      l.textContent.trim(),
    ]);
    expect(rows).toEqual([
      ['sgcAll', '전체 동의'],
      ['sgcRequired', '[필수] 만 14세 이상이며, 이용약관과 개인정보 처리방침을 확인했습니다'],
      ['sgcMarketing', '[선택] 혜택 · 새 소식을 문자 · 메일로 받겠습니다'],
    ]);
    const links = [...document.querySelectorAll('.sgc-link')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
      a.target,
    ]);
    expect(links).toEqual([
      ['이용약관', '../terms.html', '_blank'],
      ['개인정보 처리방침', '../privacy.html', '_blank'],
    ]);
    // 약관 · 처리방침에 적힌 만 14세 규칙과 같은 말
    expect(read('terms.html')).toContain('만 14세 미만은 가입할 수 없습니다.');
  });

  test('전체 동의 → 둘 다 켜짐, 선택을 끄면 전체 동의도 꺼짐, 필수를 켜야 「동의하고 시작」', async () => {
    setup();
    await tick();
    await tick();
    const ok = document.querySelector('.sgc-agree');
    expect(ok.disabled).toBe(true);
    toggle($('sgcAll'), true);
    expect([$('sgcRequired').checked, $('sgcMarketing').checked]).toEqual([true, true]);
    expect(ok.disabled).toBe(false);
    toggle($('sgcMarketing'), false);
    expect($('sgcAll').checked).toBe(false);
    expect(ok.disabled).toBe(false);
    toggle($('sgcRequired'), false);
    expect(ok.disabled).toBe(true);
  });
});

describe('남기는 것', () => {
  test('전체 동의 — 약관 · 처리방침 · 만 14세 · 마케팅 모두 같은 시각, 본인 줄만', async () => {
    const calls = setup();
    await tick();
    await tick();
    const wait = window.SeganConsent.need();
    toggle($('sgcAll'), true);
    click(document.querySelector('.sgc-agree'));
    await expect(wait).resolves.toBe(true);
    expect(calls.updates).toHaveLength(1);
    const { table, update, eq } = calls.updates[0];
    expect(table).toBe('profiles');
    expect(eq).toEqual(['id', ME]);
    expect(Object.keys(update).sort()).toEqual(
      ['age_confirmed_at', 'marketing_agreed_at', 'privacy_agreed_at', 'terms_agreed_at'].sort()
    );
    expect(update.terms_agreed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    for (const k of ['privacy_agreed_at', 'age_confirmed_at', 'marketing_agreed_at'])
      expect(update[k]).toBe(update.terms_agreed_at);
    // 동의한 뒤에는 다시 묻지 않는다
    await expect(window.SeganConsent.need()).resolves.toBe(true);
    expect(calls.opened).toHaveLength(1);
  });

  test('필수만 — 마케팅은 null', async () => {
    const calls = setup();
    await tick();
    await tick();
    toggle($('sgcRequired'), true);
    click(document.querySelector('.sgc-agree'));
    await tick();
    await tick();
    expect(calls.updates[0].update.marketing_agreed_at).toBeNull();
  });

  test('저장 실패(줄 없음) — 창은 그대로, 안내 뒤 다시 누를 수 있다', async () => {
    const calls = setup({ updateRows: 0 });
    await tick();
    await tick();
    toggle($('sgcRequired'), true);
    click(document.querySelector('.sgc-agree'));
    await tick();
    await tick();
    expect(calls.closed).toBe(0);
    const err = document.querySelector('.sgc-error');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe('저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    expect(document.querySelector('.sgc-agree').disabled).toBe(false);
  });
});

describe('나중에', () => {
  test('창만 닫는다 — need() 는 false, 저장 없음, 다음 need() 때 다시 뜬다 · 계정 지우기 단추 없음', async () => {
    const calls = setup();
    await tick();
    await tick();
    expect(document.body.textContent).not.toMatch(/동의하지 않음|계정 지우기|탈퇴/);
    const first = window.SeganConsent.need();
    click(document.querySelector('.sgc-later'));
    await expect(first).resolves.toBe(false);
    expect(calls.updates).toHaveLength(0);
    const again = window.SeganConsent.need();
    await tick();
    expect(calls.opened).toHaveLength(2);
    click(document.querySelector('.sgc-later'));
    await expect(again).resolves.toBe(false);
  });
});

describe('붙은 곳', () => {
  test('화면마다 스크립트 줄을 두지 않는다 — 셸이 로그인한 화면에서만 같은 ?v= 로 부르고, 서비스 워커가 미리 받는다', () => {
    const pages = fs.readdirSync(path.join(ROOT, 'segan')).filter((f) => f.endsWith('.html'));
    for (const f of pages)
      expect([f, /<script[^>]+consent\.js/.test(read('segan/' + f))]).toEqual([f, false]);
    const shell = read('segan/shell.js');
    expect(shell).toContain(String.raw`SHELL_SRC.replace(/shell\.js(\?[^#]*)?$/, 'consent.js$1')`);
    expect(shell).toMatch(
      /ready\.then\(function \(r\) \{\s*if \(r && r\.session\) loadConsent\(\);/
    );
    expect(shell).toContain('consent: consent,');
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'consent.js')");
  });

  test('연출컷 만들기 · AI 상담 · 상담 신청 둘 · 시공사례 올리기가 하기 전에 SeganShell.consent() 로 묻는다', () => {
    const gate = /if \(!\(await consentOk\(\)\)\) return;/g;
    expect(read('segan/make.js').match(gate)).toHaveLength(2);
    expect(read('segan/consult.js').match(gate)).toHaveLength(2);
    expect(read('segan/activity.js').match(gate)).toHaveLength(1);
    for (const f of ['make.js', 'consult.js', 'activity.js'])
      expect(read('segan/' + f)).toContain(
        'return S && S.consent ? S.consent() : Promise.resolve(true);'
      );
  });
});
