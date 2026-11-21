/**
 * 국세청 조회 다리 — 이 워커에 등록된 키(NTS_SERVICE_KEY)로 다른 워커 대신 공공데이터포털을 부른다.
 *
 * 2026-11-21 대표님: 「사업자 등록 번호 조회 하는거 회계 기능쪽에 등록 해놨었는데? 찾아보고 이용 할 수 없음?」
 *   키는 회계장부(매입처 사업자번호 확인, src/ledger/review.js)용으로 이 워커에만 등록돼 있다.
 *   Cloudflare 는 등록한 시크릿 값을 다시 내주지 않으므로 값을 옮길 수 없다 → 사업자등록증 확인(account-api)이
 *   서비스 바인딩으로 이 다리를 부른다 (들머리 src/index.js 의 NtsGateway). 공개 주소가 없어 바깥에서는 부를 수 없다.
 *
 * 부르는 쪽이 본문을 만들고(account-api src/nts.js) 여기는 키를 붙여 그대로 전한다.
 *   kind     'status' 상태조회 · 'validate' 진위확인 — 이 둘만
 *   payload  공공데이터포털 요청 본문 (객체, 4KB 까지)
 *   돌려줌   응답 본문(JSON) | null (키 없음 · 모르는 kind · 연결 · 상태 코드 · 본문) — 던지지 않는다
 * 키 · 주소 · 번호 · 이름은 로그에 남기지 않는다.
 */

export const NTS_GATEWAY_URLS = Object.freeze({
  status: 'https://api.odcloud.kr/api/nts-businessman/v1/status',
  validate: 'https://api.odcloud.kr/api/nts-businessman/v1/validate',
});

export const NTS_GATEWAY_MAX_BODY = 4096;

export async function ntsGatewayPost(env, kind, payload) {
  const url =
    typeof kind === 'string' && Object.hasOwn(NTS_GATEWAY_URLS, kind)
      ? NTS_GATEWAY_URLS[kind]
      : null;
  if (!url || !env || !env.NTS_SERVICE_KEY) return null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  let body;
  try {
    body = JSON.stringify(payload);
  } catch {
    return null;
  }
  if (body.length > NTS_GATEWAY_MAX_BODY) return null;

  let res;
  try {
    res = await fetch(`${url}?serviceKey=${encodeURIComponent(env.NTS_SERVICE_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
  } catch {
    console.error(`[NtsGateway] ${kind} failed: network`);
    return null;
  }
  if (!res.ok) {
    console.error(`[NtsGateway] ${kind} failed:`, res.status);
    return null;
  }
  try {
    return await res.json();
  } catch {
    console.error(`[NtsGateway] ${kind} failed: body`);
    return null;
  }
}
