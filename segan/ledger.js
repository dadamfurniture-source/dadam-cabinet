/* ============================================================
   segan/ledger.js — 업체 회계장부 (segan/ledger.html)

   누가 보나  workflow-api GET /ledger/me 가 답하는 사람 — 업체 구성원 + 업체 자격(Agent · 시험 업체).
             대표 · 실장(money)만 장부를 본다. 직원은 사진 올리기와 자기가 올린 사진의 상태만 (can_upload),
             올릴 수 없으면 「대표 · 실장만 봅니다」 안내만.
             자격 read(등급이 내려감)는 보기만 — 입력 · 고치기 · 취소 · 설정 저장 · 사진 올리기를 감춘다.
   데이터    GET /ledger/me · /ledger/accounts · /ledger/book?month=&include_void=1
             PUT /ledger/settings { vat_type, business_kind }
             POST /ledger/entries (X-Idempotency-Key — 입력 칸을 열 때마다 새 키, 다시 눌러도 한 줄)
             POST /ledger/entries/:id/void { reason } · /ledger/entries/:id/correct { reason, 바뀐 칸 }
             POST /ledger/documents 사진 바이트 (X-Idempotency-Key 사진마다 하나 · 메모는 X-Ledger-Note 머리)
             GET  /ledger/documents?limit=&before= — 대표 · 실장은 업체 사진 전부, 직원은 자기 것만 (서버가 가린다)
   사진      찍기(capture) · 앨범(여러 장). 캔버스로 다시 그려 JPEG 로 — 위치 같은 EXIF 가 빠지고, 긴 변 2576px ·
             375만 화소 이하로 줄인다 (워커 checks.js 와 같은 한도). 이 기기에서 못 여는 사진(HEIC 등)은 안내만 하고
             올리지 않는다. 한 장씩 차례로 올린다. 분 한도(429 rate_limited)면 RESUME_MS 쉬었다가 그 사진부터 같은 키로
             이어 올리고(화면이 열려 있는 동안), 하루 한도(429 daily_limit)면 남은 사진은 멈춰 두었다가 「다시 올리기」.
             형식 · 크기로 거절된 사진(413 · 422)은 다시 올리지 않는다.
   사진 확인  대표 · 실장만 (직원은 묻지 않는다). GET /ledger/review?status=pending&limit=&before= — 확인 기다리는 사진
             + 10분 서명 주소 + 최근 읽기 시도(상태 · 읽은 칸 · 검사). 사진을 누르면 읽은 칸으로 채운 칸을 고쳐
             POST /ledger/documents/:id/post { target: entry | order_cost } · /return · /reject { reason } · /reread.
             시트 사진은 「사진 돌리기」로 90도씩 돌려 본다 (화면에서만 — 올린 사진 파일은 그대로, 이 화면이 열린 동안 기억).
             비서가 방향을 보고 돌려 읽은 사진(읽은 칸 result.rotate)은 처음부터 그만큼 돌려 보인다 (썸네일도).
             경고 없이 다 읽은 사진은 골라 POST /ledger/review/post (한 번에 BATCH_MAX 장, 계정 하나를 골라 함께).
             읽는 중인 사진이 있으면 화면이 보일 때 POLL_MS 마다 목록을 다시 읽는다.
             서명 주소가 끝나기 PHOTO_MARGIN_MS 전부터는 사진을 열 때 · 화면이 다시 보일 때 · 썸네일이 안 열릴 때
             불러온 장수만큼(더 보기로 연 쪽까지) 목록을 새로 받는다.
             GET /ledger/business-status?biz_no= — 국세청 상태 (서버에 키가 없으면 available false → 단추를 감춘다)
             금액 채우기는 세무사 확인 전 기준: 공제되는 부가세 증빙(세금계산서 · 카드 · 현금영수증)에 공급가 · 부가세가 있으면
             금액 = 공급가 · 부가세 = 부가세, 아니면 금액 = 합계 · 부가세 0
   탭        대표 · 실장 — 머리(장부 고르기 · 달) 아래 탭 다섯: 한눈에(ledger-board.js 를 판 안에 · 같은 달) · 매출 · 매입
             (한 장부를 방향으로 — 수입 · 자산 팔기 / 비용 · 자산 사기) · 사진(올리기 · 확인) · 설정(과세 · 거래처별 세금계산서).
             주소 #board · #sales · #buys · #photos · #settings 로 탭을 연다 (한눈에의 장부 상태 칩이 이 주소로 온다),
             ?month=YYYY-MM 은 처음 달. 직원은 탭 없이 사진 판만. 알림 한 줄(lgState)은 화면 아래 — 누르면 닫는다
   보고      머리의 「보고서」(ledger-report.html?month= — 인쇄용 한 장) · 「내보내기」(세무사용 CSV 셋 — 이 달 · 반기 ·
             기간 지정 366일까지, GET /ledger/book?from=&to= 를 받아 ledger-book.js csvFiles). 월초(1~7일)에는 한눈에 위에
             지난달 보고서 카드
   사진 판    올리기 → 상태 거름(확인 기다림 · 장부에 올림 · 돌려보냄 · 쓰지 않음 · 전체 — 대표 · 실장) → 확인할 사진 ·
             올린 사진(GET /ledger/documents?status=). 세금계산서 기다리는 명세표는 매입 판에.
             사진 AI 읽기를 쓰지 않는 업체(/ledger/me ai false — Expert)는 「직접 적기」 — 읽기를 기다리지 않고 다시 묻지도 않는다
   보이는 것  사진 판에 늘 「종이 원본 5년 보관」 안내. 매출 · 매입 판(ledger-book.js 표)에 그 쪽 달 요약 · 거름(출처) ·
             찾기 · 표(일자 · 거래처 · 계정 · 공급가 · 부가세 · 합계 · 증빙 · 출처, 합계 줄) — 매입은 「매입처별」 묶음도.
             줄을 누르면 옆 서랍(폰은 아래)에 그 줄 — 직접 넣은 줄만 고치기 · 취소, 수금 · 원가 줄은 ERP 에서 고친다.
             「+ 매출 · + 매입」 · 고치기 칸도 서랍에 연다. 받을 돈(매출) · 낼 돈(매입)은 GET /ledger/receivables ·
             payables (장부 서버가 모르면 상자를 감춘다). 취소한 줄은 「취소한 줄도 보기」를 켜야 보인다 (지우지 않는다).
   못 읽으면  /ledger/me 403 → 이유 한 줄 (구성원 아님 · 자격 없음 · 대표 · 실장 아님), 그 밖 → 「불러오지 못했습니다」
   여러 장부  /ledger/me 의 ledgers 가 둘 이상이면(다담 본사 대표 · 실장 — 본사 · 공장) 장부 고르기.
             남의 장부(viewing)는 보기 주소에 ?company= 를 붙이고 보기만 한다. 쓰기는 언제나 자기 업체
   로그인 · 클라이언트는 segan/shell.js 가 맡는다 (SeganShell.ready 의 sb · session).
   ============================================================ */
