/**
 * Dadam Generate API — Cloudflare Worker (v2, 비동기)
 *
 *   POST   /api/generate              잡 생성 → 202 {id}          (JWT)
 *   GET    /api/generate/:id          진행 상태·결과               (JWT, 본인)
 *   DELETE /api/generate/:id          결과·파일 삭제               (JWT, 본인)
 *   POST   /api/generate/:id/share    공유 링크 발급(회전)         (JWT, 본인)
 *   DELETE /api/generate/:id/share    공유 회수                    (JWT, 본인)
 *   POST   /api/generate/:id/layout   구성 분석 → 플래너용 layout  (JWT, 본인, 완료된 결과만)
 *   GET    /api/share                 공유 열람                    (X-Share-Token)
 *   POST   /api/admin/appliance-image 가전 모델 제품 사진 가져오기 (JWT, admin · super_admin)
 *   GET    /health                    진단 (모델·콜로)
 *
 * 생성 자체는 job.js 의 GenerateJob(Durable Object, 미국 콜로) 이 alarm 으로 실행한다.
 * 이 파일은 인증·크레딧·입력 업로드·행 생성·조회만 한다.
 * 진행 상태의 정본은 generations 행이다 (폴링은 행만 읽는다).
 * CORS 허용 목록·요청 한도·본문 크기는 guard.js (2026-10-26).
 */

import { callGemini, geminiModel, textModel } from './gemini.js';
import { imageProvider, plannerDefaultProvider, resolvePlannerProvider } from './images.js';
import { openaiImageModel } from './openai.js';
import { assertContentLength, corsHeaders, enforceRateLimit, readBodyText } from './guard.js';
import {
  DEFAULT_STYLE,
  DOOR_COLORS,
  DOOR_FINISHES,
  KITCHEN_CATEGORIES,
  STYLES,
  buildChatPrompt,
  cleanChatReply,
  cleanCustomerRequest,
  cleanThemeNote,
  normalizeChat,
  normalizeDesignSpec,
  resolveCategory,
  resolvePlannerAspect,
} from './prompts.js';
import { verifyJwt, AuthError } from './auth.js';
import { consumeCredit, refundCredit, InsufficientCredit } from './credits.js';
import {
  selectOne,
  insertOne,
  updateById,
  deleteById,
  uploadObject,
  removeObjects,
  fetchObjectBase64,
  extOf,
  bucketName,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from './supabase.js';
import { jobStub } from './job.js';
import { assertPlannerTier } from './tier-gate.js';
import { copyApplianceImage } from './appliance-image.js';
import { LAYOUT_CATEGORIES, LAYOUT_SCHEMA, buildLayoutPrompt, normalizeLayout } from './layout.js';
import { callClaudeJson } from './claude.js';
import {
  generateShareToken,
  hashShareToken,
  buildShareUrl,
  shareExpiryIso,
  checkShareAccessible,
  isInternalOnly,
} from './share.js';
import { OWNER_SIGNED_TTL_SEC, shareSignedTtl, signImageUrls } from './storage-urls.js';
import { removeCollectionPostsFor } from './collection-post.js';

// Durable Object 클래스는 워커 진입점에서 export 되어야 런타임이 찾는다.
export { GeminiProxy } from './proxy.js';
export { GenerateJob } from './job.js';

const MAX_REFS = 5;
const ACTIVE_STATUSES = ['queued', 'analyzing', 'rendering', 'qc', 'variants'];
const ACTIVE_WINDOW_MS = 12 * 60_000; // 이보다 오래된 '실행 중' 은 죽은 잡으로 본다
/** 클라이언트에 돌려주는 열. credit_ref·share_token_hash 는 절대 나가지 않는다. */
const PUBLIC_COLUMNS =
  'id,parent_id,status,progress,step_label,error,category,title,options,wall_analysis,quote,images,layout,model,elapsed_ms,credit_cost,is_favorite,share_expires_at,share_revoked_at,created_at,completed_at';
/** Anthropic 이미지 한도 5MB — base64 로는 4/3 배. 넘으면 분석하지 않는다. */
const MAX_IMAGE_B64 = Math.floor((5 * 1024 * 1024 * 4) / 3);
/**
 * 요청 본문 상한 (2026-10-26). 가장 큰 정상 요청은 플래너 모드 — 방 사진(긴 변 1600 JPEG) + 도면 렌더 최대 7장
 * (긴 변 1536 PNG) 이 base64 로 실린다. 일반 연출컷은 방 사진 + 참고 이미지 5장. 둘 다 이보다 한참 작다.
 */
const MAX_BODY_BYTES = 32 * 1024 * 1024;
/**
 * 받는 이미지 형식 — 버킷 확장자(supabase.js extOf)·가전 사진(appliance-image.js)과 같은 셋.
 * 화면(ai-design.html · js/planner/ai-photo.js)은 image/jpeg · image/png 만 보낸다. 버킷에 그대로 Content-Type 으로 올라간다.
 */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

const CODE_BY_STATUS = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'already_running',
  410: 'gone',
  413: 'body_too_large',
  429: 'rate_limited',
};

