/**
 * 2026-09-12: 상세설계에 메인 사이트 헤더(js/site-shell.js)를 올린다.
 *
 * 왜: 상세설계는 옛 내비(nav-solid)를 따로 갖고 있었고, 플래너 전체화면(step2-fullscreen)
 * 에서는 그것마저 숨겨져 **홈으로 돌아갈 길이 없었다**. 메인 헤더를 그대로 두고
 * 전체화면에서도 맨 위에 고정한다. 툴바·플래너 overlay 는 그 아래로 내려온다.
 */
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('detaildesign.html');
const css = read('css/detaildesign/base.css');
const shell = read('js/site-shell.js');
const v5 = read('css/dadam-v5.css');

describe('상세설계는 메인 사이트 헤더를 쓴다', () => {
  test('셸 플레이스홀더가 있고 옛 내비는 없다', () => {
    expect(html).toMatch(/<div data-site-shell="header" data-nav="detail"><\/div>/);
    expect(html).not.toMatch(/class="nav nav-solid"/);
    expect(html).not.toMatch(/id="mobileMenu"/);
  });

  test('셸의 CSS·JS 를 싣고, 셸 JS 는 config·supabase 뒤에 온다', () => {
    expect(html).toMatch(/css\/dadam-v5\.css/);
    expect(html).not.toMatch(/css\/nav\.css/);
    const i1 = html.indexOf('js/config.js');
    const i2 = html.indexOf('js/site-shell.js');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
  });

  test('셸 헤더의 워드마크는 홈으로 간다', () => {
    expect(shell).toMatch(/class="v5-mark" href="[^"]+\.html" aria-label="다담가구 홈"/);
  });

  test("data-nav='detail' 이면 DETAIL DESIGN 링크가 현재 위치가 된다", () => {
    expect(shell).toMatch(/currentNav === 'detail'/);
    expect(shell).toMatch(/detail\.setAttribute\('aria-current', 'page'\)/);
  });
});

describe('플래너 전체화면에서도 헤더가 남는다', () => {
  test('숨김 규칙은 옛 내비(nav.nav)만 잡고 .v5-header 는 잡지 않는다', () => {
    const hide = css.match(/body\.step2-fullscreen nav\.nav[\s\S]*?display:\s*none\s*!important;\s*\}/);
    expect(hide).not.toBeNull();
    expect(hide[0]).not.toMatch(/v5-header/);
    expect(css).not.toMatch(/body\.step2-fullscreen nav,/);
  });

  test('헤더는 fixed 로 맨 위, 툴바는 헤더 아래, overlay 는 툴바 아래', () => {
    const header = css.match(/body\.step2-fullscreen \.v5-header \{[\s\S]*?\}/);
    expect(header).not.toBeNull();
    expect(header[0]).toMatch(/position:\s*fixed/);
    const headerZ = Number(header[0].match(/z-index:\s*(\d+)/)[1]);
    const toolbarZ = Number(css.match(/#step2Toolbar[\s\S]*?z-index:\s*(\d+)/)[1]);
    const overlayZ = Number(css.match(/\[id\^="__planner-overlay-"\][\s\S]*?z-index:\s*(\d+)/)[1]);
    expect(headerZ).toBeGreaterThan(toolbarZ);
    expect(toolbarZ).toBeGreaterThan(overlayZ);
    expect(css).toMatch(/#step2Toolbar \{ top: var\(--v5-header, 88px\); \}/);
    expect(css).toMatch(/top: calc\(var\(--v5-header, 88px\) \+ 44px\) !important/);
    expect(css).toMatch(/height: calc\(100vh - var\(--v5-header, 88px\) - 44px\) !important/);
  });

  test('폴백 88px 는 css/dadam-v5.css 의 --v5-header 와 같다', () => {
    expect(v5).toMatch(/--v5-header:\s*88px/);
  });
});

describe('옛 내비에 기대던 코드는 없어도 던지지 않는다', () => {
  test('toggleMobileMenu 는 요소가 있을 때만 토글한다', () => {
    const js = read('js/detaildesign/persistence-init.js');
    const at = js.indexOf('function toggleMobileMenu');
    expect(js.slice(at, at + 400)).toMatch(/if \(hamburger\) hamburger\.classList\.toggle/);
    expect(js.slice(at, at + 400)).toMatch(/if \(mobileMenu\) mobileMenu\.classList\.toggle/);
  });

  test('네비 사용자 이름·아바타 갱신은 null 안전하다', () => {
    const js = read('js/detaildesign/persistence-init.js');
    expect(js).toMatch(/if \(avatarEl\) avatarEl\.textContent/);
    expect(js).toMatch(/if \(navNameEl\) navNameEl\.textContent/);
  });
});
