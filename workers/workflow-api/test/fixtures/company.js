/**
 * 업체 단위 접근 시험 픽스처 — 본사 회사 행 · 구성원 행 (src/supabase.js assertDesignAccess).
 * hqCompanyId 는 격리마다 한 번 읽어 캐시한다 — 시험 파일마다 프로세스가 따로라 파일 안에서만 이어진다.
 */

export const HQ = 'f0000000-0000-4000-8000-0000000000aa';
export const PARTNER = 'f0000000-0000-4000-8000-0000000000bb';

const ok = (rows) => ({
  ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
});

/**
 * companies · company_members 요청에 답한다 (다른 요청이면 null).
 *   hq: 본사 id (null 이면 본사 행 없음)
 *   members: [{ user_id, company_id, role, status }] — user_id=eq. · status=eq. 필터를 흉내 낸다
 *   partnerPlan: id=eq.PARTNER 로 읽을 때의 협력업체 plan (문서 등급 — src/documents.js DOC_PLANS). 기본 agent
 * id=eq. 로 본사 · PARTNER 를 읽으면 그 행 { id, kind, plan, status }, 그 밖은 예전처럼 본사 id 한 줄.
 */
export function companyRoute(u, { hq = HQ, members = [], partnerPlan = 'agent' } = {}) {
  const url = String(u);
  if (url.includes('/companies?')) {
    const id = (new URL(url).searchParams.get('id') || '').replace(/^eq\./, '');
    if (hq && id === hq) return ok([{ id: hq, kind: 'hq', plan: null, status: 'active' }]);
    if (id === PARTNER) return ok([{ id: PARTNER, kind: 'partner', plan: partnerPlan, status: 'active' }]);
    return ok(hq ? [{ id: hq }] : []);
  }
  if (url.includes('/company_members?')) {
    const q = new URL(url).searchParams;
    const want = (key, row) => {
      const f = q.get(key);
      return !f || String(row[key]) === f.replace(/^eq\./, '');
    };
    return ok(members.filter((m) => want('user_id', m) && want('status', m)).map((m) => ({ company_id: m.company_id, role: m.role })));
  }
  return null;
}