function badRequest(message, code) {
  const e = new ValidationError(message);
  e.code = code;
  return e;
}

/** 본문 JSON — maxBytes 를 넘으면 413, JSON 이 아니면 400. */
async function readJsonBody(request, maxBytes) {
  const raw = await readBodyText(request, maxBytes);
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('body must be JSON', 'bad_json');
  }
}

function errorResponse(e, headers) {
  const status = e.statusCode || (e instanceof AuthError ? 401 : 500);
  const code = e.code || CODE_BY_STATUS[status] || 'internal';
  if (status >= 500) console.error('[Generate] error:', e.message);
  if (e.body) return json(e.body, status, headers); // 계약으로 모양이 정해진 거절 (internal_only)
  return json({ success: false, error: e.message, code }, status, headers);
}

/**
 * 참고 이미지: {base64, mimeType, role?, note?} 객체 배열. 문자열만 온 예전 형식도 JPEG 로 받아 준다.
 * note 는 테마 사진의 설명(관리자가 적은 것) — 테마일 때만 받아 색감 추출에 힌트로 쓴다.
 * 형식이 IMAGE_TYPES 밖이면 그 한 장만 버린다 (업로드 실패한 참고 이미지처럼 — 생성은 간다).
 */
function normalizeRefs(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => {
      if (typeof r === 'string') return { base64: r, mimeType: 'image/jpeg' };
      if (!r || typeof r.base64 !== 'string' || !r.base64) return null;
      const mimeType = r.mimeType || r.mime || 'image/jpeg';
      if (!IMAGE_TYPES.includes(mimeType)) {
        console.warn('[Generate] ref skipped: image type not allowed');
        return null;
      }
      // theme = 색감만 빌린다 (추천안 한 장), 그 외(upload·case) = 설치 참고
      const role = r.role === 'theme' ? 'theme' : 'style';
      const out = { base64: r.base64, mimeType, role };
      const note = role === 'theme' ? cleanThemeNote(r.note) : null;
      if (note) out.note = note;
      return out;
    })
    .filter(Boolean)
    .slice(0, MAX_REFS);
}

/**
 * 플래너 모드의 도면 렌더: [{role:'elevation'|'elevation_labeled'|'massing', base64, mimeType|mime}].
 * 역할마다 한 장(앞의 것), 최대 3장. 다른 역할·빈 값은 버린다. 순서는 elevation → elevation_labeled → massing.
 *   2026-10-19: elevation_labeled = 번호·치수선을 얹은 정면 입면 (선택). GPT 에만 간다 — Gemini 는 번호를 그려 넣는다.
 *   번호 없는 elevation 은 여전히 필수다 (Gemini 가 그릴 때·GPT 실패 대체 때 쓴다).
 */
//   2026-10-19: ㄱ자·ㄷ자 꺾인 벽의 정면 입면 elevation_left · elevation_right (+ _labeled) — 선택, 최대 7장.
//   design_spec.walls[] 에 그 벽이 있을 때만 프롬프트가 쓴다. 번호 붙은 것은 GPT 에만 (주벽 입면과 같은 규칙).
const RENDER_ROLES = [
  'elevation', 'elevation_labeled', 'massing',
  'elevation_left', 'elevation_left_labeled', 'elevation_right', 'elevation_right_labeled',
];
function normalizeRenders(list) {
  if (!Array.isArray(list)) return [];
  const byRole = {};
  for (const r of list) {
    if (!r || typeof r !== 'object' || !RENDER_ROLES.includes(r.role)) continue;
    if (typeof r.base64 !== 'string' || !r.base64 || byRole[r.role]) continue;
    const mimeType = r.mimeType || r.mime || 'image/png';
    if (!IMAGE_TYPES.includes(mimeType)) continue; // 형식이 틀린 렌더는 없는 것으로 (입면이면 missing_render)
    byRole[r.role] = { role: r.role, base64: r.base64, mimeType };
  }
  return RENDER_ROLES.filter((k) => byRole[k]).map((k) => byRole[k]);
}

function isStale(row) {
  return Date.now() - new Date(row.created_at).getTime() > ACTIVE_WINDOW_MS;
}

/**
 * 플래너 도면 요약. 요청이 주면 검증해서 쓰고(틀리면 400), 없으면 재생성 원본의 것을 잇는다.
 * 원본 것을 이을 때는 던지지 않는다 — 품목을 바꿔 다시 그리는 길을 400 으로 막지 않는다.
 */
/**
 * 2026-10-20 냉장고장 일반 모드 옵션 — brand(samsung|lg) · position(left|right) 는 예전대로, models 는 appliance_models
 *   model_code 최대 2개(수집한 코드 모양만 — PostgREST 필터에 들어간다). 없으면 잡이 브랜드 기본 세트(D1)를 쓴다.
 */
function normalizeFridgeOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const out = {
    brand: o.brand === 'lg' ? 'lg' : 'samsung',
    position: o.position === 'right' ? 'right' : 'left',
  };
  const models = Array.isArray(o.models)
    ? o.models.filter((c) => typeof c === 'string' && /^[A-Za-z0-9][A-Za-z0-9._()-]{0,39}$/.test(c)).slice(0, 2)
    : [];
  if (models.length) out.models = models;
  return out;
}

