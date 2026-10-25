// ============================================================
// 씨앗 패널 — planner-seed.js (구조 페이지, 2026-10-25)
//
// 사장님이 자주 하는 구성을 **씨앗**으로 저장한다. 자동완성(설계 유전체, planner-genome.js)이
// 아직 설계가 없는 계정에 처음 제안할 때 쓰는 집단 패널의 정본이다. 합성 데이터가 아니라
// 사장님이 그린 설계라서 검증된 기본 데이터가 된다 (2026-10-25 사장님 결정).
//
//   🌱 씨앗 저장   지금 구조를 유전체(plannerGenomeOf)로 바꿔 genome_seed_panel 표에 넣는다
//   🌱 ▾          저장한 씨앗 목록 · 지우기(감추기)
//
// 관리자만 보인다 — 역할은 부모 창(상세설계)이 PlannerExport 경로로 알려 준다 (onAdmin).
// 표의 쓰기 권한은 DB 가 public.is_admin() 으로 다시 막는다 (database/genome-seed-panel.sql).
// 치수·규칙을 만들지 않는다: 씨앗에는 플래너가 이미 정한 폭과 구조 서명만 담긴다.
//
// 계산은 순수 함수 — __tests__/planner-seed.test.js. 저장·목록은 PlannerStore 의 클라이언트를 쓴다.
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_SEED_ / plannerSeed / PlannerSeed 접두.
// 로드 순서: planner-store.js · planner-genome.js → 이 파일 → 인라인
// ============================================================

const PLANNER_SEED_TABLE = 'genome_seed_panel';
const PLANNER_SEED_NAME_MAX = 80;
const PLANNER_SEED_SECTION_LABEL = { lower: '하부', upper: '상부', tall: '키큰장', fridge: '냉장고장', wardrobe: '붙박이장' };
const PLANNER_SEED_TIER = { S: '서랍', R: '밥솥장', O: '오픈', D: '도어', F: '플랩' };
const PLANNER_SEED_HINGE = { L: 'left', R: 'right', U: 'up' };

/** 구조 서명 → 사람이 읽는 이름. */
function plannerSeedAlleleName(sig) {
  const s = String(sig || '');
  const [body, h] = s.split('/');
  if (body.startsWith('T:')) {
    const m = body.slice(2).match(/^([A-Z]+)(-SW|-LF)?/);
    const tiers = (m ? m[1] : '').split('').map((x) => {
      if (x === 'R' && m[2]) return `밥솥장(${m[2] === '-SW' ? '여닫이' : '리프트'})`;
      return PLANNER_SEED_TIER[x] || x;
    });
    return `키큰장 ${tiers.join('·')}`;
  }
  if (body.startsWith('DR:') || body.startsWith('DD:')) {
    const [ratio, rail, boxT] = body.slice(3).split('|');
    return `${body.startsWith('DR') ? '서랍장' : '도어+서랍'} ${ratio} ${rail === 'ball' ? '볼레일' : '언더레일'}${boxT === '18' ? ' 18T' : ''}`;
  }
  if (body === 'OPEN') return '오픈장';
  if (body === 'D2') return '양문';
  if (body === 'D1') return h === 'U' ? '플랩' : `도어 ${h === 'R' ? '오른쪽' : '왼쪽'} 경첩`;
  return body;
}

/** planner-genome.js 의 plannerGenomeOf — 페이지에서는 전역, 시험(node)에서는 require. */
function plannerSeedGenomeOf(design) {
  if (typeof plannerGenomeOf === 'function') return plannerGenomeOf(design);
  if (typeof require === 'function') return require('./planner-genome.js').plannerGenomeOf(design);
  throw new Error('planner-genome.js 가 planner-seed.js 보다 먼저 실려야 합니다');
}

/** 유전체 → 저장용 라인 (서명 · 폭 · 앵커 · 고정만). */
function plannerSeedLines(genome) {
  return ((genome && genome.lines) || []).map((ln) => ({
    section: ln.section,
    loci: ln.loci.map((l) => ({
      W: Math.round(l.W || 0),
      sig: l.allele ? l.allele.sig : null,
      anchors: (l.anchors || []).slice(),
      fixed: !!l.fixed,
    })),
  })).filter((ln) => ln.loci.length);
}

/** 자동계산 직후의 값 — 넓은 칸 양문, 좁은 칸 왼쪽 경첩, 키큰장 도어 단 셋 (autocalc-rules.md §10). */
function plannerSeedAutocalcSig(section, W, doorWMax) {
  if (section === 'tall' || section === 'fridge') return 'T:DDD/L';
  return W > doorWMax ? 'D2' : 'D1/L';
}

