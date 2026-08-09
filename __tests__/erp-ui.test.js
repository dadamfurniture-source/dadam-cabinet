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