function resolveDesignSpec(raw, parent, category) {
  if (raw !== undefined && raw !== null) return normalizeDesignSpec(raw, category);
  const inherited = parent && parent.options && parent.options.design_spec;
  if (!inherited) return null;
  try {
    return normalizeDesignSpec(inherited, category);
  } catch (e) {
    console.warn('[Generate] parent design_spec dropped:', e.message);
    return null;
  }
}

function publicView(row) {
  if (!row) return null;
  return {
    ...row,
    shared: !!(
      row.share_expires_at &&
      !row.share_revoked_at &&
      new Date(row.share_expires_at) > new Date()
    ),
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request.headers.get('Origin'), env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      // 본문 크기 — 어느 라우트든 인증·파싱보다 먼저 (선언된 길이만. 읽으면서 세는 건 라우트가 한다)
      assertContentLength(request, MAX_BODY_BYTES);

      if (url.pathname === '/health' || url.pathname === '/') {
        return json(
          {
            status: 'ok',
            service: 'dadam-generate-api',
            worker: true,
            version: 2,
            model: geminiModel(env),
            // 연출컷 이미지를 지금 누가 그리나 — 키 값은 싣지 않고 공급자·모델만 (2026-10-18)
            image_provider: imageProvider(env),
            image_model: imageProvider(env) === 'openai' ? openaiImageModel(env) : geminiModel(env),
            // 플래너 모드 기본 공급자 (2026-10-19, PLANNER_IMAGE_PROVIDER) — 요청이 image_provider 를 안 보낼 때
            planner_image_provider: plannerDefaultProvider(env),
            // 가이드 선(붙박이장 앞면) 을 찾는 모델 — Claude 키가 있으면 Haiku 5.5, 없으면 Gemini 텍스트 모델
            guide_points_model: env.ANTHROPIC_API_KEY ? env.GUIDE_MODEL || 'claude-haiku-5-5' : textModel(env),
            colo: (request.cf && request.cf.colo) || null,
          },
          200,
          headers
        );
      }

      if (url.pathname === '/api/chat' && request.method === 'POST') {
        return json(await chat(request, env), 200, headers);
      }

      if (url.pathname === '/api/share' && request.method === 'GET') {
        return json(await getShared(request, env), 200, headers);
      }

      // 2026-10-20: 가전 모델 제품 사진 — 관리자가 제조사 사진을 우리 버킷으로 가져온다 (appliance-image.js)
      if (url.pathname === '/api/admin/appliance-image' && request.method === 'POST') {
        return json(await copyApplianceImage(request, env), 200, headers);
      }

      const m = url.pathname.match(/^\/api\/generate(?:\/([0-9a-f-]{36}))?(\/share|\/layout)?$/);
      if (!m) return json({ success: false, error: 'Not found', code: 'not_found' }, 404, headers);
      const [, id, sub] = m;
      const isShare = sub === '/share';
      const isLayout = sub === '/layout';

      if (!id && request.method === 'POST') return await createGeneration(request, env, headers);
      if (id && !sub && request.method === 'GET')
        return json(await getGeneration(request, env, id), 200, headers);
      if (id && !sub && request.method === 'DELETE')
        return json(await deleteGeneration(request, env, id), 200, headers);
      if (id && isShare && request.method === 'POST')
        return json(await createShare(request, env, id), 200, headers);
      if (id && isShare && request.method === 'DELETE')
        return json(await revokeShare(request, env, id), 200, headers);
      if (id && isLayout && request.method === 'POST')
        return json(await createLayout(request, env, id, url), 200, headers);
      return json({ success: false, error: 'Method not allowed', code: 'method' }, 405, headers);
    } catch (e) {
      return errorResponse(e, headers);
    }
  },
};

// ─── 핸들러 ───

/**
 * POST /api/chat — 연출컷 ③ 상세 요청의 다음 한 마디 (2026-10-08).
 * 로그인한 손님만 — 익명으로 모델 호출을 열어 두지 않는다. 크레딧은 쓰지 않는다 (짧은 텍스트 한 번).
 * 사용자마다 요청 한도 CHAT_LIMIT (wrangler.toml [[ratelimits]], 2026-10-26).
 * 본문: { category, messages:[{role:'me'|'ai', text}] } → { success, reply }
 */
const CHAT_MAX_BODY = 32 * 1024;
async function chat(request, env) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  const user = await verifyJwt(request, env);
  await enforceRateLimit(env.CHAT_LIMIT, user.id);
  // 글자 수 검사는 아래 그대로 — UTF-8 은 UTF-16 한 칸에 최대 3바이트라, 그 3배까지만 읽는다
  const raw = await readBodyText(request, CHAT_MAX_BODY * 3);
  if (raw.length > CHAT_MAX_BODY) throw new ValidationError('chat body too large');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ValidationError('chat body must be JSON');
  }
  const messages = normalizeChat(body && body.messages);
  if (!messages.length) throw new ValidationError('messages must include a customer message');
  const r = await callGemini(env, {
    prompt: buildChatPrompt({ category: body.category, messages }),
    want: 'text',
    temperature: 0.6,
    retryDelaysMs: [3_000], // 손님이 채팅창에서 기다린다 — 과부하면 3초 뒤 한 번만
  });
  const reply = cleanChatReply(r.text);
  if (!reply) throw new Error('chat: empty reply');
  return { success: true, reply };
}

