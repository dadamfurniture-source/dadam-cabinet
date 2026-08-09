/**
 * 플래너 테스트 하네스 — mockup-shell / mockup-structure 를 jsdom 에서 실제로 부팅한다.
 *
 * 왜 필요한가:
 *   기존 플래너 테스트는 HTML 소스를 문자열로 잘라(`indexOf('function X')`) 검사한다.
 *   그 방식은 함수를 다른 파일로 옮기는 순간 `indexOf` 가 -1 을 반환하고
 *   `slice(-1, N)` 이 **빈 문자열**이 되어 `not.toMatch` 계열이 **초록으로 통과**한다.
 *   즉 리팩터링하면 테스트가 깨지는 게 아니라 **거짓말을 시작한다.**
 *   엔진을 `js/planner/` 로 분리하기 전에 이 하네스가 먼저 있어야 한다.
 *
 * 왜 jsdom 으로 되는가 (직접 확인함):
 *   - 두 파일 모두 getBBox / getScreenCTM / createSVGPoint 사용 0건
 *   - three.js 는 `if (three || !window.THREE) return;` (mockup-structure.html:2214) 로 스스로 skip
 *   - setPointerCapture 6곳만 폴리필하면 된다
 *   → Playwright 없이 실제 pointer 이벤트를 쏠 수 있다.
 *
 * 주입하는 것 (전역을 건드리지 않고 함수 인자로 그림자를 씌운다):
 *   location      — `?design=&item=` 스코프 키를 테스트가 정한다
 *   localStorage  — jest.setup.js 의 전역 목은 jest.fn() 이라 **저장이 안 된다**. 실제 Map 으로 대체
 *   window        — `window.parent === window` 면 플래너가 postMessage 를 거부하므로(sendPlannerState)
 *                   parent 만 스텁으로 바꾼 Proxy 를 넘긴다
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 실제로 값을 보관하는 localStorage. jest.setup.js 의 jest.fn() 목은 저장을 안 한다. */
function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => map.clear(),
    _dump: () => Object.fromEntries(map),
  };
}

/**
 * 실행할 클래식 스크립트를 **문서 순서대로** 모은다.
 *
 * 외부(`src=`)와 인라인을 함께 다뤄야 한다. P1 에서 공통 코드가
 * `js/planner/*.js` 로 나갔기 때문에, 외부를 건너뛰면 인라인이
 * `PLANNER_ORIGIN_KEY is not defined` 로 무너진다 — 브라우저에서는 멀쩡한데
 * 테스트만 빨개지는 가짜 실패다. jsdom 은 src 를 가져오지 않으므로 우리가 읽어준다.
 */
function collectScripts(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/type\s*=\s*["'](module|importmap)["']/.test(attrs)) continue; // ESM/importmap 은 실행 대상 아님
    const src = attrs.match(/\ssrc\s*=\s*["']([^"']+)["']/);
    if (src) {
      const rel = src[1].split('?')[0].replace(/^\.?\//, ''); // ?v= 캐시버전 제거
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) {
        throw new Error(
          `스크립트를 찾을 수 없습니다: ${src[1]} → ${abs}\n` +
          'HTML 의 <script src> 경로가 실제 파일과 어긋나면 브라우저에서도 깨집니다.'
        );
      }
      out.push({ name: rel, code: fs.readFileSync(abs, 'utf8') });
    } else {
      out.push({ name: 'inline#' + out.length, code: m[2] });
    }
  }
  return out;
}

/** 이전 이름 호환 — 인라인 코드 문자열만 준다. */
function inlineScripts(html) {
  return collectScripts(html).filter((s) => s.name.startsWith('inline#')).map((s) => s.code);
}

/**
 * 최상위 선언 이름을 뽑는다.
 *
 * `new Function(src)` 은 함수 스코프를 만들기 때문에 `function foo(){}` 가 전역에 안 올라간다.
 * 그래서 스크립트 끝에 "선언된 것들을 객체로 돌려주는" 에필로그를 붙여야 테스트가 만질 수 있다.
 *
 * 들여쓰기 4칸 이하만 최상위로 본다 — 중첩 함수 안의 선언까지 잡으면
 * 에필로그에서 ReferenceError 가 난다. 그래도 새는 경우를 대비해 typeof 가드를 씌운다.
 */