/* global window, document, fetch, crypto, location, history, URLSearchParams */
(function () {
  'use strict';

  // 값은 워커 src/ledger/checks.js 와 같다
  var DIRECTION = {
    expense: '비용',
    income: '수입',
    asset_buy: '자산 사기',
    asset_sell: '자산 팔기',
  };
  var GROUPS = {
    income: ['income'],
    expense: ['purchase', 'manufacturing', 'admin'],
    asset_buy: ['asset'],
    asset_sell: ['asset'],
  };
  var EVIDENCE = {
    tax_invoice: '세금계산서',
    invoice: '계산서',
    card: '카드',
    cash_receipt: '현금영수증',
    simple_receipt: '간이영수증',
    statement: '거래명세표',
    other: '기타',
    none: '증빙 없음',
  };
  var METHOD = { transfer: '계좌이체', card: '카드', cash: '현금', other: '기타' };
  var SOURCE = { entry: '직접', payment: '수금', cost: '수주 원가' };
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' }; // segan/books.js 와 같다
  var VAT_TYPE = { general: '일반과세', simplified: '간이과세', exempt: '면세' };
  var BIZ_KIND = { manufacturing: '제조', retail: '도소매' };
  var DENY = {
    not_member: '장부는 팩토리 구성원만 씁니다.',
    not_entitled: '회계는 Expert · Agent 팩토리가 씁니다.',
    not_money: '장부는 팩토리 대표 · 실장만 봅니다.',
  };
  var FAIL_MSG = '장부를 불러오지 못했습니다.';
  var MONTH_RE = /^(\d{4})-(\d{2})$/;
  // 탭 — 매출 · 매입 판은 한 장부를 방향으로 나눠 보인다
  var TABS = ['board', 'sales', 'buys', 'photos', 'settings'];
  // 내보내기 — 한 번에 받는 날 수 (워커 entries.js bookRange) · 월초 보고서 카드를 보이는 날까지
  var EXPORT_MAX_DAYS = 366;
  var MONTH_CARD_DAYS = 7;
  var BOOK_TABS = {
    sales: { title: '매출 — 받은 돈 · 수입', dirs: ['income', 'asset_sell'], dir: 'income' },
    buys: { title: '매입 — 낸 돈 · 비용', dirs: ['expense', 'asset_buy'], dir: 'expense' },
  };
  var PANE = {
    board: 'lgPaneBoard',
    sales: 'lgPaneBook',
    buys: 'lgPaneBook',
    photos: 'lgPanePhotos',
    settings: 'lgPaneSettings',
  };
  // 사진 — 워커 src/ledger/checks.js PHOTO_MAX_* 와 같다
  var PHOTO_MAX_EDGE = 2576;
  var PHOTO_MAX_PIXELS = 3750000;
  var PHOTO_MAX_BYTES = 5242880;
  var JPEG_QUALITY = 0.85;
  var DOCS_PAGE = 20;
  // 대표 · 실장이 보는 상태 (워커 documents.js REVIEW_STATUSES)
  var DOC_STATUS = {
    pending: '확인 기다림',
    posted: '장부에 올림',
    returned: '돌려보냄',
    rejected: '쓰지 않음',
    skipped_budget: '한도로 못 읽음',
  };
  // 직원이 보는 상태 (워커 documents.js staffStatus — 확인 전은 모두 「올림」)
  var STAFF_STATUS = {
    uploaded: '올림',
    posted: '확인됨',
    returned: '돌려보냄',
    rejected: '쓰지 않음',
  };
  var HEIC_MSG =
    '이 브라우저에서 HEIC 사진을 열지 못했습니다. 아이폰은 설정 › 카메라 › 포맷 › 「높은 호환성」으로 찍으면 됩니다.';
  var OPEN_FAIL_MSG = '이 사진을 열지 못했습니다. JPEG · PNG 사진을 골라 주세요.';
  // 사진 확인 — 워커 src/ledger/review.js (REVIEW_MAX · BATCH_MAX)
  var REVIEW_PAGE = 50;
  var BATCH_MAX = 20;
  var POLL_MS = 10000;
  // 사진 서명 주소(photo_expires_in, 워커 PHOTO_URL_TTL_SEC)가 끝나기 이만큼 전부터 목록을 새로 받는다
  var PHOTO_MARGIN_MS = 60000;
  // 시트 사진 높이 — ledger.css .lg-rv-photo img 의 max-height 와 같다 (크게 보기면 없음)
  var PHOTO_MAX_H = 320;
  // 사진 올리기 분 한도(429 rate_limited)에 걸리면 쉬는 시간 — 워커 wrangler.toml LEDGER_UPLOAD_LIMIT 의 period
  var RESUME_MS = 60000;
  // 읽기 시도 상태 (ledger_extractions.status, 시도가 아직 없으면 none)
  var READ_STATE = {
    none: '읽기 기다림',
    running: '읽는 중',
    done: '읽음',
    failed: '못 읽음',
    refused: '답할 수 없는 사진',
    skipped_budget: '한도로 못 읽음',
  };
  var REREAD = ['failed', 'refused', 'skipped_budget'];
  // 사진 판 상태 거름 — 확인 기다림은 「확인할 사진」, 나머지는 「올린 사진」 (워커 documents.js ?status=)
  var PH_FILTERS = [
    ['pending', '확인 기다림'],
    ['posted', '장부에 올림'],
    ['returned', '돌려보냄'],
    ['rejected', '쓰지 않음'],
    ['all', '전체'],
  ];
  // 세무사 확인 전 기준 — 이 증빙에 부가세가 있으면 공제되는 부가세로 본다
  var DEDUCT_EVIDENCE = ['tax_invoice', 'card', 'cash_receipt'];
  // 수주 원가 종류 — 워커 orders.js COST_CATEGORIES · erp.html 과 같다
  var COST_CATEGORY = {
    material: '자재',
    hardware: '부자재',
    labor: '노무',
    outsourcing: '외주',
    logistics: '물류',
    other: '기타',
  };
  var NTS_STATUS = {
    active: '계속 사업자',
    suspended: '휴업',
    closed: '폐업',
    unregistered: '국세청에 없는 번호',
  };
  // 꼭 볼 칸(일자 · 거래처 · 공급가 · 부가세 · 계정) — 읽은 칸이 「확실하지 않음」이면 그 칸을 「확인」으로
  var MUST_UNSURE = {
    date: ['issue_date'],
    cp: ['supplier_name'],
    amount: ['supply_amount', 'total_amount', 'tax_free_amount', 'service_charge'],
    vat: ['vat_amount'],
  };
  // 더 보기 안의 칸 — 확실하지 않거나 검사에 걸리면 표시하고 더 보기를 펼친다
  var MORE_FLAGS = {
    evidence_type: 'lgRvEvidence',
    payment_method: 'lgRvMethod',
    items: 'lgRvDesc',
    supplier_biz_no: 'lgRvBiz',
  };
  // 읽은 칸 이름 (「확실하지 않음: …」)
  var FIELD_NAME = {
    document_count: '장수',
    evidence_type: '증빙',
    issue_date: '일자',
    supplier_name: '상호',
    supplier_biz_no: '사업자번호',
    supply_amount: '공급가',
    vat_amount: '부가세',
    tax_free_amount: '면세',
    service_charge: '봉사료',
    total_amount: '합계',
    approval_no: '승인번호',
    payment_method: '결제 수단',
    items: '품목',
  };
  // 읽지 못한 까닭 (ledger_extractions.error) — 쉬운 말
  var READ_FAIL = [
    [/^cut$/, '답이 너무 길어 잘렸습니다'],
    [/^orient_/, '사진 방향을 보지 못했습니다'],
    [/^rotate_/, '사진을 돌리지 못했습니다'],
    [/^photo_/, '사진 파일을 읽지 못했습니다'],
    [/^claude_429/, 'AI 가 바빠 읽지 못했습니다'],
    [/^claude/, 'AI 에 닿지 못했습니다'],
    [/^stuck$/, '너무 오래 걸려 멈췄습니다'],
    [/^parse$/, 'AI 답을 알아보지 못했습니다'],
  ];
  // 거래명세표 — 거래처가 세금계산서를 따로 주나 (워커 src/ledger/statements.js INVOICE_MODES)
  var INVOICE_MODE = { separate: '세금계산서 따로 줌', statement_only: '명세표만 줌' };
  // 수주 원가로 — 이 업체에 고를 수주가 없을 때 할 일
  //   수주는 상세설계 업무 루프에서 고객이 승인한 확인서를 「수주 전환」해야 생긴다 (ERP 는 있는 수주만 본다 — workers/workflow-api createOrderFromDocument)
  var NO_ORDERS_HINT =
    '수주는 PC 상세설계 화면에서 고객이 승인한 확인서를 「수주 전환」해야 생깁니다. 수주에 붙지 않는 돈이면 「올릴 곳」을 장부 줄로 바꿔 올려 주세요.';
  var AMOUNT_KEYS = [
    'supply_amount',
    'vat_amount',
    'tax_free_amount',
    'service_charge',
    'total_amount',
  ];

  var L = {
    sb: null,
    session: null,
    base: '',
    me: null, // GET /ledger/me data
    company: '', // 보는 남의 장부 업체 id (비면 자기 업체)
    accounts: [], // [{ code, name, grp, note }]
    month: '',
    tab: '', // 여는 탭 — TABS 중 하나 (직원은 비움)
    ph: 'pending', // 사진 판 상태 거름 — PH_FILTERS 중 하나
    exportRange: 'month', // 내보내기 기간 — month · half · custom
    exportCache: null, // { key: from~to, rows } — 같은 기간이면 다시 묻지 않는다
    bk: { source: 'all', query: '', group: false, selected: '' }, // 매출 · 매입 판 — 거름 · 찾기 · 매입처별 · 서랍에 연 줄 id
    money: {}, // receivables · payables → GET data (없으면 false — 상자를 감춘다)
    data: null, // GET /ledger/book data
    showVoid: false,
    form: null, // { mode: 'create' | 'correct', row, key }
    voiding: '', // 취소 이유를 적는 줄 id
    busy: false,
    docs: [], // GET /ledger/documents items (새것부터)
    docsMore: false,
    up: [], // 올릴 사진 [{ name, file, blob, key, note, status: wait|prep|send|done|same|fail, msg, final }]
    uploading: false,
    upAt: 0, // 올리는 사진 차례 (L.up 안)
    upWait: false, // 분 한도로 쉬는 중 (RESUME_MS 뒤 이어 올린다)
    review: [], // GET /ledger/review items (확인 기다리는 사진, 새것부터)
    reviewMore: false,
    reviewFail: false,
    reviewAt: 0, // 확인 목록 첫 쪽을 받은 때 — 사진 서명 주소가 가장 오래된 쪽 (더 보기는 늦추지 않는다)
    reviewLoading: false, // 사진 주소를 새로 받는 중
    rot: {}, // 「사진 돌리기」로 고친 각도 — 사진 id → 0 · 90 · 180 · 270 (화면에서만)
    sheet: null, // 여는 사진 { doc, prefill }
    decide: '', // 이유를 적는 중 — returned | rejected
    orders: null, // GET /ledger/orders items — 이 업체 수주 (수주 원가로 올릴 때 한 번)
    ordersFailed: false, // 수주 목록을 못 불러옴 — 다시 고르면 다시 묻는다
    held: [], // GET /ledger/held groups — 세금계산서 기다리는 명세표 (거래처 · 달)
    suppliers: [], // GET /ledger/suppliers items — 거래처별 고른 것
    attach: null, // 붙이기 창 { group, entries, picked: { 사진 id: true }, seq }
    attachAfter: null, // 「세금계산서 줄 넣고 붙이기」 — 직접 입력을 저장하면 이 묶음 붙이기 창을 연다
    ntsAvailable: null, // 국세청 상태 조회 — false 면 단추를 감춘다
    pollTimer: null,
    reviewBusy: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 글자 ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 금액 — 값이 없으면 「-」 */
  function money(n) {
    if (n == null || n === '' || !isFinite(Number(n))) return '-';
    return Number(n).toLocaleString('ko-KR') + '원';
  }

  /** 'YYYY-MM-DD' → 'MM.DD' */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s == null ? '' : s));
    return m ? m[2] + '.' + m[3] : '';
  }

  /** 한국 시간 오늘 'YYYY-MM-DD' */
  function today(now) {
    var k = new Date((now == null ? Date.now() : now) + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1) + '-' + pad(k.getUTCDate());
  }

  function thisMonth(now) {
    return today(now).slice(0, 7);
  }

  function shiftMonth(month, by) {
    var m = MONTH_RE.exec(month);
    if (!m) return '';
    var t = Number(m[1]) * 12 + Number(m[2]) - 1 + by;
    return Math.floor(t / 12) + '-' + pad((t % 12) + 1);
  }

  function monthLabel(month) {
    var m = MONTH_RE.exec(month);
    return m ? m[1] + '년 ' + Number(m[2]) + '월' : '';
  }

  function newKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ── 판정 (순수 — 시험이 직접 부른다) ─────────────────────
  /** 그 구분에 쓰는 계정 */
  function accountsFor(accounts, direction) {
    var groups = GROUPS[direction] || [];
    return (accounts || []).filter(function (a) {
      return a && groups.indexOf(a.grp) >= 0;
    });
  }

  /** 들어온 돈인가 (+) */
  function isIn(direction) {
    return direction === 'income' || direction === 'asset_sell';
  }

  /** 줄 설명 — 수금은 단계 이름, 수주 줄은 수주 번호 */
  function rowText(row) {
    var text =
      row.source === 'payment' ? PAY_STAGE[row.description] || row.description : row.description;
    return [text, row.counterparty_name, row.order_no].filter(Boolean).join(' · ');
  }

  /** 고치기 — 처음 값과 다른 칸만 (장부 보기에 없는 칸 — 결제 수단 · 사업자번호 — 은 적었을 때만) */
  function diffPatch(row, v) {
    var out = {};
    var same = function (a, b) {
      return String(a == null ? '' : a) === String(b == null ? '' : b);
    };
    [
      'entry_date',
      'direction',
      'account',
      'description',
      'counterparty_name',
      'amount',
      'vat_amount',
      'evidence_type',
    ].forEach(function (k) {
      if (!same(row[k], v[k])) out[k] = v[k];
    });
    if (v.payment_method) out.payment_method = v.payment_method;
    if (v.counterparty_biz_no) out.counterparty_biz_no = v.counterparty_biz_no;
    return out;
  }

  /** 올릴 크기 — 긴 변 2576px · 375만 화소 이하, 키우지 않는다 */
  function fitSize(width, height) {
    var s = Math.min(
      1,
      PHOTO_MAX_EDGE / Math.max(width, height),
      Math.sqrt(PHOTO_MAX_PIXELS / (width * height))
    );
    return {
      width: Math.max(1, Math.floor(width * s)),
      height: Math.max(1, Math.floor(height * s)),
    };
  }

  function isHeic(file) {
    var t = String((file && file.type) || '').toLowerCase();
    var n = String((file && file.name) || '').toLowerCase();
    return /hei[cf]/.test(t) || /\.hei[cf]$/.test(n);
  }

  /** 시각 → 한국 시간 'MM.DD HH:mm' */
  function stamp(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return (
      pad(k.getUTCMonth() + 1) +
      '.' +
      pad(k.getUTCDate()) +
      ' ' +
      pad(k.getUTCHours()) +
      ':' +
      pad(k.getUTCMinutes())
    );
  }

  /** 사업자등록번호 검증 숫자 — 워커 checks.js bizNoValid 와 같다 (가중치 1,3,7,1,3,7,1,3,5) */
  function bizNoValid(value) {
    var s = String(value == null ? '' : value).replace(/[-\s]/g, '');
    if (!/^\d{10}$/.test(s)) return false;
    var w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    var sum = 0;
    for (var i = 0; i < 9; i++) sum += Number(s[i]) * w[i];
    sum += Math.floor((Number(s[8]) * 5) / 10);
    return (10 - (sum % 10)) % 10 === Number(s[9]);
  }

  function wholeWon(v) {
    return typeof v === 'number' && Number.isInteger(v) ? v : null;
  }

  /** 사진의 읽기 상태 — 시도가 아직 없으면 none */
  function readState(doc) {
    return doc && doc.extraction && doc.extraction.status ? doc.extraction.status : 'none';
  }

  /** 읽을 때 돌린 각도 — 비서가 방향을 보고 돌려 읽은 사진(result.rotate, 시계 방향). 화면도 그만큼 돌리면 똑바로 */
  function readRotate(doc) {
    var r = readState(doc) === 'done' ? doc.extraction.result || {} : {};
    return [90, 180, 270].indexOf(r.rotate) >= 0 ? r.rotate : 0;
  }

  /** 보이는 각도 — 「사진 돌리기」로 고친 것이 먼저, 없으면 읽을 때 돌린 각도 */
  function rotOf(doc) {
    return Object.prototype.hasOwnProperty.call(L.rot, doc.id) ? L.rot[doc.id] : readRotate(doc);
  }

  /**
   * 다 읽은 사진의 경고 [{ key, text, level }] — 서버 힌트(중복 · 큰 금액 · 증빙 · 국세청 · 처음 거래처)와
   * 검사(checks) · 확실하지 않은 칸(unsure, 칸 이름으로). level: crit 빨강 · warn 노랑 · info 회색
   */
  function warningsOf(doc) {
    if (readState(doc) !== 'done') return [];
    var x = doc.extraction;
    var c = x.checks || {};
    var r = x.result || {};
    var h = doc.hints || {};
    var w = h.warnings || {};
    var out = [];
    if (w.duplicate)
      out.push({
        key: 'duplicate',
        level: 'crit',
        text:
          '중복 의심' +
          (w.duplicate.created_at
            ? ' — ' + stamp(w.duplicate.created_at) + ' 사진'
            : w.duplicate.on_date
              ? ' — ' + day(w.duplicate.on_date) + ' 장부 줄'
              : ''),
      });
    if (w.nts && (w.nts.status === 'closed' || w.nts.status === 'suspended'))
      out.push({ key: 'nts', level: 'crit', text: NTS_STATUS[w.nts.status] + ' 사업자' });
    if (w.large)
      out.push({ key: 'large', level: 'warn', text: '평소보다 큰 금액 (' + w.large.ratio + '배)' });
    if (w.evidence_risk)
      out.push({
        key: 'evidence',
        level: 'warn',
        text: '증빙 경고 — 3만원 넘는 간이영수증 · 명세표',
      });
    if (c.biz_no === 'bad')
      out.push({ key: 'biz_no', level: 'warn', text: '사업자번호 확인 필요' });
    if (c.amounts === 'mismatch' || c.items === 'mismatch')
      out.push({ key: 'amounts', level: 'warn', text: '금액 합이 안 맞음' });
    if (c.date && c.date !== 'ok') out.push({ key: 'date', level: 'warn', text: '날짜 확인' });
    if (c.multiple) out.push({ key: 'multiple', level: 'warn', text: '한 장씩 다시 찍기' });
    var unsure = (Array.isArray(r.unsure) ? r.unsure : []).map(function (k) {
      return FIELD_NAME[k] || k;
    });
    if (unsure.length)
      out.push({ key: 'unsure', level: 'warn', text: '확실하지 않음: ' + unsure.join(' · ') });
    if (h.first_time) out.push({ key: 'first', level: 'info', text: '처음 보는 거래처' });
    var route = h.invoice && h.invoice.route;
    if (route === 'ask')
      out.push({ key: 'invoice', level: 'info', text: '명세표 — 세금계산서를 따로 주는지 고르기' });
    if (route === 'hold')
      out.push({ key: 'invoice', level: 'info', text: '세금계산서 따로 받는 거래처 — 모아 두기' });
    return out;
  }

  /**
   * 읽은 칸 → 장부 줄 칸 (세무사 확인 전 기준). 공제되는 부가세 증빙에 공급가 · 부가세가 있으면
   * 금액 = 공급가 · 부가세 = 부가세, 아니면 금액 = 합계 · 부가세 0. 없는 칸은 비운다 (계산해서 채우지 않는다)
   */
  function prefillEntry(result) {
    var r = result || {};
    var supply = wholeWon(r.supply_amount);
    var vat = wholeWon(r.vat_amount);
    var deductible = DEDUCT_EVIDENCE.indexOf(r.evidence_type) >= 0 && supply > 0 && vat > 0;
    var items = (Array.isArray(r.items) ? r.items : []).filter(function (i) {
      return i && typeof i.name === 'string' && i.name.trim();
    });
    var desc = items.length
      ? items[0].name.trim() + (items.length > 1 ? ' 외 ' + (items.length - 1) + '건' : '')
      : '';
    return {
      entry_date: typeof r.issue_date === 'string' ? r.issue_date : '',
      direction: 'expense',
      account: '',
      description: desc.slice(0, 200),
      counterparty_name: typeof r.supplier_name === 'string' ? r.supplier_name.slice(0, 100) : '',
      counterparty_biz_no: typeof r.supplier_biz_no === 'string' ? r.supplier_biz_no : '',
      amount: deductible ? supply : wholeWon(r.total_amount),
      vat_amount: deductible ? vat : 0,
      evidence_type: EVIDENCE[r.evidence_type] ? r.evidence_type : '',
      payment_method: METHOD[r.payment_method] ? r.payment_method : '',
      deductible: deductible,
    };
  }

  /**
   * 시트에 채울 값 — 서버가 정한 올릴 값(hints.proposal: 기억 · AI 계정 제안 · 공제 증빙 규칙)이 먼저,
   * 없으면(서버가 힌트를 못 줌) 읽은 칸으로. 읽은 사업자번호가 검사에 걸려 서버 값이 비면 읽은 번호를 보여 고치게 한다
   */
  function prefillFor(doc) {
    if (readState(doc) !== 'done') return prefillEntry(null);
    var h = doc.hints;
    var r = doc.extraction.result || {};
    if (!h || !h.proposal) return prefillEntry(r);
    var p = h.proposal;
    return {
      entry_date: p.entry_date || '',
      direction: DIRECTION[p.direction] ? p.direction : 'expense',
      account: p.account || '',
      description: p.description || '',
      counterparty_name: p.counterparty_name || '',
      counterparty_biz_no:
        p.counterparty_biz_no || (typeof r.supplier_biz_no === 'string' ? r.supplier_biz_no : ''),
      amount: p.amount,
      vat_amount: p.vat_amount,
      evidence_type: EVIDENCE[p.evidence_type] ? p.evidence_type : '',
      payment_method: METHOD[p.payment_method] ? p.payment_method : '',
      deductible: !!h.deductible,
    };
  }

  /**
   * 꼭 볼 칸 표시 (순수) → { date | cp | amount | vat | account: { mark: ok | chk | '', why, tag } }.
   * 읽지 않은 사진은 표시하지 않는다(직접 적는다). ✓ = 확실하게 읽었고 검사도 맞음, chk = 한 번 볼 칸
   */
  function mustMarks(doc) {
    var out = {};
    ['date', 'cp', 'amount', 'vat', 'account'].forEach(function (k) {
      out[k] = { mark: '', why: '', tag: '' };
    });
    if (readState(doc) !== 'done') return out;
    var r = doc.extraction.result || {};
    var c = doc.extraction.checks || {};
    var h = doc.hints || {};
    var w = h.warnings || {};
    var src = h.sources || {};
    var p = prefillFor(doc);
    var unsure = Array.isArray(r.unsure) ? r.unsure : [];
    Object.keys(out).forEach(function (k) {
      out[k].mark = 'ok';
    });
    function chk(k, why) {
      if (out[k].mark === 'chk') return;
      out[k].mark = 'chk';
      out[k].why = why;
    }
    function shaky(k) {
      return (MUST_UNSURE[k] || []).some(function (f) {
        return unsure.indexOf(f) >= 0;
      });
    }
    // 일자
    if (shaky('date')) chk('date', 'AI 가 확실하지 않은 칸입니다');
    else if (c.date === 'future') chk('date', '앞날 날짜입니다');
    else if (c.date === 'too_old') chk('date', '5년 넘은 날짜입니다');
    if (!p.entry_date) chk('date', '날짜를 읽지 못했습니다');
    // 거래처
    if (w.nts && (w.nts.status === 'closed' || w.nts.status === 'suspended'))
      chk(
        'cp',
        '국세청 조회: ' +
          NTS_STATUS[w.nts.status] +
          (w.nts.closed_on ? ' (' + w.nts.closed_on + ')' : '')
      );
    if (shaky('cp')) chk('cp', 'AI 가 확실하지 않은 칸입니다');
    if (c.biz_no === 'bad') chk('cp', '사업자번호 검증 숫자가 맞지 않습니다 (더 보기)');
    if (!p.counterparty_name) chk('cp', '상호를 읽지 못했습니다');
    if (src.counterparty_name === 'memory') out.cp.tag = '지난번대로';
    else if (h.first_time) out.cp.tag = '처음';
    // 금액 · 부가세
    if (w.large)
      chk(
        'amount',
        '평소보다 큰 금액입니다 (최근 중앙값 ' +
          money(w.large.median) +
          '의 ' +
          w.large.ratio +
          '배)'
      );
    if (shaky('amount')) chk('amount', 'AI 가 확실하지 않은 칸입니다');
    if (c.amounts === 'mismatch') chk('amount', '공급가 + 부가세가 합계와 맞지 않습니다');
    if (c.items === 'mismatch') chk('amount', '품목 합이 금액과 맞지 않습니다');
    if (!(Number.isInteger(p.amount) && p.amount >= 1)) chk('amount', '금액을 읽지 못했습니다');
    if (shaky('vat')) chk('vat', 'AI 가 확실하지 않은 칸입니다');
    if (c.amounts === 'mismatch') chk('vat', '공급가 + 부가세가 합계와 맞지 않습니다');
    if (out.vat.mark === 'ok' && !p.deductible)
      out.vat.why = '공제 안 되는 증빙이라 0 — 합계를 금액에 적었습니다';
    // 계정
    if (src.account === 'memory') out.account.tag = '지난번대로';
    else if (src.account === 'ai') {
      out.account.tag = 'AI 제안';
      chk('account', 'AI 가 품목을 보고 고른 계정 — 맞는지 봐 주세요');
    }
    if (!p.account) chk('account', '계정을 골라 주세요');
    return out;
  }

  /** 바로 올려도 되는 사진 — 쓸 수 있고 서버가 ready 라 한 사진 (서버가 올릴 때 다시 센다) */
  function readyDocs() {
    if (!canWrite()) return [];
    return L.review.filter(function (d) {
      return readState(d) === 'done' && d.hints && d.hints.ready === true && d.hints.proposal;
    });
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = L.sb && (await L.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return L.session ? L.session.access_token : '';
  }

  /** → { ok, status, data, code, message } (끊김은 status 0). o.raw 는 바이트(Blob) 본문, o.note 는 X-Ledger-Note */
  async function api(path, opts) {
    var o = opts || {};
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (o.raw !== undefined) headers['Content-Type'] = o.raw.type || 'application/octet-stream';
    else if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.key) headers['X-Idempotency-Key'] = o.key;
    if (o.note) headers['X-Ledger-Note'] = encodeURIComponent(o.note);
    try {
      var res = await fetch(L.base + path, {
        method: o.method || 'GET',
        headers: headers,
        body:
          o.raw !== undefined ? o.raw : o.body === undefined ? undefined : JSON.stringify(o.body),
        cache: 'no-store',
      });
      var b = null;
      try {
        b = await res.json();
      } catch {
        b = null;
      }
      var good = res.ok && b && b.success === true;
      return {
        ok: !!good,
        status: res.status,
        data: good ? b.data : null,
        code: b && b.code ? b.code : '',
        message: b && b.message ? b.message : '',
      };
    } catch {
      return { ok: false, status: 0, data: null, code: '', message: '' };
    }
  }

  /** 보기 주소 — 남의 장부를 볼 때 ?company= */
  function withCompany(path) {
    if (!L.company) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'company=' + encodeURIComponent(L.company);
  }

  function canWrite() {
    return !!(L.me && L.me.can_write);
  }

  // ── 그리기 ─────────────────────────────────────────────
  function setState(text) {
    $('lgState').textContent = text || '';
  }

  function renderTax() {
    var tax = (L.me && L.me.tax) || {};
    $('lgVatType').value = tax.vat_type || '';
    $('lgBizKind').value = tax.business_kind || '';
    $('lgTaxNote').textContent = tax.vat_type
      ? VAT_TYPE[tax.vat_type] + (tax.business_kind ? ' · ' + BIZ_KIND[tax.business_kind] : '')
      : '과세 유형을 정해 주세요. 일반과세 업체만 받은 돈을 공급가 · 부가세로 나눠 보입니다.';
    var w = canWrite();
    $('lgVatType').disabled = !w;
    $('lgBizKind').disabled = !w;
    $('lgTaxSave').hidden = !w;
  }

  function renderSummary() {
    var t = (L.data && L.data.totals) || {};
    var side = BOOK_TABS[L.tab] ? L.tab : '';
    var items = sideSummary(side, t) || [
      ['수입', money(t.income)],
      ['비용', money(t.expense)],
      [
        '장부 손익',
        t.income == null ? '-' : money((Number(t.income) || 0) - (Number(t.expense) || 0)),
      ],
      ['받은 부가세', money(t.income_vat)],
      ['낸 부가세', money(t.expense_vat)],
    ];
    if (Number(t.asset_buy) || Number(t.asset_sell)) {
      items.push(['자산 사기', money(t.asset_buy)], ['자산 팔기', money(t.asset_sell)]);
    }
    $('lgSum').innerHTML = items
      .map(function (x) {
        return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>';
      })
      .join('');
    var notes = [];
    if (Number(t.vat_unknown) > 0) {
      notes.push(
        '부가세를 모르는 줄 ' +
          t.vat_unknown +
          '개 — 부가세 칸이 생기기 전 원가 줄(적힌 금액이 부가세 포함 합계 — 공제 부가세에 넣지 않았습니다)이거나, 일반과세가 아닌 업체의 수금입니다.'
      );
    }
    if (Number(t.account_unknown) > 0) {
      notes.push('계정이 정해지지 않은 원가 줄 ' + t.account_unknown + '개 (노무 · 외주).');
    }
    $('lgSumNote').textContent = notes.join(' ');
    $('lgSumNote').hidden = !notes.length;
    $('lgMonth').textContent = monthLabel(L.month);
    $('lgReportLink').href = withCompany(
      'ledger-report.html?month=' + encodeURIComponent(L.month || thisMonth())
    );
    $('lgNext').disabled = L.busy || L.month >= thisMonth();
    $('lgPrev').disabled = L.busy;
  }

  /** 매출 · 매입 판의 달 요약 — 그 쪽 공급가 · 부가세 · 합계 (자산은 있을 때만) */
  function sideSummary(side, t) {
    if (side === 'sales')
      return [
        ['매출 (공급가)', money(t.income)],
        ['받은 부가세', money(t.income_vat)],
        ['합계', money((Number(t.income) || 0) + (Number(t.income_vat) || 0))],
      ].concat(Number(t.asset_sell) ? [['자산 팔기', money(t.asset_sell)]] : []);
    if (side === 'buys')
      return [
        ['매입 (공급가)', money(t.expense)],
        ['낸 부가세', money(t.expense_vat)],
        ['합계', money((Number(t.expense) || 0) + (Number(t.expense_vat) || 0))],
      ].concat(Number(t.asset_buy) ? [['자산 사기', money(t.asset_buy)]] : []);
    return null;
  }

  function accountName(code) {
    for (var i = 0; i < L.accounts.length; i++)
      if (L.accounts[i].code === code) return L.accounts[i].name;
    return code ? code : '계정 미정';
  }

  function itemHtml(row) {
    var voided = !!row.voided_at;
    var sign = isIn(row.direction) ? '+' : '−';
    var vat =
      row.vat_amount == null
        ? '부가세 모름'
        : '부가세 ' + money(row.vat_amount) + (row.vat_computed ? ' (계산값)' : '');
    var meta = [vat, row.evidence_type ? EVIDENCE[row.evidence_type] || row.evidence_type : '']
      .filter(Boolean)
      .join(' · ');
    var acts = '';
    if (row.source === 'entry' && !voided && canWrite()) {
      acts =
        L.voiding === row.id
          ? '<div class="lg-void"><input type="text" maxlength="300" aria-label="취소 이유" placeholder="취소 이유 · 필수" data-void-reason />' +
            '<button type="button" class="mk-btn" data-act="void-ok" data-id="' +
            esc(row.id) +
            '">취소하기</button>' +
            '<button type="button" class="mk-link" data-act="void-no">그만</button></div>'
          : '<div class="lg-item-acts"><button type="button" class="mk-link" data-act="edit" data-id="' +
            esc(row.id) +
            '">고치기</button>' +
            '<button type="button" class="mk-link" data-act="void" data-id="' +
            esc(row.id) +
            '">취소</button></div>';
    }
    return (
      '<li class="lg-item' +
      (voided ? ' lg-item--void' : '') +
      '" data-source="' +
      esc(row.source) +
      '" data-id="' +
      esc(row.id) +
      '">' +
      '<span class="lg-line"><span class="lg-main"><b>' +
      esc(accountName(row.account)) +
      '</b>' +
      '<small>' +
      esc(
        [day(row.entry_date), SOURCE[row.source] || row.source, rowText(row)]
          .filter(Boolean)
          .join(' · ')
      ) +
      '</small></span>' +
      '<span class="lg-amt' +
      (isIn(row.direction) ? ' lg-amt--in' : '') +
      '">' +
      sign +
      esc(money(row.amount)) +
      '</span></span>' +
      '<small class="lg-meta">' +
      esc(meta) +
      (voided ? ' · 취소한 줄' : '') +
      '</small>' +
      acts +
      '</li>'
    );
  }

  /** 매출 · 매입 판 — 거름 · 표(또는 매입처별) · 서랍의 고른 줄 (ledger-book.js) */
  function renderList() {
    var side = BOOK_TABS[L.tab] ? L.tab : '';
    var Book = window.SeganLedgerBook;
    renderBookBar(side);
    var box = $('lgBkTable');
    box.textContent = '';
    if (side && Book) {
      var rows = Book.rowsFor((L.data && L.data.rows) || [], side, {
        showVoid: L.showVoid,
        source: L.bk.source,
        query: L.bk.query,
      });
      box.appendChild(
        side === 'buys' && L.bk.group
          ? Book.supplierTable(Book.bySupplier(rows))
          : Book.bookTable(rows, {
              accountName: accountName,
              evidenceName: function (c) {
                return EVIDENCE[c] || c;
              },
              selected: L.bk.selected,
            })
      );
    }
    renderPicked();
  }

  /** 거름 단추 · 매입처별 · 넣기 단추 */
  function renderBookBar(side) {
    var Book = window.SeganLedgerBook;
    var seg = $('lgBkSrc');
    seg.textContent = '';
    $('lgBkGroup').hidden = side !== 'buys';
    $('lgBkGroup').setAttribute('aria-pressed', L.bk.group ? 'true' : 'false');
    $('lgAdd').textContent = side === 'sales' ? '+ 매출' : '+ 매입';
    if (!side || !Book) return;
    Book.SIDES[side].sources.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lg-seg-btn';
      b.setAttribute('data-src', s[0]);
      b.setAttribute('aria-pressed', L.bk.source === s[0] ? 'true' : 'false');
      b.textContent = s[1];
      seg.appendChild(b);
    });
  }

  /** 서랍에 연 줄 (모든 출처) */
  function pickedRow() {
    var rows = (L.data && L.data.rows) || [];
    for (var i = 0; i < rows.length; i++)
      if (L.bk.selected && rows[i].id === L.bk.selected) return rows[i];
    return null;
  }

  /** 서랍 — 고른 줄 (고치기 · 취소는 직접 넣은 줄만, 수금 · 원가는 ERP) · 넣기 · 고치기 칸 */
  function renderPicked() {
    var row = pickedRow();
    var note =
      row && row.source !== 'entry'
        ? '<li class="lg-erp">' +
          esc(
            (row.source === 'payment' ? '수금' : '수주 원가') +
              ' 줄은 ERP에서 고칩니다' +
              (row.order_no ? ' (주문 ' + row.order_no + ')' : '')
          ) +
          ' <a class="mk-link" href="../erp.html">ERP 열기</a></li>'
        : '';
    $('lgList').innerHTML = row ? itemHtml(row) + note : '';
    $('lgList').hidden = !row || !!L.form;
    $('lgDrawer').hidden = !row && !L.form;
    if (row && !L.form) $('lgFormTitle').textContent = '줄 보기';
  }

  function closeDrawer() {
    L.bk.selected = '';
    L.voiding = '';
    closeForm();
    renderList();
  }

  /** 받을 돈(매출) · 낼 돈(매입) — 수주 일정. 장부 서버가 모르면(아직 배포 전) 상자를 감춘다 */
  async function loadMoney(side) {
    var key = side === 'sales' ? 'receivables' : 'payables';
    if (!(key in L.money)) {
      L.money[key] = null;
      var r = await api(withCompany('/ledger/' + key));
      L.money[key] = r.ok && r.data ? r.data : false;
    }
    renderMoney();
  }

  function renderMoney() {
    var side = BOOK_TABS[L.tab] ? L.tab : '';
    var d = side ? L.money[side === 'sales' ? 'receivables' : 'payables'] : null;
    $('lgMoney').hidden = !d;
    if (!d || !window.SeganLedgerBook) return;
    $('lgMoneyTitle').textContent = side === 'sales' ? '받을 돈' : '낼 돈';
    $('lgMoneySum').textContent =
      money(d.total) +
      ' · ' +
      (d.count || 0) +
      '건' +
      (d.late_count ? ' · 늦음 ' + money(d.late_total) : '');
    window.SeganLedgerBook.moneyList(
      $('lgMoneyList'),
      d,
      side === 'sales' ? 'in' : 'out',
      function (s) {
        return PAY_STAGE[s] || s;
      }
    );
  }

  function render() {
    renderSummary();
    renderList();
    $('lgAdd').hidden = !canWrite();
    $('lgReadonly').hidden = !(L.me && L.me.level === 'read');
    $('lgReadonly').textContent =
      L.me && L.me.viewing
        ? (ledgerName(L.me.company_id) || '이') + ' 장부 — 보기만 합니다.'
        : '지금 등급에서는 장부를 보기만 할 수 있습니다.';
  }

  function ledgerName(id) {
    var list = (L.me && L.me.ledgers) || [];
    for (var i = 0; i < list.length; i++) if (list[i].company_id === id) return list[i].name || '';
    return '';
  }

  /** 장부 고르기 — 여는 장부가 둘 이상일 때만 */
  function renderSwitch() {
    var list = ((L.me && L.me.ledgers) || []).filter(function (x) {
      return x && x.company_id;
    });
    $('lgSwitch').hidden = list.length < 2;
    $('lgCompany').innerHTML = list
      .map(function (x) {
        return (
          '<option value="' +
          esc(x.company_id) +
          '">' +
          esc(x.name || x.company_id) +
          (x.own ? '' : ' (보기만)') +
          '</option>'
        );
      })
      .join('');
    $('lgCompany').value = L.me.company_id;
  }

  // ── 탭 ─────────────────────────────────────────────────
  /** 회계 한눈에 (ledger-board.js) — 이 화면의 토큰 · 주소 · 본사 보기 · 계정 이름 · 달을 넘긴다 */
  function board() {
    var b = window.SeganLedgerBoard;
    return b && typeof b.mount === 'function' ? b : null;
  }

  function mountBoard() {
    var b = board();
    if (!b) return;
    var names = {};
    L.accounts.forEach(function (a) {
      names[a.code] = a.name;
    });
    b.mount({
      sb: L.sb,
      session: L.session,
      base: L.base,
      company: L.company,
      names: names,
      // 막대를 누르면 화면 전체의 달을 바꾼다
      onMonth: function (month) {
        if (!L.busy && month <= thisMonth()) loadBook(month);
      },
    });
  }

  /** 탭 열기 — 판을 바꾸고 아직 안 그린 한눈에는 그린다 */
  async function showTab(tab) {
    if (TABS.indexOf(tab) < 0) tab = 'board';
    L.tab = tab;
    [].forEach.call(document.querySelectorAll('#lgTabs [data-tab]'), function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    Object.keys(PANE).forEach(function (k) {
      $(PANE[k]).hidden = PANE[k] !== PANE[tab];
    });
    $('lgHeldWrap').hidden = tab !== 'buys';
    var only = BOOK_TABS[tab];
    if (only) {
      L.bk = { source: 'all', query: '', group: false, selected: '' };
      L.voiding = '';
      $('lgBkFind').value = '';
      closeForm();
      $('lgBookTitle').textContent = only.title;
      $('lgPaneBook').setAttribute('aria-labelledby', 'lgTab-' + tab);
      renderSummary();
      renderList();
      await loadMoney(tab);
    }
    if (tab === 'board' && board()) await board().show(L.month);
  }

  /** 월초(1~MONTH_CARD_DAYS 일) — 한눈에 위에 지난달 보고서 카드 */
  function renderMonthCard() {
    var k = new Date(Date.now() + 9 * 3600 * 1000);
    var card = $('lgMonthCard');
    card.hidden = k.getUTCDate() > MONTH_CARD_DAYS;
    if (card.hidden) return;
    var prev = shiftMonth(thisMonth(), -1);
    card.textContent = monthLabel(prev) + ' 회계 보고서가 나왔습니다 — 보고서 보기 ›';
    card.href = withCompany('ledger-report.html?month=' + prev);
  }

  // ── 내보내기 (세무사용 CSV) ─────────────────────────────
  /** 파일 받기 — 시험이 바꿔 낀다 (SeganLedger.files) */
  var files = {
    save: function (name, text) {
      var blob = new window.Blob([text], { type: 'text/csv;charset=utf-8' });
      var url = window.URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () {
        window.URL.revokeObjectURL(url);
      }, 1000);
    },
  };

  /** 내보낼 기간 → { from, to } | { error } */
  function exportRange() {
    var m = L.month || thisMonth();
    if (L.exportRange === 'month') return { from: m + '-01', to: m + '-' + lastDay(m) };
    if (L.exportRange === 'half') {
      var y = m.slice(0, 4);
      return Number(m.slice(5)) <= 6
        ? { from: y + '-01-01', to: y + '-06-30' }
        : { from: y + '-07-01', to: y + '-12-31' };
    }
    var from = $('lgExFrom').value;
    var to = $('lgExTo').value;
    if (!from || !to) return { error: '시작 · 끝 날짜를 골라 주세요.' };
    if (from > to) return { error: '시작이 끝보다 늦습니다.' };
    var days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000 + 1;
    if (days > EXPORT_MAX_DAYS)
      return { error: '한 번에 ' + EXPORT_MAX_DAYS + '일까지 받습니다. 기간을 나눠 받아 주세요.' };
    return { from: from, to: to };
  }

  /** 'YYYY-MM' 의 마지막 날 'DD' */
  function lastDay(month) {
    var p = month.split('-').map(Number);
    return String(new Date(Date.UTC(p[0], p[1], 0)).getUTCDate()).padStart(2, '0');
  }

  function exError(text) {
    $('lgExError').textContent = text || '';
    $('lgExError').hidden = !text;
  }

  function renderExport() {
    [].forEach.call($('lgExRange').querySelectorAll('[data-range]'), function (b) {
      b.setAttribute(
        'aria-pressed',
        b.getAttribute('data-range') === L.exportRange ? 'true' : 'false'
      );
    });
    $('lgExCustom').hidden = L.exportRange !== 'custom';
    var rg = exportRange();
    $('lgExPeriod').textContent = rg.error ? '' : '기간 ' + rg.from + ' ~ ' + rg.to;
  }

  function openExport() {
    L.exportRange = 'month';
    exError('');
    renderExport();
    $('lgExport').hidden = false;
  }

  /** 그 기간 장부를 받아(같은 기간이면 다시 묻지 않는다) CSV 하나를 내려받는다 */
  async function downloadCsv(kind) {
    var rg = exportRange();
    if (rg.error) return exError(rg.error);
    exError('');
    var key = rg.from + '~' + rg.to + '~' + L.company;
    if (!L.exportCache || L.exportCache.key !== key) {
      var r = await api(withCompany('/ledger/book?from=' + rg.from + '&to=' + rg.to));
      if (!r.ok) return exError(r.message || '장부를 불러오지 못했습니다.');
      L.exportCache = { key: key, rows: (r.data && r.data.rows) || [] };
    }
    var Book = window.SeganLedgerBook;
    var out = Book.csvFiles(L.exportCache.rows, {
      accountName: accountName,
      evidenceName: function (c) {
        return EVIDENCE[c] || c;
      },
      stageName: function (s) {
        return PAY_STAGE[s] || s;
      },
    });
    var name = { sales: '매출장', buys: '매입장', accounts: '계정별합계' }[kind];
    var who = (ledgerName(L.me && L.me.company_id) || '회계').replace(/[\\/:*?"<>|\s]+/g, '');
    files.save(who + '_' + name + '_' + rg.from + '_' + rg.to + '.csv', Book.toCsv(out[kind]));
    setState(name + ' 파일을 받았습니다.');
  }

  /** 처음 여는 탭 — 주소 #탭, 없으면 한눈에 */
  function firstTab() {
    var h = String(location.hash || '').replace(/^#/, '');
    return TABS.indexOf(h) >= 0 ? h : 'board';
  }

  /** 사진 탭 옆 수 — 확인할 사진 */
  function renderTabCount() {
    var n = $('lgTabPhotosN');
    n.hidden = !L.review.length;
    n.textContent = L.review.length + (L.reviewMore ? '+' : '');
  }

  // ── 입력 칸 ────────────────────────────────────────────
  function fillAccounts(direction, selected) {
    var list = accountsFor(L.accounts, direction);
    $('lgAccount').innerHTML = list
      .map(function (a) {
        return (
          '<option value="' +
          esc(a.code) +
          '">' +
          esc(a.name + (a.note ? ' (' + a.note + ')' : '')) +
          '</option>'
        );
      })
      .join('');
    if (
      selected &&
      list.some(function (a) {
        return a.code === selected;
      })
    )
      $('lgAccount').value = selected;
  }

  function fillSelect(id, labels, blank) {
    $(id).innerHTML =
      (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
      Object.keys(labels)
        .map(function (k) {
          return '<option value="' + k + '">' + esc(labels[k]) + '</option>';
        })
        .join('');
  }

  function formError(text) {
    $('lgFormError').textContent = text || '';
    $('lgFormError').hidden = !text;
  }

  function openForm(mode, row) {
    L.form = { mode: mode, row: row || null, key: newKey() };
    var r = row || {};
    $('lgFormTitle').textContent =
      mode === 'correct'
        ? '장부 줄 고치기'
        : L.tab === 'sales'
          ? '매출 넣기'
          : L.tab === 'buys'
            ? '매입 넣기'
            : '직접 입력';
    $('lgDate').value = r.entry_date || today();
    $('lgDir').value = r.direction || (BOOK_TABS[L.tab] ? BOOK_TABS[L.tab].dir : 'expense');
    fillAccounts($('lgDir').value, r.account);
    $('lgDesc').value = r.description || '';
    $('lgCpName').value = r.counterparty_name || '';
    $('lgCpBiz').value = '';
    $('lgAmount').value = r.amount == null ? '' : r.amount;
    $('lgVat').value = r.vat_amount == null ? '' : r.vat_amount;
    $('lgEvidence').value = r.evidence_type || '';
    $('lgMethod').value = '';
    $('lgReason').value = '';
    $('lgReasonRow').hidden = mode !== 'correct';
    formError('');
    $('lgForm').hidden = false;
    $('lgList').hidden = true;
    $('lgDrawer').hidden = false;
  }

  function closeForm() {
    L.form = null;
    L.attachAfter = null;
    $('lgForm').hidden = true;
    formError('');
    renderPicked();
  }

  /** 입력 칸 값 → 보낼 칸 (틀리면 { error }) */
  function formValues() {
    var amount = Number($('lgAmount').value);
    var vatText = $('lgVat').value;
    var vat = vatText === '' ? 0 : Number(vatText);
    if (!$('lgDate').value) return { error: '일자를 적어 주세요.' };
    if (!$('lgAccount').value) return { error: '계정을 골라 주세요.' };
    if (!(Number.isInteger(amount) && amount >= 1))
      return { error: '금액을 1원 이상 정수로 적어 주세요.' };
    if (!(Number.isInteger(vat) && vat >= 0))
      return { error: '부가세는 0 이상 정수로 적어 주세요.' };
    if (!$('lgEvidence').value) return { error: '증빙을 골라 주세요.' };
    return {
      values: {
        entry_date: $('lgDate').value,
        direction: $('lgDir').value,
        account: $('lgAccount').value,
        description: $('lgDesc').value.trim() || null,
        counterparty_name: $('lgCpName').value.trim() || null,
        counterparty_biz_no: $('lgCpBiz').value.trim() || null,
        amount: amount,
        vat_amount: vat,
        evidence_type: $('lgEvidence').value,
        payment_method: $('lgMethod').value || null,
      },
    };
  }

  async function submitForm(e) {
    if (e) e.preventDefault();
    if (!L.form || L.busy) return;
    var got = formValues();
    if (got.error) return formError(got.error);
    var r;
    L.busy = true;
    $('lgSave').disabled = true;
    if (L.form.mode === 'correct') {
      var reason = $('lgReason').value.trim();
      var patch = diffPatch(L.form.row, got.values);
      if (!reason) r = { ok: false, message: '고치는 이유를 적어 주세요.' };
      else if (!Object.keys(patch).length) r = { ok: false, message: '바뀐 칸이 없습니다.' };
      else {
        patch.reason = reason;
        r = await api('/ledger/entries/' + encodeURIComponent(L.form.row.id) + '/correct', {
          method: 'POST',
          body: patch,
        });
      }
    } else {
      r = await api('/ledger/entries', { method: 'POST', body: got.values, key: L.form.key });
    }
    L.busy = false;
    $('lgSave').disabled = false;
    if (!r.ok) return formError(r.message || '저장하지 못했습니다.');
    var after = L.form.mode === 'create' ? L.attachAfter : null;
    closeForm();
    await loadBook(L.month);
    // 「세금계산서 줄 넣고 붙이기」 — 방금 넣은 줄로 붙이기 창을 다시 연다
    if (after && r.data && r.data.entry && r.data.entry.id) openAttach(after, r.data.entry.id);
  }

  // ── 읽기 · 행동 ─────────────────────────────────────────
  async function loadBook(month) {
    L.busy = true;
    renderSummary();
    var r = await api(
      withCompany('/ledger/book?month=' + encodeURIComponent(month) + '&include_void=1')
    );
    L.busy = false;
    L.month = month;
    L.data = r.ok ? r.data : { rows: [], totals: {} };
    setState(r.ok ? '' : FAIL_MSG);
    render();
    if (L.tab === 'board' && board()) await board().show(month);
  }

  async function saveTax() {
    var vatType = $('lgVatType').value;
    var bizKind = $('lgBizKind').value;
    if (!vatType || !bizKind) return setState('과세 유형과 업종을 모두 골라 주세요.');
    var r = await api('/ledger/settings', {
      method: 'PUT',
      body: { vat_type: vatType, business_kind: bizKind },
    });
    if (!r.ok) return setState(r.message || '설정을 저장하지 못했습니다.');
    L.me.tax = r.data;
    renderTax();
    setState('과세 설정을 저장했습니다.');
    await loadBook(L.month);
  }

  async function voidRow(id) {
    var input = document.querySelector('[data-void-reason]');
    var reason = input ? input.value.trim() : '';
    if (!reason) return setState('취소 이유를 적어 주세요.');
    var r = await api('/ledger/entries/' + encodeURIComponent(id) + '/void', {
      method: 'POST',
      body: { reason: reason },
    });
    if (!r.ok) return setState(r.message || '취소하지 못했습니다.');
    L.voiding = '';
    setState('그 줄을 취소했습니다. 「취소한 줄도 보기」로 볼 수 있습니다.');
    await loadBook(L.month);
  }

  // ── 사진 ───────────────────────────────────────────────
  /** 기다리기 — 시험이 바꿔 낀다 (SeganLedger.timer) */
  var timer = {
    sleep: function (ms) {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, ms);
      });
    },
  };

  /** 기기에서 열기 · JPEG 로 다시 그리기 — 시험이 바꿔 낀다 (SeganLedger.media) */
  var media = {
    /** → Promise<{ source, width, height, release() }> — 못 열면 거절 */
    decode: function (file) {
      return new Promise(function (resolve, reject) {
        var url = window.URL.createObjectURL(file);
        var img = new window.Image();
        img.onload = function () {
          resolve({
            source: img,
            width: img.naturalWidth,
            height: img.naturalHeight,
            release: function () {
              window.URL.revokeObjectURL(url);
            },
          });
        };
        img.onerror = function () {
          window.URL.revokeObjectURL(url);
          reject(new Error('decode'));
        };
        img.src = url;
      });
    },
    /** → Promise<Blob | null> — 흰 바탕에 그린 JPEG (EXIF 는 따라오지 않는다) */
    encode: function (source, width, height) {
      return new Promise(function (resolve) {
        var c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        var ctx = c.getContext && c.getContext('2d');
        if (!ctx || !c.toBlob) return resolve(null);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(source, 0, 0, width, height);
        c.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
      });
    },
  };

  /** 사진 하나 → { blob } | { error } */
  async function preparePhoto(file) {
    var img = null;
    try {
      img = await media.decode(file);
    } catch {
      return { error: isHeic(file) ? HEIC_MSG : OPEN_FAIL_MSG };
    }
    try {
      if (!img || !(img.width > 0 && img.height > 0)) return { error: OPEN_FAIL_MSG };
      var size = fitSize(img.width, img.height);
      var blob = await media.encode(img.source, size.width, size.height);
      if (!blob || !blob.size) return { error: '사진을 JPEG로 바꾸지 못했습니다.' };
      if (blob.size > PHOTO_MAX_BYTES) return { error: '사진이 5MB를 넘습니다.' };
      return { blob: blob };
    } catch {
      return { error: '사진을 JPEG로 바꾸지 못했습니다.' };
    } finally {
      if (img && img.release) img.release();
    }
  }

  function canUpload() {
    return !!(L.me && L.me.can_upload);
  }

  function retryable(x) {
    return x.status === 'fail' && !x.final;
  }

  function renderUp() {
    var n = function (s) {
      return L.up.filter(function (x) {
        return x.status === s;
      }).length;
    };
    var text = '';
    if (L.uploading && L.upWait) {
      text =
        L.upAt +
        1 +
        ' / ' +
        L.up.length +
        '장 — 1분에 올릴 수 있는 장수를 넘어 잠시 쉬었다가 이어 올립니다. 화면을 켜 두세요.';
    } else if (L.uploading) {
      text = L.upAt + 1 + ' / ' + L.up.length + '장 올리는 중…';
    } else if (L.up.length) {
      text = [
        n('done') ? n('done') + '장 올림' : '',
        n('same') ? n('same') + '장은 이미 올린 사진' : '',
        n('fail') ? n('fail') + '장 못 올림' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    $('lgUpState').textContent = text;
    $('lgUpFail').innerHTML = L.up
      .filter(function (x) {
        return x.status === 'fail';
      })
      .map(function (x) {
        return '<li><b>' + esc(x.name) + '</b> — ' + esc(x.msg) + '</li>';
      })
      .join('');
    $('lgRetry').hidden = L.uploading || !L.up.some(retryable);
    $('lgShoot').disabled = L.uploading;
    $('lgPick').disabled = L.uploading;
  }

  /** 기다리는 사진을 한 장씩 — 다듬고 올린다 */
  async function runQueue() {
    if (L.uploading) return;
    L.uploading = true;
    for (var i = 0; i < L.up.length; i++) {
      var item = L.up[i];
      if (item.status !== 'wait') continue;
      L.upAt = i;
      if (!item.blob) {
        item.status = 'prep';
        renderUp();
        var p = await preparePhoto(item.file);
        item.file = null;
        if (p.error) {
          item.status = 'fail';
          item.msg = p.error;
          item.final = true;
          continue;
        }
        item.blob = p.blob;
      }
      item.status = 'send';
      renderUp();
      var r = await api('/ledger/documents', {
        method: 'POST',
        raw: item.blob,
        key: item.key,
        note: item.note,
      });
      if (r.ok) {
        item.status = r.data && r.data.reused ? 'same' : 'done';
        item.blob = null;
        continue;
      }
      if (r.status === 429 && r.code === 'rate_limited') {
        // 분 한도 — 쉬었다가 이 사진부터 이어 올린다 (같은 키 · 처음 그린 JPEG 그대로)
        item.status = 'wait';
        L.upWait = true;
        renderUp();
        await timer.sleep(RESUME_MS);
        L.upWait = false;
        i -= 1;
        continue;
      }
      item.status = 'fail';
      item.msg = r.message || (r.status === 0 ? '연결이 끊겼습니다.' : '올리지 못했습니다.');
      // 형식 · 크기로 거절된 사진은 다시 올려도 같다
      item.final = r.status === 413 || r.status === 422;
      if (r.status === 429) {
        // 하루 한도 — 남은 사진은 멈춰 두고 「다시 올리기」로
        for (var j = i + 1; j < L.up.length; j++) {
          if (L.up[j].status !== 'wait') continue;
          L.up[j].status = 'fail';
          L.up[j].msg = item.msg;
        }
        break;
      }
    }
    L.uploading = false;
    renderUp();
    // 대표 · 실장은 방금 올린 사진도 확인할 사진에 보인다
    if (L.me && L.me.money) await loadReview();
    await loadDocs();
  }

  /** 고른 사진을 줄에 — 멈춰 둔 사진도 함께 다시 올린다. 메모는 그때 칸 값 */
  function addPhotos(files) {
    var list = [].slice.call(files || []);
    if (!list.length || L.uploading || !canUpload()) return;
    var note = $('lgNote').value.trim();
    L.up = L.up
      .filter(retryable)
      .map(function (x) {
        x.status = 'wait';
        x.msg = '';
        return x;
      })
      .concat(
        list.map(function (f) {
          return {
            name: f.name || '사진',
            file: f,
            blob: null,
            key: newKey(),
            note: note,
            status: 'wait',
            msg: '',
            final: false,
          };
        })
      );
    return runQueue();
  }

  function retryUp() {
    if (L.uploading) return;
    L.up = L.up.filter(retryable).map(function (x) {
      x.status = 'wait';
      x.msg = '';
      return x;
    });
    return runQueue();
  }

  function docHtml(d) {
    var money = !!(L.me && L.me.money);
    var status = money ? d.review_status : d.status;
    var label = (money ? DOC_STATUS[status] : STAFF_STATUS[status]) || status;
    var why = money ? d.decision_reason : d.reason;
    var text = [
      money ? d.note : '',
      why && (status === 'returned' || status === 'rejected') ? '이유: ' + why : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      '<li class="lg-doc" data-status="' +
      esc(status) +
      '"><span class="lg-doc-line"><span>' +
      esc(stamp(d.created_at)) +
      '</span><b>' +
      esc(label) +
      '</b></span>' +
      (text ? '<small>' + esc(text) + '</small>' : '') +
      '</li>'
    );
  }

  function renderDocs() {
    $('lgDocs').innerHTML = L.docs.length
      ? L.docs.map(docHtml).join('')
      : '<li class="lg-empty">올린 사진이 없습니다.</li>';
    $('lgDocsMore').hidden = !L.docsMore;
  }

  /** 올린 사진 — 새것부터, 더 보기는 마지막 사진보다 앞선 것 */
  async function loadDocs(more) {
    var last = more && L.docs.length ? L.docs[L.docs.length - 1].created_at : '';
    var r = await api(
      withCompany(
        '/ledger/documents?limit=' +
          DOCS_PAGE +
          docsStatus() +
          (last ? '&before=' + encodeURIComponent(last) : '')
      )
    );
    if (!r.ok) {
      $('lgDocs').innerHTML = '<li class="lg-empty">올린 사진을 불러오지 못했습니다.</li>';
      $('lgDocsMore').hidden = true;
      return;
    }
    var got = (r.data && r.data.items) || [];
    L.docs = last ? L.docs.concat(got) : got;
    L.docsMore = got.length === DOCS_PAGE;
    renderDocs();
  }

  function renderPhotosBox() {
    var money = !!(L.me && L.me.money);
    $('lgPhotos').hidden = false;
    $('lgUp').hidden = !canUpload();
    $('lgPhotosNote').textContent = !money
      ? '올린 사진은 대표 · 실장이 확인해 장부에 올립니다. 금액은 대표 · 실장만 봅니다.'
      : noAi()
        ? '올린 사진은 아래 「확인할 사진」에서 칸을 직접 적어 장부에 올립니다.'
        : '올린 사진은 Claude가 읽어 칸을 채웁니다. 아래 「확인할 사진」에서 칸을 확인한 뒤 장부에 올립니다.';
    $('lgPhChips').hidden = !money;
    $('lgDocsBox').hidden = money && L.ph === 'pending';
    if (!money) $('lgDocsTitle').textContent = '올린 사진';
    if (money) renderPhChips();
  }

  /** 사진 AI 읽기를 쓰지 않는 업체 (Expert — 워커 /ledger/me ai false). ai 를 주지 않는 서버면 지금처럼 */
  function noAi() {
    return !!(L.me && L.me.ai === false);
  }

  /** 올린 사진을 상태로 거를 때 붙이는 주소 칸 (대표 · 실장, 확인 기다림 · 전체는 거르지 않는다) */
  function docsStatus() {
    var ph = L.me && L.me.money ? L.ph : '';
    return ph && ph !== 'pending' && ph !== 'all' ? '&status=' + encodeURIComponent(ph) : '';
  }

  /** 사진 상태 거름 단추 — 확인 기다림 옆에 수 */
  function renderPhChips() {
    var seg = $('lgPhChips');
    seg.textContent = '';
    PH_FILTERS.forEach(function (f) {
      var n =
        f[0] === 'pending' && L.review.length
          ? ' ' + L.review.length + (L.reviewMore ? '+' : '')
          : '';
      var b = el('button', 'lg-seg-btn', f[1] + n);
      b.type = 'button';
      b.setAttribute('data-ph', f[0]);
      b.setAttribute('aria-pressed', L.ph === f[0] ? 'true' : 'false');
      seg.appendChild(b);
    });
  }

  /** 사진 상태 거름 바꾸기 — 확인 기다림은 확인할 사진 상자, 나머지는 그 상태의 올린 사진 */
  async function showPh(ph) {
    L.ph = ph;
    renderPhChips();
    $('lgReview').hidden = ph !== 'pending';
    $('lgDocsBox').hidden = ph === 'pending';
    if (ph === 'pending') return;
    var name = PH_FILTERS.filter(function (f) {
      return f[0] === ph;
    })[0];
    $('lgDocsTitle').textContent = '올린 사진 — ' + (name ? name[1] : ph);
    await loadDocs();
  }

  function bindPhotos() {
    $('lgShoot').addEventListener('click', function () {
      $('lgCamera').click();
    });
    $('lgPick').addEventListener('click', function () {
      $('lgFiles').click();
    });
    ['lgCamera', 'lgFiles'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var files = [].slice.call($(id).files || []);
        $(id).value = ''; // 같은 사진을 다시 고를 수 있게
        addPhotos(files);
      });
    });
    $('lgRetry').addEventListener('click', retryUp);
    $('lgDocsMore').addEventListener('click', function () {
      loadDocs(true);
    });
  }

  // ── 사진 확인 (대표 · 실장) ─────────────────────────────
  /** 글자만 넣는 칸 하나 (자료 글은 textContent 로만) */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function safePhotoUrl(u) {
    return typeof u === 'string' && /^https:\/\//.test(u) ? u : '';
  }

  function reviewById(id) {
    for (var i = 0; i < L.review.length; i++) if (L.review[i].id === id) return L.review[i];
    return null;
  }

  function chipsInto(box, doc) {
    box.textContent = '';
    warningsOf(doc).forEach(function (w) {
      var c = el('span', 'lg-chip lg-chip--' + w.level, w.text);
      c.setAttribute('data-warn', w.key);
      box.appendChild(c);
    });
  }

  /** 목록 한 줄의 읽은 요약 — 상호 · 합계 */
  function readSummary(doc) {
    if (readState(doc) !== 'done') return '';
    var r = doc.extraction.result || {};
    return [r.supplier_name, r.total_amount != null ? money(r.total_amount) : '']
      .filter(Boolean)
      .join(' · ');
  }

  /** 바로 올려도 되는 사진 한 줄의 값 — 일자 · 거래처 / 금액 + 부가세 · 계정 */
  function readyLines(doc) {
    var p = doc.hints.proposal;
    return [
      [day(p.entry_date), p.counterparty_name].filter(Boolean).join(' · '),
      money(p.amount) +
        (p.vat_amount ? ' + 부가세 ' + money(p.vat_amount) : '') +
        ' · ' +
        accountName(p.account),
    ];
  }

  function reviewItem(doc, ready) {
    var state = readState(doc);
    var li = el('li', 'lg-rv');
    li.setAttribute('data-id', doc.id);
    li.setAttribute('data-read', state);
    var open = el('button', 'lg-rv-open');
    open.type = 'button';
    open.setAttribute('data-act', 'rv-open');
    open.setAttribute('data-id', doc.id);
    var url = safePhotoUrl(doc.photo_url);
    if (url) {
      var img = document.createElement('img');
      img.className = 'lg-rv-thumb';
      img.setAttribute('loading', 'lazy');
      img.alt = '';
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.src = url;
      // 정사각 썸네일은 돌려도 자리가 같다
      var turn = rotOf(doc);
      if (turn) img.style.transform = 'rotate(' + turn + 'deg)';
      open.appendChild(img);
    } else {
      open.appendChild(el('span', 'lg-rv-thumb lg-rv-thumb--none', '사진 없음'));
    }
    var main = el('span', 'lg-rv-main');
    if (ready) {
      var two = readyLines(doc);
      main.appendChild(el('b', 'lg-rv-ready1', two[0]));
      main.appendChild(el('small', 'lg-rv-ready2', two[1]));
      open.appendChild(main);
      li.appendChild(open);
      return li;
    }
    var line = el('span', 'lg-rv-line');
    line.appendChild(el('span', '', stamp(doc.created_at)));
    line.appendChild(
      el('b', '', state === 'none' && noAi() ? '직접 적기' : READ_STATE[state] || state)
    );
    main.appendChild(line);
    if (doc.note) main.appendChild(el('small', 'lg-rv-memo', doc.note));
    var sum = readSummary(doc);
    if (sum) main.appendChild(el('small', 'lg-rv-sum', sum));
    var chips = el('span', 'lg-chips');
    chipsInto(chips, doc);
    if (chips.childNodes.length) main.appendChild(chips);
    open.appendChild(main);
    li.appendChild(open);
    return li;
  }

  function renderReady(list) {
    var box = $('lgReady');
    box.hidden = !list.length;
    $('lgReadyTitle').textContent = '바로 올려도 되는 사진 ' + list.length + '장';
    $('lgReadyPost').textContent = list.length + '장 올리기';
    $('lgReadyPost').disabled = L.reviewBusy || !list.length;
    var ul = $('lgReadyList');
    ul.textContent = '';
    list.forEach(function (d) {
      ul.appendChild(reviewItem(d, true));
    });
  }

  function renderReview() {
    $('lgReview').hidden = L.ph !== 'pending';
    var n = L.review.length;
    $('lgReviewTitle').textContent =
      '확인할 사진' + (L.reviewFail ? '' : ' ' + n + (L.reviewMore ? '장 넘게' : '장'));
    $('lgReviewNote').textContent = L.reviewFail
      ? '확인할 사진을 불러오지 못했습니다.'
      : !n
        ? '확인할 사진이 없습니다.'
        : canWrite() && noAi()
          ? '사진을 눌러 일자 · 거래처 · 공급가 · 부가세 · 계정을 적어 장부에 올립니다.'
          : canWrite()
            ? '사진을 눌러 꼭 볼 칸(일자 · 거래처 · 공급가 · 부가세 · 계정)을 확인하고 올립니다. 같은 거래처를 같은 계정으로 세 번 넘게 올렸고 걸리는 것이 없는 사진은 「바로 올려도 되는 사진」에 모입니다.'
            : '보기만 합니다.';
    var ready = readyDocs();
    renderReady(ready);
    var list = $('lgReviewList');
    list.textContent = '';
    L.review.forEach(function (d) {
      if (ready.indexOf(d) < 0) list.appendChild(reviewItem(d, false));
    });
    $('lgReviewMore').hidden = !L.reviewMore;
    renderTabCount();
    renderPhChips();
  }

  /** 읽는 중인 사진이 있으면 화면이 보일 때 다시 읽는다 */
  function needsPoll() {
    // 직접 적는 업체 — 읽기를 기다리지 않는다
    if (noAi()) return false;
    return L.review.some(function (d) {
      var s = readState(d);
      return s === 'none' || s === 'running';
    });
  }

  function stopPoll() {
    if (L.pollTimer) window.clearTimeout(L.pollTimer);
    L.pollTimer = null;
  }

  function schedulePoll() {
    stopPoll();
    if (!needsPoll() || document.visibilityState === 'hidden') return;
    L.pollTimer = window.setTimeout(pollTick, POLL_MS);
  }

  async function pollTick() {
    L.pollTimer = null;
    if (document.visibilityState === 'hidden') return;
    // 칸을 고치는 중 · 올리는 중에는 목록을 바꾸지 않는다 — 다음에
    if (L.sheet || L.reviewBusy) return schedulePoll();
    await loadReview();
  }

  /** 확인할 사진 한 쪽 — before 보다 앞선 것 REVIEW_PAGE 장 (before 가 없으면 새것부터) */
  function reviewPage(before) {
    return api(
      withCompany(
        '/ledger/review?status=pending&limit=' +
          REVIEW_PAGE +
          (before ? '&before=' + encodeURIComponent(before) : '')
      )
    );
  }

  /** 확인할 사진 — 새것부터 REVIEW_PAGE 장, 더 보기는 마지막 사진보다 앞선 것 */
  async function loadReview(more) {
    var last = more && L.review.length ? L.review[L.review.length - 1].created_at : '';
    var at = Date.now();
    var r = await reviewPage(last);
    if (!r.ok) {
      if (!more) L.review = [];
      L.reviewFail = !more;
      L.reviewMore = false;
      renderReview();
      return schedulePoll();
    }
    var got = r.data && Array.isArray(r.data.items) ? r.data.items : [];
    L.review = last ? L.review.concat(got) : got;
    L.reviewMore = got.length === REVIEW_PAGE;
    L.reviewFail = false;
    if (!last) L.reviewAt = at;
    renderReview();
    schedulePoll();
  }

  /** 사진 서명 주소가 곧 끝나는가 — 워커가 준 photo_expires_in 기준 */
  function photosStale() {
    var ttl = L.review.length ? Number(L.review[0].photo_expires_in) : 0;
    if (!ttl || !L.reviewAt) return false;
    return Date.now() - L.reviewAt > ttl * 1000 - PHOTO_MARGIN_MS;
  }

  /** 불러온 장수만큼 처음부터 다시 받는다 — 새 사진 주소 (더 보기로 연 쪽까지, 다 받은 뒤 한 번 그린다) */
  async function refreshReview() {
    if (L.reviewLoading) return;
    L.reviewLoading = true;
    var want = L.review.length;
    var at = Date.now();
    var got = [];
    var more = true;
    while (more && got.length < want) {
      var r = await reviewPage(got.length ? got[got.length - 1].created_at : '');
      if (!r.ok) {
        // 받지 못하면 목록은 그대로 둔다 — 다음에 열 때 다시
        L.reviewLoading = false;
        return;
      }
      var items = r.data && Array.isArray(r.data.items) ? r.data.items : [];
      got = got.concat(items);
      more = items.length === REVIEW_PAGE;
    }
    L.reviewLoading = false;
    L.review = got;
    L.reviewMore = more;
    L.reviewFail = false;
    L.reviewAt = at;
    renderReview();
    schedulePoll();
  }

  /** 사진 주소가 곧 끝나면 목록을 새로 받은 뒤 연다 */
  async function openReview(id) {
    if (photosStale()) await refreshReview();
    openSheet(id);
  }

  /** 칸을 고치는 중 · 올리는 중이 아니면 사진 주소를 새로 받는다 */
  function refreshIfStale() {
    if (photosStale() && !L.sheet && !L.reviewBusy) refreshReview();
  }

  // ── 거래명세표 모아 붙이기 ─────────────────────────────────
  //   시트: 명세표인데 거래처를 안 골랐으면 묻고(ask), 따로 주는 거래처면 모아 두기(hold)
  //   목록: 세금계산서 기다리는 명세표 (거래처 · 달) → 세금계산서 줄에 붙이기 · 명세표만 주는 곳으로
  //   붙이기 창: 장부 줄 고르기 + 명세표 고르기 → 맞춰 보기(dry_run) → 붙이기

  /** 이 사진 거래처의 모아 둔 명세표 묶음 — 그 달 것이 먼저 */
  function heldFor(doc, entryDate) {
    var key = doc && doc.hints && doc.hints.supplier && doc.hints.supplier.key;
    if (!key) return null;
    var same = L.held.filter(function (g) {
      return g.supplier_key === key;
    });
    var month = String(entryDate || '').slice(0, 7);
    return (
      same.filter(function (g) {
        return g.month === month;
      })[0] ||
      same[0] ||
      null
    );
  }

  function heldName(g) {
    return (g.supplier_name || '거래처 모름') + ' · ' + monthLabel(g.month);
  }

  function renderHeld() {
    var box = $('lgHeld');
    var n = L.held.reduce(function (s, g) {
      return s + g.count;
    }, 0);
    box.hidden = !n;
    $('lgHeldTitle').textContent = '세금계산서 기다리는 명세표 ' + n + '장';
    var ul = $('lgHeldList');
    ul.textContent = '';
    L.held.forEach(function (g, i) {
      var li = el('li', 'lg-held-row');
      var top = el('div', 'lg-held-top');
      top.appendChild(el('b', '', heldName(g)));
      top.appendChild(
        el(
          'span',
          '',
          g.count +
            '장 · ' +
            (g.supply != null ? '공급가 ' + money(g.supply) : '합계 ' + money(g.total))
        )
      );
      li.appendChild(top);
      if (g.late)
        li.appendChild(el('small', 'lg-held-late', '11일이 지났는데 세금계산서가 아직 없습니다'));
      if (canWrite()) {
        var acts = el('div', 'lg-held-acts');
        var go = el('button', 'mk-btn mk-btn--solid', '세금계산서 줄에 붙이기');
        go.type = 'button';
        go.setAttribute('data-act', 'held-attach');
        go.setAttribute('data-i', String(i));
        acts.appendChild(go);
        if (g.supplier_key) {
          var only = el('button', 'mk-link', '명세표만 주는 곳으로 바꾸기');
          only.type = 'button';
          only.setAttribute('data-act', 'held-only');
          only.setAttribute('data-i', String(i));
          acts.appendChild(only);
        }
        li.appendChild(acts);
      }
      ul.appendChild(li);
    });
  }

  async function loadHeld() {
    var r = await api(withCompany('/ledger/held'));
    L.held = r.ok && r.data && Array.isArray(r.data.groups) ? r.data.groups : [];
    renderHeld();
  }

  async function onHeldClick(e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || L.reviewBusy) return;
    var g = L.held[Number(b.getAttribute('data-i'))];
    if (!g) return;
    if (b.getAttribute('data-act') === 'held-attach') return openAttach(g, '');
    if (b.getAttribute('data-act') === 'held-only') {
      L.reviewBusy = true;
      var r = await api('/ledger/suppliers', {
        method: 'PUT',
        body: { supplier_key: g.supplier_key, mode: 'statement_only' },
      });
      L.reviewBusy = false;
      if (!r.ok) return setState(r.message || '바꾸지 못했습니다.');
      setState(
        (g.supplier_name || '이 거래처') +
          '는 명세표만 주는 곳으로 바꿨습니다 — 명세표 ' +
          (r.data.released || 0) +
          '장을 확인할 사진으로 돌렸습니다.'
      );
      await loadHeld();
      await loadReview();
      await loadSuppliers();
    }
  }

  /** 시트 위 명세표 상자 — ask(묻기) · hold(모아 두기, 다시 고르기) */
  function renderInvoice(doc) {
    var h = doc.hints || {};
    var route = h.invoice && h.invoice.route;
    L.sheet.invName = (h.supplier && h.supplier.name) || '이 거래처';
    $('lgRvInv').hidden = !route || !canWrite();
    if (route === 'ask') return askInvoice();
    L.sheet.candidates = null;
    $('lgRvInvAsk').hidden = true;
    $('lgRvInvHold').hidden = route !== 'hold';
    $('lgRvInvRedoRow').hidden = route !== 'hold';
    $('lgRvHold').textContent = '모아 두기';
    if (route === 'hold') {
      $('lgRvInvTitle').textContent = '세금계산서를 따로 주는 거래처의 명세표입니다';
      $('lgRvInvNote').textContent =
        '장부 줄로 올리면 세금계산서와 두 번 잡힙니다. 모아 두었다가 세금계산서가 오면 그 줄에 붙이세요.';
    }
  }

  /** 묻기 — 처음 · 잘못 골라 다시 고를 때 (고른 것은 다시 고를 때까지 그대로) */
  function askInvoice() {
    L.sheet.candidates = null;
    $('lgRvInvAsk').hidden = false;
    $('lgRvInvHold').hidden = true;
    $('lgRvInvRedoRow').hidden = true;
    $('lgRvHold').textContent = '모아 두기';
    $('lgRvInvTitle').textContent = L.sheet.invName + '는 세금계산서를 따로 주나요?';
    $('lgRvInvNote').textContent =
      '한 번만 고르면 이 거래처의 명세표는 앞으로 저절로 나뉩니다. 모르시면 세무사님께 물어보세요 (홈택스 자료로 바로 압니다).';
  }

  async function setSheetMode(mode) {
    if (!L.sheet || L.reviewBusy) return;
    var doc = L.sheet.doc;
    L.reviewBusy = true;
    var r = await api('/ledger/suppliers', {
      method: 'PUT',
      body: { document_id: doc.id, mode: mode },
    });
    L.reviewBusy = false;
    if (!r.ok) return rvError(r.message || '고르지 못했습니다.');
    loadSuppliers();
    L.sheet.invName = r.data.name || L.sheet.invName;
    $('lgRvInvRedoRow').hidden = false;
    if (mode === 'statement_only') {
      // 앞서 따로 줌으로 모아 둔 명세표는 서버가 확인할 사진으로 돌렸다
      if (r.data.released) {
        loadHeld();
        loadReview();
      }
      L.sheet.candidates = null;
      $('lgRvInvAsk').hidden = true;
      $('lgRvInvHold').hidden = true;
      $('lgRvInvTitle').textContent = L.sheet.invName + '는 명세표만 주는 곳으로 정했습니다';
      $('lgRvInvNote').textContent =
        '이 명세표는 아래 「장부에 올리기」로 올리면 됩니다 (합계를 금액에 · 부가세 0). 잘못 골랐으면 다시 고르세요.';
      return;
    }
    var ids = Array.isArray(r.data.candidates) ? r.data.candidates.slice() : [];
    if (ids.indexOf(doc.id) < 0) ids.unshift(doc.id);
    L.sheet.candidates = ids;
    $('lgRvInvAsk').hidden = true;
    $('lgRvInvHold').hidden = false;
    $('lgRvInvTitle').textContent = L.sheet.invName + '는 세금계산서를 따로 주는 곳으로 정했습니다';
    $('lgRvInvNote').textContent =
      '이 거래처 명세표 ' +
      ids.length +
      '장(이 사진 포함)을 장부에 넣지 않고 모아 둡니다. 세금계산서가 오면 그 줄에 붙입니다.';
    $('lgRvHold').textContent = ids.length + '장 모아 두기';
  }

  async function holdSheet() {
    if (!L.sheet || L.reviewBusy) return;
    var ids = L.sheet.candidates || [L.sheet.doc.id];
    L.reviewBusy = true;
    var r = await api('/ledger/documents/hold', { method: 'POST', body: { document_ids: ids } });
    L.reviewBusy = false;
    if (!r.ok) return rvError(r.message || '모아 두지 못했습니다.');
    L.review = L.review.filter(function (d) {
      return ids.indexOf(d.id) < 0;
    });
    closeSheet();
    renderReview();
    await loadHeld();
    await loadDocs();
    setState('명세표 ' + (r.data.held || 0) + '장을 모아 뒀습니다 — 세금계산서가 오면 붙입니다.');
  }

  // 붙이기 창

  function closeAttach() {
    L.attach = null;
    $('lgAttach').hidden = true;
  }

  function atError(text) {
    $('lgAtError').textContent = text || '';
    $('lgAtError').hidden = !text;
  }

  function entryLabel(x) {
    return [
      day(x.entry_date),
      money(x.amount) + (x.vat_amount ? ' + 부가세 ' + money(x.vat_amount) : ''),
      EVIDENCE[x.evidence_type] || x.evidence_type || '',
      x.supporting ? '붙은 명세표 ' + x.supporting + '장' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 맞춰 보기 결과 → 글 (순수) */
  function compareText(c) {
    if (!c || !c.n) return { rows: [], res: '', good: null };
    var supply = c.basis === 'supply';
    var rows = [
      [
        (supply ? '명세표 공급가 합' : '명세표 합계 합') + ' (' + c.n + '장)',
        c.statements == null ? '읽지 못한 값이 있음' : money(c.statements),
      ],
      [supply ? '세금계산서 공급가' : '장부 줄 합계 (금액 + 부가세)', money(c.invoice)],
    ];
    if (c.match === true)
      return {
        rows: rows,
        res: '같습니다 — 붙이면 명세표 ' + c.n + '장이 이 줄의 증빙이 됩니다.',
        good: true,
      };
    if (c.match === false)
      return {
        rows: rows,
        res:
          money(Math.abs(c.diff)) +
          ' 다릅니다 — 빠진 명세표가 있거나 세금계산서가 잘못됐을 수 있습니다. 그래도 붙일 수 있습니다.',
        good: false,
      };
    return {
      rows: rows,
      res: '명세표 금액을 다 읽지 못해 맞춰 볼 수 없습니다. 그래도 붙일 수 있습니다.',
      good: null,
    };
  }

  function renderAttach() {
    var a = L.attach;
    if (!a) return;
    $('lgAtTitle').textContent = heldName(a.group) + ' — 세금계산서 줄에 붙이기';
    var sel = $('lgAtEntry');
    var keep = sel.value || a.entryId;
    sel.textContent = '';
    if (!a.entries) sel.appendChild(new window.Option('장부 줄을 불러오는 중…', ''));
    else if (!a.entries.length)
      sel.appendChild(new window.Option('이 거래처 장부 줄이 없습니다', ''));
    (a.entries || []).forEach(function (x) {
      sel.appendChild(new window.Option(entryLabel(x), x.entry_id));
    });
    if (keep) sel.value = keep;
    $('lgAtNote').textContent =
      a.entries && !a.entries.length
        ? '세금계산서 장부 줄이 아직 없습니다. 「세금계산서 줄 넣고 붙이기」로 세금계산서를 먼저 적어 주세요.'
        : '세금계산서 장부 줄을 고르고, 붙일 명세표를 확인하세요. 명세표는 장부 금액에 들어가지 않고 그 줄의 증빙이 됩니다.';
    var ul = $('lgAtDocs');
    ul.textContent = '';
    a.group.documents.forEach(function (d) {
      var li = el('li', 'lg-at-doc');
      var label = document.createElement('label');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!a.picked[d.id];
      box.setAttribute('data-doc', d.id);
      label.appendChild(box);
      label.appendChild(el('span', '', (day(d.issue_date) || stamp(d.created_at)) + ' 명세표'));
      label.appendChild(
        el(
          'span',
          'lg-at-amt',
          d.supply_amount != null ? money(d.supply_amount) : money(d.total_amount)
        )
      );
      li.appendChild(label);
      ul.appendChild(li);
    });
    $('lgAtGo').disabled = !$('lgAtEntry').value || !pickedIds().length;
  }

  function pickedIds() {
    var a = L.attach;
    if (!a) return [];
    return a.group.documents
      .map(function (d) {
        return d.id;
      })
      .filter(function (id) {
        return a.picked[id];
      });
  }

  async function openAttach(group, entryId) {
    var picked = {};
    group.documents.forEach(function (d) {
      picked[d.id] = true;
    });
    L.attach = { group: group, entryId: entryId || '', entries: null, picked: picked, seq: 0 };
    $('lgAtCmp').textContent = '';
    $('lgAtRes').textContent = '';
    atError('');
    renderAttach();
    $('lgAttach').hidden = false;
    var q = [];
    if (group.biz_no) q.push('biz_no=' + encodeURIComponent(group.biz_no));
    if (group.name_key) q.push('name_key=' + encodeURIComponent(group.name_key));
    var r = q.length
      ? await api(withCompany('/ledger/held/entries?' + q.join('&')))
      : { ok: true, data: { items: [] } };
    if (!L.attach || L.attach.group !== group) return;
    var items = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items : [];
    L.attach.entries = items;
    if (!L.attach.entryId) {
      // 그 달 세금계산서 줄이 먼저, 없으면 가장 최근 줄
      var pick =
        items.filter(function (x) {
          return (
            x.evidence_type === 'tax_invoice' && String(x.entry_date).slice(0, 7) === group.month
          );
        })[0] || items[0];
      L.attach.entryId = pick ? pick.entry_id : '';
    }
    if (!r.ok) atError(r.message || '장부 줄을 불러오지 못했습니다.');
    renderAttach();
    compareAttach();
  }

  /** 맞춰 보기 — 고른 줄 · 명세표가 바뀔 때마다 (늦게 온 답은 버린다) */
  async function compareAttach() {
    var a = L.attach;
    if (!a) return;
    var entry = $('lgAtEntry').value;
    var ids = pickedIds();
    $('lgAtGo').disabled = !entry || !ids.length;
    $('lgAtCmp').textContent = '';
    $('lgAtRes').textContent = '';
    if (!entry || !ids.length) return;
    var seq = ++a.seq;
    var r = await api('/ledger/entries/' + encodeURIComponent(entry) + '/attach', {
      method: 'POST',
      body: { document_ids: ids, dry_run: true },
    });
    if (L.attach !== a || seq !== a.seq) return;
    if (!r.ok) return atError(r.message || '맞춰 보지 못했습니다.');
    atError('');
    var t = compareText(r.data && r.data.compare);
    var dl = $('lgAtCmp');
    t.rows.forEach(function (row) {
      dl.appendChild(el('dt', '', row[0]));
      dl.appendChild(el('dd', '', row[1]));
    });
    $('lgAtRes').textContent = t.res;
    $('lgAtRes').className =
      'lg-at-res' +
      (t.good === true ? ' lg-at-res--good' : t.good === false ? ' lg-at-res--bad' : '');
  }

  async function goAttach() {
    var a = L.attach;
    var entry = $('lgAtEntry').value;
    var ids = pickedIds();
    if (!a || !entry || !ids.length || L.reviewBusy) return;
    L.reviewBusy = true;
    $('lgAtGo').disabled = true;
    var r = await api('/ledger/entries/' + encodeURIComponent(entry) + '/attach', {
      method: 'POST',
      body: { document_ids: ids },
    });
    L.reviewBusy = false;
    if (!r.ok) {
      $('lgAtGo').disabled = false;
      if (r.status === 409) await loadHeld();
      return atError(r.message || '붙이지 못했습니다.');
    }
    var c = r.data.compare || {};
    closeAttach();
    await loadHeld();
    await loadBook(L.month);
    setState(
      '명세표 ' +
        (r.data.attached || 0) +
        '장을 세금계산서 줄에 붙였습니다.' +
        (c.match === false ? ' 합계가 달라 비서 알림에 남겼습니다.' : '')
    );
  }

  /** 세금계산서 장부 줄을 직접 넣고, 저장하면 이 묶음 붙이기 창을 다시 연다 */
  function newInvoiceEntry() {
    var a = L.attach;
    if (!a || !canWrite()) return;
    var g = a.group;
    closeAttach();
    if (L.tab !== 'buys') {
      if (history.replaceState) history.replaceState(null, '', '#buys');
      showTab('buys');
    }
    openForm('create');
    L.attachAfter = g;
    $('lgCpName').value = g.supplier_name || '';
    $('lgCpBiz').value = g.biz_no || '';
    $('lgEvidence').value = 'tax_invoice';
    $('lgDesc').value = monthLabel(g.month) + ' 세금계산서';
    formError('');
    $('lgForm').scrollIntoView({ block: 'start' });
  }

  // 거래처별 세금계산서 (장부 설정)

  function renderSuppliers() {
    var box = $('lgSup');
    box.hidden = !L.suppliers.length;
    var ul = $('lgSupList');
    ul.textContent = '';
    L.suppliers.forEach(function (s) {
      var li = el('li', 'lg-sup-row');
      li.appendChild(el('span', 'lg-sup-name', s.name || s.supplier_key));
      var sel = document.createElement('select');
      sel.setAttribute('data-key', s.supplier_key);
      sel.setAttribute('aria-label', (s.name || '거래처') + ' 세금계산서');
      sel.disabled = !canWrite();
      Object.keys(INVOICE_MODE).forEach(function (k) {
        sel.appendChild(new window.Option(INVOICE_MODE[k], k));
      });
      sel.value = s.mode;
      li.appendChild(sel);
      ul.appendChild(li);
    });
  }

  async function loadSuppliers() {
    var r = await api(withCompany('/ledger/suppliers'));
    L.suppliers = r.ok && r.data && Array.isArray(r.data.items) ? r.data.items : [];
    renderSuppliers();
  }

  async function onSupplierChange(e) {
    var key = e.target && e.target.getAttribute ? e.target.getAttribute('data-key') : null;
    if (!key || !canWrite()) return;
    var mode = e.target.value;
    var r = await api('/ledger/suppliers', {
      method: 'PUT',
      body: { supplier_key: key, mode: mode },
    });
    if (!r.ok) {
      setState(r.message || '바꾸지 못했습니다.');
      return loadSuppliers();
    }
    setState(
      (r.data.name || '이 거래처') +
        ' — ' +
        INVOICE_MODE[mode] +
        (r.data.released ? ' (모아 둔 명세표 ' + r.data.released + '장을 확인할 사진으로)' : '') +
        (mode === 'separate' && r.data.candidates && r.data.candidates.length
          ? ' — 확인할 사진의 이 거래처 명세표 ' +
            r.data.candidates.length +
            '장은 사진을 열어 모아 두세요'
          : '')
    );
    await loadSuppliers();
    await loadHeld();
    await loadReview();
  }

  // 시트 — 사진 하나
  function rvError(text) {
    $('lgRvError').textContent = text || '';
    $('lgRvError').hidden = !text;
  }

  function fillRvAccounts(direction, selected) {
    var list = accountsFor(L.accounts, direction);
    var sel = $('lgRvAccount');
    sel.textContent = '';
    sel.appendChild(new window.Option('고르기', ''));
    list.forEach(function (a) {
      sel.appendChild(new window.Option(a.name + (a.note ? ' (' + a.note + ')' : ''), a.code));
    });
    sel.value = selected || '';
  }

  function fillRvOrders() {
    var sel = $('lgRvOrder');
    var keep = sel.value;
    var none = !!L.orders && !L.orders.length;
    sel.textContent = '';
    sel.appendChild(
      new window.Option(
        L.ordersFailed
          ? '수주 목록을 불러오지 못했습니다'
          : !L.orders
            ? '수주를 불러오는 중…'
            : none
              ? '이 팩토리 수주가 없습니다'
              : '고르기',
        ''
      )
    );
    (L.orders || []).forEach(function (o) {
      sel.appendChild(
        new window.Option([o.order_no, o.customer_name].filter(Boolean).join(' · '), o.id)
      );
    });
    sel.value = keep;
    // 수주가 없으면 그 칸 아래에 할 일을 쓴다 (꼭 볼 칸 표시는 이 칸을 그리지 않는다)
    var why = sel.closest('.lg-must-row').querySelector('[data-why]');
    why.textContent = none ? NO_ORDERS_HINT : '';
    why.hidden = !none;
  }

  // 사진과 같은 업체 수주만 받는다 (서버 ledger_post_document) — GET /orders 는 볼 수 있는 업체들의 수주를 섞는다
  async function loadOrders() {
    if (L.orders) return fillRvOrders();
    L.ordersFailed = false;
    fillRvOrders();
    var r = await api('/ledger/orders');
    L.orders = r.ok
      ? ((r.data && r.data.items) || []).filter(function (o) {
          return o && o.id;
        })
      : null;
    L.ordersFailed = !r.ok;
    if (!r.ok) rvError('수주 목록을 불러오지 못했습니다.');
    fillRvOrders();
  }

  function setTarget(target) {
    $('lgRvTarget').value = target;
    [].forEach.call($('lgRvForm').querySelectorAll('[data-for]'), function (n) {
      n.hidden = n.getAttribute('data-for') !== target;
    });
    $('lgRvPost').textContent = target === 'order_cost' ? '수주 원가로 올리기' : '장부에 올리기';
    renderBizRow();
    if (target === 'order_cost' && canWrite()) loadOrders();
  }

  /** 꼭 볼 칸 표시를 그린다 */
  function renderMust(doc) {
    var marks = mustMarks(doc);
    Object.keys(marks).forEach(function (k) {
      var row = $('lgRvMust').querySelector('[data-must="' + k + '"]');
      if (!row) return;
      var m = marks[k];
      row.classList.toggle('lg-flag', m.mark === 'chk');
      var mark = row.querySelector('[data-mark]');
      mark.textContent = m.mark === 'ok' ? '✓' : m.mark === 'chk' ? '확인' : '';
      mark.className = 'lg-mark' + (m.mark ? ' lg-mark--' + m.mark : '');
      var why = row.querySelector('[data-why]');
      why.textContent = m.why;
      why.hidden = !m.why;
      var tag = row.querySelector('[data-tag]');
      tag.textContent = m.tag;
      tag.hidden = !m.tag;
      tag.className = 'lg-tag' + (m.tag === 'AI 제안' ? ' lg-tag--ai' : '');
    });
  }

  /** 더 보기 안의 칸 표시 → 표시한 칸이 있으면 true (더 보기를 펼친다) */
  function flagMore(doc) {
    [].forEach.call($('lgRvMore').querySelectorAll('.lg-flag'), function (n) {
      n.classList.remove('lg-flag');
    });
    if (readState(doc) !== 'done') return false;
    var x = doc.extraction;
    var keys = ((x.result && x.result.unsure) || []).slice();
    var c = x.checks || {};
    if (c.biz_no === 'bad') keys.push('supplier_biz_no');
    var any = false;
    keys.forEach(function (k) {
      var id = MORE_FLAGS[k];
      var label = id && $(id).closest('.mk-input');
      if (label) {
        label.classList.add('lg-flag');
        any = true;
      }
    });
    return any || !!c.multiple;
  }

  /** 공급가 칸 이름 — 공제되는 증빙이면 공급가, 아니면 부가세 공제가 안 되는 금액 */
  function renderAmountLabel() {
    var ev = $('lgRvEvidence').value;
    $('lgRvAmountLabel').textContent =
      !ev || DEDUCT_EVIDENCE.indexOf(ev) >= 0 ? '공급가' : '금액 (부가세 공제 안 됨)';
  }

  /** 읽은 품목 줄 — 이름 · 수량 × 단가 = 금액 */
  function itemsInto(doc) {
    var ul = $('lgRvItems');
    ul.textContent = '';
    if (readState(doc) !== 'done') return;
    var items = (doc.extraction.result && doc.extraction.result.items) || [];
    items.forEach(function (i) {
      if (!i || typeof i.name !== 'string') return;
      var parts = [i.name];
      if (i.quantity != null && i.unit_price != null)
        parts.push(i.quantity + ' × ' + money(i.unit_price));
      if (i.amount != null) parts.push('= ' + money(i.amount));
      ul.appendChild(el('li', '', parts.join(' ')));
    });
  }

  /** 읽지 못한 까닭 — 쉬운 말 */
  function failText(error) {
    var e = String(error || '');
    for (var i = 0; i < READ_FAIL.length; i++) if (READ_FAIL[i][0].test(e)) return READ_FAIL[i][1];
    return '';
  }

  function amountsText(doc) {
    if (readState(doc) !== 'done') return '';
    var r = doc.extraction.result || {};
    var names = {
      supply_amount: '공급가',
      vat_amount: '부가세',
      tax_free_amount: '면세',
      service_charge: '봉사료',
      total_amount: '합계',
    };
    var parts = AMOUNT_KEYS.filter(function (k) {
      return r[k] != null;
    }).map(function (k) {
      return names[k] + ' ' + money(r[k]);
    });
    return parts.length ? '읽은 금액 — ' + parts.join(' · ') : '읽은 금액이 없습니다.';
  }

  function readText(doc) {
    var state = readState(doc);
    var x = doc.extraction;
    if (state === 'none' && noAi())
      return '사진을 보고 꼭 볼 칸을 직접 적어 올려 주세요. (사진 AI 읽기는 Agent 등급에서 씁니다)';
    if (state === 'none') return '아직 읽지 않았습니다 — 곧 읽습니다. 직접 적어 올려도 됩니다.';
    if (state === 'running')
      return '읽는 중입니다. 다 읽으면 목록에 「읽음」이 보입니다 — 직접 적어 올려도 됩니다.';
    if (state === 'done') return '읽음 — 꼭 볼 칸을 확인하고 올려 주세요.';
    if (state === 'skipped_budget')
      return '이달 사진 읽기 한도로 읽지 못했습니다. 직접 적어 올리거나 「다시 읽기」를 눌러 주세요.';
    if (state === 'refused') return '이 사진은 읽지 않았습니다. 직접 적어 올려 주세요.';
    var why = failText(x && x.error);
    return (
      '읽지 못했습니다' +
      (x && x.attempt ? ' (' + x.attempt + '번째 시도)' : '') +
      (why ? ' — ' + why : '') +
      '. 직접 적어 올리거나 「다시 읽기」를 눌러 주세요.'
    );
  }

  function renderBizRow() {
    var show =
      canWrite() &&
      L.ntsAvailable !== false &&
      $('lgRvTarget').value === 'entry' &&
      bizNoValid($('lgRvBiz').value);
    $('lgRvBizRow').hidden = !show;
  }

  function openSheet(id) {
    var doc = reviewById(id);
    if (!doc) return;
    var p = prefillFor(doc);
    L.sheet = { doc: doc, prefill: p };
    L.decide = '';
    var url = safePhotoUrl(doc.photo_url);
    $('lgRvPhoto').hidden = !url;
    $('lgRvPhotoBtn').hidden = !url;
    $('lgRvPhotoBtn').classList.remove('lg-rv-photo--big');
    if (url) $('lgRvPhoto').src = url;
    else $('lgRvPhoto').removeAttribute('src');
    $('lgRvRotateRow').hidden = !url;
    applyRotation();
    $('lgRvNoPhoto').hidden = !!url;
    $('lgRvRead').textContent = readText(doc);
    chipsInto($('lgRvChips'), doc);
    $('lgRvAmounts').textContent = amountsText(doc);
    $('lgRvDate').value = p.entry_date || '';
    $('lgRvDir').value = p.direction;
    fillRvAccounts(p.direction, p.account);
    $('lgRvDesc').value = p.description;
    $('lgRvCpName').value = p.counterparty_name;
    $('lgRvBiz').value = p.counterparty_biz_no;
    $('lgRvAmount').value = p.amount == null ? '' : p.amount;
    $('lgRvVat').value = p.vat_amount == null ? '' : p.vat_amount;
    $('lgRvEvidence').value = p.evidence_type;
    $('lgRvMethod').value = p.payment_method;
    var h = doc.hints || {};
    $('lgRvCategory').value =
      (h.target === 'order_cost' && COST_CATEGORY[h.category] && h.category) || 'material';
    $('lgRvBizState').textContent = '';
    $('lgRvReason').value = '';
    $('lgRvDecide').hidden = true;
    rvError('');
    var w = canWrite();
    $('lgRvActs').hidden = !w;
    $('lgRvReread').hidden = !w || REREAD.indexOf(readState(doc)) < 0;
    [].forEach.call($('lgRvForm').querySelectorAll('input, select'), function (n) {
      n.disabled = !w;
    });
    renderMust(doc);
    renderInvoice(doc);
    itemsInto(doc);
    renderAmountLabel();
    $('lgRvMore').open = flagMore(doc);
    setTarget(h.target === 'order_cost' ? 'order_cost' : 'entry');
    $('lgSheet').hidden = false;
  }

  /** 시트 사진을 돌린 각도대로 그린다 (화면에서만). 90 · 270 은 돌린 뒤 가로가 상자 폭에 맞게
   *  (작게 보기면 돌린 뒤 높이가 PHOTO_MAX_H 안에) 크기를 정하고, 아래 여백으로 상자 높이를 돌린 사진에 맞춘다 */
  function applyRotation() {
    var img = $('lgRvPhoto');
    var box = $('lgRvPhotoBtn');
    var deg = L.sheet ? rotOf(L.sheet.doc) : 0;
    img.removeAttribute('style');
    img.setAttribute('data-rot', String(deg));
    if (deg === 180) img.style.transform = 'rotate(180deg)';
    if (deg !== 90 && deg !== 270) return;
    var w = img.naturalWidth;
    var h = img.naturalHeight;
    var room = box.clientWidth;
    // 사진이 아직 안 열렸으면 load 때 다시
    if (!(w > 0 && h > 0 && room > 0)) return;
    var big = box.classList.contains('lg-rv-photo--big');
    var across = big ? room : Math.min(room, Math.floor((PHOTO_MAX_H * h) / w));
    var down = Math.round((across * w) / h);
    img.style.position = 'relative';
    img.style.left = Math.floor((room - across) / 2) + 'px';
    img.style.width = down + 'px';
    img.style.height = across + 'px';
    img.style.maxHeight = 'none';
    img.style.marginBottom = down - across + 'px';
    img.style.transformOrigin = '0 0';
    img.style.transform =
      deg === 90 ? 'rotate(90deg) translateY(-100%)' : 'rotate(270deg) translateX(-100%)';
  }

  function closeSheet() {
    L.sheet = null;
    L.decide = '';
    $('lgSheet').hidden = true;
    rvError('');
    schedulePoll();
  }

  /** 시트 칸 → 올리기 본문 (틀리면 { error }) */
  function sheetBody() {
    var target = $('lgRvTarget').value;
    var amount = Number($('lgRvAmount').value);
    var vatText = $('lgRvVat').value;
    var vat = vatText === '' ? 0 : Number(vatText);
    var date = $('lgRvDate').value;
    var evidence = $('lgRvEvidence').value;
    if (!date) return { error: '일자를 적어 주세요.' };
    if (!($('lgRvAmount').value !== '' && Number.isInteger(amount) && amount >= 1))
      return { error: '금액을 1원 이상 정수로 적어 주세요.' };
    if (!(Number.isInteger(vat) && vat >= 0))
      return { error: '부가세는 0 이상 정수로 적어 주세요.' };
    if (!evidence) return { error: '증빙을 골라 주세요.' };
    var desc = $('lgRvDesc').value.trim() || null;
    var name = $('lgRvCpName').value.trim() || null;
    if (target === 'order_cost') {
      if (!$('lgRvOrder').value)
        return {
          error:
            L.orders && !L.orders.length
              ? '이 팩토리에는 고를 수주가 없습니다.'
              : '수주를 골라 주세요.',
        };
      return {
        body: {
          target: 'order_cost',
          order_id: $('lgRvOrder').value,
          cost: {
            category: $('lgRvCategory').value,
            amount: amount,
            vat_amount: vat,
            description: desc,
            vendor_name: name,
            evidence_type: evidence,
            spent_on: date,
          },
        },
      };
    }
    if (!$('lgRvAccount').value) return { error: '계정을 골라 주세요.' };
    var biz = $('lgRvBiz').value.trim();
    if (biz && !bizNoValid(biz))
      return { error: '사업자등록번호를 확인해 주세요 (숫자 10자리, 검증 숫자).' };
    return {
      body: {
        target: 'entry',
        entry: {
          entry_date: date,
          direction: $('lgRvDir').value,
          account: $('lgRvAccount').value,
          description: desc,
          counterparty_name: name,
          counterparty_biz_no: biz ? biz.replace(/[-\s]/g, '') : null,
          amount: amount,
          vat_amount: vat,
          evidence_type: evidence,
          payment_method: $('lgRvMethod').value || null,
        },
      },
    };
  }

  /** 사진 하나가 끝났다 — 목록에서 빼고 장부 · 올린 사진을 다시 읽는다 */
  async function afterDecided(id, text) {
    L.review = L.review.filter(function (d) {
      return d.id !== id;
    });
    closeSheet();
    renderReview();
    await loadBook(L.month);
    await loadDocs();
    setState(text); // 장부 다시 읽기가 상태 줄을 비우므로 그 뒤에
  }

  async function postSheet(e) {
    if (e) e.preventDefault();
    if (!L.sheet || L.reviewBusy || !canWrite()) return;
    var got = sheetBody();
    if (got.error) return rvError(got.error);
    var id = L.sheet.doc.id;
    L.reviewBusy = true;
    $('lgRvPost').disabled = true;
    var r = await api('/ledger/documents/' + encodeURIComponent(id) + '/post', {
      method: 'POST',
      body: got.body,
    });
    L.reviewBusy = false;
    $('lgRvPost').disabled = false;
    if (!r.ok) {
      if (r.status === 409) {
        closeSheet();
        setState(r.message || '이미 확인한 사진입니다.');
        return loadReview();
      }
      return rvError(r.message || '올리지 못했습니다.');
    }
    var doc = L.sheet.doc;
    await afterDecided(
      id,
      got.body.target === 'order_cost' ? '수주 원가로 올렸습니다.' : '장부에 올렸습니다.'
    );
    // 세금계산서를 올렸고 이 거래처 명세표를 모아 두었으면 — 붙일지 묻는다
    if (
      got.body.target === 'entry' &&
      got.body.entry.evidence_type === 'tax_invoice' &&
      r.data &&
      r.data.entry_id
    ) {
      var g = heldFor(doc, got.body.entry.entry_date);
      if (g) openAttach(g, r.data.entry_id);
    }
  }

  function askDecide(status) {
    if (!L.sheet || !canWrite()) return;
    L.decide = status;
    $('lgRvDecideOk').textContent = status === 'rejected' ? '버리기' : '돌려보내기';
    $('lgRvReason').placeholder =
      status === 'rejected' ? '버리는 이유 · 필수' : '돌려보내는 이유 · 필수 (올린 사람이 봅니다)';
    $('lgRvDecide').hidden = false;
    rvError('');
  }

  async function decide() {
    if (!L.sheet || !L.decide || L.reviewBusy) return;
    var reason = $('lgRvReason').value.trim();
    if (!reason) return rvError('이유를 적어 주세요.');
    var id = L.sheet.doc.id;
    var status = L.decide;
    L.reviewBusy = true;
    var r = await api(
      '/ledger/documents/' +
        encodeURIComponent(id) +
        (status === 'rejected' ? '/reject' : '/return'),
      { method: 'POST', body: { reason: reason } }
    );
    L.reviewBusy = false;
    if (!r.ok) {
      if (r.status === 409) {
        closeSheet();
        setState(r.message || '이미 확인한 사진입니다.');
        return loadReview();
      }
      return rvError(r.message || '바꾸지 못했습니다.');
    }
    await afterDecided(id, status === 'rejected' ? '사진을 버렸습니다.' : '사진을 돌려보냈습니다.');
  }

  async function reread() {
    if (!L.sheet || L.reviewBusy || !canWrite()) return;
    var id = L.sheet.doc.id;
    L.reviewBusy = true;
    var r = await api('/ledger/documents/' + encodeURIComponent(id) + '/reread', {
      method: 'POST',
    });
    L.reviewBusy = false;
    if (!r.ok) return rvError(r.message || '다시 읽기를 걸지 못했습니다.');
    if (r.data && r.data.queued === false)
      return rvError('다시 읽기를 걸지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
    closeSheet();
    setState('다시 읽는 중입니다.');
    await loadReview();
  }

  async function checkBusiness() {
    var biz = $('lgRvBiz').value.trim().replace(/[-\s]/g, '');
    if (!bizNoValid(biz)) return;
    $('lgRvBizState').textContent = '보는 중…';
    var r = await api('/ledger/business-status?biz_no=' + encodeURIComponent(biz));
    if (!r.ok) {
      $('lgRvBizState').textContent = r.message || '조회하지 못했습니다.';
      return;
    }
    var d = r.data || {};
    if (d.available === false) {
      L.ntsAvailable = false;
      $('lgRvBizState').textContent = '';
      return renderBizRow();
    }
    L.ntsAvailable = true;
    if (!d.status) {
      $('lgRvBizState').textContent = '국세청 조회에 실패했습니다. 잠시 뒤 다시 눌러 주세요.';
      return;
    }
    $('lgRvBizState').textContent = [
      (NTS_STATUS[d.status] || d.status) +
        (d.status === 'closed' && d.closed_on ? ' (' + d.closed_on + ')' : ''),
      d.tax_type,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 바로 올려도 되는 사진을 한 번에 — 서버가 정한 값(hints.proposal) 그대로, BATCH_MAX 장씩. 서버가 다시 세어 바뀌었으면 그 장만 실패 */
  async function postReady() {
    if (L.reviewBusy || !canWrite()) return;
    var ids = readyDocs().map(function (d) {
      return d.id;
    });
    if (!ids.length) return;
    L.reviewBusy = true;
    $('lgReadyPost').disabled = true;
    $('lgBatchResult').textContent = '';
    var results = [];
    for (var i = 0; i < ids.length; i += BATCH_MAX) {
      var chunk = ids.slice(i, i + BATCH_MAX);
      $('lgBatchState').textContent =
        Math.min(i + BATCH_MAX, ids.length) + ' / ' + ids.length + '장 올리는 중…';
      var r = await api('/ledger/review/post', {
        method: 'POST',
        body: {
          items: chunk.map(function (id) {
            return { id: id, ready: true, entry: reviewById(id).hints.proposal };
          }),
        },
      });
      if (!r.ok) {
        chunk.forEach(function (id) {
          results.push({ id: id, ok: false, message: r.message || '올리지 못했습니다.' });
        });
        continue;
      }
      ((r.data && r.data.items) || []).forEach(function (x) {
        results.push(x);
      });
    }
    L.reviewBusy = false;
    var okIds = results
      .filter(function (x) {
        return x && x.ok;
      })
      .map(function (x) {
        return x.id;
      });
    var failed = results.filter(function (x) {
      return x && !x.ok;
    });
    $('lgBatchState').textContent =
      okIds.length + '장 올림' + (failed.length ? ' · ' + failed.length + '장 못 올림' : '');
    failed.forEach(function (x) {
      var doc = reviewById(x.id);
      var li = el('li');
      li.appendChild(el('b', '', doc ? stamp(doc.created_at) : '사진'));
      li.appendChild(document.createTextNode(' — ' + (x.message || '올리지 못했습니다.')));
      $('lgBatchResult').appendChild(li);
    });
    L.review = L.review.filter(function (d) {
      return okIds.indexOf(d.id) < 0;
    });
    renderReview();
    if (okIds.length) {
      await loadBook(L.month);
      await loadDocs();
    }
    // 바뀐 사진(409)은 목록을 새로 받아 다시 센다
    if (failed.length) await loadReview();
  }

  function onReviewClick(e) {
    var t = e.target;
    var open = t.closest ? t.closest('[data-act="rv-open"]') : null;
    if (open && !L.reviewBusy && !L.reviewLoading) openReview(open.getAttribute('data-id'));
  }

  function bindReview() {
    fillSelect('lgRvEvidence', EVIDENCE, '고르기');
    fillSelect('lgRvMethod', METHOD, '고르지 않음');
    fillSelect('lgRvCategory', COST_CATEGORY);
    $('lgReviewList').addEventListener('click', onReviewClick);
    $('lgPhChips').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-ph]') : null;
      if (b) showPh(b.getAttribute('data-ph'));
    });
    $('lgReadyList').addEventListener('click', onReviewClick);
    // 썸네일이 안 열리면(서명 주소가 끝남) 새로 받는다 — error 는 올라오지 않아 붙잡기로 듣는다
    $('lgReviewList').addEventListener(
      'error',
      function (e) {
        if (e.target && e.target.tagName === 'IMG') refreshIfStale();
      },
      true
    );
    $('lgReviewMore').addEventListener('click', function () {
      loadReview(true);
    });
    $('lgHeldList').addEventListener('click', onHeldClick);
    $('lgRvInvSep').addEventListener('click', function () {
      setSheetMode('separate');
    });
    $('lgRvInvOnly').addEventListener('click', function () {
      setSheetMode('statement_only');
    });
    $('lgRvHold').addEventListener('click', holdSheet);
    $('lgRvInvRedo').addEventListener('click', function () {
      if (L.sheet && !L.reviewBusy) askInvoice();
    });
    $('lgAtClose').addEventListener('click', closeAttach);
    $('lgAtEntry').addEventListener('change', compareAttach);
    $('lgAtDocs').addEventListener('change', function (e) {
      var box = e.target && e.target.getAttribute ? e.target.getAttribute('data-doc') : null;
      if (!box || !L.attach) return;
      L.attach.picked[box] = !!e.target.checked;
      compareAttach();
    });
    $('lgAtGo').addEventListener('click', goAttach);
    $('lgAtNew').addEventListener('click', newInvoiceEntry);
    $('lgSupList').addEventListener('change', onSupplierChange);
    $('lgReadyPost').addEventListener('click', postReady);
    $('lgRvClose').addEventListener('click', closeSheet);
    $('lgRvPhotoBtn').addEventListener('click', function () {
      $('lgRvPhotoBtn').classList.toggle('lg-rv-photo--big');
      applyRotation();
    });
    $('lgRvRotate').addEventListener('click', function () {
      if (!L.sheet) return;
      L.rot[L.sheet.doc.id] = (rotOf(L.sheet.doc) + 90) % 360;
      applyRotation();
    });
    $('lgRvPhoto').addEventListener('load', applyRotation);
    window.addEventListener('resize', function () {
      if (L.sheet) applyRotation();
    });
    $('lgRvTarget').addEventListener('change', function () {
      setTarget($('lgRvTarget').value);
    });
    $('lgRvDir').addEventListener('change', function () {
      fillRvAccounts($('lgRvDir').value);
    });
    $('lgRvBiz').addEventListener('input', renderBizRow);
    $('lgRvEvidence').addEventListener('change', renderAmountLabel);
    $('lgRvBizCheck').addEventListener('click', checkBusiness);
    $('lgRvForm').addEventListener('submit', postSheet);
    $('lgRvReturn').addEventListener('click', function () {
      askDecide('returned');
    });
    $('lgRvReject').addEventListener('click', function () {
      askDecide('rejected');
    });
    $('lgRvDecideOk').addEventListener('click', decide);
    $('lgRvDecideNo').addEventListener('click', function () {
      L.decide = '';
      $('lgRvDecide').hidden = true;
    });
    $('lgRvReread').addEventListener('click', reread);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') return stopPoll();
      if (!L.pollTimer) schedulePoll();
      refreshIfStale(); // 오래 두었다 돌아오면 사진 주소부터 새로
    });
  }

  async function switchTo(id) {
    if (L.busy || L.uploading || !L.me || id === L.me.company_id) return;
    var own = (
      (L.me.ledgers || []).filter(function (x) {
        return x.own;
      })[0] || {}
    ).company_id;
    var prev = L.company;
    L.company = id === own ? '' : id;
    var me = await api(withCompany('/ledger/me'));
    if (!me.ok || !me.data || !me.data.money) {
      L.company = prev;
      renderSwitch();
      return setState(DENY[me.code] || FAIL_MSG);
    }
    L.me = me.data;
    L.voiding = '';
    L.money = {};
    L.ph = 'pending';
    L.bk.selected = '';
    closeForm();
    closeSheet();
    L.review = [];
    L.orders = null;
    L.held = [];
    L.suppliers = [];
    closeAttach();
    $('lgBatchResult').textContent = '';
    $('lgBatchState').textContent = '';
    renderTax();
    renderSwitch();
    renderPhotosBox();
    mountBoard();
    await loadBook(L.month);
    await loadReview();
    await loadHeld();
    await loadSuppliers();
    await loadDocs();
  }

  function rowById(id) {
    var rows = (L.data && L.data.rows) || [];
    for (var i = 0; i < rows.length; i++)
      if (rows[i].id === id && rows[i].source === 'entry') return rows[i];
    return null;
  }

  function onListClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || L.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    if (act === 'edit') {
      var row = rowById(id);
      if (row) openForm('correct', row);
    } else if (act === 'void') {
      L.voiding = id;
      renderList();
    } else if (act === 'void-no') {
      L.voiding = '';
      renderList();
    } else if (act === 'void-ok') {
      return voidRow(id);
    }
  }

  function bind() {
    fillSelect('lgEvidence', EVIDENCE, '고르기');
    fillSelect('lgMethod', METHOD, '고르지 않음');
    $('lgPrev').addEventListener('click', function () {
      if (!L.busy) loadBook(shiftMonth(L.month, -1));
    });
    $('lgNext').addEventListener('click', function () {
      var next = shiftMonth(L.month, 1);
      if (!L.busy && next <= thisMonth()) loadBook(next);
    });
    $('lgShowVoid').addEventListener('change', function () {
      L.showVoid = $('lgShowVoid').checked;
      renderList();
    });
    $('lgBkSrc').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-src]') : null;
      if (!b) return;
      L.bk.source = b.getAttribute('data-src');
      renderList();
    });
    $('lgBkGroup').addEventListener('click', function () {
      L.bk.group = !L.bk.group;
      renderList();
    });
    $('lgBkFind').addEventListener('input', function () {
      L.bk.query = $('lgBkFind').value;
      renderList();
    });
    // 표의 줄을 누르면 서랍에 (Enter 도)
    var pick = function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-id]') : null;
      if (!tr || L.busy) return;
      L.bk.selected = tr.getAttribute('data-id');
      L.voiding = '';
      L.form = null;
      $('lgForm').hidden = true;
      renderList();
    };
    $('lgBkTable').addEventListener('click', pick);
    $('lgBkTable').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') pick(e);
    });
    $('lgDrawerClose').addEventListener('click', closeDrawer);
    $('lgExportOpen').addEventListener('click', openExport);
    $('lgExClose').addEventListener('click', function () {
      $('lgExport').hidden = true;
    });
    $('lgExRange').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-range]') : null;
      if (!b) return;
      L.exportRange = b.getAttribute('data-range');
      exError('');
      renderExport();
    });
    ['lgExFrom', 'lgExTo'].forEach(function (id) {
      $(id).addEventListener('change', renderExport);
    });
    $('lgExport').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-csv]') : null;
      if (b) downloadCsv(b.getAttribute('data-csv'));
    });
    $('lgAdd').addEventListener('click', function () {
      openForm('create');
    });
    $('lgCancel').addEventListener('click', closeForm);
    $('lgDir').addEventListener('change', function () {
      fillAccounts($('lgDir').value);
    });
    $('lgForm').addEventListener('submit', submitForm);
    $('lgTaxSave').addEventListener('click', saveTax);
    $('lgList').addEventListener('click', onListClick);
    $('lgCompany').addEventListener('change', function () {
      switchTo($('lgCompany').value);
    });
    $('lgTabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-tab]') : null;
      if (!b) return;
      var tab = b.getAttribute('data-tab');
      if (history.replaceState) history.replaceState(null, '', '#' + tab);
      showTab(tab);
    });
    // 한눈에의 장부 상태 칩 (#photos …) · 뒤로 가기
    window.addEventListener('hashchange', function () {
      showTab(firstTab());
    });
    $('lgState').addEventListener('click', function () {
      setState('');
    });
  }

  async function start(auth) {
    if (!auth || !auth.session || !auth.sb || !$('lgList')) return;
    L.sb = auth.sb;
    L.session = auth.session;
    var cfg = window.DADAM_CONFIG || {};
    L.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    if (!L.base) return setState(FAIL_MSG);
    var me = await api('/ledger/me');
    if (!me.ok) return setState(DENY[me.code] || FAIL_MSG);
    L.me = me.data;
    if (!L.me.money) {
      // 직원 — 사진 올리기와 자기가 올린 사진의 상태만
      if (!L.me.can_upload) return setState(DENY.not_money);
      $('lgTitle').textContent = '영수증 올리기';
      document.title = '영수증 올리기 · SEGAN';
      bindPhotos();
      renderPhotosBox();
      return loadDocs();
    }
    // 자기 업체 장부가 없는 본사 대표 · 실장 — 서버가 공장 장부(보기만)로 열어 준다
    if (L.me.viewing) L.company = L.me.company_id;
    var acc = await api('/ledger/accounts');
    if (!acc.ok) return setState(FAIL_MSG);
    L.accounts = (acc.data && acc.data.items) || [];
    bind();
    bindPhotos();
    bindReview();
    renderTax();
    renderSwitch();
    renderPhotosBox();
    $('lgTabs').hidden = false;
    $('lgNav').hidden = false;
    $('lgTopActs').hidden = false;
    renderMonthCard();
    mountBoard();
    var asked = new URLSearchParams(location.search).get('month') || '';
    await loadBook(MONTH_RE.test(asked) && asked <= thisMonth() ? asked : thisMonth());
    await loadDocs();
    await loadReview();
    await loadHeld();
    await loadSuppliers();
    await showTab(firstTab());
  }

  var exported = {
    DIRECTION: DIRECTION,
    EVIDENCE: EVIDENCE,
    state: L,
    accountsFor: accountsFor,
    diffPatch: diffPatch,
    rowText: rowText,
    thisMonth: thisMonth,
    shiftMonth: shiftMonth,
    fitSize: fitSize,
    stamp: stamp,
    media: media,
    timer: timer,
    RESUME_MS: RESUME_MS,
    bizNoValid: bizNoValid,
    prefillEntry: prefillEntry,
    warningsOf: warningsOf,
    prefillFor: prefillFor,
    mustMarks: mustMarks,
    readyDocs: readyDocs,
    showTab: showTab,
    files: files,
    heldFor: heldFor,
    compareText: compareText,
    poll: { tick: pollTick, stop: stopPoll, POLL_MS: POLL_MS },
    PHOTO_MARGIN_MS: PHOTO_MARGIN_MS,
  };
  window.SeganLedger = exported;
  exported.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