async function requireOwner(request, env, id) {
  const user = await verifyJwt(request, env);
  const row = await selectOne(env, 'generations', { id: `eq.${id}`, select: '*' });
  if (!row) throw new NotFoundError('생성 결과를 찾을 수 없습니다');
  if (row.user_id !== user.id) throw new ForbiddenError('본인 결과가 아닙니다');
  return { user, row };
}

async function createGeneration(request, env, headers) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');

  // 인증 — 본문을 읽기 전에. 인증 없는 요청이 수 MB base64 를 파싱하게 두지 않는다.
  const user = await verifyJwt(request, env);
  // 요청 한도 (2026-10-26) — 사용자마다 GENERATE_LIMIT. 본문·DB 보다 먼저.
  await enforceRateLimit(env.GENERATE_LIMIT, user.id);

  // 사용자당 실행 중 잡 1개.
  const active = await selectOne(env, 'generations', {
    user_id: `eq.${user.id}`,
    status: `in.(${ACTIVE_STATUSES.join(',')})`,
    select: 'id,created_at',
  });
  if (active && !isStale(active)) {
    throw new ConflictError('이미 생성 중인 작업이 있습니다. 끝난 뒤 다시 시도해 주세요.');
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('body must be a JSON object', 'bad_json');
  const {
    room_image,
    image_type = 'image/jpeg',
    category: rawCategory,
    design_style = DEFAULT_STYLE,
    door_color = 'white',
    door_finish = 'matte',
    wall_width_override,
    water_from_left_override,
    exhaust_from_left_override,
    room_focal35,
    fridge_options = {},
    design_spec,
    variants,
    reference_images,
    parent_id,
    title,
    mode,
    renders,
    aspect,
    customer_request,
    image_provider,
    place_guide,
  } = body;

  // 입력 검사 (2026-10-26) — 크레딧 차감 전에. 방 사진 형식은 버킷 Content-Type 으로 그대로 가고,
  //   문짝 색·마감은 설치 프롬프트 FINISH 줄에 그대로 들어간다 — 화면이 보내는 값만 받는다 (prompts.js DOOR_COLORS).
  if (!IMAGE_TYPES.includes(image_type)) {
    throw badRequest(`image_type must be one of ${IMAGE_TYPES.join(', ')}`, 'bad_image_type');
  }
  if (!DOOR_COLORS.includes(door_color)) throw badRequest('door_color is not a known colour', 'bad_door_color');
  if (!DOOR_FINISHES.includes(door_finish)) throw badRequest('door_finish is not a known finish', 'bad_door_finish');

  // 재생성: 부모의 입력을 그대로 쓴다 (업로드 생략).
  let parent = null;
  if (parent_id) {
    parent = await selectOne(env, 'generations', { id: `eq.${parent_id}`, select: '*' });
    if (!parent || parent.user_id !== user.id)
      throw new NotFoundError('원본 생성 결과를 찾을 수 없습니다');
  }
  if (!parent && !room_image) throw new ValidationError('room_image is required');

  // 플래너 모드 (2026-10-08, docs/01-plan/planner-render-realize.plan.md §6): 방 사진 + 도면 렌더 + 도면 요약.
  //   reference_images 는 받지 않는다. 재생성이면 원본의 모드를 잇는다.
  // 2026-10-19 (계획 §8·P6): 실사화(realize)·ControlNet(engine·control_image·control_type·control_size)을 지웠다.
  //   요청에 실려 와도 읽지 않는다. 옛 행(options.realize·options.engine)을 재생성하면 그 키를 잇지 않고
  //   일반 경로(또는 플래너 모드)로 간다 — 옛 행의 inputs.control 은 잡이 읽지 않는다.
  //   모드가 아니면 이 블록은 아무것도 하지 않는다 — 옛 경로는 바이트 그대로 (route 시험이 지킨다).
  const planner = mode === 'planner' || (mode == null && !!(parent && parent.options && parent.options.mode === 'planner'));
  if (planner) {
    return await createPlannerGeneration(request, env, headers, {
      user, parent, room_image, image_type, rawCategory, design_style, door_color, door_finish,
      wall_width_override, water_from_left_override, exhaust_from_left_override,
      fridge_options, design_spec, renders, aspect, title, image_provider, room_focal35, place_guide,
    });
  }

  const category = resolveCategory(rawCategory || (parent && parent.category) || 'sink');
  const options = {
    design_style: STYLES[design_style] ? design_style : DEFAULT_STYLE,
    door_color,
    door_finish,
    // 재생성이면 원본의 실측 폭을 잇는다 (2026-10-19) — 붙박이장 통 나누기는 폭 ±100mm 로도 문 수가
    //   짝·홀로 바뀐다. 다시 만들기에서 손님이 넣은 폭이 빠지면 같은 사진이 다른 문 수로 나왔다.
    wall_width_override:
      Number(wall_width_override) || (parent && parent.options && Number(parent.options.wall_width_override)) || null,
    // 급수·배기는 주방 품목에서만 뜻이 있다 — 붙박이장 요청에 실려 와도 버린다
    water_from_left_override: KITCHEN_CATEGORIES.includes(category) ? Number(water_from_left_override) || null : null,
    exhaust_from_left_override: KITCHEN_CATEGORIES.includes(category) ? Number(exhaust_from_left_override) || null : null,
    // 사진 EXIF 35mm 환산 초점거리 (2026-10-19) — 싱크대 덩어리 합성의 화각. 있을 때만 키를 둔다.
    //   2026-10-20: 다시 만들기는 원본의 값을 잇는다 (화면은 다시 만들 때 사진을 다시 보내지 않아 EXIF 를 못 읽는다 —
    //   예전엔 같은 사진이 24mm 로 다시 풀렸다). 플래너 경로와 같은 함수.
    ...plannerFocalOption(room_focal35, parent),
    fridge_options: category === 'fridge' ? normalizeFridgeOptions(fridge_options) : null,
    // 플래너 도면 요약 — 없으면 null 이고, 그러면 프롬프트는 예전 그대로다.
    // 크레딧은 그대로 20 (2026-09-17 결정): 새 action 을 만들지 않는다.
    design_spec: resolveDesignSpec(design_spec, parent, category),
    // 추천안 끄기 (2026-09-22): variants:false 면 기본안 한 장만. 재생성이면 원본을 잇는다. 켰을 때만 키가 생긴다.
    ...((variants != null ? variants === false : !!(parent && parent.options && parent.options.variants === false)) ? { variants: false } : {}),
    // 손님 요청 (연출컷 ③ 상세 요청, 2026-10-08) — 다듬어서 남긴다. 재생성이면 새 글이 없을 때 원본을 잇는다.
    //   있을 때만 키가 생긴다 — 없으면 options 는 예전과 같은 모양이다.
    ...(() => {
      const r = cleanCustomerRequest(customer_request) || (parent && parent.options && parent.options.customer_request) || null;
      return r ? { customer_request: r } : {};
    })(),
  };

  return await enqueueGeneration(request, env, headers, {
    user,
    parent,
    category,
    options,
    title,
    uploadInputs: async (prefix) => {
      const room = await uploadObject(
        env,
        `${prefix}/room.${extOf(image_type)}`,
        room_image,
        image_type
      );
      const refs = [];
      const list = normalizeRefs(reference_images);
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        try {
          const up = await uploadObject(
            env,
            `${prefix}/ref-${i + 1}.${extOf(r.mimeType)}`,
            r.base64,
            r.mimeType
          );
          refs.push({ path: up.path, url: up.url, mime: r.mimeType, role: r.role || 'style', ...(r.note ? { note: r.note } : {}) });
        } catch (e) {
          console.warn('[Generate] ref upload skipped:', e.message);
        }
      }
      return { room: { path: room.path, url: room.url, mime: image_type }, refs };
    },
  });
}

