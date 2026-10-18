/**
 * CD-5: ERP 프론트 배선.
 *
 * 계약의 근거는 **고객이 승인한 확인서 하나뿐**이다.
 * 이 계약이 느슨해지면 승인 안 된 견적이 수주가 되고 매출이 허구가 된다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF = fs.readFileSync(path.join(ROOT, 'js/detaildesign/workflow-client.js'), 'utf8');
const ERP = fs.readFileSync(path.join(ROOT, 'erp.html'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'database/cd5-erp.sql'), 'utf8');

describe('수주 전환', () => {
  test('승인된 고객확인서에만 전환 버튼이 뜬다', () => {
    expect(WF).toMatch(/d\.doc_type === 'customer_confirmation' && d\.decision === 'approved'/);
    expect(WF).toMatch(/수주 전환/);
  });

  test('전환은 문서 단위 엔드포인트를 부른다', () => {
    expect(WF).toMatch(/'\/documents\/' \+ encodeURIComponent\(documentId\) \+ '\/order'/);
    expect(WF).toMatch(/function toOrder/);
  });

  test('이미 전환된 확인서는 그렇다고 알린다 (중복 생성 아님)', () => {
    const fn = WF.slice(WF.indexOf('async function toOrder'), WF.indexOf('async function saveSite'));
    expect(fn).toMatch(/order\.reused/);
  });

  test('설치·제작 작업지시서는 수주 대상이 아니다', () => {
    // 공장/현장 문서는 계약이 아니다
    const fn = WF.slice(WF.indexOf('function documentsHtml'), WF.indexOf('function schedulesHtml'));
    expect(fn).toMatch(/customer_confirmation/);
    expect(fn).not.toMatch(/work_order' && d\.decision/);
  });

  test('문서 종류 3종을 구분해 표시한다', () => {
    expect(WF).toMatch(/제작 작업지시서/);
    expect(WF).toMatch(/설치 작업지시서/);
    expect(WF).toMatch(/고객확인서/);
  });
});

describe('ERP 화면', () => {
  test('수주·수금·원가·마진을 모두 보여준다', () => {
    for (const id of ['kContract', 'kReceived', 'kOutstanding', 'kCost', 'kMargin', 'kQuoted']) {
      expect(ERP).toMatch(new RegExp(`id="${id}"`));
    }
  });

  test('원가 입력 항목이 있다', () => {
    for (const id of ['selCategory', 'inpDesc', 'inpVendor', 'inpAmount', 'inpDate', 'btnAddCost']) {
      expect(ERP).toMatch(new RegExp(`id="${id}"`));
    }
  });

  test('원가 분류 라벨이 코드가 아니라 우리말이다', () => {
    for (const label of ['자재', '부자재', '노무', '외주', '물류', '기타']) {
      expect(ERP).toContain(label);
    }
  });

  test('마진이 음수면 눈에 띄게 표시한다', () => {
    // 적자를 조용히 넘기면 안 된다
    expect(ERP).toMatch(/margin < 0 \? 'neg' : 'pos'/);
  });

  test('금액·마진이 담기므로 색인을 막는다', () => {
    expect(ERP).toMatch(/noindex, nofollow, noarchive/);
    expect(ERP).toMatch(/referrer.*no-referrer/);
  });

  test('수주가 없을 때 어떻게 만드는지 안내한다', () => {
    expect(ERP).toMatch(/확인서를 승인하면/);
  });
});

describe('마이그레이션', () => {
  test('한 확인서는 한 번만 수주가 된다 (DB 레벨)', () => {
    expect(SQL).toMatch(/document_id\s+UUID NOT NULL UNIQUE/);
  });

  test('계약 시점 스냅샷을 못박는다', () => {
    expect(SQL).toMatch(/snapshot_id\s+UUID NOT NULL REFERENCES design_snapshots/);
  });

  test('금액은 음수가 될 수 없다', () => {
    expect(SQL).toMatch(/contract_amount BIGINT NOT NULL CHECK \(contract_amount >= 0\)/);
    expect(SQL).toMatch(/amount\s+BIGINT NOT NULL CHECK \(amount >= 0\)/);
  });

  test('삭제로 이력이 사라지지 않는다 (RESTRICT)', () => {
    // 수주가 걸린 설계·문서·스냅샷은 지워지면 안 된다
    expect(SQL).toMatch(/REFERENCES designs\(id\) ON DELETE RESTRICT/);
    expect(SQL).toMatch(/REFERENCES design_documents\(id\) ON DELETE RESTRICT/);
  });

  test('멱등이고 트랜잭션이다', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS orders/);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS order_costs/);
    expect(SQL).toMatch(/^BEGIN;/m);
    expect(SQL).toMatch(/^COMMIT;/m);
  });

  test('RLS 를 켜고 anon 을 막는다', () => {
    expect(SQL).toMatch(/ALTER TABLE orders\s+ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/REVOKE ALL ON orders\s+FROM anon/);
    expect(SQL).toMatch(/REVOKE ALL ON order_costs FROM anon/);
  });
});

describe('수주 구분 — 고객 · 거래처 (2026-10-19 대표: 수주에 거래처 칸)', () => {
  const TIER_SQL = fs.readFileSync(path.join(ROOT, 'database/orders-price-tier.sql'), 'utf8');
  const detail = ERP.slice(ERP.indexOf('function renderDetail'), ERP.indexOf('async function load'));
  const save = ERP.slice(ERP.indexOf('async function saveOrder'), ERP.indexOf('async function addCost'));

  test('상세에서 구분을 고르고 저장한다', () => {
    expect(ERP).toMatch(/id="lblTier" hidden/);
    expect(ERP).toMatch(/id="selTier"/);
    expect(ERP).toMatch(/TIER_LABELS = \{ customer: '고객', partner: '거래처' \}/);
    expect(save).toMatch(/patch\.price_tier = el\('selTier'\)\.value \|\| null/);
  });

  test('칸이 아직 DB 에 없으면(SQL 전) 고칠 곳을 숨기고 저장에도 싣지 않는다', () => {
    expect(detail).toMatch(/hasOwnProperty\.call\(d\.order, 'price_tier'\)/);
    expect(detail).toMatch(/el\('lblTier'\)\.hidden = !hasTier/);
    expect(save).toMatch(/if \(!el\('lblTier'\)\.hidden\)/);
  });

  test('비어 있는 옛 수주는 고객으로 단정하지 않고 모름으로 둔다', () => {
    expect(detail).toMatch(/if \(!d\.order\.price_tier\) tiers\.unshift\(''\)/);
    expect(detail).toMatch(/모름 \(계약금으로 짐작\)/);
  });

  test('목록에서 거래처 주문이 보인다', () => {
    expect(ERP).toMatch(/o\.price_tier === 'partner' \? ' <span class="status tier">거래처<\/span>'/);
  });

  test('SQL: 두 값만 받고, 여러 번 실행해도 안전하고, 옛 수주는 확인서 금액 종류로 채운다', () => {
    expect(TIER_SQL).toMatch(/ADD COLUMN IF NOT EXISTS price_tier TEXT/);
    expect(TIER_SQL).toMatch(/DROP CONSTRAINT IF EXISTS orders_price_tier_chk/);
    expect(TIER_SQL).toMatch(/price_tier IN \('customer', 'partner'\)/);
    expect(TIER_SQL).toMatch(/d\.totals->>'price_tier' = 'partner'/);
    expect(TIER_SQL).toMatch(/AND o\.price_tier IS NULL/);
  });
});

describe('재작업 · A/S 기록 (경영 대시보드 2단계 PR-6)', () => {
  const PHASE2 = fs.readFileSync(path.join(ROOT, 'database/management-phase2.sql'), 'utf8');
  const render = ERP.slice(ERP.indexOf('function renderReworks'), ERP.indexOf('async function addRework'));
  const add = ERP.slice(ERP.indexOf('async function addRework'), ERP.indexOf('async function removeRework'));

  test('상세에 종류 · 원인 · 날짜 · 분 · 비용 · 부재 · 메모 입력과 목록이 있다', () => {
    for (const id of ['selReworkKind', 'selReworkCause', 'inpReworkDate', 'inpReworkMin', 'inpReworkCost', 'inpReworkParts', 'inpReworkMemo', 'btnAddRework', 'reworkRows']) {
      expect(ERP).toMatch(new RegExp(`id="${id}"`));
    }
  });

  test('워커와 같은 원인 열 가지를 우리말로 보인다', () => {
    for (const label of ['실측', '설계', '재단', '엣지', '조립', '설치', '자재 불량', '외주 불량', '고객 변경', '기타']) {
      expect(ERP).toContain(`'${label}'`);
    }
  });

  test('표가 아직 없으면(워커가 null) 입력칸 대신 SQL 안내', () => {
    expect(render).toMatch(/d\.reworks === null/);
    expect(render).toMatch(/el\('reworkForm'\)\.hidden = missing/);
    expect(ERP).toMatch(/id="reworkNeedSql"[^>]*hidden/);
  });

  test('빈 분 · 비용은 0 이 아니라 비운 채로 보낸다', () => {
    expect(add).toMatch(/inpReworkMin'\)\.value === '' \? null/);
    expect(add).toMatch(/inpReworkCost'\)\.value === '' \? null/);
  });

  test('상세를 열 때마다 기록도 다시 그린다 (원가가 비어도)', () => {
    expect(ERP).toMatch(/renderDetail\(\);\s*renderReworks\(\);/);
  });

  test('SQL: 원인 · 종류는 정해진 것만, 분 · 비용은 음수 불가, 관리자만 읽는다', () => {
    expect(PHASE2).toMatch(/kind\s+TEXT NOT NULL CHECK \(kind IN \('rework', 'as'\)\)/);
    expect(PHASE2).toMatch(/minutes\s+INT CHECK \(minutes IS NULL OR minutes >= 0\)/);
    expect(PHASE2).toMatch(/CREATE POLICY "Admin read rework logs" ON rework_logs FOR SELECT TO authenticated USING \(public\.is_admin\(\)\)/);
  });
});

describe('설치 후 한 문항 링크 (경영 대시보드 2단계 PR-7)', () => {
  const render = ERP.slice(ERP.indexOf('function renderFeedback'), ERP.indexOf('async function createFeedbackLink'));
  const create = ERP.slice(ERP.indexOf('async function createFeedbackLink'), ERP.indexOf('async function copyFeedbackLink'));
  const copy = ERP.slice(ERP.indexOf('async function copyFeedbackLink'), ERP.indexOf('async function addRework'));

  test('링크 만들기 → 링크 칸 · 복사 버튼', () => {
    for (const id of ['feedbackBox', 'btnFeedbackLink', 'feedbackLinkRow', 'inpFeedbackUrl', 'btnCopyFeedback']) {
      expect(ERP).toMatch(new RegExp(`id="${id}"`));
    }
    expect(create).toMatch(/'\/feedback-link', \{ method: 'POST' \}/);
  });

  test('평문 링크는 만든 응답에서만 보인다 — 다시 그린 뒤에 링크 칸을 연다', () => {
    expect(create.indexOf('await open(state.current)')).toBeLessThan(create.indexOf("el('feedbackLinkRow').hidden = false"));
  });

  test('답을 받았으면 점수 · 한 줄을 보이고 버튼을 숨긴다, 표가 없으면 SQL 안내', () => {
    expect(render).toMatch(/if \(f\.answered\)/);
    expect(render).toMatch(/'받은 답: ' \+ f\.score \+ '점'/);
    expect(render).toMatch(/management-phase2\.sql/);
  });

  test('복사는 클립보드, 막히면 선택해 두고 알린다', () => {
    expect(copy).toMatch(/navigator\.clipboard\.writeText/);
    expect(copy).toMatch(/input\.select\(\)/);
  });
});

describe('거래처 · 공급처 붙이기 (경영 대시보드 2단계 PR-8)', () => {
  const cp = ERP.slice(ERP.indexOf('async function loadCounterparties'), ERP.indexOf('async function addRework'));
  const save = ERP.slice(ERP.indexOf('async function saveOrder'), ERP.indexOf('async function addCost'));
  const add = ERP.slice(ERP.indexOf('async function addCost'), ERP.indexOf('async function removeCost'));

  test('수주 상세에 거래처 고르기, 원가 줄에 공급처 고르기', () => {
    expect(ERP).toMatch(/id="lblPartner" hidden/);
    expect(ERP).toMatch(/id="selPartner"/);
    expect(ERP).toMatch(/id="selSupplier" aria-label="공급처" hidden/);
  });

  test('목록은 한 번만 읽고, 관리자가 아니거나 SQL 전이면 고르기 칸을 숨긴다', () => {
    expect(cp).toMatch(/if \(state\.cp !== undefined\) return state\.cp/);
    expect(cp).toMatch(/catch \(e\) \{ state\.cp = null; \}/);
    expect(cp).toMatch(/c\.active !== false/);
  });

  test('거래처 칸은 구분이 거래처이고 칸(partner_id)이 있을 때만', () => {
    expect(cp).toMatch(/hasOwnProperty\.call\(d\.order, 'partner_id'\)/);
    expect(cp).toMatch(/el\('selTier'\)\.value === 'partner'/);
    expect(ERP).toMatch(/el\('selTier'\)\.addEventListener\('change', renderCounterparties\)/);
  });

  test('저장: 보일 때만 싣고, 고객으로 바꾸면 붙였던 거래처를 뗀다', () => {
    expect(save).toMatch(/if \(!el\('lblPartner'\)\.hidden\) patch\.partner_id = el\('selPartner'\)\.value \|\| null/);
    expect(save).toMatch(/patch\.price_tier === 'customer' && state\.detail && state\.detail\.order\.partner_id\) patch\.partner_id = null/);
  });

  test('원가: 고른 공급처를 보내고, 다 넣으면 고르기를 비운다', () => {
    expect(add).toMatch(/counterparty_id: el\('selSupplier'\)\.value \|\| null/);
    expect(add).toMatch(/el\('selSupplier'\)\.value = ''/);
  });
});
