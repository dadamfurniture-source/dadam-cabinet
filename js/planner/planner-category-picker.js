// ============================================================
// 품목 선택 드롭다운 — 배치·구조·디테일 **공통**
//
// 2026-09-18: mockup-shell.html(배치) 안에만 인라인으로 있던 것을 여기로 뺐다.
//   구조·디테일에서도 품목을 넣고 뺄 수 있어야 한다는 요구 때문인데,
//   같은 130줄을 두 문서에 복사해 두면 10종 목록·배선이 갈라진다.
//   planner-scope.js 가 배치·구조에서 같은 코드를 쓰는 것과 같은 자리다.
//
// 배선(부모 = detaildesign / js/detaildesign/ui-step1.js)은 W8-5/W8-6 그대로다:
//   클릭        → postMessage ADD_CATEGORY    → incrementCategory
//   −·우클릭    → postMessage REMOVE_CATEGORY → decrementCategory
//   뜰 때       → postMessage PLANNER_READY   → 부모가 이 iframe 에 CATEGORY_COUNTS 응답
//   품목 변동   → 부모가 iframe[data-planner] **전부**에 CATEGORY_COUNTS 를 broadcast
//                 (_broadcastCategoryCounts) — 단계 사이 연동은 여기서 온다.
//
// ⚠ 이 배선이 끊기면 가구를 만들 수단이 아예 사라진다.
//   __tests__/planner-category-tools.test.js 가 양쪽을 고정한다.
//
// 아이콘은 '배치' 그룹(분배기🚰·후드💨·냉장고🧊·식세기🍽️)과 겹치지 않게 고른다.
// 그 둘은 계층이 다르다 — 여기는 '품목', 아래는 품목 안에 놓는 '모듈/가전'.
// ============================================================

/** 품목 10종. js/detaildesign/data-constants.js 의 CATEGORIES 와 id·name 이 같아야 한다. */
const PLANNER_CATEGORY_LIST = [
  { id: 'sink', name: '싱크대', icon: '🍳' },
  { id: 'island', name: '아일랜드', icon: '🏝' },
  { id: 'wardrobe', name: '붙박이장', icon: '👔' },
  { id: 'fridge', name: '냉장고장', icon: '❄️' },
  { id: 'shoerack', name: '신발장', icon: '👟' },
  { id: 'vanity', name: '화장대', icon: '💄' },
  { id: 'storage', name: '수납장', icon: '📦' },
  { id: 'warehouse', name: '창고장', icon: '🏭' },
  { id: 'door', name: '도어교체', icon: '🚪' },
  { id: 'custom', name: '비규격장', icon: '✏️' },
];

/** 이 드롭다운이 쓰는 DOM id — 두 문서가 같은 이름을 쓴다 (시험도 이 이름을 본다). */
const PLANNER_CATEGORY_PICKER_IDS = {
  picker: 'catPicker',
  button: 'catPickerBtn',
  total: 'catPickerTotal',
  menu: 'catMenu',
};

/**
 * 드롭다운을 붙인다. 두 문서가 뜰 때 한 번씩 부른다.
 *
 * 단독 열람(부모 iframe 이 없을 때)에는 품목을 만들 곳이 없으므로 통째로 숨긴다.
 *
 * @param {object} [opt]
 * @param {Document} [opt.doc]      기본 document (시험 주입용)
 * @param {Window}   [opt.win]      기본 window   (시험 주입용)
 * @param {object[]} [opt.cats]     기본 PLANNER_CATEGORY_LIST
 * @returns {{ok:boolean, reason?:string, setOpen?:Function, apply?:Function}}
 */
