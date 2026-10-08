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
 *   GET    /health · /diag            진단
 *
 * 생성 자체는 job.js 의 GenerateJob(Durable Object, 미국 콜로) 이 alarm 으로 실행한다.
 * 이 파일은 인증·크레딧·입력 업로드·행 생성·조회만 한다.
 * 진행 상태의 정본은 generations 행이다 (폴링은 행만 읽는다).
 */

import { geminiModel, probeRoutes } from './gemini.js';
import { proxyStub } from './proxy.js';
import {
  DEFAULT_STYLE,
  STYLES,
  cleanThemeNote,
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
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from './supabase.js';
import { jobStub } from './job.js';
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

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Share-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

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
};

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
 */
function normalizeRefs(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((r) => {
      if (typeof r === 'string') return { base64: r, mimeType: 'image/jpeg' };
      if (!r || !r.base64) return null;
      // theme = 색감만 빌린다 (추천안 한 장), 그 외(upload·case) = 설치 참고
      const role = r.role === 'theme' ? 'theme' : 'style';
      const out = { base64: r.base64, mimeType: r.mimeType || r.mime || 'image/jpeg', role };
      const note = role === 'theme' ? cleanThemeNote(r.note) : null;
      if (note) out.note = note;
      return out;
    })
    .filter(Boolean)
    .slice(0, MAX_REFS);
}

/**
 * 플래너 모드의 도면 렌더: [{role:'elevation'|'massing', base64, mimeType|mime}].
 * 역할마다 한 장(앞의 것), 최대 2장. 다른 역할·빈 값은 버린다. 순서는 elevation → massing.
 */
const RENDER_ROLES = ['elevation', 'massing'];
function normalizeRenders(list) {
  if (!Array.isArray(list)) return [];
  const byRole = {};
  for (const r of list) {
    if (!r || typeof r !== 'object' || !RENDER_ROLES.includes(r.role)) continue;
    if (typeof r.base64 !== 'string' || !r.base64 || byRole[r.role]) continue;
    byRole[r.role] = { role: r.role, base64: r.base64, mimeType: r.mimeType || r.mime || 'image/png' };
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
    const headers = corsHeaders(request.headers.get('Origin') || '*');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      if (url.pathname === '/health' || url.pathname === '/') {
        return json(
          {
            status: 'ok',
            service: 'dadam-generate-api',
            worker: true,
            version: 2,
            model: geminiModel(env),
            colo: (request.cf && request.cf.colo) || null,
          },
          200,
          headers
        );
      }
      if (url.pathname === '/diag') return json(await diag(request, env), 200, headers);

      if (url.pathname === '/api/share' && request.method === 'GET') {
        return json(await getShared(request, env), 200, headers);
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

  // 사용자당 실행 중 잡 1개.
  const active = await selectOne(env, 'generations', {
    user_id: `eq.${user.id}`,
    status: `in.(${ACTIVE_STATUSES.join(',')})`,
    select: 'id,created_at',
  });
  if (active && !isStale(active)) {
    throw new ConflictError('이미 생성 중인 작업이 있습니다. 끝난 뒤 다시 시도해 주세요.');
  }

  const body = await request.json();
  const {
    room_image,
    image_type = 'image/jpeg',
    category: rawCategory,
    design_style = DEFAULT_STYLE,
    door_color = 'white',
    door_finish = 'matte',
    wall_width_override,
    fridge_options = {},
    design_spec,
    realize,
    variants,
    engine,
    control_image,
    control_type = 'image/png',
    control_size,
    reference_images,
    parent_id,
    title,
    mode,
    renders,
    aspect,
  } = body;

  // 재생성: 부모의 입력을 그대로 쓴다 (업로드 생략).
  let parent = null;
  if (parent_id) {
    parent = await selectOne(env, 'generations', { id: `eq.${parent_id}`, select: '*' });
    if (!parent || parent.user_id !== user.id)
      throw new NotFoundError('원본 생성 결과를 찾을 수 없습니다');
  }
  if (!parent && !room_image) throw new ValidationError('room_image is required');

  // 플래너 모드 (2026-10-08, docs/01-plan/planner-render-realize.plan.md §6): 방 사진 + 도면 렌더 + 도면 요약.
  //   realize·engine·control_*·reference_images 는 받지 않는다. 재생성이면 원본의 모드를 잇는다.
  //   모드가 아니면 이 블록은 아무것도 하지 않는다 — 옛 경로는 바이트 그대로 (route 시험이 지킨다).
  const planner = mode === 'planner' || (mode == null && !!(parent && parent.options && parent.options.mode === 'planner'));
  if (planner) {
    return await createPlannerGeneration(request, env, headers, {
      user, parent, room_image, image_type, rawCategory, design_style, door_color, door_finish,
      wall_width_override, fridge_options, design_spec, renders, aspect, title,
    });
  }

  // ControlNet 경로 (2026-09-22): 구조 조건 이미지가 있어야 한다. 크레딧 차감 전에 막는다.
  const wantControlNet = engine === 'controlnet' || (engine == null && !!(parent && parent.options && parent.options.engine === 'controlnet'));
  if (wantControlNet && !parent && !control_image) throw new ValidationError('control_image is required when engine is controlnet');
  const sizeOf = (v) => (v && Number.isFinite(Number(v.width)) && Number.isFinite(Number(v.height)) && Number(v.width) > 0 && Number(v.height) > 0
    ? { width: Math.round(Number(v.width)), height: Math.round(Number(v.height)) } : null);

  const category = resolveCategory(rawCategory || (parent && parent.category) || 'sink');
  const options = {
    design_style: STYLES[design_style] ? design_style : DEFAULT_STYLE,
    door_color,
    door_finish,
    wall_width_override: Number(wall_width_override) || null,
    fridge_options: category === 'fridge' ? fridge_options : null,
    // 플래너 도면 요약 — 없으면 null 이고, 그러면 프롬프트는 예전 그대로다.
    // 크레딧은 그대로 20 (2026-09-17 결정): 새 action 을 만들지 않는다.
    design_spec: resolveDesignSpec(design_spec, parent, category),
    // 실사화 (2026-09-19): 첫 사진에 플래너가 도면 입면을 이미 얹어 둔 경우. 재생성이면 원본을 잇는다.
    //   켰을 때만 키가 생긴다 — 안 켜면 options 는 예전과 같은 모양이다 (route 시험이 deepEqual 로 지킨다).
    ...((realize != null ? !!realize : !!(parent && parent.options && parent.options.realize)) ? { realize: true } : {}),
    // 추천안 끄기 (2026-09-22): variants:false 면 기본안 한 장만. 재생성이면 원본을 잇는다. 켰을 때만 키가 생긴다.
    ...((variants != null ? variants === false : !!(parent && parent.options && parent.options.variants === false)) ? { variants: false } : {}),
    // ControlNet 경로 — 켰을 때만 키가 생긴다. 크기는 조건 이미지와 바탕 사진의 화소 크기(같아야 한다).
    ...(wantControlNet ? { engine: 'controlnet', control_size: sizeOf(control_size) || (parent && parent.options && parent.options.control_size) || null } : {}),
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
      // 구조 조건 이미지 (ControlNet) — 방 사진과 같은 화소 공간의 윤곽선/깊이 PNG
      let control = null;
      if (control_image) {
        try {
          const up = await uploadObject(env, `${prefix}/control.${extOf(control_type)}`, control_image, control_type);
          control = { path: up.path, url: up.url, mime: control_type };
        } catch (e) {
          console.warn('[Generate] control upload failed:', e.message);
        }
      }
      return { room: { path: room.path, url: room.url, mime: image_type }, refs, ...(control ? { control } : {}) };
    },
  });
}

