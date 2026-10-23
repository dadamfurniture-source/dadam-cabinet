// ============================================================
// 조립 검사 배지 — planner-cad-check.js (구조 페이지, 다담 CAD 베타 PR11)
//
// 구조가 바뀌면 (디바운스 뒤) 조립 명세(bom-assembly.js)를 만들고 조립 검사(assembly-check.js)를 돌려
// 좌측 모듈 목록에 모듈마다 배지를 붙인다. 오류 목록을 누르면 그 모듈을 고른다.
//
// 규칙을 새로 두지 않는다 — 명세는 CAD GLB 와 같은 길(plannerExportCadSpec, 부모 창의 변환·BOM), 판정은 assembly-check.js.
// 관리자만 — 배지는 내부 구조(뒷판·겹침·partId)를 말한다. 역할은 부모 창이 PlannerExport 로 알려 준다 (개정 #11).
// 3D 그리기는 바꾸지 않는다.
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_CAD_CHECK_ / plannerCadCheck / PlannerCadCheck 접두.
// ============================================================

const PLANNER_CAD_CHECK_DEBOUNCE_MS = 400;
const PLANNER_CAD_CHECK_BADGE_CLASS = 'mi-cad';
const PLANNER_CAD_CHECK_MAX_ROWS = 30;

function plannerCadCheckEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 검사 결과 → 플래너 모듈마다 { error, warning, issues }. 칸(moduleKey)은 cells 로 플래너 모듈에 돌아간다.
 * 플래너 모듈로 못 돌아가는 이슈(라인 부재 `0-ep` 등)는 '' 에 모은다.
 * @param {{issues:Array}} result  DadamAssemblyCheck.check 결과
 * @param {Object<string,{plannerId:string}>} cells
 */
function plannerCadCheckGroup(result, cells) {
  const out = {};
  ((result && result.issues) || []).forEach((x) => {
    const cell = x.moduleKey && cells && cells[x.moduleKey];
    const id = cell ? String(cell.plannerId) : '';
    const g = out[id] || (out[id] = { error: 0, warning: 0, issues: [] });
    if (x.level === 'error') g.error++;
    else if (x.level === 'warning') g.warning++;
    g.issues.push(x);
  });
  return out;
}