function plannerCategoryPickerMount(opt) {
  const o = opt || {};
  const doc = o.doc || (typeof document !== 'undefined' ? document : null);
  const win = o.win || (typeof window !== 'undefined' ? window : null);
  const cats = Array.isArray(o.cats) && o.cats.length ? o.cats : PLANNER_CATEGORY_LIST;
  if (!doc || !win) return { ok: false, reason: 'no-dom' };

  const ids = PLANNER_CATEGORY_PICKER_IDS;
  const host = doc.getElementById(ids.menu);
  const pickBtn = doc.getElementById(ids.button);
  const totalEl = doc.getElementById(ids.total);
  const picker = doc.getElementById(ids.picker);
  if (!host || !pickBtn || !picker) return { ok: false, reason: 'no-markup' };

  // 두 번 붙이면 행이 20개가 된다 (구조 → 디테일은 같은 문서라 재호출될 수 있다).
  if (picker.dataset && picker.dataset.pickerMounted === '1') return { ok: false, reason: 'already' };
  if (picker.dataset) picker.dataset.pickerMounted = '1';

  /** 부모(detaildesign)가 없으면 이 UI 는 의미가 없다 — 단독 열람 시 숨긴다. */
  const embedded = win.parent && win.parent !== win;
  if (!embedded) {
    picker.style.display = 'none';
    return { ok: false, reason: 'standalone' };
  }

  function post(type, categoryId) {
    try { win.parent.postMessage({ type, categoryId }, '*'); } catch (e) { /* 부모가 없으면 보낼 곳도 없다 */ }
  }

  // ── 메뉴 만들기 ──
  // 행 = [추가 버튼][− 제거 버튼]. 버튼 안에 버튼을 넣을 수 없어 형제로 둔다.
  cats.forEach((cat) => {
    const row = doc.createElement('div');
    row.className = 'cat-menu-row';
    row.dataset.cat = cat.id;

    const add = doc.createElement('button');
    add.type = 'button';
    add.className = 'cat-menu-add';
    add.id = `catBtn-${cat.id}`;
    add.title = `${cat.name} 추가`;
    add.innerHTML =
      `<span class="cm-icon" aria-hidden="true">${cat.icon}</span>` +
      '<span class="cm-name"></span>' +
      `<span class="cm-n" id="catBadge-${cat.id}" hidden>0</span>`;
    add.querySelector('.cm-name').textContent = cat.name;
    add.addEventListener('click', () => post('ADD_CATEGORY', cat.id));
    // 좌측 툴바 시절의 우클릭 제거를 그대로 남긴다 (손에 익은 사용자를 위해)
    add.addEventListener('contextmenu', (e) => {
      e.preventDefault();          // 브라우저 컨텍스트 메뉴 억제
      e.stopPropagation();         // 도면 우클릭(회전)까지 번지지 않게
      post('REMOVE_CATEGORY', cat.id);
    });

    const del = doc.createElement('button');
    del.type = 'button';
    del.className = 'cat-menu-del';
    del.id = `catDel-${cat.id}`;
    del.title = `${cat.name} 1개 제거`;
    del.textContent = '−';
    del.disabled = true;           // 0개면 지울 게 없다
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      post('REMOVE_CATEGORY', cat.id);
    });

    row.appendChild(add);
    row.appendChild(del);
    host.appendChild(row);
  });

  const hint = doc.createElement('div');
  hint.className = 'cat-menu-hint';
  hint.textContent = '클릭하면 추가 · −로 1개 제거';
  host.appendChild(hint);

  // ── 열고 닫기 ──
  function setOpen(open) {
    host.hidden = !open;
    pickBtn.setAttribute('aria-expanded', String(open));
  }
  const isOpen = () => !host.hidden;

  pickBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!isOpen());
  });
  // 메뉴 안 클릭이 바깥 클릭으로 새어 닫히지 않게
  host.addEventListener('click', (e) => e.stopPropagation());
  doc.addEventListener('click', () => { if (isOpen()) setOpen(false); });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); pickBtn.focus(); }
  });

  /** 카테고리별 개수 → 배지·제거 버튼·총합. */
  function apply(counts) {
    const c = counts || {};
    let total = 0;
    cats.forEach((cat) => {
      const n = Number(c[cat.id]) || 0;
      total += n;
      const badge = doc.getElementById(`catBadge-${cat.id}`);
      const del = doc.getElementById(`catDel-${cat.id}`);
      if (badge) { badge.textContent = String(n); badge.hidden = n === 0; }
      if (del) del.disabled = n === 0;
    });
    if (totalEl) { totalEl.textContent = String(total); totalEl.hidden = total === 0; }
    return total;
  }

  // 부모가 보내주는 개수로 갱신한다. 부모는 품목이 바뀔 때마다 iframe 전부에 broadcast 하므로,
  // 다른 단계에서 넣고 뺀 것도 여기로 들어온다.
  win.addEventListener('message', (e) => {
    if (!e.data || e.data.type !== 'CATEGORY_COUNTS' || !e.data.counts) return;
    apply(e.data.counts);
  });

  // 초기 개수 요청 (부모가 CATEGORY_COUNTS 로 응답한다)
  try { win.parent.postMessage({ type: 'PLANNER_READY' }, '*'); } catch (e) { /* 부모가 없으면 물어볼 곳도 없다 */ }

  return { ok: true, setOpen, apply };
}

if (typeof window !== 'undefined') {
  window.PLANNER_CATEGORY_LIST = PLANNER_CATEGORY_LIST;
  window.PLANNER_CATEGORY_PICKER_IDS = PLANNER_CATEGORY_PICKER_IDS;
  window.plannerCategoryPickerMount = plannerCategoryPickerMount;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_CATEGORY_LIST,
    PLANNER_CATEGORY_PICKER_IDS,
    plannerCategoryPickerMount,
  };
}
