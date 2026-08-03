/**
 * 업무 루프 패널 — 스냅샷 → 고객확인서/작업지시서 → 일정/Slack.
 *
 * ★ 파일 소유권 규칙 준수: ui-step1.js / ui-workspace.js / ai-design-report.js 를
 *   수정하지 않는다. proceedToBOM() 이 세팅해 둔 window._reportData 를
 *   읽기만 하고, UI 는 detaildesign.html 의 #workflowPanel 안에만 그린다.
 *   (#step3-report-area 는 ui-step1.js:326 이 innerHTML 로 통째로 덮어쓰므로
 *    그 안에 무엇을 넣어도 재산출 시 사라진다.)
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

  function documentsHtml() {
    if (!state.documents.length) {
      return '<p style="color:#888;font-size:13px;margin:6px 0;">아직 발행한 문서가 없습니다.</p>';
    }

    const rows = state.documents
      .map(function (d) {
        const typeLabel = d.doc_type === 'work_order' ? '작업지시서' : '고객확인서';
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
              '" style="font-size:12px;padding:4px 10px;cursor:pointer;">링크 회수</button>'
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
      '<button type="button" id="wfIssueWO" style="padding:9px 16px;cursor:pointer;"' +
      (snap ? '' : ' disabled') +
      '>3. 작업지시서 발행</button>' +
      '</div>' +
      (snap
        ? '<div style="margin-top:10px;font-size:13px;color:#333;">' +
          '스냅샷 rev ' +
          esc(snap.rev) +
          ' · 품목 ' +
          esc(snap.item_count) +
          ' · 부재 ' +
          esc(snap.panel_count) +
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
      '<div style="margin-top:16px;font-weight:600;font-size:13px;">발행 문서</div>' +
      documentsHtml() +
      '<div style="margin-top:16px;font-weight:600;font-size:13px;">일정</div>' +
      schedulesHtml() +
      scheduleFormHtml() +
      '</div>';

    bind();
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

    setStatus('설계와 BOM 을 동결하는 중…');
    const data = await api('/designs/' + encodeURIComponent(id) + '/snapshots', {
      method: 'POST',
      body: {
        design: report.design,
        bom: report.materials,
        hardware: report.hardware || {},
      },
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

    if (data.share_url) {
      // 평문 토큰은 이 응답에서만 볼 수 있다 — 지금 복사하지 않으면 재발행해야 한다
      try {
        await navigator.clipboard.writeText(data.share_url);
        setStatus(data.doc_no + ' 발행 완료 · 공유 링크를 클립보드에 복사했습니다.', 'ok');
      } catch (e) {
        window.prompt(
          '아래 공유 링크를 복사해 고객에게 전달하세요 (다시 볼 수 없습니다)',
          data.share_url
        );
        setStatus(data.doc_no + ' 발행 완료', 'ok');
      }
    } else {
      setStatus(data.doc_no + ' 발행 완료', 'ok');
    }

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

  async function openPrint(documentId) {
    const t = await token();
    if (!t) throw new Error('로그인이 필요합니다.');

    // 인쇄 화면은 JWT 가 필요해 새 탭 주소로 바로 열 수 없다.
    // 본문을 받아 새 창에 써 넣는다.
    const res = await fetch(API + '/documents/' + encodeURIComponent(documentId) + '/print', {
      headers: { Authorization: 'Bearer ' + t },
    });
    if (!res.ok) throw new Error('인쇄 화면을 불러오지 못했습니다 (' + res.status + ')');

    const html = await res.text();
    const win = window.open('', '_blank');
    if (!win) throw new Error('팝업이 차단되었습니다. 팝업을 허용해 주세요.');
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
    const [docs, scheds] = await Promise.all([
      api('/designs/' + encodeURIComponent(id) + '/documents').catch(function () {
        return { items: [] };
      }),
      api('/designs/' + encodeURIComponent(id) + '/schedules').catch(function () {
        return { items: [] };
      }),
    ]);
    state.documents = docs.items || [];
    state.schedules = scheds.items || [];
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
    on('wfIssueWO', function () {
      return issue('work_order');
    });
    on('wfAddSched', addSchedule);

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
    if (!panel()) return;
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
  };
})();