const PlannerCadCheck = {
  admin: false,
  last: null,      // { byModule, counts, error } — 마지막 검사
  _o: null,
  _timer: null,

  /**
   * @param {{
   *   list: () => HTMLElement|null,          모듈 목록 몸통 (.module-item[data-id] 를 담는다)
   *   panel?: HTMLElement,                   오류 목록 칸 (관리자만 보인다)
   *   compute: () => {spec:object, cells:object},   명세 (plannerExportCadSpec 결과)
   *   Check?: object,                        DadamAssemblyCheck (없으면 전역)
   *   onPick?: (plannerId:string) => void,   오류 줄을 눌렀을 때
   *   debounceMs?: number,
   * }} o
   */
  mount(o) {
    this._o = o || {};
    if (this._o.panel) this._o.panel.hidden = true;
    return this;
  },

  setAdmin(on) {
    this.admin = !!on;
    if (!this.admin) {
      clearTimeout(this._timer);
      this.last = null;
      this.decorate();
      this.renderPanel();
      return;
    }
    this.run();
  },

  /** 구조가 바뀌었다 — 관리자면 디바운스 뒤 다시 검사한다. */
  schedule() {
    if (!this.admin) return;
    clearTimeout(this._timer);
    const ms = this._o && Number.isFinite(this._o.debounceMs) ? this._o.debounceMs : PLANNER_CAD_CHECK_DEBOUNCE_MS;
    this._timer = setTimeout(() => this.run(), ms);
  },

  /** 지금 검사한다. 명세를 못 만들면 그 이유를 오류 칸에 적고 배지는 지운다. */
  run() {
    if (!this.admin) return null;
    const o = this._o || {};
    const Check = o.Check || (typeof window !== 'undefined' ? window.DadamAssemblyCheck : null);
    try {
      if (!Check || typeof o.compute !== 'function') throw new Error('조립 검사(assembly-check.js)가 실리지 않았습니다');
      const { spec, cells } = o.compute();
      const result = Check.check(spec);
      this.last = { byModule: plannerCadCheckGroup(result, cells), counts: result.counts, error: null };
    } catch (e) {
      this.last = { byModule: {}, counts: null, error: (e && e.message) || String(e) };
    }
    this.decorate();
    this.renderPanel();
    return this.last;
  },

  /** 모듈 목록에 배지를 단다. renderModuleList 가 목록을 새로 그린 뒤에도 부른다. */
  decorate() {
    const o = this._o || {};
    const body = typeof o.list === 'function' ? o.list() : null;
    if (!body) return;
    body.querySelectorAll('.' + PLANNER_CAD_CHECK_BADGE_CLASS).forEach((el) => el.remove());
    if (!this.admin || !this.last || this.last.error) return;
    body.querySelectorAll('.module-item[data-id]').forEach((el) => {
      const g = this.last.byModule[el.dataset.id];
      const err = g ? g.error : 0, warn = g ? g.warning : 0;
      const b = document.createElement('span');
      b.className = PLANNER_CAD_CHECK_BADGE_CLASS + (err ? ' err' : ' ok');
      b.textContent = err ? '⚠ ' + err : '✓';
      b.title = err
        ? `조립 검사 오류 ${err}건` + (warn ? ` · 경고 ${warn}건` : '') + ' (관리자 전용)'
        : '조립 검사 정상' + (warn ? ` · 자리 미정 경고 ${warn}건` : '') + ' (관리자 전용)';
      el.appendChild(b);
    });
  },

  /** 오류 목록 — 줄을 누르면 그 모듈을 고른다. 경고는 개수만. */
  renderPanel() {
    const o = this._o || {};
    const panel = o.panel;
    if (!panel) return;
    if (!this.admin || !this.last) { panel.hidden = true; panel.innerHTML = ''; return; }
    panel.hidden = false;
    if (this.last.error) {
      panel.innerHTML = `<div class="cad-check-head">조립 검사 — 못 돌림</div><div class="cad-check-note">${plannerCadCheckEsc(this.last.error)}</div>`;
      return;
    }
    const c = this.last.counts || { error: 0, warning: 0 };
    const rows = [];
    Object.keys(this.last.byModule).forEach((id) => {
      this.last.byModule[id].issues.forEach((x) => { if (x.level === 'error') rows.push({ id, x }); });
    });
    const head = `<div class="cad-check-head">조립 검사 — 오류 ${c.error} · 경고 ${c.warning}</div>`;
    const list = rows.slice(0, PLANNER_CAD_CHECK_MAX_ROWS).map(({ id, x }) =>
      `<div class="cad-check-row" data-id="${plannerCadCheckEsc(id)}" title="${plannerCadCheckEsc(x.code)}">${plannerCadCheckEsc(x.message)}</div>`).join('');
    const more = rows.length > PLANNER_CAD_CHECK_MAX_ROWS ? `<div class="cad-check-note">… 외 ${rows.length - PLANNER_CAD_CHECK_MAX_ROWS}건</div>` : '';
    panel.innerHTML = head + list + more;
    panel.querySelectorAll('.cad-check-row[data-id]').forEach((el) => {
      if (!el.dataset.id) return;
      el.onclick = () => { if (typeof o.onPick === 'function') o.onPick(el.dataset.id); };
    });
  },
};

if (typeof window !== 'undefined') {
  window.PlannerCadCheck = PlannerCadCheck;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlannerCadCheck, plannerCadCheckGroup, PLANNER_CAD_CHECK_DEBOUNCE_MS };
}