/**
 * 플래너 모드 접수 (mode:'planner', 2026-10-08 · 계획서 §6.1).
 *   필수: room_image(재생성이면 원본 것), design_spec(원본 것을 이어도 된다), renders 의 elevation.
 *   선택: renders 의 massing, aspect (허용값 밖이면 16:9),
 *         wall_width_override · water_from_left_override · exhaust_from_left_override (일반 경로와 같은 정규화),
 *         image_provider ('openai' | 'gemini', 2026-10-18). 없거나 모르는 값이면 재생성 원본 값,
 *           그것도 없으면 PLANNER_IMAGE_PROVIDER (2026-10-19 기본 'openai' = GPT).
 *         renders 의 elevation_labeled (번호 붙은 입면, 2026-10-19) — GPT 가 그릴 때만 IMAGE B 로 쓴다.
 *   받지 않음: reference_images. (realize · engine · control_* 는 2026-10-19 경로째 지웠다 — 어느 모드도 읽지 않는다)
 * 검증은 전부 크레딧 차감 전에 한다 — 틀린 요청으로 20 크레딧이 날아가지 않는다.
 * 추천안은 항상 끈다 (한 장이 결과물이다).
 */
/** 플래너 모드 초점거리 — 요청 값 → 재생성 원본 값. 8~200 밖이거나 없으면 키를 두지 않는다. */
function plannerFocalOption(given, parent) {
  const ok = (v) => Number(v) >= 8 && Number(v) <= 200;
  const parentFocal = parent && parent.options && parent.options.room_focal35;
  const f = ok(given) ? given : ok(parentFocal) ? parentFocal : null;
  return f == null ? {} : { room_focal35: Math.round(Number(f)) };
}