/** 저장을 막는 문제 — 사람이 고칠 수 있는 말로. */
function plannerSeedProblems(lines) {
  const out = [];
  if (!lines.length) out.push('배치된 장이 없습니다. 장을 놓고 구조를 정한 뒤 저장해 주세요');
  lines.forEach((ln) => {
    if (ln.loci.some((l) => !l.sig)) out.push(`${PLANNER_SEED_SECTION_LABEL[ln.section] || ln.section} 라인에 구조를 읽지 못한 자리가 있습니다`);
  });
  return out;
}

/** 한 줄 요약 — "하부 6 · 상부 5 · 키큰장 1 — 서랍장 2:1:1 볼레일, 오픈장" */
function plannerSeedSummary(lines, doorWMax) {
  const counts = lines.map((ln) => `${PLANNER_SEED_SECTION_LABEL[ln.section] || ln.section} ${ln.loci.length}`);
  const notable = [];
  lines.forEach((ln) => ln.loci.forEach((l) => {
    if (!l.sig || l.sig === plannerSeedAutocalcSig(ln.section, l.W, doorWMax)) return;
    const name = plannerSeedAlleleName(l.sig);
    if (notable.indexOf(name) < 0) notable.push(name);
  }));
  return counts.join(' · ') + (notable.length ? ` — ${notable.slice(0, 4).join(', ')}${notable.length > 4 ? ' 외' : ''}` : '');
}

/** 기본 이름 — 하부 라인 길이와 키큰장 여부. */
function plannerSeedDefaultName(lines) {
  const lower = lines.find((ln) => ln.section === 'lower');
  const span = lower ? lower.loci.reduce((s, l) => s + l.W, 0) : 0;
  const parts = [];
  if (span) parts.push(`하부 ${span.toLocaleString('ko-KR')}`);
  if (lines.some((ln) => ln.section === 'tall')) parts.push('키큰장');
  if (!parts.length) parts.push(lines.map((ln) => PLANNER_SEED_SECTION_LABEL[ln.section] || ln.section).join('·'));
  return `${parts.join(' · ')} 구성`;
}

/**
 * 지금 구조 → 씨앗 한 건 (저장 전 확인용).
 * @param {object[]} modules  구조 페이지 modules
 * @param {object} structures 구조 페이지 structures
 * @param {{doorWMax:number}} opt  자동계산 양문 기준 (MASTER_RULES.DOOR_W_MAX)
 * @returns {{lines:object[], summary:string, defaultName:string, problems:string[], informative:boolean}}
 */
function plannerSeedRecord(modules, structures, opt) {
  const doorWMax = (opt && opt.doorWMax) || 600;
  const lines = plannerSeedLines(plannerSeedGenomeOf({ modules: modules || [], structures: structures || {} }));
  // 자동계산 기본값과 다른 자리가 하나라도 있어야 배울 것이 있다
  const informative = lines.some((ln) => ln.loci.some((l) => l.sig && l.sig !== plannerSeedAutocalcSig(ln.section, l.W, doorWMax)));
  return {
    lines,
    summary: plannerSeedSummary(lines, doorWMax),
    defaultName: plannerSeedDefaultName(lines),
    problems: plannerSeedProblems(lines),
    informative,
  };
}

/**
 * 저장된 씨앗 행 → plannerGenomeImpute 패널 (own = false, 집단 몫).
 * @param {{id:string, lines:object[]}[]} rows
 * @param {number} [weight] 씨앗 한 건의 가중치
 */
function plannerSeedPanel(rows, weight) {
  const out = [];
  (rows || []).forEach((r) => (r.lines || []).forEach((ln) => {
    const n = ln.loci.length;
    const sinkAt = ln.loci.findIndex((l) => (l.anchors || []).indexOf('sink') >= 0);
    out.push({
      own: false,
      weight: weight == null ? 1 : weight,
      seed: r.id,
      line: {
        section: ln.section,
        loci: ln.loci.map((l, i) => {
          const m = String(l.sig || '').match(/\/([LRU])$/);
          return {
            W: l.W, anchors: l.anchors || [], fixed: !!l.fixed, i, n,
            fromSink: sinkAt >= 0 ? i - sinkAt : null,
            allele: l.sig ? { sig: l.sig, type: l.sig.replace(/\/[LRU]$/, ''), hinge: m ? PLANNER_SEED_HINGE[m[1]] : null } : null,
          };
        }),
      },
    });
  }));
  return out;
}

