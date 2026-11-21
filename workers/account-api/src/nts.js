/**
 * 사업자등록번호 — 검증 숫자 · 국세청 상태조회 · 진위확인 (account-api).
 *
 * 사업자등록증 자동 확인(biz-cert.js)이 쓴다. 워커끼리 파일을 import 하지 않으므로 workflow-api 의 같은 셈을 옮겨 왔다:
 *   normalizeBizNo · bizNoValid   workers/workflow-api/src/ledger/checks.js 와 같은 셈 (가중치 1,3,7,1,3,7,1,3,5)
 *   ntsRow · lookupNtsStatus      workers/workflow-api/src/ledger/review.js 의 ntsRow · lookupNts 와 같은 부르기
 *
 * 공공데이터포털 「국세청_사업자등록정보 진위확인 및 상태조회 서비스」.
 *   키는 회계장부용으로 workflow-api 에 등록돼 있다 (2026-11-21 대표님: 「회계 기능쪽에 등록 해놨었는데? … 이용 할 수 없음?」).
 *   Cloudflare 는 시크릿 값을 다시 내주지 않아 옮길 수 없으므로, 이 워커는 서비스 바인딩 WORKFLOW_NTS
 *   (workflow-api 의 진입점 NtsGateway, workers/workflow-api/src/nts-gateway.js)로 그 키를 빌려 부른다.
 *   이 워커에 시크릿 NTS_SERVICE_KEY 를 따로 넣으면 그것을 먼저 쓴다 (바로 부른다). 둘 다 없으면 묻지 않는다(null).
 *   상태조회  POST {NTS_STATUS_URL}?serviceKey=…    본문 { b_no: [번호] }
 *             응답 data[0].b_stt_cd — 01 계속사업자 · 02 휴업자 · 03 폐업자, 비어 있으면 등록되지 않은 번호
 *   진위확인  POST {NTS_VALIDATE_URL}?serviceKey=…  본문 { businesses: [{ b_no, start_dt(YYYYMMDD), p_nm, p_nm2, b_nm, corp_no, b_sector, b_type }] }
 *             응답 data[0].valid — "01" 일치 · "02" 불일치(확인할 수 없음)
 *     ※ 진위확인은 이 저장소에서 처음 쓴다. 위 본문 · 응답 모양은 공공데이터포털 명세 기준이고 **실제 키로 확인하지 못했다**
 *       (2026-11-21). 실제 응답이 다르면 validateNts 는 null(확인 못 함)을 돌려주고 그 건은 본사 검토로 간다.
 *
 * 실패(키도 바인딩도 없음 · 연결 · 상태 코드 · 본문 · 다리 오류)는 null — 던지지 않는다. 키 · 주소 · 번호 · 이름은 로그에 남기지 않는다.
 */

export const NTS_STATUS_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/status';
export const NTS_VALIDATE_URL = 'https://api.odcloud.kr/api/nts-businessman/v1/validate';

/** 사업자등록번호 — 숫자 10자리로 (- · 빈칸 뺌). 비면 null */
export function normalizeBizNo(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[-\s]/g, '');
  return s === '' ? null : s;
}

/** 사업자등록번호 검증 숫자 — 가중치 1,3,7,1,3,7,1,3,5 */
export function bizNoValid(bizNo) {
  if (typeof bizNo !== 'string' || !/^\d{10}$/.test(bizNo)) return false;
  const d = bizNo.split('').map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * w[i];
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

const NTS_STATUS = { '01': 'active', '02': 'suspended', '03': 'closed' };

/** 상태조회 한 건 (순수) — 응답 data[0] → { biz_no, status, tax_type, closed_on } */
export function ntsRow(bizNo, d) {
  const status = NTS_STATUS[d && d.b_stt_cd] || 'unregistered';
  const end =
    d && typeof d.end_dt === 'string' && /^\d{8}$/.test(d.end_dt)
      ? `${d.end_dt.slice(0, 4)}-${d.end_dt.slice(4, 6)}-${d.end_dt.slice(6, 8)}`
      : null;
  const tax =
    status !== 'unregistered' && d && typeof d.tax_type === 'string' && d.tax_type.trim()
      ? d.tax_type.trim().slice(0, 60)
      : null;
  return { biz_no: bizNo, status, tax_type: tax, closed_on: end };
}

/** 공공데이터포털 POST → 응답 본문(JSON) | null. what 은 'status' | 'validate' — 로그에 남기는 이름이자 다리(NtsGateway)의 kind */
async function ntsPost(env, url, payload, what) {
  if (!env.NTS_SERVICE_KEY) {
    // 이 워커에 키가 없으면 회계 서버에 등록된 키로 — 서비스 바인딩 WORKFLOW_NTS
    if (!env.WORKFLOW_NTS) return null;
    try {
      const body = await env.WORKFLOW_NTS.post(what, payload);
      return body && typeof body === 'object' ? body : null;
    } catch {
      console.error(`[cert] NTS ${what} failed: gateway`);
      return null;
    }
  }
  let res;
  try {
    res = await fetch(`${url}?serviceKey=${encodeURIComponent(env.NTS_SERVICE_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    console.error(`[cert] NTS ${what} failed: network`);
    return null;
  }
  if (!res.ok) {
    console.error(`[cert] NTS ${what} failed:`, res.status);
    return null;
  }
  try {
    return await res.json();
  } catch {
    console.error(`[cert] NTS ${what} failed: body`);
    return null;
  }
}

const rowOf = (body, bizNo) =>
  body && body.status_code === 'OK' && Array.isArray(body.data)
    ? body.data.find((x) => x && String(x.b_no) === bizNo) || null
    : null;

/** 상태조회 → { biz_no, status: active | suspended | closed | unregistered, tax_type, closed_on } | null (확인 못 함) */
export async function lookupNtsStatus(env, bizNo) {
  const body = await ntsPost(env, NTS_STATUS_URL, { b_no: [bizNo] }, 'status');
  if (!body) return null;
  const d = rowOf(body, bizNo);
  if (!d) {
    console.error('[cert] NTS status failed: status');
    return null;
  }
  return ntsRow(bizNo, d);
}

/**
 * 진위확인 — 등록번호 · 개업일 · 대표자가 국세청 기록과 맞는가.
 * @param {{ bizNo: string, openDate: string, representativeName: string }} v  openDate 는 'YYYY-MM-DD'
 * @returns {Promise<boolean | null>}  true 일치("01") · false 불일치("02") · null 확인 못 함
 */
export async function validateNts(env, { bizNo, openDate, representativeName }) {
  const body = await ntsPost(
    env,
    NTS_VALIDATE_URL,
    {
      businesses: [
        {
          b_no: bizNo,
          start_dt: String(openDate).replace(/-/g, ''),
          p_nm: representativeName,
          p_nm2: '',
          b_nm: '',
          corp_no: '',
          b_sector: '',
          b_type: '',
        },
      ],
    },
    'validate'
  );
  if (!body) return null;
  const d = rowOf(body, bizNo);
  if (d && d.valid === '01') return true;
  if (d && d.valid === '02') return false;
  console.error('[cert] NTS validate failed: status');
  return null;
}