async function createPlannerGeneration(request, env, headers, p) {
  const { user, parent, room_image, image_type } = p;
  // 등급 관문 (사장님 결정 2026-10-20, src/tier-gate.js): expert · agent · 관리자만. 진입 직후 — 검증·크레딧 차감보다
  //   앞이라 거절(403 planner_tier)되면 아무것도 차감되지 않는다. 재생성도 여기를 지난다. 일반 경로는 관문이 없다.
  await assertPlannerTier(env, user);
  const category = resolveCategory(p.rawCategory || (parent && parent.category) || 'sink');
  const spec = resolveDesignSpec(p.design_spec, parent, category);
  if (!spec) {
    const e = new ValidationError('design_spec is required when mode is planner');
    e.code = 'bad_design_spec';
    throw e;
  }
  const renders = normalizeRenders(p.renders);
  const parentRenders = parent && parent.inputs && Array.isArray(parent.inputs.renders) ? parent.inputs.renders : [];
  const hasElevation = parent
    ? parentRenders.some((r) => r && r.role === 'elevation')
    : renders.some((r) => r.role === 'elevation');
  if (!hasElevation) {
    const e = new ValidationError('renders must include an elevation image when mode is planner');
    e.code = 'missing_render';
    throw e;
  }
  const parentAspect = parent && parent.options && parent.options.aspect;
  const options = {
    design_style: STYLES[p.design_style] ? p.design_style : DEFAULT_STYLE,
    door_color: p.door_color,
    door_finish: p.door_finish,
    // 2026-10-20: 재생성이면 원본의 실측 폭을 잇는다 (일반 경로와 같게) — 예전엔 플래너 재생성에서 손님이 넣은 폭이 빠졌다.
    //   분석 벽은 잡이 방 사진 해시로 원본 것을 다시 쓴다 (job.js roomPhoto).
    wall_width_override:
      Number(p.wall_width_override) || (parent && parent.options && Number(parent.options.wall_width_override)) || null,
    // 급수·배기 수동값 — 일반 경로와 같은 정규화 (주방 품목만). 잡이 wall_analysis 에 반영한다 (applyManualPlumbing).
    //   플래너 프롬프트는 싱크·후드 자리를 도면(design_spec)에서 말하므로 이 값을 쓰지 않는다.
    water_from_left_override: KITCHEN_CATEGORIES.includes(category) ? Number(p.water_from_left_override) || null : null,
    exhaust_from_left_override: KITCHEN_CATEGORIES.includes(category) ? Number(p.exhaust_from_left_override) || null : null,
    fridge_options: category === 'fridge' ? p.fridge_options : null,
    design_spec: spec,
    mode: 'planner',
    aspect: resolvePlannerAspect(p.aspect != null ? p.aspect : parentAspect),
    variants: false,
    // 사진 EXIF 35mm 환산 초점거리 (2026-10-20) — 도면 덩어리(1-d)의 카메라 화각. 일반 경로와 같은 정규화.
    //   재생성은 같은 방 사진을 쓰므로 원본 값을 잇는다. 있을 때만 키를 둔다 (없으면 options 모양 그대로).
    ...plannerFocalOption(p.room_focal35, parent),
    // 도면 덩어리 안내 끄기 (2026-10-20, 반복 시험용) — 요청 place_guide:false 면 잡 1-d 가 칠하지 않는다 (운영 변수
    //   PLANNER_PLACE_GUIDE 배포 없이). **false 일 때만** 키를 둔다 (기본은 키 없음 = 지금과 같음). 재생성은 원본 값을 잇는다.
    ...(p.place_guide === false || (p.place_guide === undefined && !!(parent && parent.options && parent.options.place_guide === false))
      ? { place_guide: false }
      : {}),
    // 이미지 공급자 (2026-10-18 → 2026-10-19 기본 GPT) — 플래너 모드는 결정된 값을 **항상** 기록한다.
    //   요청 값 → 재생성 원본 값 → PLANNER_IMAGE_PROVIDER. 잡은 이 값만 읽는다 (없는 옛 행은 Gemini).
    image_provider: resolvePlannerProvider(env, p.image_provider, parent && parent.options && parent.options.image_provider),
  };

  return await enqueueGeneration(request, env, headers, {
    user,
    parent,
    category,
    options,
    title: p.title,
    uploadInputs: async (prefix) => {
      const room = await uploadObject(env, `${prefix}/room.${extOf(image_type)}`, room_image, image_type);
      const saved = [];
      for (const r of renders) {
        try {
          const up = await uploadObject(env, `${prefix}/render-${r.role}.${extOf(r.mimeType)}`, r.base64, r.mimeType);
          saved.push({ role: r.role, path: up.path, url: up.url, mime: r.mimeType });
        } catch (e) {
          // 입면은 설계 그 자체다 — 없으면 잡을 만들지 않는다 (차감은 되돌린다). 번호 입면·3/4 뷰는 없어도 간다.
          if (r.role === 'elevation') throw e;
          console.warn(`[Generate] ${r.role} render upload skipped:`, e.message);
        }
      }
      return { room: { path: room.path, url: room.url, mime: image_type }, refs: [], renders: saved };
    },
  });
}

/**
 * 접수 공통 꼬리: 크레딧 차감 → 행 생성 → 입력 업로드(재생성이면 원본 입력) → 잡 시작 → 202.
 * 어디서든 실패하면 차감을 되돌리고 행을 지운다.
 */
