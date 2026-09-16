/**
 * dadam-dataset-api — 학습 데이터셋 수집·내보내기
 *
 * 왜 별도 워커인가: service_role 로 원본 표(collection_posts · generations)를 통째로
 * 읽는다. 이미지 생성 워커나 결제 워커가 그 권한까지 들고 있을 이유가 없다.
 *
 * cron 둘 (wrangler.toml):
 *   *\/10 * * * *   수집  — 증분 (워터마크)
 *   30 18 * * *    내보내기 — KST 03:30. dataset_exportable → 비공개 버킷 JSONL
 *
 * HTTP (관리자 토큰 필요 — admin/dataset.html 의 버튼):
 *   GET  /health   설정 상태만 (비밀값 없음, 인증 없음)
 *   GET  /state    워터마크 · 마지막 실행 · 표별 건수
 *   POST /ingest   지금 수집
 *   POST /export   지금 내보내기
 *
 * 검수 자체는 이 워커를 지나지 않는다. 관리자 페이지가 dataset_reviews 에 직접 쓰고
 * (RLS 가 관리자만 통과시킨다), 트리거가 dataset_samples 에 반영한다.
 */
import { corsHeaders, handleOptions, jsonResponse } from './cors.js';
import { select, verifyAdmin } from './supabase.js';
import { ingestAll } from './ingest.js';
import { exportDataset } from './export.js';
import { TAXONOMY_VERSION } from './adapters.js';

async function stateSummary(env) {
  const [state, total, review, exportable] = await Promise.all([
    select(env, 'dataset_ingest_state?select=*&order=src_table.asc'),
    select(env, 'dataset_samples?select=sample_id&limit=1'),
    select(env, 'dataset_samples?select=sample_id&needs_review=is.true&limit=1'),
    select(env, 'dataset_exportable?select=sample_id&limit=1'),
  ]);
  // 건수는 Prefer: count 를 쓰지 않고 헤더 없이 세면 비싸다 — 필요한 화면(관리자)에서
  // Supabase 클라이언트가 count 로 직접 센다. 여기서는 "있나 없나" 만 알린다.
  return {
    taxonomy_version: TAXONOMY_VERSION,
    sources: state,
    has_samples: total.length > 0,
    has_review_queue: review.length > 0,
    has_exportable: exportable.length > 0,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return handleOptions(request, env);

    if (url.pathname === '/health') {
      return jsonResponse(request, env, {
        ok: true,
        service: 'dadam-dataset-api',
        taxonomy_version: TAXONOMY_VERSION,
        configured: !!env.SUPABASE_SERVICE_ROLE_KEY,
        export_bucket: env.EXPORT_BUCKET || 'datasets',
      });
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(request, env, { error: '워커에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다 (DEPLOY.md)' }, 503);
    }

    const auth = await verifyAdmin(request, env);
    if (!auth.ok) return jsonResponse(request, env, { error: auth.error }, auth.status);

    try {
      if (url.pathname === '/state' && request.method === 'GET') {
        return jsonResponse(request, env, await stateSummary(env));
      }
      if (url.pathname === '/ingest' && request.method === 'POST') {
        const results = await ingestAll(env);
        return jsonResponse(request, env, { ok: !results.some((r) => r.error), results, by: auth.user.email });
      }
      if (url.pathname === '/export' && request.method === 'POST') {
        return jsonResponse(request, env, { ok: true, ...(await exportDataset(env)), by: auth.user.email });
      }
    } catch (e) {
      return jsonResponse(request, env, { error: String(e.message || e).slice(0, 400) }, 500);
    }

    return new Response('not found', { status: 404, headers: corsHeaders(request, env) });
  },

  /** cron. 오래 걸려도 요청을 붙잡지 않는다 — 실패는 로그로 남기고 다음 실행이 이어받는다. */
  async scheduled(event, env, ctx) {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[dataset] SUPABASE_SERVICE_ROLE_KEY 없음 — 건너뜀');
      return;
    }
    const nightly = event.cron === '30 18 * * *';
    ctx.waitUntil(
      (async () => {
        try {
          const ingested = await ingestAll(env);
          console.log('[dataset] ingest', JSON.stringify(ingested));
          if (nightly) console.log('[dataset] export', JSON.stringify(await exportDataset(env)));
        } catch (e) {
          console.error('[dataset] cron 실패', e && e.message);
        }
      })()
    );
  },
};
