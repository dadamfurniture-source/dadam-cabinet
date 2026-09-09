/**
 * Dadam Generate API — Cloudflare Worker
 * POST /api/generate
 *
 * 파이프라인 (전 품목 동일, Gemini 모델 하나):
 *   1. 분석   사진 → 벽 치수 JSON            (텍스트, 벽 폭을 직접 넣으면 건너뜀)
 *   2. 설치   사진 → 가구 설치, 문 닫힘        (이미지 1장 = 기본안)
 *   3. 변형   설치 결과 → 마감만 바꾼 추천안    (이미지 3장 병렬)
 *
 * 품목별 차이는 prompts.js 의 CATEGORIES 한 문단과 quote.js 의 단가 한 줄이 전부다.
 */

import { callGemini, geminiModel } from './gemini.js';
import {
  DEFAULT_STYLE,
  STYLES,
  buildAnalysisPrompt,
  buildInstallPrompt,
  buildVariantPrompt,
  clampWall,
  parseAnalysis,
  pickFinishes,
  resolveCategory,
} from './prompts.js';
import { buildQuote } from './quote.js';
import { verifyJwt, AuthError } from './auth.js';
import { consumeCredit, refundCredit, InsufficientCredit } from './credits.js';

// Durable Object 클래스는 워커 진입점에서 export 되어야 런타임이 찾는다.
export { GeminiProxy } from './proxy.js';