async function enqueueGeneration(request, env, headers, { user, parent, category, options, title, uploadInputs }) {
  // 크레딧 차감 — 사용자 토큰으로, 어떤 업로드보다 먼저. 뒤에서 실패하면 같은 토큰으로 되돌린다.
  let credit;
  try {
    credit = await consumeCredit(request, env, 'generate');
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

  let row = null;
  try {
    row = await insertOne(env, 'generations', {
      user_id: user.id,
      parent_id: parent ? parent.id : null,
      status: 'queued',
      progress: 0,
      step_label: '대기 중',
      category,
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : null,
      options,
      inputs: parent ? parent.inputs : {},
      credit_ref: credit.ref,
      credit_cost: credit.cost || null,
      model: env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image',
    });

    let inputs = parent ? parent.inputs : null;
    if (!parent) {
      inputs = await uploadInputs(`${user.id}/${row.id}`);
      await updateById(env, 'generations', row.id, { inputs });
    }

    const stub = jobStub(env, row.id);
    if (!stub) throw new Error('GENERATE_JOB binding missing');
    const started = await stub.fetch('https://generate-job/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: row.id,
        userId: user.id,
        creditRef: credit.ref,
        category,
        options,
        inputs,
        startedAt: Date.now(),
      }),
    });
    if (!started.ok) throw new Error(`job start ${started.status}`);

    console.log(
      `[Generate] queued ${row.id} user=${user.id} category=${category} refs=${(inputs.refs || []).length} spec=${options.design_spec ? 'yes' : 'no'}${options.mode ? ` mode=${options.mode} renders=${(inputs.renders || []).map((r) => r.role).join('+') || '-'}` : ''}`
    );
    return json(
      {
        success: true,
        id: row.id,
        status: 'queued',
        credit: { balance: credit.balance, cost: credit.cost || null },
      },
      202,
      headers
    );
  } catch (e) {
    // 사용자가 아무것도 못 받았다 — 차감을 되돌리고 행을 지운다.
    await refundCredit(request, env, credit.ref);
    if (row) {
      try {
        await deleteById(env, 'generations', row.id);
      } catch (e2) {
        console.warn('[Generate] cleanup failed:', e2.message);
      }
    }
    throw e;
  }
}

/**
 * 연출컷 → 구성 분석 (gen-to-planner). 기본안 한 장을 Claude 비전에 읽혀 generations.layout 에 남긴다.
 * 멱등이다 — 이미 있으면 그대로 돌려주고, ?force=1 일 때만 다시 분석한다.
 * 동기 응답(5~15초). 클라이언트(ai-design.html)는 응답을 받은 뒤 detaildesign.html?gen= 으로 간다.
 */
async function createLayout(request, env, id, url) {
  const { user, row } = await requireOwner(request, env, id);
  if (row.status !== 'done') {
    const e = new ConflictError('완료된 결과만 설계로 가져올 수 있습니다');
    e.code = 'not_done';
    throw e;
  }
  const category = resolveCategory(row.category);
  if (!LAYOUT_CATEGORIES.includes(category)) {
    const e = new ValidationError('이 품목은 아직 플래너로 가져올 수 없습니다');
    e.code = 'unsupported_category';
    throw e;
  }
  if (row.layout && url.searchParams.get('force') !== '1') {
    return { success: true, layout: row.layout, cached: true };
  }
  // 요청 한도 (2026-10-26) — Claude 를 실제로 부를 때만 센다 (첫 분석 · ?force=1). 캐시 응답은 세지 않는다.
  await enforceRateLimit(env.LAYOUT_LIMIT, user.id);
  const base = (row.images || []).find((im) => im && im.slot === 'base');
  if (!base || !base.path) {
    const e = new NotFoundError('기본안 이미지가 없습니다');
    e.code = 'no_base_image';
    throw e;
  }
  const image = await fetchObjectBase64(env, base.path);
  if (image.base64.length > MAX_IMAGE_B64) {
    const e = new Error('이미지가 너무 커서 분석할 수 없습니다');
    e.statusCode = 413;
    e.code = 'image_too_large';
    throw e;
  }
  const ctx = { category, wallAnalysis: row.wall_analysis, options: row.options };
  const t0 = Date.now();
  const { json: raw, model } = await callClaudeJson(env, {
    prompt: buildLayoutPrompt(ctx),
    image,
    schema: LAYOUT_SCHEMA,
  });
  const layout = normalizeLayout(raw, {
    ...ctx,
    slot: 'base',
    model,
    now: new Date().toISOString(),
  });
  layout.elapsed_ms = Date.now() - t0;
  await updateById(env, 'generations', id, { layout });
  console.log(
    `[Layout ${id}] ${category} ${layout.elapsed_ms}ms conf=${layout.confidence.overall}`
  );
  return { success: true, layout };
}

async function getGeneration(request, env, id) {
  const user = await verifyJwt(request, env);
  const row = await selectOne(env, 'generations', {
    id: `eq.${id}`,
    user_id: `eq.${user.id}`,
    select: PUBLIC_COLUMNS,
  });
  if (!row) throw new NotFoundError('생성 결과를 찾을 수 없습니다');
  // 이미지 url 은 서명 URL 로 (2026-10-26, storage-urls.js) — 버킷이 비공개여도 열린다. path 는 그대로 싣는다.
  const images = await signImageUrls(env, row.images, bucketName(env), OWNER_SIGNED_TTL_SEC);
  return { success: true, generation: publicView({ ...row, images }) };
}

