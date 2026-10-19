/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, document, window */
/**
 * 관리자 사이드바 공용화 (work-reports-archive.plan.md PR7).
 *   메뉴 정본 = js/admin-shell.js ADMIN_NAV, 각 페이지는 빈 #adminNav + 스크립트
 *   관리자 판정 = AdminAccess (admin_roles · is_admin RPC), 하드코딩 이메일 없음
 *   가전 모델 쓰기 = admin · super_admin ('superadmin' 오타 수정)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'js/admin-shell.js'), 'utf8');
const PAGES = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => f.endsWith('.html'));
const read = (f) => fs.readFileSync(path.join(ROOT, 'admin', f), 'utf8');

function boot(pathname) {
  document.body.innerHTML = '<ul class="nav-menu" id="adminNav"></ul>';
  window.history.replaceState(null, '', pathname);
  (0, eval)(SHELL);
  return [...document.querySelectorAll('#adminNav a')];
}

describe('메뉴 정본 — js/admin-shell.js', () => {
  test('관리자 페이지 전부가 메뉴에 한 번씩, 메뉴의 모든 링크는 있는 페이지', () => {
    const links = boot('/admin/index.html').map((a) => a.getAttribute('href'));
    expect([...links].sort()).toEqual([...PAGES].sort());
    expect(new Set(links).size).toBe(links.length);
    expect(links.indexOf('work-reports.html')).toBe(links.indexOf('logs.html') - 1);
  });

  test('지금 페이지에 active · aria-current, 나머지는 없음', () => {
    const links = boot('/admin/work-reports.html?order=x');
    const active = links.filter((a) => a.classList.contains('active'));
    expect(active.map((a) => a.getAttribute('href'))).toEqual(['work-reports.html']);
    expect(active[0].getAttribute('aria-current')).toBe('page');
    expect(active[0].querySelector('.nav-icon').textContent).toBe('📑');
    expect(active[0].textContent).toBe('📑작업 지시 보고');
  });

  test("'/admin/' 처럼 파일 이름이 없으면 대시보드", () => {
    expect(boot('/admin/').filter((a) => a.className === 'active').map((a) => a.getAttribute('href'))).toEqual(['index.html']);
    expect(window.AdminShell.currentPage('/a/b/logs.html')).toBe('logs.html');
  });

  test('확장자 없는 깔끔한 주소(/admin/logs — GitHub Pages · serve)도 지금 페이지로 잡는다', () => {
    expect(boot('/admin/logs').filter((a) => a.className === 'active').map((a) => a.getAttribute('href'))).toEqual(['logs.html']);
    expect(window.AdminShell.currentPage('/admin/reference-images')).toBe('reference-images.html');
  });
});

describe('각 관리자 페이지', () => {
  test.each(PAGES)('%s — 빈 #adminNav + 공용 스크립트, 하드코딩 메뉴 없음', (f) => {
    const html = read(f);
    expect(html.split('<ul class="nav-menu"').length - 1).toBe(1);
    expect(html).toMatch(/<ul class="nav-menu" id="adminNav"><\/ul>\s*<script src="\.\.\/js\/admin-shell\.js"><\/script>/);
    expect(html).not.toMatch(/<li><a href="logs\.html"/);
  });

  test.each(PAGES)('%s — 관리자 판정은 AdminAccess, 하드코딩 이메일 없음', (f) => {
    const html = read(f);
    expect(html).not.toMatch(/const ADMIN_EMAILS/);
    expect(html).not.toMatch(/\.includes\((session\.user|currentUser)\.email\)/);
    expect(html).not.toMatch(/기본 관리자 \(하드코딩\)/);
    expect(html).toMatch(/<script src="\.\.\/js\/admin-access\.js(\?v=[\d.]+)?"><\/script>/);
    expect(html).toMatch(/AdminAccess\.(isAdmin|getRole)\(/);
  });

  test("가전 모델 — admin · super_admin 만 ('superadmin' 오타 없음), DB 정책도 같이", () => {
    const html = read('appliances.html');
    expect(html).toContain("['admin', 'super_admin'].includes(role)");
    expect(html).not.toMatch(/'superadmin'\]/);
    const schema = fs.readFileSync(path.join(ROOT, 'database/appliance-models-schema.sql'), 'utf8');
    const fix = fs.readFileSync(path.join(ROOT, 'database/fix-appliance-models-rls.sql'), 'utf8');
    for (const sql of [schema, fix]) {
      expect(sql).not.toMatch(/role IN \('admin', 'superadmin'\)/);
      expect(sql.split("role IN ('admin', 'super_admin')").length - 1).toBe(3);
    }
  });
});

describe('메인 사이트로 버튼이 메뉴를 덮지 않는다', () => {
  test('사이드바 바닥에 absolute 로 붙어 있던 버튼을 메뉴 아래로 흘린다 (메뉴가 길어진 낮은 화면)', () => {
    document.body.innerHTML = '<nav class="sidebar"><ul class="nav-menu" id="adminNav"></ul><div class="sidebar-footer" style="position:absolute"><a href="../index.html">← 메인 사이트로</a></div></nav>';
    window.history.replaceState(null, '', '/admin/index.html');
    (0, eval)(SHELL);
    const f = document.querySelector('.sidebar-footer');
    expect(f.style.position).toBe('static');
  });
});