const VARIANT_COUNT = 3;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/** 참고 이미지: {base64, mimeType} 객체 배열. 문자열만 온 예전 형식도 JPEG 로 받아 준다. */
function normalizeRefs(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((r) =>
      typeof r === 'string'
        ? { base64: r, mimeType: 'image/jpeg' }
        : r && r.base64
          ? { base64: r.base64, mimeType: r.mimeType || r.mime || 'image/jpeg' }
          : null
    )
    .filter(Boolean)
    .slice(0, 5);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request.headers.get('Origin') || '*');

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/health' || url.pathname === '/') {
      return json(
        {
          status: 'ok',
          service: 'dadam-generate-api',
          worker: true,
          model: geminiModel(env),
          colo: (request.cf && request.cf.colo) || null, // 지역 차단 진단용
        },
        200,
        headers
      );
    }
    if (url.pathname !== '/api/generate' || request.method !== 'POST') {
      return json({ error: 'Not found' }, 404, headers);
    }

    const startTime = Date.now();
    let creditRef = null; // catch 에서 환불하려면 try 밖에 있어야 한다

    try {
      if (!env.GEMINI_API_KEY)
        return json({ success: false, error: 'GEMINI_API_KEY not configured' }, 500, headers);

      // 인증 — 본문을 읽기 전에. 인증 없는 요청이 수 MB base64 를 파싱하게 두지 않는다.
      let user;
      try {
        user = await verifyJwt(request, env);
      } catch (e) {
        if (e instanceof AuthError) return json({ success: false, error: e.message }, 401, headers);
        throw e;
      }

      // 크레딧 차감. 잔액 확인과 차감이 한 RPC 안에서 끝난다.
      try {
        const c = await consumeCredit(request, env, 'generate');
        creditRef = c.ref;
        console.log(`[Generate] user=${user.id} credit → ${c.balance}`);
      } catch (e) {
        if (e instanceof InsufficientCredit) {
          return json(
            {
              success: false,
              error: '이번 달 생성 횟수를 모두 사용했습니다.',
              code: 'insufficient_credit',
            },
            402,
            headers
          );
        }
        throw e;
      }

      const body = await request.json();
      const {
        room_image,
        image_type = 'image/jpeg',
        category: rawCategory = 'sink',
        design_style = DEFAULT_STYLE,
        door_color = 'white',
        door_finish = 'matte',
        wall_width_override,
        fridge_options = {},
        reference_images,
      } = body;

      if (!room_image) {
        await refundCredit(request, env, creditRef);
        return json({ success: false, error: 'room_image is required' }, 400, headers);
      }

      const category = resolveCategory(rawCategory);
      const style = STYLES[design_style] ? design_style : DEFAULT_STYLE;
      const room = { base64: room_image, mimeType: image_type };
      const refs = normalizeRefs(reference_images);
      console.log(
        `[Generate] category=${rawCategory}→${category} style=${style} refs=${refs.length} model=${geminiModel(env)}`
      );

      // ═══ 1. 분석 ═══
      let wall = { wallW: 3000, wallH: 2400, waterPct: 30, exhaustPct: 70, confidence: null };
      const manualW = Number(wall_width_override);
      if (manualW >= 1000 && manualW <= 6000) {
        wall.wallW = clampWall(manualW);
        wall.confidence = 'user';
      } else {
        try {
          const r = await callGemini(env, {
            prompt: buildAnalysisPrompt(),
            images: [room],
            want: 'text',
          });
          wall = parseAnalysis(r.text);
        } catch (e) {
          console.warn('[Generate] analysis failed, using defaults:', e.message);
        }
      }
      console.log(
        `[Generate] wall ${wall.wallW}x${wall.wallH} water=${wall.waterPct}% exhaust=${wall.exhaustPct}%`
      );

      // ═══ 2. 설치 ═══
      const ctx = {
        category,
        ...wall,
        style,
        doorColor: door_color,
        doorFinish: door_finish,
        refCount: refs.length,
        fridgeBrand: fridge_options.brand === 'lg' ? 'LG' : 'Samsung',
        fridgePosition: fridge_options.position === 'right' ? 'right' : 'left',
      };
      const installed = await callGemini(env, {
        prompt: buildInstallPrompt(ctx),
        images: [room, ...refs],
      });
      if (!installed.image) {
        await refundCredit(request, env, creditRef);
        return json({ success: false, error: 'Failed to generate image' }, 500, headers);
      }
      const base = { base64: installed.image, mimeType: 'image/png' };

      // ═══ 3. 변형 — 추천안 3장 병렬. 한 장이 실패해도 나머지는 보여준다. ═══
      const finishes = pickFinishes(VARIANT_COUNT, wall.wallW + category.length * 7919);
      const variants = (
        await Promise.all(
          finishes.map(async (f) => {
            try {
              const r = await callGemini(env, { prompt: buildVariantPrompt(f), images: [base] });
              return r.image ? { image: r.image, finish: f } : null;
            } catch (e) {
              console.warn('[Generate] variant failed:', f.key, e.message);
              return null;
            }
          })
        )
      ).filter(Boolean);

      const quote = buildQuote(category, wall.wallW);
      const elapsed = Date.now() - startTime;
      console.log(`[Generate] done: variants ${variants.length}/${VARIANT_COUNT}, ${elapsed}ms`);

      const altStyles = variants.map((v) => ({
        name: `AI 추천 · ${v.finish.tone}`,
        key: v.finish.key,
        body: v.finish.body,
        accent: v.finish.accent,
      }));

      return json(
        {
          success: true,
          generated_image: {
            background: room_image,
            closed: installed.image,
            alts: variants.map((v) => v.image),
            // 예전 화면이 읽는 키. 첫 추천안을 그대로 둔다.
            alt: variants[0] ? variants[0].image : null,
            open: variants[0] ? variants[0].image : null,
          },
          quote,
          wall_analysis: wall,
          alt_style: altStyles[0] || null,
          alt_styles: altStyles,
          metadata: {
            category,
            design_style: style,
            door_color,
            door_finish,
            model: geminiModel(env),
            reference_count: refs.length,
            elapsed_ms: elapsed,
          },
        },
        200,
        headers
      );
    } catch (error) {
      console.error('[Generate] error:', error.message);
      await refundCredit(request, env, creditRef); // 사용자가 아무것도 못 받았으면 되돌린다
      return json({ success: false, error: error.message }, 500, headers);
    }
  },
};