/** DB 오류 → 할 일을 말하는 문장. */
function plannerSeedExcuse(error) {
  const e = error || {};
  const msg = String(e.message || e);
  if (e.code === '42P01' || e.code === 'PGRST205' || (/genome_seed_panel/.test(msg) && /(does not exist|Could not find)/i.test(msg))) {
    return '씨앗 표가 아직 없습니다 — database/genome-seed-panel.sql 을 Supabase SQL Editor 에서 실행해 주세요';
  }
  if (e.code === '42501' || /row-level security/i.test(msg)) return '관리자 계정만 씨앗을 저장·지울 수 있습니다';
  return msg;
}

function plannerSeedEsc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PlannerSeed = {
  admin: false,
  _o: null,

  /**
   * @param {{ saveButton?:HTMLElement, menuButton?:HTMLElement, menu?:HTMLElement,
   *           state:()=>({modules:object[], structures:object}), doorWMax?:number, toast?:Function }} o
   */
  mount(o) {
    this._o = o || {};
    const { saveButton, menuButton, menu } = this._o;
    if (saveButton) { saveButton.hidden = true; saveButton.onclick = () => this.save(); }
    if (menuButton) {
      menuButton.hidden = true;
      menuButton.onclick = (e) => {
        e.stopPropagation();
        if (!menu) return;
        menu.hidden = !menu.hidden;
        if (!menu.hidden) this.render();
      };
    }
    if (menu && typeof document !== 'undefined') {
      document.addEventListener('click', (e) => {
        if (menu.hidden) return;
        if (!menu.contains(e.target) && e.target !== menuButton) menu.hidden = true;
      });
    }
    return this;
  },

  setAdmin(on) {
    this.admin = !!on;
    const o = this._o || {};
    if (o.saveButton) o.saveButton.hidden = !this.admin;
    if (o.menuButton) o.menuButton.hidden = !this.admin;
    if (!this.admin && o.menu) o.menu.hidden = true;
  },

  toast(text) {
    const t = this._o && this._o.toast;
    if (typeof t === 'function') t(text);
  },

  async session() {
    if (typeof PlannerStore === 'undefined') return { ok: false, reason: 'no-sdk' };
    return PlannerStore.session();
  },

  /** 지금 구조를 씨앗으로 저장한다. 관리자가 아니면 아무것도 하지 않는다. */
  async save() {
    if (!this.admin) return null;
    const o = this._o || {};
    const st = typeof o.state === 'function' ? o.state() : {};
    const rec = plannerSeedRecord(st.modules, st.structures, { doorWMax: o.doorWMax });
    if (rec.problems.length) { this.toast(`⚠ 씨앗 저장 안 함: ${rec.problems[0]}`); return { ok: false, reason: 'problems', problems: rec.problems }; }
    if (!rec.informative && !confirm('모든 자리가 자동계산 기본값(문짝)과 같습니다.\n자동완성이 배울 것이 없는 구성입니다. 그래도 씨앗으로 저장할까요?')) return null;
    const typed = prompt(`씨앗 이름 — 자주 하는 구성\n${rec.summary}`, rec.defaultName);
    if (typed === null) return null;
    const name = (String(typed).trim() || rec.defaultName).slice(0, PLANNER_SEED_NAME_MAX);
    const ses = await this.session();
    if (!ses.ok) {
      const why = typeof plannerDrawingExcuse === 'function' ? plannerDrawingExcuse(ses.reason) : '';
      this.toast(`⚠ 씨앗 저장 실패: ${why || ses.reason}`);
      return ses;
    }
    const ids = typeof plannerScopeIds === 'function' ? plannerScopeIds() : {};
    const row = {
      name,
      lines: rec.lines,
      summary: rec.summary,
      genome_version: typeof PLANNER_GENOME_VERSION !== 'undefined' ? PLANNER_GENOME_VERSION : 1,
      source_design_id: ids.designId || null,
      source_item_unique_id: ids.itemId == null ? null : ids.itemId,
    };
    try {
      const { error } = await ses.client.from(PLANNER_SEED_TABLE).insert(row);
      if (error) { this.toast(`⚠ 씨앗 저장 실패: ${plannerSeedExcuse(error)}`); return { ok: false, reason: 'error', error }; }
    } catch (e) {
      this.toast(`⚠ 씨앗 저장 실패: ${plannerSeedExcuse(e)}`);
      return { ok: false, reason: 'error', error: e };
    }
    this.toast(`🌱 씨앗 저장 — ${name}`);
    if (o.menu && !o.menu.hidden) this.render();
    return { ok: true, row };
  },

  /** 저장한 씨앗 (감춘 것 제외, 최근 순). */
  async list() {
    const ses = await this.session();
    if (!ses.ok) return { ok: false, reason: ses.reason, rows: [] };
    try {
      const { data, error } = await ses.client.from(PLANNER_SEED_TABLE)
        .select('id,name,summary,created_at,genome_version')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return { ok: false, reason: 'error', error, rows: [] };
      return { ok: true, rows: data || [] };
    } catch (e) {
      return { ok: false, reason: 'error', error: e, rows: [] };
    }
  },

  async render() {
    const menu = this._o && this._o.menu;
    if (!menu) return;
    const esc = plannerSeedEsc;
    menu.innerHTML = '<div class="pdm-note">불러오는 중…</div>';
    const r = await this.list();
    const parts = ['<div class="pdm-stage"><span>씨앗 패널 — 자주 하는 구성</span><button type="button" data-seed-save="1">현재 구조를 씨앗으로…</button></div>',
      '<div class="pdm-note">자동완성이 아직 설계가 없는 계정에 처음 제안할 때 이 구성들을 참고합니다. 폭과 구조 선택만 담깁니다.</div>'];
    if (!r.ok) {
      const why = r.reason === 'error' ? plannerSeedExcuse(r.error)
        : (typeof plannerDrawingExcuse === 'function' ? plannerDrawingExcuse(r.reason) : r.reason);
      parts.push(`<div class="pdm-note">⚠ ${esc(why)}</div>`);
    } else if (!r.rows.length) {
      parts.push('<div class="pdm-empty">아직 저장한 씨앗이 없습니다</div>');
    } else {
      r.rows.forEach((row) => {
        const when = typeof plannerSnapshotWhen === 'function' ? plannerSnapshotWhen(row.created_at) : String(row.created_at || '').slice(0, 10);
        parts.push(`<div class="pdm-row" data-seed="${esc(row.id)}">${esc(row.name)}`
          + `<span class="pdm-meta">${esc(when)}${row.summary ? ' · ' + esc(row.summary) : ''}</span>`
          + `<span class="pdm-meta"><button type="button" data-seed-del="${esc(row.id)}" data-seed-name="${esc(row.name)}">지우기</button></span></div>`);
      });
    }
    menu.innerHTML = parts.join('');
    const saveEl = menu.querySelector('[data-seed-save]');
    if (saveEl) saveEl.onclick = (e) => { e.stopPropagation(); menu.hidden = true; this.save(); };
    menu.querySelectorAll('[data-seed-del]').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); this.remove(el.dataset.seedDel, el.dataset.seedName); };
    });
  },

  /** 지우기 = 감추기 (active = false). 어느 씨앗이 제안을 만들었는지 나중에 되짚을 수 있게 남긴다. */
  async remove(id, name) {
    if (!this.admin || !id) return null;
    if (!confirm(`씨앗 "${name || ''}" 을(를) 지웁니다.\n자동완성이 더는 이 구성을 참고하지 않습니다. 계속할까요?`)) return null;
    const ses = await this.session();
    if (!ses.ok) { this.toast(`⚠ 지우기 실패: ${ses.reason}`); return ses; }
    try {
      const { error } = await ses.client.from(PLANNER_SEED_TABLE).update({ active: false }).eq('id', id);
      if (error) { this.toast(`⚠ 지우기 실패: ${plannerSeedExcuse(error)}`); return { ok: false, error }; }
    } catch (e) {
      this.toast(`⚠ 지우기 실패: ${plannerSeedExcuse(e)}`);
      return { ok: false, error: e };
    }
    this.toast(`🌱 씨앗을 지웠습니다 — ${name || ''}`);
    this.render();
    return { ok: true };
  },
};

if (typeof window !== 'undefined') {
  window.PlannerSeed = PlannerSeed;
  window.plannerSeedPanel = plannerSeedPanel;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_SEED_TABLE,
    plannerSeedAlleleName,
    plannerSeedLines,
    plannerSeedAutocalcSig,
    plannerSeedProblems,
    plannerSeedSummary,
    plannerSeedDefaultName,
    plannerSeedRecord,
    plannerSeedPanel,
    plannerSeedExcuse,
    PlannerSeed,
  };
}