async function deleteGeneration(request, env, id) {
  const { row } = await requireOwner(request, env, id);
  if (ACTIVE_STATUSES.includes(row.status) && !isStale(row)) {
    throw new ConflictError('생성 중인 결과는 삭제할 수 없습니다');
  }
  const paths = [];
  if (row.inputs && row.inputs.room) paths.push(row.inputs.room.path);
  for (const r of (row.inputs && row.inputs.refs) || []) paths.push(r.path);
  for (const r of (row.inputs && row.inputs.renders) || []) paths.push(r.path); // 플래너 모드 도면 렌더
  for (const im of row.images || []) paths.push(im.path);
  // 재생성 자식이 같은 입력을 가리키면 입력 파일은 남긴다.
  const child = await selectOne(env, 'generations', { parent_id: `eq.${id}`, select: 'id' });
  // 2026-10-19: render-elevation_labeled · render-elevation_left … 도 입력이다 (역할 이름에 밑줄)
  const toRemove = child ? paths.filter((p) => !/\/(room|ref-\d+|render-[a-z_]+)\./.test(p)) : paths;
  // 시공사례에 올라간 대표 연출컷도 함께 내린다 — 행과 collection 버킷의 복사본 (2026-10-27, collection-post.js)
  await removeCollectionPostsFor(env, id);
  await removeObjects(env, toRemove);
  await deleteById(env, 'generations', id);
  return { success: true };
}

async function createShare(request, env, id) {
  const { row } = await requireOwner(request, env, id);
  // 도면과 어긋난 플래너 결과는 내부 확인용 — 토큰을 만들지도, 행을 건드리지도 않는다 (계획서 §6.3)
  if (isInternalOnly(row)) {
    const message = '도면과 다른 결과는 공유할 수 없습니다';
    const e = new ConflictError(message);
    e.code = 'internal_only';
    e.body = { success: false, error: 'internal_only', code: 'internal_only', message };
    throw e;
  }
  if (row.status !== 'done') throw new ConflictError('완료된 결과만 공유할 수 있습니다');
  let validDays = null;
  try {
    const b = await request.json();
    validDays = b && b.valid_days;
  } catch {
    /* 본문 없음 */
  }
  const token = generateShareToken();
  const expiresAt = shareExpiryIso(env, validDays);
  await updateById(env, 'generations', id, {
    share_token_hash: await hashShareToken(env, token),
    share_expires_at: expiresAt,
    share_revoked_at: null,
  });
  return { success: true, share_url: buildShareUrl(env, token), expires_at: expiresAt };
}

async function revokeShare(request, env, id) {
  await requireOwner(request, env, id);
  await updateById(env, 'generations', id, { share_revoked_at: new Date().toISOString() });
  return { success: true };
}

const SHARE_MESSAGES = {
  not_found: '공유 링크가 유효하지 않습니다',
  share_expired: '공유 링크가 만료되었습니다',
  share_revoked: '공유가 중단된 링크입니다',
  not_ready: '아직 준비 중인 결과입니다',
  internal_only: '공유할 수 없는 결과입니다',
};

async function getShared(request, env) {
  const token = request.headers.get('X-Share-Token') || '';
  if (!token) throw new AuthError('공유 토큰이 없습니다');
  const hash = await hashShareToken(env, token);
  const row = await selectOne(env, 'generations', {
    share_token_hash: `eq.${hash}`,
    select: '*',
  });
  const check = checkShareAccessible(row);
  if (!check.ok) {
    const err = new Error(SHARE_MESSAGES[check.reason] || '열람할 수 없습니다');
    err.statusCode = check.status;
    err.code = check.reason;
    throw err;
  }
  // 서명 URL (2026-10-26) — 수명은 링크가 남은 시간, 최대 1시간 (storage-urls.js shareSignedTtl).
  //   토큰을 가진 사람만 여기까지 온다. 회수·만료되면 이 응답이 410 이 되고, 버킷이 비공개면 이미 받은 URL 도
  //   길어야 1시간 안에 닫힌다.
  const signed = await signImageUrls(env, row.images, bucketName(env), shareSignedTtl(row.share_expires_at));
  return {
    success: true,
    generation: {
      category: row.category,
      title: row.title,
      options: { design_style: row.options && row.options.design_style },
      // 붙박이장 내부 보기의 칸 구성·추천 이유도 싣는다 (2026-10-20). 고른 모델(by)은 공유하지 않는다.
      images: signed.map((im) => ({
        slot: im.slot,
        label: im.label,
        url: im.url,
        ...(im.structure && im.structure.plan
          ? {
              structure: {
                kind: im.structure.kind,
                plan: im.structure.plan,
                ...(im.structure.concept ? { concept: im.structure.concept } : {}),
                ...(im.structure.reason ? { reason: im.structure.reason } : {}),
              },
            }
          : {}),
      })),
      quote: row.quote,
      created_at: row.created_at,
      expires_at: row.share_expires_at,
    },
  };
}
