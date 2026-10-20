/**
 * 시공사례 이미지 관리(admin/gallery.html)의 XSS (작업자 포털 1주차 후속 A).
 *
 * furniture_images 의 품목·스타일·설명은 수집 스크립트(크롤링 사진의 모델 판독)가 넣은 글이고,
 * 업로드 진행 줄의 파일 이름은 내려받은 파일이면 바깥에서 정한 이름이다.
 * 예전 loadImages · submitUpload 는 그 글을 innerHTML 에 그대로 넣었다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'admin/gallery.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n'));

const ID = '33333333-3333-4333-8333-333333333333';
const EVIL_CAT = '<img src=x onerror="window.__pwned=1">';
const EVIL_STYLE = '<b>modern</b>';
const EVIL_DESC = '<svg onload="window.__pwned=2">설명';
const EVIL_URL = 'https://img.example.test/a.jpg" onload="window.__pwned=3';
const EVIL_FILE = '<img src=x onerror="window.__pwned=4">.jpg';

function query(result) {
  const q = {};
  for (const m of ['select', 'order', 'range', 'eq', 'insert']) q[m] = () => q;
  q.then = (ok, ng) => Promise.resolve(result).then(ok, ng);
  return q;
}

function boot(rows, storage) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb.test', anonKey: 'k' } };
  window.AdminAccess = { isAdmin: async () => true };
  const session = {
    user: { id: 'admin-id', email: 'admin@example.test', user_metadata: { name: '관리자' } },
  };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session } }) },
      from: () => query({ data: rows, error: null, count: rows.length }),
      storage: storage || { from: () => ({}) },
    }),
  };
  (0, eval)(SCRIPT);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('admin/gallery.html', () => {
  beforeEach(() => {
    delete window.__pwned;
  });

  test('카드의 품목·스타일·설명·주소는 글자로만 나온다', async () => {
    boot([
      {
        id: ID,
        category: EVIL_CAT,
        style: EVIL_STYLE,
        description: EVIL_DESC,
        image_url: EVIL_URL,
        is_training: false,
      },
    ]);
    await window.initAdmin();
    const box = document.getElementById('galleryContainer');
    expect(box.querySelectorAll('.gallery-item')).toHaveLength(1);
    // 카드의 그림은 페이지가 넣은 <img> 하나뿐, 그 onerror 는 페이지의 'No Image' 대체 그림이다
    const imgs = box.querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe(EVIL_URL);
    expect(imgs[0].getAttribute('alt')).toBe(EVIL_CAT);
    expect(imgs[0].hasAttribute('onload')).toBe(false);
    expect(imgs[0].getAttribute('onerror')).toMatch(/^this\.src='data:image\/svg\+xml,/);
    expect(box.querySelector('svg, b, script, [onload]')).toBeNull();
    expect(box.querySelector('.category').textContent).toBe(EVIL_CAT);
    expect(box.querySelector('.style').textContent).toContain(EVIL_STYLE);
    expect(box.querySelector('.style').textContent).toContain(EVIL_DESC.substring(0, 30));
    expect(window.__pwned).toBeUndefined();
  });

  test('DB 에만 있는 품목도 필터 목록에 글자로만 들어간다', async () => {
    boot([{ id: ID, category: EVIL_CAT, image_url: 'https://img.example.test/a.jpg' }]);
    await window.initAdmin();
    const sel = document.getElementById('filterCategory');
    expect(sel.querySelector('img')).toBeNull();
    const orphan = [...sel.options].find((o) => o.value === EVIL_CAT);
    expect(orphan).toBeTruthy();
    expect(orphan.textContent).toBe(EVIL_CAT);
  });

  test('인라인 onclick 의 id 는 UUID 일 때만 들어간다', async () => {
    const evilId = "x');window.__pwned=5;('";
    boot([
      { id: ID, category: 'sink', image_url: 'https://img.example.test/a.jpg' },
      { id: evilId, category: 'sink', image_url: 'https://img.example.test/b.jpg' },
    ]);
    await window.initAdmin();
    const items = document.querySelectorAll('#galleryContainer .gallery-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.delete-btn').getAttribute('onclick')).toBe(
      `deleteSingle('${ID}')`
    );
    expect(items[1].querySelector('.delete-btn').getAttribute('onclick')).toBe("deleteSingle('')");
    expect(items[1].getAttribute('data-id')).toBe(evilId);
    document
      .querySelectorAll('#galleryContainer [onclick], #galleryContainer [onchange]')
      .forEach((el) => {
        expect(el.getAttribute('onclick') || el.getAttribute('onchange')).not.toContain('__pwned');
      });
  });

  test('업로드 실패 줄의 파일 이름·오류 글은 글자로만 나온다', async () => {
    const storage = {
      from: () => ({
        upload: async () => ({ error: { message: '<b>거절</b>' } }),
        remove: async () => ({}),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    };
    boot([], storage);
    await window.initAdmin();
    const input = document.getElementById('uploadFiles');
    Object.defineProperty(input, 'files', {
      value: [{ name: EVIL_FILE, type: 'image/jpeg', size: 1 }],
    });
    window.alert = () => {};
    await window.submitUpload();
    await tick();
    const prog = document.getElementById('uploadProgress');
    expect(prog.querySelector('img, b')).toBeNull();
    expect(prog.textContent).toContain(EVIL_FILE);
    expect(prog.textContent).toContain('<b>거절</b>');
    expect(window.__pwned).toBeUndefined();
  });

  test('보통 이미지는 그대로 보인다', async () => {
    boot([
      {
        id: ID,
        category: 'wardrobe',
        style: 'modern',
        description: '화이트 붙박이장',
        image_url: 'https://img.example.test/a.jpg',
        is_training: true,
      },
    ]);
    await window.initAdmin();
    const item = document.querySelector('#galleryContainer .gallery-item');
    expect(item.getAttribute('data-id')).toBe(ID);
    expect(item.querySelector('.category').textContent).toBe('붙박이장');
    expect(item.querySelector('.style').textContent.trim()).toBe('modern · 화이트 붙박이장');
    expect(item.querySelector('.training-badge').textContent).toBe('학습용');
    expect(item.querySelector('.checkbox').getAttribute('onchange')).toBe(`toggleSelect('${ID}')`);
  });
});