/**
 * 플래너 모드 접수 (mode:'planner', 2026-10-08 · 계획서 §6.1).
 *   필수: room_image(재생성이면 원본 것), design_spec(원본 것을 이어도 된다), renders 의 elevation.
 *   선택: renders 의 massing, aspect (허용값 밖이면 16:9).
 *   받지 않음: realize · engine · control_* · reference_images.
 * 검증은 전부 크레딧 차감 전에 한다 — 틀린 요청으로 20 크레딧이 날아가지 않는다.
 * 추천안은 항상 끈다 (한 장이 결과물이다).
 */
async function createPlannerGeneration(request, env, headers, p) {
  const { user, parent, room_image, image_type } = p;
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
    wall_width_override: Number(p.wall_width_override) || null,
    fridge_options: category === 'fridge' ? p.fridge_options : null,
    design_spec: spec,
    mode: 'planner',
    aspect: resolvePlannerAspect(p.aspect != null ? p.aspect : parentAspect),
    variants: false,
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
          // 입면은 설계 그 자체다 — 없으면 잡을 만들지 않는다 (차감은 되돌린다). 3/4 뷰는 없어도 간다.
          if (r.role === 'elevation') throw e;
          console.warn('[Generate] massing render upload skipped:', e.message);
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
  const { row } = await requireOwner(request, env, id);
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
  return { success: true, generation: publicView(row) };
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
  const toRemove = child ? paths.filter((p) => !/\/(room|ref-\d+|render-[a-z]+)\./.test(p)) : paths;
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
  return {
    success: true,
    generation: {
      category: row.category,
      title: row.title,
      options: { design_style: row.options && row.options.design_style },
      images: (row.images || []).map((im) => ({ slot: im.slot, label: im.label, url: im.url })),
      quote: row.quote,
      created_at: row.created_at,
      expires_at: row.share_expires_at,
    },
  };
}

async function diag(request, env) {
  const pick = (t) => (t.match(/(colo|loc|ip)=[^\n]*/g) || []).join(' ');
  const out = { worker_colo: (request.cf && request.cf.colo) || null };
  try {
    out.worker_egress = pick(
      await fetch('https://www.cloudflare.com/cdn-cgi/trace').then((r) => r.text())
    );
  } catch (e) {
    out.worker_egress = 'ERR ' + e.message;
  }
  try {
    const stub = proxyStub(env);
    out.proxy_egress = stub
      ? pick(await stub.fetch('https://gemini-proxy/').then((r) => r.text()))
      : 'no binding';
  } catch (e) {
    out.proxy_egress = 'ERR ' + e.message;
  }
  out.job_binding = !!env.GENERATE_JOB;
  out.service_role = !!env.SUPABASE_SERVICE_ROLE_KEY;
  out.routes = await probeRoutes(env);
  return out;
}