function topLevelNames(src) {
  const names = new Set();
  const re = /^ {0,4}(?:function\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  return [...names];
}

/** jsdom 에 없는 것들. 있으면 건드리지 않는다. */
function polyfill(win) {
  const E = win.Element.prototype;
  if (!E.setPointerCapture) E.setPointerCapture = function () {};
  if (!E.releasePointerCapture) E.releasePointerCapture = function () {};
  if (!E.hasPointerCapture) E.hasPointerCapture = function () { return false; };
  if (!win.requestAnimationFrame) win.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  if (!win.cancelAnimationFrame) win.cancelAnimationFrame = (id) => clearTimeout(id);
}

/**
 * 플래너 페이지를 부팅한다.
 * @param {'mockup-shell.html'|'mockup-structure.html'} file
 * @param {{search?: string, storage?: object, rect?: object}} [opts]
 */
function bootPlanner(file, opts = {}) {
  const search = opts.search || '';
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');

  const win = global.window;
  const doc = global.document;
  polyfill(win);

  // innerHTML 로 심은 <script> 는 HTML 명세상 실행되지 않는다 — 우리가 직접 돌린다
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  doc.documentElement.innerHTML = '<head></head><body>' + (bodyMatch ? bodyMatch[1] : html) + '</body>';

  // getBoundingClientRect 는 jsdom 이 전부 0 을 준다 → 좌표 계산이 무의미해진다
  const rect = Object.assign({ x: 0, y: 0, top: 0, left: 0, width: 1200, height: 800, right: 1200, bottom: 800 }, opts.rect);
  doc.querySelectorAll('*').forEach((el) => { el.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }); });

  const storage = makeStorage(opts.storage || {});
  const messages = [];
  const parentStub = {
    postMessage: (data) => { messages.push(data); },
    addEventListener: () => {},
  };
  const location = {
    search, hash: '', pathname: '/' + file, href: 'https://test.local/' + file + search,
    origin: 'https://test.local', reload: () => {}, replace: () => {}, assign: () => {},
  };

  // window.parent === window 이면 sendPlannerState 가 전송을 거부한다 → parent 만 갈아끼운다
  const winProxy = new Proxy(win, {
    get(t, k) {
      if (k === 'parent') return parentStub;
      if (k === 'location') return location;
      if (k === 'localStorage') return storage;
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, k, v) { t[k] = v; return true; },
    has(t, k) { return k in t; },
  });

  const errors = [];
  const exported = {};
  for (const { name, code } of collectScripts(html)) {
    // 함수 스코프에 갇힌 선언을 밖으로 꺼내는 에필로그.
    // typeof 가드는 중첩 선언이 새어 들어왔을 때의 ReferenceError 를 막는다.
    const epilogue =
      '\n;return {' +
      topLevelNames(code)
        .map((n) => `${JSON.stringify(n)}:(typeof ${n} !== 'undefined' ? ${n} : undefined)`)
        .join(',') +
      '};';
    try {
      // 전역을 오염시키지 않고 인자로 그림자를 씌운다.
      //
      // 브라우저에서는 외부 스크립트의 최상위 `const` 가 전역 렉시컬 스코프에 올라가
      // 뒤따르는 인라인이 그대로 참조한다. 여기서는 스크립트마다 함수 스코프가 생기므로
      // 그 연결이 끊긴다 — 대신 각 모듈이 `window.X = X` 로 노출하고, jsdom 에서는
      // window 가 곧 전역이라 다음 스크립트가 맨이름으로 찾아낸다.
      // (그래서 js/planner/*.js 의 window 노출 블록은 테스트의 생명줄이기도 하다.)
      // eslint-disable-next-line no-new-func
      const fn = new Function('window', 'document', 'location', 'localStorage', 'sessionStorage', 'self', 'globalThis', code + epilogue);
      Object.assign(exported, fn(winProxy, doc, location, storage, makeStorage(), winProxy, winProxy) || {});
    } catch (e) {
      e.message = `[${name}] ${e.message}`;
      errors.push(e);
    }
  }

  /** 실제 pointer 이벤트를 쏜다. jsdom 은 PointerEvent 미구현 → MouseEvent 로 타입만 맞춘다. */
  function fire(target, type, x, y, extra = {}) {
    const ev = new win.MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      button: extra.button ?? 0, buttons: extra.buttons ?? 1,
      shiftKey: !!extra.shiftKey, ctrlKey: !!extra.ctrlKey, altKey: !!extra.altKey, metaKey: !!extra.metaKey,
    });
    Object.defineProperty(ev, 'pointerId', { value: extra.pointerId ?? 1 });
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
    target.dispatchEvent(ev);
    return ev;
  }

  const pointer = {
    down: (t, x, y, o) => fire(t, 'pointerdown', x, y, o),
    move: (t, x, y, o) => fire(t, 'pointermove', x, y, o),
    up:   (t, x, y, o) => fire(t, 'pointerup', x, y, { buttons: 0, ...o }),
    drag(t, from, to, o) {
      this.down(t, from[0], from[1], o);
      this.move(t, to[0], to[1], o);
      this.up(t, to[0], to[1], o);
    },
  };

  return {
    window: winProxy, document: doc, storage, messages, errors, location,
    /** 인라인 스크립트의 최상위 선언. window 전역도 폴백으로 본다. */
    g: (name) => (name in exported ? exported[name] : win[name]),
    exported,
    pointer,
    /** 부모가 보낸 것처럼 메시지를 흘려보낸다 */
    postToPlanner: (data) => win.dispatchEvent(Object.assign(new win.Event('message'), { data, source: parentStub })),
  };
}

module.exports = { bootPlanner, makeStorage, inlineScripts, collectScripts };
