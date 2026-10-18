// ============================================================
// 사전 오류 검사 표시 — planner-preflight.js (구조 페이지)
//
// ArchiWood REA 2번 (2026-10-18). 상세설계가 BOM 을 산출하면 사전 검사(js/detaildesign/bom-preflight.js)를
// 돌려 품목 iframe 으로 DADAM_PREFLIGHT_MARKS 를 보낸다. 여기서는 그 표시를 받아
//   (a) 문제 있는 모듈에 3D 테두리를 씌우고 (오류 빨강 · 경고 주황)
//   (b) 좌측 아래에 목록 상자를 띄운다.
// 검사는 여기서 하지 않는다 — 규칙과 판정은 bom-preflight.js 한 곳이다. 이 파일은 그리기만 한다.
//
// 표시 형태 (bom-preflight.js plannerMarksOf):
//   { counts:{error,warning}, modules:{ <플래너 모듈 id>: {level:'error'|'warning', messages:[…]} }, other:[…] }
//   빈 표시가 오면 테두리와 상자를 지운다.
//
// HTML 인라인은 mount 와 한 훅(renderAll3D 의 모듈 루프 → outline)만 건다.
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_PREFLIGHT_ / plannerPreflight / PlannerPreflight 접두.
// ============================================================

const PLANNER_PREFLIGHT_COLORS = { error: 0xd32f2f, warning: 0xf57c00 };
const PLANNER_PREFLIGHT_BOX_ID = 'plannerPreflightBox';

/** 받은 표시를 다듬는다. 모르는 모양이면 빈 표시. */
function plannerPreflightNormalize(marks) {
  const m = marks && typeof marks === 'object' ? marks : {};
  const modules = {};
  Object.keys(m.modules || {}).forEach((id) => {
    const v = m.modules[id] || {};
    modules[id] = {
      level: v.level === 'error' ? 'error' : 'warning',
      messages: Array.isArray(v.messages) ? v.messages.map(String) : [],
    };
  });
  const c = m.counts || {};
  return {
    counts: { error: Number(c.error) || 0, warning: Number(c.warning) || 0 },
    modules,
    other: Array.isArray(m.other) ? m.other.map(String) : [],
  };
}

const PlannerPreflight = {
  marks: plannerPreflightNormalize(null),
  _o: null,

  /**
   * @param {{renderAll3D?:Function, toast?:Function, moduleLabel?:Function, selectModule?:Function}} o
   */
  mount(o) {
    this._o = o || {};
    try {
      window.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== 'DADAM_PREFLIGHT_MARKS') return;
        if (e.origin !== location.origin) return;
        this.set(e.data.marks);
      });
    } catch (e) {
      /* window 가 없으면 메시지도 없다 */
    }
    return this;
  },

  /** 표시를 갈아 끼우고 다시 그린다. */
  set(marks) {
    this.marks = plannerPreflightNormalize(marks);
    const o = this._o || {};
    if (typeof o.renderAll3D === 'function') {
      try {
        o.renderAll3D({ fit: false });
      } catch (e) {
        /* 3D 전이면 다음 그리기 때 붙는다 */
      }
    }
    this.renderBox();
    const c = this.marks.counts;
    if ((c.error || c.warning) && typeof o.toast === 'function') {
      o.toast(`⚠ 사전 검사: 오류 ${c.error} · 경고 ${c.warning} — 표시된 모듈을 확인하세요`);
    }
    return this.marks;
  },

  levelOf(moduleId) {
    const v = this.marks.modules[String(moduleId)];
    return v ? v.level : null;
  },

  /**
   * renderAll3D 의 모듈 루프에서 부른다. 표시가 있는 모듈이면 고른 모듈 테두리(addPickOutline3D)와 같은 식으로
   * 조금 더 큰 상자를 씌운다. 클릭을 막지 않는다.
   * @returns {object|null} 붙인 LineSegments
   */
  outline(parent, m, mesh, T) {
    const level = m ? this.levelOf(m.id) : null;
    if (!level || !parent || !mesh || !T) return null;
    const W = Math.max(1, m.W),
      H = Math.max(1, m.H),
      D = Math.max(1, m.D);
    const geo = new T.EdgesGeometry(new T.BoxGeometry(W + 20, H + 20, D + 20));
    const mat = new T.LineBasicMaterial({
      color: PLANNER_PREFLIGHT_COLORS[level],
      depthTest: false,
    });
    const box = new T.LineSegments(geo, mat);
    box.renderOrder = 998;
    box.position.set(mesh.position.x, (mesh.position.y || 0) + H / 2, mesh.position.z);
    box.rotation.copy(mesh.rotation);
    box.raycast = function () {};
    box.userData = { entityKind: 'preflight', moduleId: m.id, level };
    parent.add(box);
    return box;
  },

  /** 좌측 아래 목록 상자. 표시가 비면 지운다. */
  renderBox() {
    if (typeof document === 'undefined') return null;
    let box = document.getElementById(PLANNER_PREFLIGHT_BOX_ID);
    const ids = Object.keys(this.marks.modules);
    const c = this.marks.counts;
    if (!ids.length && !this.marks.other.length && !c.error && !c.warning) {
      if (box) box.remove();
      return null;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = PLANNER_PREFLIGHT_BOX_ID;
      box.style.cssText =
        'position:fixed;left:12px;bottom:52px;z-index:50;max-width:360px;max-height:40vh;overflow:auto;' +
        'background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.15);' +
        'font:12px/1.5 sans-serif;color:#222;padding:8px 10px';
      document.body.appendChild(box);
    }
    const esc = (s) =>
      String(s).replace(
        /[&<>"]/g,
        (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]
      );
    const o = this._o || {};
    const label = (id) => {
      try {
        return typeof o.moduleLabel === 'function' ? o.moduleLabel(id) : String(id);
      } catch (e) {
        return String(id);
      }
    };
    const dot = (level) =>
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${
        level === 'error' ? '#d32f2f' : '#f57c00'
      }"></span>`;
    const rows = ids.map((id) => {
      const v = this.marks.modules[id];
      return (
        `<div data-pf-module="${esc(id)}" style="cursor:pointer;margin:4px 0">${dot(v.level)}<b>${esc(label(id))}</b>` +
        v.messages.map((t) => `<div style="margin-left:12px;color:#555">${esc(t)}</div>`).join('') +
        '</div>'
      );
    });
    this.marks.other.forEach((t) =>
      rows.push(`<div style="margin:4px 0;color:#555">${dot('warning')}${esc(t)}</div>`)
    );
    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      `<b>사전 검사 — 오류 ${c.error} · 경고 ${c.warning}</b>` +
      '<button type="button" data-pf-close style="border:0;background:none;cursor:pointer;font-size:14px">✕</button></div>' +
      rows.join('');
    const close = box.querySelector('[data-pf-close]');
    if (close) close.onclick = () => box.remove();
    box.querySelectorAll('[data-pf-module]').forEach((el) => {
      el.onclick = () => {
        if (typeof o.selectModule === 'function') o.selectModule(el.getAttribute('data-pf-module'));
      };
    });
    return box;
  },
};

if (typeof window !== 'undefined') {
  window.PlannerPreflight = PlannerPreflight;
  window.plannerPreflightNormalize = plannerPreflightNormalize;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlannerPreflight, plannerPreflightNormalize, PLANNER_PREFLIGHT_COLORS };
}
