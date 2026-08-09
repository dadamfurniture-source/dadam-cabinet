/**
 * CD-4: 설치 도메인 프론트 배선.
 *
 * 현장 정보는 **설계**에 붙는다 — 스냅샷이 아니다.
 * 주소를 고쳤다고 설계 스냅샷 rev 가 올라가면 안 되기 때문이다.
 */
const fs = require('fs');
const path = require('path');

const WF = fs.readFileSync(
  path.join(__dirname, '../js/detaildesign/workflow-client.js'),
  'utf8'
);
const SQL = fs.readFileSync(path.join(__dirname, '../database/cd4-install-domain.sql'), 'utf8');

describe('현장 정보 입력', () => {
  test('설치에 필요한 항목이 모두 있다', () => {
    // id 는 문자열 연결로 만들어지므로 리터럴이 아니라 식별자로 확인한다
    for (const id of [
      'wfSiteAddress', 'wfSiteAddressDetail', 'wfSiteFloor', 'wfSiteElevator',
      'wfSiteContactName', 'wfSiteContactPhone', 'wfSiteAccess', 'wfSiteOrder',
    ]) {
      expect(WF).toContain(`'${id}'`);
    }
  });

  test('입력한 값을 모두 서버로 보낸다', () => {
    const fn = WF.slice(WF.indexOf('async function saveSite'), WF.indexOf('async function addSchedule'));
    for (const field of [
      'address', 'address_detail', 'floor', 'has_elevator',
      'contact_name', 'contact_phone', 'access_note', 'install_order',
    ]) {
      expect(fn).toContain(`${field}:`);
    }
  });

  test('엘리베이터는 미확인/있음/없음 3상태다', () => {
    // 미확인을 '없음' 으로 단정하면 사다리차를 잘못 부른다
    expect(WF).toMatch(/opt\('', '미확인'\)/);
    expect(WF).toMatch(/opt\('true', '있음'\)/);
    expect(WF).toMatch(/사다리차 검토/);
    expect(WF).toMatch(/elev === '' \? null : elev === 'true'/);
  });

  test('설계 단위로 저장한다 (스냅샷 아님)', () => {
    expect(WF).toMatch(/'\/designs\/' \+ encodeURIComponent\(id\) \+ '\/site-info'/);
    expect(WF).toMatch(/method: 'PUT'/);
  });

  test('패널을 열 때 현장 정보를 함께 불러온다', () => {
    expect(WF).toMatch(/state\.site = site \|\| null/);
    expect(WF).toMatch(/'\/site-info'\)\.catch/);
  });
});

describe('설치 작업지시서 발행', () => {
  test('버튼이 있고 installation_order 로 발행한다', () => {
    expect(WF).toMatch(/id="wfIssueIO"/);
    expect(WF).toMatch(/issue\('installation_order'\)/);
  });

  test('제작 지시서와 구분되는 이름이다', () => {
    expect(WF).toMatch(/제작 작업지시서/);
    expect(WF).toMatch(/설치 작업지시서/);
  });
});

describe('마이그레이션', () => {
  test('doc_type 이 3종으로 확장된다', () => {
    expect(SQL).toMatch(/installation_order/);
    expect(SQL).toMatch(/customer_confirmation/);
    expect(SQL).toMatch(/'work_order'/);
  });

  test('멱등이다 (두 번 실행해도 안전)', () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS design_site_info/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS started_at/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS completed_at/);
    expect(SQL).toMatch(/DROP CONSTRAINT IF EXISTS/);
  });

  test('트랜잭션으로 감싼다', () => {
    expect(SQL).toMatch(/^BEGIN;/m);
    expect(SQL).toMatch(/^COMMIT;/m);
  });

  test('RLS 를 켜고 anon 을 막는다', () => {
    expect(SQL).toMatch(/ALTER TABLE design_site_info ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/REVOKE ALL ON design_site_info FROM anon/);
  });

  test('완료가 착수보다 빠를 수 없다', () => {
    expect(SQL).toMatch(/completed_at >= started_at/);
  });
});
