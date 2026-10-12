/**
 * 업무 루프 — 두 화면을 그린다.
 *   Step 3 (#workflowPanel)  스냅샷 동결 · 고객확인서 · 수주 전환 · 일정/Slack
 *   Step 4 (#workOrderPanel) 작업지시서 — [발행] 한 번에 저장 → 동결 → 제작(+설치) 발행,
 *                            사람별 꾸러미 인쇄(/print?pack=), 현장 정보, 발행 이력
 *                            (docs/01-plan/work-order-stage.plan.md §4.1 · §4.2)
 *
 * proceedToBOM() 이 세팅해 둔 window._reportData 를 읽기만 한다.
 * (#step3-report-area 는 재산출 때마다 innerHTML 로 통째로 덮이므로 그 안에는 그리지 않는다.)
 * 단계 전환(goToStep4 · backToStep3)은 ui-step1.js 에 있다 — 여기서는 enterStep4 만 노출한다.
 *
 * 전역 스크립트다 — ESM 아님. detaildesign.html 이 순서대로 동기 로드한다.
 */

(function () {
  'use strict';

  const API =
    (window.DADAM_CONFIG &&
      window.DADAM_CONFIG.workflowApi &&
      window.DADAM_CONFIG.workflowApi.url) ||
    '';

  const PANEL_ID = 'workflowPanel';
  const STEP4_ID = 'workOrderPanel';

  /** 작업지시서 꾸러미 — 워커 templates/work-order.js WORK_ORDER_PACKS 와 같은 키 */
  const WO_PACKS = [
    { pack: 'cut', title: '재단·엣지 지시서', who: '재단 기사', desc: '원판별 재단 배치 · 엣지 붙일 변 표시 · 엣지 합계 · 정면도' },
    { pack: 'assembly', title: '조립 지시서', who: '조립 기사', desc: '모듈별 부재·철물 · 모듈 치수도 · 조립 체크 · 정면도' },
    { pack: 'door', title: '도어재 발주서', who: '도어 외주처', desc: '도어·몰딩·마감 부재 · 발주 코드 · 경첩 컵 위치 (고객 정보·금액 없음)' },
    { pack: 'labels', title: '부재 라벨', who: '재단 기사', desc: 'QR 라벨 A4 3×8 · 사내 부재 먼저, 도어재는 입고 시' },
    { pack: 'all', title: '전체 작업지시서', who: '사무실 보관', desc: '위 전부 + 표지 · 이전 rev 와의 차이' },
  ];

  /** 대체·회수되지 않은 문서 */
  function live(d) {
    return Boolean(d) && d.status !== 'superseded' && d.status !== 'revoked' && !d.superseded_by;
  }

  const SCHEDULE_TYPES = [
    { value: 'measurement', label: '실측' },
    { value: 'material_order', label: '자재 발주' },
    { value: 'manufacturing_start', label: '제작 착수' },
    { value: 'manufacturing_end', label: '제작 완료' },
    { value: 'quality_check', label: '검수' },
    { value: 'delivery', label: '납품' },
    { value: 'installation', label: '설치' },
    { value: 'as_visit', label: 'A/S 방문' },
  ];

  const state = {
    snapshot: null,
    documents: [],
    schedules: [],
    site: null,     // CD-4: 현장 정보
    busy: false,
  };

  // ── 유틸 ────────────────────────────────────────────────────────

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function krw(n) {
    if (n === null || n === undefined || n === '') return '-';
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('ko-KR') + '원' : '-';
  }

  function ymdhm(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    const kst = new Date(d.getTime() + 9 * 3600 * 1000);
    return kst.toISOString().slice(0, 10) + ' ' + kst.toISOString().slice(11, 16);
  }

  /**
   * 현재 설계 id.
   * URL 을 1순위로 본다 — persistence-init.js 가 첫 저장 후
   * history.replaceState 로 ?id= 를 넣는다.
   */
  function designId() {
    const fromUrl = new URLSearchParams(window.location.search).get('id');
    if (fromUrl) return fromUrl;
    return typeof currentDesignId !== 'undefined' && currentDesignId ? currentDesignId : null;
  }

  /** multiagent-client.js:22 와 같은 방식으로 세션 토큰을 얻는다. */
  async function token() {
    if (typeof SupabaseUtils === 'undefined' || !SupabaseUtils.client) return null;
    const r = await SupabaseUtils.client.auth.getSession();
    return (r && r.data && r.data.session && r.data.session.access_token) || null;
  }

  async function api(path, options) {
    const opts = options || {};
    const t = await token();
    if (!t) throw new Error('로그인이 필요합니다.');

    const headers = { Authorization: 'Bearer ' + t };
    if (opts.body) headers['Content-Type'] = 'application/json';

    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }

    if (!res.ok || !body || !body.success) {
      const msg = (body && body.message) || '요청에 실패했습니다 (' + res.status + ')';
      const err = new Error(msg);
      err.status = res.status;
      err.details = body && body.details;
      throw err;
    }
    return body.data;
  }

  // ── 렌더 ────────────────────────────────────────────────────────

  function panel() {
    return document.getElementById(PANEL_ID);
  }

  function setStatus(message, kind) {
    const node = document.getElementById('wfStatus');
    if (!node) return;
    node.textContent = message || '';
    node.style.color = kind === 'error' ? '#c62828' : kind === 'ok' ? '#2e7d32' : '#666';
  }

  function documentsHtml(filter) {
    const docs = state.documents.filter(filter || function () { return true; });
    if (!docs.length) {
      return '<p style="color:#888;font-size:13px;margin:6px 0;">아직 발행한 문서가 없습니다.</p>';
    }

    const rows = docs
      .map(function (d) {
        const typeLabel =
          d.doc_type === 'work_order'
            ? '제작 작업지시서'
            : d.doc_type === 'installation_order'
              ? '설치 작업지시서'
              : '고객확인서';
        const staleBadge = d.stale
          ? '<span style="background:#fff3cd;color:#8a6d3b;border:1px solid #f0d68a;border-radius:4px;padding:1px 6px;font-size:11px;margin-left:6px;">설계 변경됨 · 재발행 필요</span>'
          : '';
        const decision =
          d.decision === 'approved'
            ? '<span style="color:#2e7d32;font-weight:600;">고객 확인 완료</span>'
            : d.decision === 'rejected'
              ? '<span style="color:#c62828;font-weight:600;">수정 요청</span>'
              : d.view_count
                ? '<span style="color:#666;">열람 ' + d.view_count + '회</span>'
                : '<span style="color:#999;">미열람</span>';

        return (
          '<tr>' +
          '<td style="padding:6px 8px;">' +
          esc(typeLabel) +
          ' r' +
          esc(d.rev) +
          staleBadge +
          '</td>' +
          '<td style="padding:6px 8px;font-family:monospace;font-size:11px;color:#666;">' +
          esc(d.doc_no) +
          '</td>' +
          '<td style="padding:6px 8px;">' +
          krw(d.totals && d.totals.total) +
          '</td>' +
          '<td style="padding:6px 8px;">' +
          decision +
          '</td>' +
          '<td style="padding:6px 8px;white-space:nowrap;">' +
          '<button type="button" data-wf-print="' +
          esc(d.id) +
          '" style="font-size:12px;padding:4px 10px;margin-right:4px;cursor:pointer;">인쇄</button>' +
          (d.status === 'issued' || d.status === 'viewed'
            ? '<button type="button" data-wf-revoke="' +
              esc(d.id) +
              '" style="font-size:12px;padding:4px 10px;margin-right:4px;cursor:pointer;">링크 회수</button>'
            : '') +
          // CD-5: 고객이 승인한 확인서만 수주가 된다. 계약의 근거는 그것 하나뿐이다.
          (d.doc_type === 'customer_confirmation' && d.decision === 'approved'
            ? '<button type="button" data-wf-order="' +
              esc(d.id) +
              '" style="font-size:12px;padding:4px 10px;cursor:pointer;font-weight:600;">수주 전환</button>'
            : '') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    return (
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
      '<thead><tr style="background:#f5f5f5;text-align:left;">' +
      '<th style="padding:6px 8px;">문서</th><th style="padding:6px 8px;">번호</th>' +
      '<th style="padding:6px 8px;">금액</th><th style="padding:6px 8px;">상태</th><th style="padding:6px 8px;"></th>' +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table>'
    );
  }

  function schedulesHtml() {
    if (!state.schedules.length) return '';
    const rows = state.schedules
      .map(function (s) {
        const label =
          (
            SCHEDULE_TYPES.find(function (t) {
              return t.value === s.type;
            }) || {}
          ).label || s.type;
        return (
          '<tr>' +
          '<td style="padding:5px 8px;">' +
          esc(label) +
          '</td>' +
          '<td style="padding:5px 8px;">' +
          esc(ymdhm(s.scheduled_at)) +
          '</td>' +
          '<td style="padding:5px 8px;">' +
          esc(s.assignee_name || '-') +
          '</td>' +
          '<td style="padding:5px 8px;">' +
          esc(s.location || '-') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
    return (
      '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">' +
      '<thead><tr style="background:#f5f5f5;text-align:left;">' +
      '<th style="padding:5px 8px;">구분</th><th style="padding:5px 8px;">일시</th>' +
      '<th style="padding:5px 8px;">담당</th><th style="padding:5px 8px;">장소</th>' +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table>'
    );
  }

  function scheduleFormHtml() {
    const options = SCHEDULE_TYPES.map(function (t) {
      return '<option value="' + esc(t.value) + '">' + esc(t.label) + '</option>';
    }).join('');

    return (
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;margin-top:8px;">' +
      '<label style="font-size:12px;">구분<br><select id="wfSchedType" style="padding:6px;">' +
      options +
      '</select></label>' +
      '<label style="font-size:12px;">일시<br><input id="wfSchedAt" type="datetime-local" style="padding:6px;"></label>' +
      '<label style="font-size:12px;">담당<br><input id="wfSchedWho" type="text" style="padding:6px;width:90px;"></label>' +
      '<label style="font-size:12px;">장소<br><input id="wfSchedWhere" type="text" style="padding:6px;width:180px;"></label>' +
      '<button type="button" id="wfAddSched" style="padding:7px 14px;cursor:pointer;">일정 추가 + Slack 알림</button>' +
      '</div>'
    );
  }

  /**
   * CD-4: 현장 정보 입력.
   * 설치 팀이 현장에 들어가려면 주소·층·엘리베이터·반입경로가 필요한데
   * 지금까지 이걸 담을 자리가 아예 없었다 (일정의 location 자유텍스트 한 칸이 전부).
   */
  function siteInfoHtml() {
    const s = state.site || {};
    const v = function (k) { return s[k] == null ? '' : esc(s[k]); };
    const ev = s.has_elevator;
    const opt = function (val, label) {
      const sel = (val === '' ? ev == null : String(ev) === val) ? ' selected' : '';
      return '<option value="' + val + '"' + sel + '>' + label + '</option>';
    };
    const row = function (label, id, val, ph) {
      return '<label style="display:block;font-size:12px;color:#555;">' + label +
        '<input id="' + id + '" value="' + val + '" placeholder="' + (ph || '') +
        '" style="width:100%;padding:6px 8px;margin-top:2px;box-sizing:border-box;"></label>';
    };
    return '<div style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;">' +
      row('주소', 'wfSiteAddress', v('address'), '시/군/구 도로명') +
      row('상세 (동·호수)', 'wfSiteAddressDetail', v('address_detail'), '101동 1203호') +
      row('층', 'wfSiteFloor', v('floor'), '12층 / B1') +
      '<label style="display:block;font-size:12px;color:#555;">엘리베이터' +
      '<select id="wfSiteElevator" style="width:100%;padding:6px 8px;margin-top:2px;box-sizing:border-box;">' +
      opt('', '미확인') + opt('true', '있음') + opt('false', '없음 (사다리차 검토)') +
      '</select></label>' +
      row('연락처 이름', 'wfSiteContactName', v('contact_name'), '') +
      row('연락처 번호', 'wfSiteContactPhone', v('contact_phone'), '') +
      '</div>' +
      '<div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
      '<label style="font-size:12px;color:#555;">반입 경로' +
      '<textarea id="wfSiteAccess" rows="3" placeholder="계단 폭, 진입로 높이, 주차" style="width:100%;padding:6px 8px;margin-top:2px;box-sizing:border-box;">' + v('access_note') + '</textarea></label>' +
      '<label style="font-size:12px;color:#555;">시공 순서' +
      '<textarea id="wfSiteOrder" rows="3" placeholder="1. 하부장 → 2. 상판 → 3. 상부장" style="width:100%;padding:6px 8px;margin-top:2px;box-sizing:border-box;">' + v('install_order') + '</textarea></label>' +
      '</div>' +
      '<div style="margin-top:6px;"><button type="button" id="wfSaveSite" style="padding:7px 14px;cursor:pointer;">현장 정보 저장</button></div>';
  }

  function render() {
    const root = panel();
    if (!root) return;

    if (!API) {
      root.innerHTML =
        '<div style="padding:14px;background:#fff3cd;border:1px solid #f0d68a;border-radius:8px;font-size:13px;">' +
        '업무 루프 서버(workflowApi.url)가 설정되지 않았습니다.</div>';
      return;
    }

    const snap = state.snapshot;
    const quote = snap && snap.quote;

    root.innerHTML =
      '<div style="margin-top:24px;padding:16px;border:1px solid #e0e0e0;border-radius:12px;background:#fff;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<div style="font-weight:700;font-size:15px;">업무 루프</div>' +
      '<div id="wfStatus" style="font-size:12px;color:#666;"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">' +
      '<button type="button" id="wfSnapshot" style="padding:9px 16px;cursor:pointer;font-weight:600;">1. 설계·BOM 동결</button>' +
      '<button type="button" id="wfIssueCC" style="padding:9px 16px;cursor:pointer;"' +
      (snap ? '' : ' disabled') +
      '>2. 고객확인서 발행</button>' +
      '<button type="button" id="wfGoStep4" style="padding:9px 16px;cursor:pointer;">작업지시서 →</button>' +
      '</div>' +
      '<div style="margin-top:6px;font-size:12px;color:#888;">제작·설치 작업지시서는 다음 단계(4. 작업지시서)에서 발행·인쇄합니다.</div>' +
      (snap
        ? '<div style="margin-top:10px;font-size:13px;color:#333;">' +
          '스냅샷 rev ' +
          esc(snap.rev) +
          ' · 품목 ' +
          esc(snap.item_count) +
          ' · 부재 ' +
          esc(snap.panel_count) +
          (snap.sheet_count !== undefined && snap.sheet_count !== null
            ? ' · 원판 ' + esc(snap.sheet_count) + '장'
            : '') +
          (quote ? ' · 견적 ' + krw(quote.total) : '') +
          (quote && quote.skipped && quote.skipped.length
            ? '<div style="color:#8a6d3b;margin-top:4px;">단가 미정 품목: ' +
              esc(
                quote.skipped
                  .map(function (s) {
                    return s.label;
                  })
                  .join(', ')
              ) +
              '</div>'
            : '') +
          '</div>'
        : '') +
      '<div style="margin-top:16px;font-weight:600;font-size:13px;">고객확인서</div>' +
      documentsHtml(function (d) { return d.doc_type === 'customer_confirmation'; }) +
      '<div style="margin-top:16px;font-weight:600;font-size:13px;">일정</div>' +
      schedulesHtml() +
      scheduleFormHtml() +
      '</div>';

    bind();
    renderStep4();
  }

  // ── Step 4 작업지시서 ───────────────────────────────────────────

  /** 목록은 created_at 내림차순 — 살아 있는 첫 문서가 최신 */
  function latestDoc(docType) {
    return state.documents.find(function (d) { return d.doc_type === docType && live(d); }) || null;
  }

  function approvedCC() {
    return state.documents.find(function (d) {
      return d.doc_type === 'customer_confirmation' && d.decision === 'approved';
    }) || null;
  }

  function hasSiteInfo() {
    const s = state.site || {};
    return Boolean(s.address || s.address_detail || s.floor || s.access_note || s.install_order);
  }

  /** 상태 칩 — ok: true(완료) · false(주의) · null(아직) */
  function chip(ok, label, hint) {
    const cls = ok === true ? 'ok' : ok === false ? 'warn' : 'todo';
    const mark = ok === true ? '✓' : ok === false ? '!' : '·';
    return '<div class="wo4-chip ' + cls + '"><b>' + mark + ' ' + esc(label) + '</b>' +
      (hint ? '<span>' + esc(hint) + '</span>' : '') + '</div>';
  }

  function ensureStep4Style() {
    if (document.getElementById('wo4-style')) return;
    const st = document.createElement('style');
    st.id = 'wo4-style';
    st.textContent = [
      '#workOrderPanel .wo4-box{padding:16px;border:1px solid #e0e0e0;border-radius:12px;background:#fff;margin-bottom:14px}',
      '#workOrderPanel .wo4-h{font-weight:700;font-size:14px}',
      '#workOrderPanel .wo4-h small{font-weight:400;font-size:12px;color:#888}',
      '#workOrderPanel .wo4-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:10px}',
      '#workOrderPanel .wo4-chip{border-radius:8px;padding:8px 10px;font-size:13px;display:flex;flex-direction:column;gap:2px}',
      '#workOrderPanel .wo4-chip span{font-size:12px;opacity:.85}',
      '#workOrderPanel .wo4-chip.ok{background:#e8f5e9;color:#1b5e20}',
      '#workOrderPanel .wo4-chip.warn{background:#fff3e0;color:#8a3b00}',
      '#workOrderPanel .wo4-chip.todo{background:#f1f1f1;color:#555}',
      '#workOrderPanel .wo4-issue{background:#1f2937;color:#fff;border:none;border-radius:8px;padding:11px 22px;font-size:14px;font-weight:700;cursor:pointer}',
      '#workOrderPanel .wo4-issue[disabled]{opacity:.5;cursor:default}',
      '#workOrderPanel .wo4-packs{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:10px}',
      '#workOrderPanel .wo4-pack{border:1px solid #d6d6d6;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}',
      '#workOrderPanel .wo4-pack .who{font-size:12px;color:#666}',
      '#workOrderPanel .wo4-pack .desc{font-size:12px;color:#444;flex:1}',
      '#workOrderPanel .wo4-pack button{align-self:flex-start;padding:7px 14px;cursor:pointer;font-weight:600}',
      '#workOrderPanel .wo4-pack.off{opacity:.55}',
    ].join('');
    document.head.appendChild(st);
  }

  function packCard(title, who, desc, docId, pack) {
    return '<div class="wo4-pack' + (docId ? '' : ' off') + '">' +
      '<div class="wo4-h">' + esc(title) + '</div>' +
      '<div class="who">' + esc(who) + '</div>' +
      '<div class="desc">' + esc(desc) + '</div>' +
      '<button type="button" data-wo-print="' + esc(docId || '') + '" data-wo-pack="' + esc(pack || '') + '"' +
      (docId ? '' : ' disabled') + '>인쇄</button></div>';
  }

  function renderStep4() {
    const root = document.getElementById(STEP4_ID);
    if (!root) return;
    ensureStep4Style();

    if (!API) {
      root.innerHTML = '<div class="wo4-box">업무 루프 서버(workflowApi.url)가 설정되지 않았습니다.</div>';
      return;
    }

    const id = designId();
    const report = window._reportData;
    const hasBom = Boolean(report && report.materials);
    const wo = latestDoc('work_order');
    const io = latestDoc('installation_order');
    const cc = approvedCC();
    const snap = state.snapshot;
    const woFresh = Boolean(wo && !wo.stale && (!snap || wo.snapshot_id === snap.snapshot_id));
    const site = hasSiteInfo();

    const chips =
      chip(Boolean(id), id ? '설계 저장됨' : '설계 저장 전', id ? '' : '발행할 때 이름을 묻고 저장합니다') +
      chip(hasBom ? true : false, hasBom ? 'BOM 산출됨' : 'BOM 없음',
        hasBom ? '부재 ' + ((report.materials.materials || []).length) + '종' : '3단계에서 산출해 주세요') +
      (snap
        ? chip(true, '동결 rev ' + snap.rev, snap.reused ? '변경 없음 — 기존 rev' : '')
        : wo && wo.snapshot_rev
          ? chip(woFresh, '동결 rev ' + wo.snapshot_rev, woFresh ? '최신 작업지시서 기준' : '그 뒤로 설계가 바뀌었습니다')
          : chip(null, '동결 전', '발행할 때 동결합니다')) +
      chip(cc ? true : false, cc ? '고객 승인됨' : '고객 승인 전', cc ? cc.doc_no || '' : '승인 전 발행은 사유를 남깁니다') +
      chip(wo ? woFresh : null,
        wo ? '작업지시서 r' + wo.rev + (woFresh ? '' : ' · 설계 변경됨') : '작업지시서 없음',
        wo ? wo.doc_no : '');

    const packs =
      WO_PACKS.map(function (p) { return packCard(p.title, p.who, p.desc, wo && wo.id, p.pack); }).join('') +
      packCard('설치 지시서', '시공 기사',
        io ? '현장 주소 · 층 · 엘리베이터 · 반입 경로 · 시공 순서'
          : site ? '[발행] 할 때 아래 현장 정보로 함께 만듭니다' : '아래 현장 정보를 저장하면 [발행] 할 때 함께 만듭니다',
        io && io.id, '');

    const issueLabel = woFresh ? '작업지시서 다시 확인' : wo ? '설계 변경 반영해 새로 발행' : '작업지시서 발행';

    root.innerHTML =
      '<div class="wo4-box">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<div class="wo4-h">발행</div><div id="wo4Status" style="font-size:12px;color:#666;"></div></div>' +
      '<div class="wo4-chips">' + chips + '</div>' +
      '<div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
      '<button type="button" class="wo4-issue" id="wo4Issue"' + (hasBom ? '' : ' disabled') + '>' + esc(issueLabel) + '</button>' +
      '<span style="font-size:12px;color:#666;">저장 → 설계·BOM 동결 → 제작' + (site ? '·설치' : '') +
      ' 작업지시서 발행을 한 번에 합니다. 같은 설계면 새로 만들지 않습니다.</span>' +
      '</div></div>' +
      '<div class="wo4-box"><div class="wo4-h">꾸러미 인쇄 <small>— 사람마다 자기 종이만</small></div>' +
      '<div class="wo4-packs">' + packs + '</div></div>' +
      '<div class="wo4-box"><div class="wo4-h">현장 정보 <small>— 설치 지시서에 실립니다</small></div>' +
      siteInfoHtml() + '</div>' +
      '<div class="wo4-box"><div class="wo4-h">발행 이력</div>' +
      documentsHtml(function (d) { return d.doc_type === 'work_order' || d.doc_type === 'installation_order'; }) +
      '</div>';

    bindStep4(root);
  }

  function setStep4Status(message, kind) {
    const node = document.getElementById('wo4Status');
    if (node) {
      node.textContent = message || '';
      node.style.color = kind === 'error' ? '#c62828' : kind === 'ok' ? '#2e7d32' : '#666';
    }
    setStatus(message, kind);
  }

  /**
   * [발행] — 저장 → 동결 → 제작(+설치) 작업지시서. 같은 스냅샷에 살아 있는 문서가 있으면 새로 만들지 않는다.
   * 고객 승인 전이면 사유를 받아 특기사항에 남긴다 (계획 §7 Q6 기본값: 확정은 승인 뒤, 사유 입력 시 예외).
   */
  async function issueWorkOrders() {
    if (!designId()) {
      if (typeof window.saveDesign !== 'function') throw new Error('설계를 먼저 저장해 주세요.');
      setStep4Status('설계를 저장하는 중…');
      await window.saveDesign();
      if (!designId()) throw new Error('저장이 취소되어 발행하지 않았습니다.');
    }

    await createSnapshot();
    const snap = state.snapshot;
    const sameSnap = function (type) {
      return state.documents.find(function (d) {
        return d.doc_type === type && d.snapshot_id === snap.snapshot_id && live(d);
      }) || null;
    };

    const made = [];
    if (!sameSnap('work_order')) {
      const body = { doc_type: 'work_order' };
      if (!approvedCC()) {
        const reason = window.prompt(
          '고객 확인서 승인 전입니다. 그래도 작업지시서를 발행하려면 사유를 적어 주세요 (지시서 특기사항에 남습니다).'
        );
        if (reason === null || !String(reason).trim()) {
          setStep4Status('발행하지 않았습니다 — 고객 승인 뒤에 다시 눌러 주세요.', 'error');
          return;
        }
        body.instructions = '고객 승인 전 발행 — 사유: ' + String(reason).trim();
      }
      setStep4Status('제작 작업지시서를 발행하는 중…');
      const data = await api('/snapshots/' + encodeURIComponent(snap.snapshot_id) + '/documents', {
        method: 'POST',
        body: body,
      });
      made.push(data.doc_no);
    }
    if (hasSiteInfo() && !sameSnap('installation_order')) {
      setStep4Status('설치 작업지시서를 발행하는 중…');
      const data = await api('/snapshots/' + encodeURIComponent(snap.snapshot_id) + '/documents', {
        method: 'POST',
        body: { doc_type: 'installation_order' },
      });
      made.push(data.doc_no);
    }

    await refresh();
    setStep4Status(
      made.length
        ? made.join(' · ') + ' 발행 완료 — 아래 꾸러미에서 인쇄하세요.'
        : '설계가 그대로라 기존 작업지시서를 씁니다.',
      'ok'
    );
  }

  function bindStep4(root) {
    const btn = document.getElementById('wo4Issue');
    if (btn) btn.addEventListener('click', function () { guard(issueWorkOrders); });
    const save = root.querySelector('#wfSaveSite');
    if (save) save.addEventListener('click', function () { guard(saveSite); });
    root.querySelectorAll('[data-wo-print]').forEach(function (b) {
      b.addEventListener('click', function () {
        guard(function () {
          return openPrint(b.getAttribute('data-wo-print'), b.getAttribute('data-wo-pack') || null);
        });
      });
    });
    root.querySelectorAll('[data-wf-print]').forEach(function (b) {
      b.addEventListener('click', function () {
        guard(function () { return openPrint(b.dataset.wfPrint); });
      });
    });
  }

  // ── 동작 ────────────────────────────────────────────────────────

  async function guard(fn) {
    if (state.busy) return;
    state.busy = true;
    try {
      await fn();
    } catch (e) {
      setStatus(e.message || '오류가 발생했습니다', 'error');
      if (e.details) console.error('[Workflow] details:', e.details);
    } finally {
      state.busy = false;
    }
  }

  async function createSnapshot() {
    const id = designId();
    if (!id) throw new Error('먼저 설계를 저장해 주세요. (저장하면 주소에 ?id= 가 붙습니다)');

    const report = window._reportData;
    if (!report || !report.design || !report.materials) {
      throw new Error('BOM 산출 결과가 없습니다. "재산출" 을 먼저 눌러 주세요.');
    }

    // B4: 재단 배치(cutPlan)도 함께 동결한다. _reportData 는 ui-step1.js 가 만들므로
    // (소유권 규칙상 손대지 않는다) 같은 materials 로 여기서 다시 계산한다 — 엔진이 결정적이라
    // CNC 탭(ai-design-report.js)이 그린 배치와 같다. 엔진이 없으면(옛 캐시) 배치 없이 보낸다.
    let cutPlan = null;
    const materials = report.materials && report.materials.materials;
    if (window.NestingEngine && Array.isArray(materials)) {
      try {
        cutPlan = window.NestingEngine.plan(materials);
      } catch (e) {
        console.warn('[Workflow] cutPlan 계산 실패 — 배치 없이 동결합니다:', e);
        cutPlan = null;
      }
    }

    setStatus('설계와 BOM 을 동결하는 중…');
    const body = {
      design: report.design,
      bom: report.materials,
      hardware: report.hardware || {},
    };
    if (cutPlan) body.cutPlan = cutPlan;
    const data = await api('/designs/' + encodeURIComponent(id) + '/snapshots', {
      method: 'POST',
      body: body,
    });

    state.snapshot = data;
    setStatus(
      data.reused
        ? '변경 사항이 없어 기존 rev ' + data.rev + ' 를 사용합니다.'
        : 'rev ' + data.rev + ' 생성 완료',
      'ok'
    );
    await refresh();
  }

  async function issue(docType) {
    if (!state.snapshot) throw new Error('먼저 설계·BOM 을 동결해 주세요.');

    const body = { doc_type: docType };
    if (docType === 'customer_confirmation') {
      const name = window.prompt('고객 성함을 입력해 주세요 (문서에는 마스킹되어 표시됩니다)');
      if (name === null) return;
      body.customer_name = name;
      const pin = window.prompt(
        '접근 번호를 설정하시겠습니까? (고객 연락처 뒤 4자리 권장, 비우면 생략)'
      );
      if (pin) body.access_pin = pin;
    }

    setStatus('문서를 발행하는 중…');
    const data = await api(
      '/snapshots/' + encodeURIComponent(state.snapshot.snapshot_id) + '/documents',
      {
        method: 'POST',
        body: body,
      }
    );

    // 재발행이면 옛 공유 링크가 닫힌다. 고객이 예전 링크로 들어오면 열리지 않으므로
    // 새 링크를 다시 보내야 한다는 걸 발행 시점에 알려준다.
    // 대체된 문서 전부의 링크가 닫히는 것은 아니다 — 고객이 승인·반려한 문서는
    // 그 자체가 확인 기록이자 수주의 근거라 열람 가능하게 남는다.
    // 둘을 뭉뚱그리면 "옛 링크가 닫혔다" 는 잘못된 안내가 된다.
    let supersededNote = '';
    if (data.superseded_count > 0) {
      supersededNote = ' · 이전 ' + data.superseded_count + '건 대체';
      const closed = data.superseded_closed_count;
      if (closed > 0) supersededNote += ' (옛 링크 ' + closed + '건 닫힘)';
      if (closed === 0) supersededNote += ' (고객이 확인한 문서는 열람 가능하게 남습니다)';
    }

    if (data.share_url) {
      // 평문 토큰은 이 응답에서만 볼 수 있다 — 지금 복사하지 않으면 재발행해야 한다
      try {
        await navigator.clipboard.writeText(data.share_url);
        setStatus(
          data.doc_no + ' 발행 완료 · 공유 링크를 클립보드에 복사했습니다.' + supersededNote,
          'ok'
        );
      } catch (e) {
        window.prompt(
          '아래 공유 링크를 복사해 고객에게 전달하세요 (다시 볼 수 없습니다)',
          data.share_url
        );
        setStatus(data.doc_no + ' 발행 완료' + supersededNote, 'ok');
      }
    } else {
      // 작업지시서 — 공유 링크가 없다
      setStatus(data.doc_no + ' 발행 완료' + supersededNote, 'ok');
    }

    await refresh();
  }

  /**
   * CD-4: 현장 정보 저장.
   * 설계에 붙는다 — 스냅샷이 아니다. 주소를 고쳤다고 설계 rev 가 올라가면 안 된다.
   */
  /**
   * CD-5: 승인된 확인서 → 수주.
   * 서버가 멱등하게 처리한다 — 두 번 눌러도 수주가 두 개 생기지 않는다
   * (orders.document_id UNIQUE 가 DB 레벨 최후 방어선).
   */
  async function toOrder(documentId) {
    const order = await api('/documents/' + encodeURIComponent(documentId) + '/order', {
      method: 'POST',
    });
    setStatus(
      (order.reused ? '이미 수주로 전환된 확인서입니다: ' : '수주로 전환했습니다: ') + order.order_no
    );
    if (window.confirm('수주 ' + order.order_no + '\n\nERP 화면(수주·원가·마진)을 열까요?')) {
      window.open('erp.html', '_blank', 'noopener');
    }
  }

  async function saveSite() {
    const id = designId();
    if (!id) throw new Error('설계를 먼저 저장해 주세요.');
    const val = function (elId) {
      const n = document.getElementById(elId);
      return n ? n.value : '';
    };
    const elev = val('wfSiteElevator');
    await api('/designs/' + encodeURIComponent(id) + '/site-info', {
      method: 'PUT',
      body: {
        address: val('wfSiteAddress'),
        address_detail: val('wfSiteAddressDetail'),
        floor: val('wfSiteFloor'),
        // '' = 미확인. false(없음) 와 구분해야 사다리차 판단이 된다
        has_elevator: elev === '' ? null : elev === 'true',
        contact_name: val('wfSiteContactName'),
        contact_phone: val('wfSiteContactPhone'),
        access_note: val('wfSiteAccess'),
        install_order: val('wfSiteOrder'),
      },
    });
    setStatus('현장 정보를 저장했습니다.');
    await refresh();
  }

  async function addSchedule() {
    const id = designId();
    if (!id) throw new Error('먼저 설계를 저장해 주세요.');

    const type = document.getElementById('wfSchedType').value;
    const at = document.getElementById('wfSchedAt').value;
    if (!at) throw new Error('일시를 선택해 주세요.');

    setStatus('일정을 등록하고 Slack 에 알리는 중…');
    await api('/designs/' + encodeURIComponent(id) + '/schedules', {
      method: 'POST',
      body: {
        items: [
          {
            type: type,
            // datetime-local 은 타임존이 없다. 브라우저 로컬 시각으로 해석해 ISO 로 보낸다.
            scheduled_at: new Date(at).toISOString(),
            assignee_name: document.getElementById('wfSchedWho').value || null,
            location: document.getElementById('wfSchedWhere').value || null,
          },
        ],
      },
    });

    setStatus('일정을 등록했습니다. Slack 알림은 잠시 뒤 도착합니다.', 'ok');
    await refresh();
  }

  /** pack: 작업지시서 꾸러미 키 (cut · assembly · door · labels · all). 없으면 문서 전체. */
  async function openPrint(documentId, pack) {
    if (!documentId) throw new Error('먼저 작업지시서를 발행해 주세요.');
    // 창은 클릭 직후에 연다 — await 뒤에 열면 팝업 차단에 걸린다
    const win = window.open('', '_blank');
    if (!win) throw new Error('팝업이 차단되었습니다. 팝업을 허용해 주세요.');
    win.document.write('<p style="font:14px sans-serif;padding:24px">인쇄 화면을 불러오는 중…</p>');

    const t = await token();
    if (!t) {
      win.close();
      throw new Error('로그인이 필요합니다.');
    }

    // 인쇄 화면은 JWT 가 필요해 새 탭 주소로 바로 열 수 없다.
    // 본문을 받아 새 창에 써 넣는다.
    const query = pack ? '?pack=' + encodeURIComponent(pack) : '';
    const res = await fetch(API + '/documents/' + encodeURIComponent(documentId) + '/print' + query, {
      headers: { Authorization: 'Bearer ' + t },
    });
    if (!res.ok) {
      win.close();
      throw new Error('인쇄 화면을 불러오지 못했습니다 (' + res.status + ')');
    }

    const html = await res.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  async function revoke(documentId) {
    if (!window.confirm('이 공유 링크를 회수하시겠습니까? 고객이 더 이상 열 수 없게 됩니다.'))
      return;
    await api('/documents/' + encodeURIComponent(documentId) + '/revoke', { method: 'POST' });
    setStatus('공유 링크를 회수했습니다.', 'ok');
    await refresh();
  }

  async function refresh() {
    const id = designId();
    if (!id) {
      render();
      return;
    }
    const [docs, scheds, site] = await Promise.all([
      api('/designs/' + encodeURIComponent(id) + '/documents').catch(function () {
        return { items: [] };
      }),
      api('/designs/' + encodeURIComponent(id) + '/schedules').catch(function () {
        return { items: [] };
      }),
      // CD-4: 현장 정보 (없으면 null)
      api('/designs/' + encodeURIComponent(id) + '/site-info').catch(function () {
        return null;
      }),
    ]);
    state.documents = docs.items || [];
    state.schedules = scheds.items || [];
    state.site = site || null;
    render();
  }

  // ── 바인딩 ──────────────────────────────────────────────────────

  function bind() {
    const root = panel();
    if (!root) return;

    const on = function (id, fn) {
      const node = document.getElementById(id);
      if (node)
        node.addEventListener('click', function () {
          guard(fn);
        });
    };

    on('wfSnapshot', createSnapshot);
    on('wfIssueCC', function () {
      return issue('customer_confirmation');
    });
    on('wfAddSched', addSchedule);
    const go4 = document.getElementById('wfGoStep4');
    if (go4) {
      go4.addEventListener('click', function () {
        if (typeof window.goToStep4 === 'function') window.goToStep4();
      });
    }

    root.querySelectorAll('[data-wf-order]').forEach(function (b) {
      b.addEventListener('click', function () {
        guard(function () {
          return toOrder(b.getAttribute('data-wf-order'));
        });
      });
    });

    root.querySelectorAll('[data-wf-print]').forEach(function (b) {
      b.addEventListener('click', function () {
        guard(function () {
          return openPrint(b.dataset.wfPrint);
        });
      });
    });
    root.querySelectorAll('[data-wf-revoke]').forEach(function (b) {
      b.addEventListener('click', function () {
        guard(function () {
          return revoke(b.dataset.wfRevoke);
        });
      });
    });
  }

  // ── 초기화 ──────────────────────────────────────────────────────

  function init() {
    if (!panel() && !document.getElementById(STEP4_ID)) return;
    render();
    if (designId()) guard(refresh);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 외부에서 갱신할 수 있게 최소 인터페이스만 노출한다
  window.DadamWorkflow = {
    refresh: function () {
      return guard(refresh);
    },
    render: render,
    /** goToStep4 (ui-step1.js) 가 부른다 — 바로 그리고, 서버 목록을 받아 다시 그린다 */
    enterStep4: function () {
      renderStep4();
      if (designId()) return guard(refresh);
      return Promise.resolve();
    },
  };
})();
