/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, process */
/**
 * functions/segan/p/[id].js — 시공사례 사진 한 장 주소 (Cloudflare Pages Function, 2026-11-23 「사이트 새는 곳 막기」 묶음 5).
 * 메신저가 링크를 미리 볼 때 그 사진이 뜨는 작은 HTML + 사람은 시공사례 화면의 그 사진으로 넘긴다.
 * ESM 이라 node 하위 프로세스로 불러 본다 (fetch 는 가짜).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const FN = pathToFileURL(path.join(ROOT, 'functions', 'segan', 'p', '[id].js')).href;
const ID = '7581b529-0937-4d8c-8f37-f2fda010d467';

/** 하위 프로세스에서 함수 모듈을 불러 code 를 돌리고 JSON 결과를 받는다 */
function run(code) {
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import * as fn from ${JSON.stringify(FN)};\n${code}`],
    { cwd: ROOT, encoding: 'utf8' }
  );
  return JSON.parse(out);
}

/** 가짜 fetch 로 onRequest 를 부른다 → { status, headers, body, calls } */
function request({ id, method = 'GET', rows = [], ok = true, throws = false }) {
  return run(`
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init && init.headers });
      if (${throws}) throw new Error('network');
      return { ok: ${ok}, json: async () => ${JSON.stringify(rows)} };
    };
    const res = await fn.onRequest({ request: new Request('https://example.test/segan/p/x', { method: ${JSON.stringify(method)} }), params: { id: ${JSON.stringify(id)} } });
    console.log(JSON.stringify({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text(), calls }));
  `);
}

describe('시공사례 사진 주소 /segan/p/<id>', () => {
  test('공개 키 · 주소가 js/config.js 와 같다', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
    const got = run(`console.log(JSON.stringify({ url: fn.SUPABASE_URL, key: fn.SUPABASE_KEY }));`);
    expect(cfg).toContain(`url: '${got.url}'`);
    expect(cfg).toContain(`'${got.key}'`);
    expect(got.key).toMatch(/^sb_publishable_/); // 공개 키만 — 서버 키를 넣지 않는다
  });

  test('한 건 읽기 — 시공사례 화면과 같은 공개 조건', () => {
    const { url } = run(`console.log(JSON.stringify({ url: fn.postUrl(${JSON.stringify(ID)}) }));`);
    const u = new URL(url);
    expect(u.pathname).toBe('/rest/v1/collection_posts');
    expect(u.searchParams.get('id')).toBe(`eq.${ID}`);
    expect(u.searchParams.get('or')).toBe('(source.eq.upload,hq_picked_at.not.is.null)');
    const col = fs.readFileSync(path.join(ROOT, 'segan', 'collection.js'), 'utf8');
    expect(col).toContain(".or('source.eq.upload,hq_picked_at.not.is.null')");
  });

  test('있는 게시물 — 그 사진 · 장소 · 색으로 미리보기, 사람은 시공사례 ?p= 로 넘어간다, 검색에는 내지 않는다', () => {
    const r = request({
      id: ID,
      rows: [
        {
          id: ID,
          image_url: 'https://dadamfurniture.com/app/portfolio/mix-01.jpg',
          place_label: '일자형 주방',
          door_color: '매트 딥그린 · 카카오월넛',
          source: 'ai_render',
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['x-robots-tag']).toBe('noindex');
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].headers.apikey).toMatch(/^sb_publishable_/);
    expect(r.body).toContain(
      '<meta property="og:image" content="https://dadamfurniture.com/app/portfolio/mix-01.jpg" />'
    );
    expect(r.body).toContain(
      '<meta property="og:title" content="일자형 주방 · 매트 딥그린 · 카카오월넛 · SEGAN" />'
    );
    expect(r.body).toContain(
      `<meta property="og:url" content="https://dadamfurniture.com/segan/p/${ID}" />`
    );
    expect(r.body).toContain(`location.replace("/segan/collection?p=${ID}")`);
    expect(r.body).toContain(`<a href="/segan/collection?p=${ID}">`);
    expect(r.body).toContain('<meta name="robots" content="noindex" />');
  });

  test('글은 이스케이프한다 · https 가 아닌 사진은 공통 사진 · 업체 사진은 「실제 시공 사진」', () => {
    const r = request({
      id: ID,
      rows: [
        {
          id: ID,
          image_url: 'javascript:alert(1)',
          place_label: '<b>"주방"</b>',
          door_color: '',
          source: 'upload',
        },
      ],
    });
    expect(r.body).toContain('&lt;b&gt;&quot;주방&quot;&lt;/b&gt; · SEGAN');
    expect(r.body).not.toContain('<b>"주방"');
    expect(r.body).toContain(
      '<meta property="og:image" content="https://dadamfurniture.com/segan/og/collection.jpg" />'
    );
    expect(r.body).toContain('실제 시공 사진입니다.');
  });

  test('HEAD 는 머리만', () => {
    const r = request({
      id: ID,
      method: 'HEAD',
      rows: [{ id: ID, image_url: 'https://x.test/a.jpg', source: 'upload' }],
    });
    expect(r.status).toBe(200);
    expect(r.body).toBe('');
  });

  test.each([
    ['모르는 id 모양 — DB 에 묻지 않는다', { id: 'not-a-uuid' }, 0],
    ['없거나 숨은 게시물', { id: ID, rows: [] }, 1],
    ['DB 가 실패', { id: ID, ok: false }, 1],
    ['네트워크 오류', { id: ID, throws: true }, 1],
  ])('%s → 302 시공사례 목록', (_, args, calls) => {
    const r = request(args);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/segan/collection');
    expect(r.calls).toHaveLength(calls);
  });

  test('GET · HEAD 말고는 405', () => {
    const r = request({ id: ID, method: 'POST' });
    expect(r.status).toBe(405);
    expect(r.calls).toHaveLength(0);
  });
});
