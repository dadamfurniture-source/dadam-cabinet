/**
 * GenerateJob — 연출컷 생성 잡 하나를 끝까지 실행하는 Durable Object.
 *
 * 왜 DO 인가:
 *   한 건이 60~90초다. HTTP 요청 안에서 기다리면 탭을 닫는 순간 죽고, 결과가 남지 않는다.
 *   Queue 는 새 바인딩과 소비자를 들여야 하고 잡별 상태가 없다. DO 는 이미 이 워커에
 *   배포돼 있고(GeminiProxy), alarm 은 I/O 대기에 시간 상한이 없다.
 *   locationHint 'enam' 으로 만들면 Gemini 를 미국에서 직접 부른다 (HKG·KIX 지역 차단 회피).
 *
 * 규약:
 *   - 진행 상태의 정본은 generations 행이다. DO storage 는 체크포인트(경로만, base64 금지).
 *   - alarm 은 최소 1회 실행이라 단계마다 멱등: 체크포인트에 있는 슬롯은 건너뛴다.
 *   - alarm 안에서 던지지 않는다. 실패는 attempt 를 올리고 15초 뒤 재시도, 2회 넘으면 failed.
 *   - 종료 상태(done/failed)에서는 storage 를 비우고 alarm 을 지운다.
 *   - 기본안이 나왔으면 추천안이 0장이어도 done (환불 없음). 기본안 실패만 환불.
 *   - 플래너 모드는 대조가 ok 가 아니면 done 과 함께 options.internal_only = true (계획서 §6.3).
 */

import { aspectRatioOf, callGemini, textModel } from './gemini.js';
import { plannerProvider, renderImage, renderPlannerImage } from './images.js';
import {
  CATEGORIES,
  wardrobeDoors,
  DEFAULT_STYLE,
  STYLES,
  buildAnalysisPrompt,
  buildInstallPrompt,
  buildPlumbingPrompt,
  buildPlannerPrompt,
  buildQcPrompt,
  buildThemePalettePrompt,
  cleanCustomerRequest,
  buildTwoToneVariantPrompt,
  buildVariantPrompt,
  buildWardrobeInteriorPrompt,
  buildInteriorRecommendPrompt,
  INTERIOR_RECOMMEND_SCHEMA,
  interiorPlanKo,
  parseInteriorRecommendation,
  wardrobeInteriorPlan,
  KITCHEN_CATEGORIES,
  clampWall,
  parseAnalysis,
  parsePlumbing,
  parseQc,
  qcNeedsRetry,
  parseThemePalette,
  pickFinishes,
  pickTwoTone,
  resolveCategory,
} from './prompts.js';
import { buildQuote } from './quote.js';
import { selectOne, updateById, uploadObject, fetchObjectBase64, extOf } from './supabase.js';
import { refundCreditService } from './credits.js';
import {
  LAYOUT_CATEGORIES,
  LAYOUT_SCHEMA,
  PLANNER_READ_CATEGORIES,
  PLANNER_READ_SCHEMA,
  buildLayoutPrompt,
  buildPlannerReadPrompt,
  normalizeLayout,
  normalizePlannerRead,
} from './layout.js';
import { callClaudeJson, claudeModel } from './claude.js';
import { VERIFY_VERSION, compareLayoutToSpec } from './verify.js';
import { FURNITURE_MASK_SCHEMA, buildFurnitureMaskPrompt, parseFurnitureMask } from './furniture-mask.js';
import { GUIDE_POINTS_SCHEMA, buildGuidePointsPrompt, drawGuide, parseGuidePoints, pasteVariantInPolys, pasteVariantInside, prepareGuideCanvas, renderMassingImage } from './guide.js';
import { KITCHEN_POINTS_SCHEMA, buildKitchenPointsPrompt, parseKitchenPoints, renderFacesMassing, renderKitchenMassing } from './kitchen.js';
import { plannerPlaceBlocks, plannerPlaceFaces } from './planner-place.js';

const MAX_ATTEMPTS = 2;
/** 역판독(Claude 비전) 이미지 한도 — Anthropic 5MB, base64 는 4/3 배 (worker.js MAX_IMAGE_B64 와 같은 값) */
const VERIFY_MAX_B64 = Math.floor((5 * 1024 * 1024 * 4) / 3);
const RETRY_DELAY_MS = 15_000;
/** 검사(QC) 한 번의 상한 — 넘기면 통과로 보고 진행한다 */
const QC_TIMEOUT_MS = 90_000;
const INTERIOR_REC_TIMEOUT_MS = 60_000; // 붙박이장 추천 구조 고르기 — 넘으면 그 장은 정본 기본형 + 추천 색
const JOB_TIMEOUT_MS = 10 * 60_000; // 환불 창(30분) 안에 끝나야 한다
const VARIANT_COUNT = 3;
const VARIANT_ATTEMPTS = 2; // 실패·빈 응답이면 한 번 더
const VARIANT_RETRY_MS = 15_000; // 2026-10-13: 4초 → 15초. 503 은 callGemini 가 따로 기다린다 — 이 간격은 빈 응답 등 나머지용
const VARIANT_STAGGER_MS = 1_500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STEP = {
  analyzing: { progress: 10, label: '공간을 읽는 중' },
  rendering: { progress: 30, label: '기본안을 그리는 중' },
  qc: { progress: 60, label: '품질을 확인하는 중' },
  variants: { progress: 70, label: '추천안을 그리는 중' },
  done: { progress: 100, label: '완료' },
};

export class GenerateJob {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /** POST /start {id, userId, creditRef, category, options, inputs, startedAt} */
  async fetch(request) {
    if (request.method !== 'POST') return new Response('POST only', { status: 405 });
    const job = await request.json();
    if (!job || !job.id) return new Response('bad job', { status: 400 });
    await this.state.storage.put('job', job);
    await this.state.storage.put('ckpt', { step: 'analyzing', attempt: 0, images: {} });
    await this.state.storage.setAlarm(Date.now() + 50);
    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async alarm() {
    const job = await this.state.storage.get('job');
    if (!job) return;
    const ck = (await this.state.storage.get('ckpt')) || {
      step: 'analyzing',
      attempt: 0,
      images: {},
    };
    ck.attempt += 1;
    await this.state.storage.put('ckpt', ck);

    if (ck.attempt > MAX_ATTEMPTS) {
      await this.fail(job, ck, `attempts exhausted (${ck.lastError || 'unknown'})`);
      return;
    }
    if (Date.now() - (job.startedAt || Date.now()) > JOB_TIMEOUT_MS) {
      await this.fail(job, ck, 'timeout');
      return;
    }

    try {
      // 2026-09-22: 파이프라인에 마감을 건다. 안 돌아오는 상류 호출이 있으면 이 await 가 영영 안 풀려
      //   10분 제한(위)이 검사될 기회가 없었다 — 첫 실측에서 QC 단계가 9분 넘게 멈춘 이유다.
      //   마감을 넘기면 던져서 재시도·실패(환불) 경로로 보낸다.
      const remaining = JOB_TIMEOUT_MS - (Date.now() - (job.startedAt || Date.now()));
      let deadlineTimer = null;
      const deadline = new Promise((_, reject) => {
        deadlineTimer = setTimeout(() => reject(new Error(`pipeline deadline (${Math.round(remaining / 1000)}s) at ${ck.step}`)), Math.max(1_000, remaining));
      });
      try {
        await Promise.race([
          runPipeline(this.env, job, ck, (patch) => this.state.storage.put('ckpt', { ...ck, ...patch })),
          deadline,
        ]);
      } finally {
        clearTimeout(deadlineTimer);
      }
      await this.state.storage.deleteAll();
      await this.state.storage.deleteAlarm();
    } catch (e) {
      console.error(`[Job ${job.id}] attempt ${ck.attempt} failed at ${ck.step}:`, e.message);
      ck.lastError = e.message.slice(0, 200);
      await this.state.storage.put('ckpt', ck);
      if (ck.attempt >= MAX_ATTEMPTS) {
        await this.fail(job, ck, ck.lastError);
      } else {
        await this.state.storage.setAlarm(Date.now() + RETRY_DELAY_MS);
      }
    }
  }

  async fail(job, ck, reason) {
    const hasBase = ck.images && ck.images.base;
    try {
      // 기본안이 있어 done 으로 닫을 때도 내부 확인용 표시는 같은 패치에 싣는다 — 대조 전에 죽었으면 ok 가 아니다
      const internal = hasBase ? await internalOnlyPatch(this.env, job, ck) : {};
      await updateById(this.env, 'generations', job.id, {
        status: hasBase ? 'done' : 'failed', // 기본안이 있으면 결과로 인정한다
        progress: hasBase ? 100 : ck.step === 'analyzing' ? 10 : 30,
        step_label: hasBase ? '완료 (추천안 일부 실패)' : '생성 실패',
        error: reason,
        completed_at: new Date().toISOString(),
        ...(hasBase ? { images: slotList(ck.images) } : {}),
        ...internal,
      });
    } catch (e) {
      console.error(`[Job ${job.id}] fail-patch failed:`, e.message);
    }
    if (!hasBase && job.creditRef) {
      try {
        await refundCreditService(this.env, job.creditRef);
        await updateById(this.env, 'generations', job.id, { credit_refunded: true });
      } catch (e) {
        console.error(`[Job ${job.id}] refund failed:`, e.message);
      }
    }
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
  }
}

/** 미국 동부 힌트로 잡 stub. 잡 id 로 이름을 고정하면 재시작 요청이 같은 객체로 간다. */
export function jobStub(env, generationId) {
  if (!env.GENERATE_JOB) return null;
  const id = env.GENERATE_JOB.idFromName(generationId);
  return env.GENERATE_JOB.get(id, { locationHint: 'enam' });
}

/**
 * 내부 확인용 표시 (2026-10-08, 계획서 docs/01-plan/planner-render-realize.plan.md §6.3 · §11-⑦).
 *   플래너 모드 결과가 도면과 맞는다고 확인되지 않았으면(대조 ok 가 아님 · 대조 실패 · 대조를 못 함)
 *   고객에게 내보내지 않는다 — 공유 409, 내 연출컷에서 숨김. 새 열 없이 options 에 둔다.
 *   PATCH 는 options 를 통째로 바꾸므로 지금 행의 options 를 읽어 키 하나만 더한다
 *   (못 읽으면 잡이 받은 options 에 더한다 — 접수 때 행에 넣은 것과 같다).
 *   ok 면 키를 넣지 않는다. 플래너가 아니면 아무것도 하지 않는다. 크레딧은 그대로다.
 * @returns {Promise<{options?: object}>} 마무리 패치에 섞을 조각
 */
export async function internalOnlyPatch(env, job, ck) {
  const opts = job.options || {};
  if (opts.mode !== 'planner') return {};
  if (ck.verify && ck.verify.ok === true) return {};
  let current = opts;
  try {
    const row = await selectOne(env, 'generations', { id: `eq.${job.id}`, select: 'options' });
    if (row && row.options && typeof row.options === 'object') current = row.options;
  } catch (e) {
    console.warn(`[Job ${job.id}] options read failed, using job options:`, e.message);
  }
  return { options: { ...current, internal_only: true } };
}

/**
 * 플래너 역판독에 같이 보일 정면 입면 (2026-10-19).
 *   번호 입면(elevation_labeled)이 있으면 그것 — 설치 때 GPT 가 아니어서 안 읽었으면 여기서 읽는다.
 *   없거나 못 읽거나 너무 크면 번호 없는 입면, 그것도 너무 크면 없이(글 목록만) 읽는다.
 * @returns {Promise<{kind:'labeled'|'plain'|null, image:object|null}>}
 */
async function plannerVerifyElevation(env, job, inputs, elevation, elevationLabeled) {
  const fits = (im) => im && typeof im.base64 === 'string' && im.base64.length <= VERIFY_MAX_B64;
  let labeled = elevationLabeled;
  if (!labeled) {
    const list = Array.isArray(inputs.renders) ? inputs.renders : [];
    const lb = list.find((r) => r && r.role === 'elevation_labeled');
    if (lb && lb.path) {
      try {
        labeled = await fetchObjectBase64(env, lb.path);
      } catch (e) {
        console.warn(`[Job ${job.id}] verify: labeled elevation skipped: ${e.message}`);
      }
    }
  }
  if (fits(labeled)) return { kind: 'labeled', image: labeled };
  if (fits(elevation)) return { kind: 'plain', image: elevation };
  return { kind: null, image: null };
}

// ─── 파이프라인 ───

function slotList(images) {
  // 2026-10-19: 'mockup' 슬롯(실사화 합성본)은 실사화와 함께 지웠다. 이미 DB 에 그 슬롯이 든 옛 행은 그대로 둔다 —
  //   GET·내 연출컷·공유는 images[] 를 그대로 돌려주고 칸마다 label·url 만 그린다(슬롯 이름을 가리지 않는다).
  const order = ['base', 'v1', 'v2', 'v3'];
  return order.filter((s) => images[s]).map((s) => ({ slot: s, ...images[s] }));
}

async function setStep(env, job, ck, step, extra = {}) {
  ck.step = step;
  const s = STEP[step];
  await updateById(env, 'generations', job.id, {
    status: step,
    progress: s.progress,
    step_label: s.label,
    ...extra,
  });
}

/**
 * 2차 질문 — 1차가 놓친 배관만 다시 묻는다. 실패해도 조용히 넘어간다(기본값이 남는다).
 * 이미 읽은 쪽은 덮어쓰지 않는다 — 1차가 본 것을 2차가 흔들 이유가 없다.
 */
async function askPlumbing(env, job, wall, room) {
  try {
    const r = await callGemini(env, {
      prompt: buildPlumbingPrompt(wall.wallW),
      images: [room],
      want: 'text',
      temperature: 0.1,
    });
    const p = parsePlumbing(r.text);
    const got = [];
    if (!wall.read.water && p.water != null) {
      wall.waterPct = p.water;
      wall.read.water = true;
      got.push(`water ${p.water}% (${p.waterWhy || '-'})`);
    }
    if (!wall.read.exhaust && p.exhaust != null) {
      wall.exhaustPct = p.exhaust;
      wall.read.exhaust = true;
      got.push(`exhaust ${p.exhaust}% (${p.exhaustWhy || '-'})`);
    }
    // 무엇을 2차로 건졌는지 남긴다 — 나중에 효과를 세려면 이 표시가 있어야 한다
    wall.plumbingPass2 = { water: p.water != null, exhaust: p.exhaust != null,
                           waterWhy: p.waterWhy, exhaustWhy: p.exhaustWhy };
    console.log(`[Job ${job.id}] plumbing pass2: ${got.length ? got.join(' · ') : '못 찾음'}`);
  } catch (e) {
    console.warn(`[Job ${job.id}] plumbing pass2 failed:`, e.message);
  }
}

/**
 * 사람이 알려준 급수(싱크)·배기(후드) 위치를 벽 폭 기준 %로 바꿔 넣는다.
 *
 * 벽 밖이거나 숫자가 아니면 무시한다 — 잘못 친 값으로 가구를 옮기는 것보다
 * 모델이 읽은 값(또는 기본값)을 쓰는 편이 낫다.
 * pct 와 같은 5~95 범위로 자른다 (벽 끝에 붙은 싱크는 없다).
 *
 * @param {{wallW:number, waterPct:number, exhaustPct:number, read?:object}} wall
 * @param {{water_from_left_override?:number, exhaust_from_left_override?:number}} opts
 */
export function applyManualPlumbing(wall, opts = {}) {
  const put = (key, flag) => {
    const mm = Number(opts[`${key}_from_left_override`]);
    if (!(mm > 0) || mm > wall.wallW) return false;
    const p = Math.max(5, Math.min(95, Math.round((mm / wall.wallW) * 100)));
    wall[`${key === 'water' ? 'water' : 'exhaust'}Pct`] = p;
    if (wall.read) wall.read[flag] = true;
    return true;
  };
  const w = put('water', 'water');
  const e = put('exhaust', 'exhaust');
  if (w || e) wall.confidence = 'user';
  return { water: w, exhaust: e };
}

async function runPipeline(env, job, ck, save) {
  const opts = job.options || {};
  const inputs = job.inputs || {};
  const category = resolveCategory(job.category);
  const startedAt = job.startedAt || Date.now();

  // 플래너 모드 (2026-10-08, 계획서 docs/01-plan/planner-render-realize.plan.md §6.2):
  //   설치는 [방 사진, 입면, 3/4?] + 프롬프트 v2 · 온도 0.2 · 비율 고정. 검사는 기록만(재시도 없음).
  //   역판독 대조는 [결과 사진, 정면 입면] + 도면 목록으로 모듈마다 센다(2026-10-19). 추천안 없음.
  const planner = opts.mode === 'planner';

  // 입력 이미지는 Storage 에서 읽는다 — DO storage 에 base64 를 두지 않는다.
  const room = await fetchObjectBase64(env, inputs.room.path);
  // 플래너 렌더: 입면은 필수다 — 못 읽으면 던져서 재시도·실패(환불)로 간다. 3/4 뷰는 없어도 그린다.
  let elevation = null;
  let elevationLabeled = null;
  let massing = null;
  const returnElevations = []; // 2026-10-19: [{ side, plain, labeled }] — 꺾인 벽 입면
  if (planner) {
    const list = Array.isArray(inputs.renders) ? inputs.renders : [];
    const el = list.find((r) => r && r.role === 'elevation');
    if (!el || !el.path) throw new Error('planner: elevation render missing');
    elevation = await fetchObjectBase64(env, el.path);
    // 2026-10-19: 번호 붙은 입면은 GPT 가 그릴 때만 쓴다 — Gemini 는 번호를 도어 위에 글자로 옮겨 그렸다.
    //   GPT 행이 아니면 읽지도 않는다. 못 읽으면 번호 없는 입면으로 그린다.
    const lb = plannerProvider(opts.image_provider) === 'openai' ? list.find((r) => r && r.role === 'elevation_labeled') : null;
    if (lb && lb.path) {
      try {
        elevationLabeled = await fetchObjectBase64(env, lb.path);
      } catch (e) {
        console.warn(`[Job ${job.id}] labeled elevation skipped: ${e.message}`);
      }
    }
    const ms = list.find((r) => r && r.role === 'massing');
    if (ms && ms.path) {
      try {
        massing = await fetchObjectBase64(env, ms.path);
      } catch (e) {
        console.warn(`[Job ${job.id}] massing render skipped: ${e.message}`);
      }
    }
    // 2026-10-19: ㄱ자·ㄷ자 꺾인 벽 입면 (elevation_left · elevation_right, 번호 붙은 것 _labeled) — design_spec.walls 에 있는 벽만.
    //   못 읽으면 그 벽은 글 목록만으로 그린다. 번호 붙은 것은 설치 때 GPT 에만, 역판독에는 공급자와 상관없이 쓴다.
    const sides = (Array.isArray(opts.design_spec && opts.design_spec.walls) ? opts.design_spec.walls : [])
      .map((w) => w && w.side)
      .filter((s) => s === 'left' || s === 'right');
    for (const side of sides) {
      const got = { side, plain: null, labeled: null };
      for (const [role, k] of [[`elevation_${side}`, 'plain'], [`elevation_${side}_labeled`, 'labeled']]) {
        const r = list.find((x) => x && x.role === role);
        if (!r || !r.path) continue;
        try {
          got[k] = await fetchObjectBase64(env, r.path);
        } catch (e) {
          console.warn(`[Job ${job.id}] ${role} render skipped: ${e.message}`);
        }
      }
      if (got.plain || got.labeled) returnElevations.push(got);
    }
  }
  // 참고 이미지는 역할이 둘이다.
  //   style (업로드·시공사례) → 설치 단계에 첨부, 마감·분위기 참고
  //   theme (식물·명품·회화 등)  → 색감만 뽑아 추천안 한 장으로
  const refs = []; // style
  const themeRefs = [];
  const themeNotes = []; // themeRefs 와 같은 순서 — 관리자가 적은 사진 설명 (없으면 null)
  for (const r of inputs.refs || []) {
    try {
      const img = await fetchObjectBase64(env, r.path);
      if (r.role === 'theme') {
        themeRefs.push(img);
        themeNotes.push(r.note || null);
      } else {
        refs.push(img);
      }
    } catch (e) {
      console.warn(`[Job ${job.id}] ref skipped: ${e.message}`);
    }
  }

  // ═══ 1. 분석 (브리프 포함) ═══
  if (!ck.wall) {
    await setStep(env, job, ck, 'analyzing');
    let wall = {
      wallW: 3000,
      wallH: 2400,
      waterPct: 48,   // prompts.js 의 기본값과 같다 (실측 중앙값)
      exhaustPct: 70,
      confidence: null,
      brief: null,
      existing: null,
    };
    try {
      const r = await callGemini(env, {
        prompt: buildAnalysisPrompt(),
        images: [room],
        want: 'text',
      });
      wall = parseAnalysis(r.text);
    } catch (e) {
      console.warn(`[Job ${job.id}] analysis failed, defaults:`, e.message);
    }
    const manualW = Number(opts.wall_width_override);
    if (manualW >= 1000 && manualW <= 6000) {
      wall.wallW = clampWall(manualW);
      wall.confidence = 'user';
      if (wall.read) wall.read.width = true;   // 사람이 넣은 값이다 — 추측이 아니다
    }
    // 급수·배기는 사진에서 자주 못 읽는다 (시공 전 828장 실측: 급수 56% · 배기 48% 만 읽음).
    // 못 읽으면 30% · 70% 로 **추측해서 배치**되므로, 현장에서 잰 값이 있으면 그게 이긴다.
    // 벽 왼쪽 끝에서 중심까지의 mm 를 받아 벽 폭 기준 %로 바꾼다 — 벽 폭 보정 뒤에 둬야 한다.
    // 1차가 배관을 놓쳤으면 **그것만** 다시 묻는다. 주방이 아니면 묻지 않는다.
    //   실측(2026-10): 1차는 급수 56% · 배기 48% 만 읽고, 2차로 놓친 것의 절반을 더 읽는다.
    //   벽 폭 보정 뒤에 둔다 — 2차 프롬프트가 그 폭을 기준으로 비율을 답한다.
    if (KITCHEN_CATEGORIES.includes(category) && wall.read && (!wall.read.water || !wall.read.exhaust)) {
      await askPlumbing(env, job, wall, room);
    }
    applyManualPlumbing(wall, opts);   // 사람이 넣은 값은 둘 다 이긴다
    ck.wall = wall;
    await save({ wall });
    await updateById(env, 'generations', job.id, { wall_analysis: wall });
  }
  const wall = ck.wall;

  const ctx = {
    category,
    ...wall,
    style: STYLES[opts.design_style] ? opts.design_style : DEFAULT_STYLE,
    doorColor: opts.door_color || 'white',
    doorFinish: opts.door_finish || 'matte',
    refCount: refs.length,
    fridgeBrand: opts.fridge_options && opts.fridge_options.brand === 'lg' ? 'LG' : 'Samsung',
    fridgePosition:
      opts.fridge_options && opts.fridge_options.position === 'right' ? 'right' : 'left',
    // 플래너 도면 요약 (worker.js 가 이미 검증해 options 에 넣었다). null 이면 범용 문단.
    designSpec: opts.design_spec || null,
    // 손님 요청 (연출컷 ③ 상세 요청). worker.js 가 다듬어 두었다 — 한 번 더 다듬는다. 없으면 null.
    customerRequest: cleanCustomerRequest(opts.customer_request),
    // 플래너 모드 — 프롬프트 v2 와 검사 코드(existing_left·pasted_reference)를 켠다
    ...(planner ? { planner: true, massing: !!massing, aspect: opts.aspect } : {}),
  };
  const imageSize = env.GEMINI_IMAGE_SIZE || '2K';
  // 결과 비율은 방 사진을 따른다 (플래너 모드는 고른 비율). 추천안도 같은 비율로 그린다.
  const aspectRatio = planner ? ctx.aspect : aspectRatioOf(room);
  const prefix = `${job.userId}/${job.id}`;

  // ═══ 1-b. 사진 위 가이드 선 (깊이 계획 3a, 2026-10-18) ═══
  //   벽 전체 장(붙박이장·수납장)이고 정면 벽 끝에 튀어나온 벽이 있을 때만 — 그 벽 앞 모서리가 앞면의 기준이다.
  //   텍스트 모델이 보이는 선·모서리만 찾고, 앞면 선은 guide.js 가 소실점으로 계산해 사진 사본에 그린다.
  //   어느 단계든 실패하면 가이드 없이 글 지시만으로 그린다. GUIDE_LINES='off' 로 끈다.
  let guideImg = null;
  let massingImg = null; // 덩어리 합성본 — 있으면 방 사진 대신 편집 대상
  const wantGuide =
    !planner && env.GUIDE_LINES !== 'off' &&
    !!(CATEGORIES[category] && CATEGORIES[category].wallToWallMm) && !!wall.sideReturn;
  if (wantGuide && ck.guide === undefined) {
    ck.guide = null;
    const t0 = Date.now();
    try {
      const side = wall.sideReturn.side;
      const canvas = await prepareGuideCanvas(room); // 긴 변 1024 바탕 — 선 찾기와 그리기가 같은 그림을 쓴다
      let points = null;
      let by = null;
      // 2026-10-18 사장님 "선 찾는 일은 Haiku 5.5" — 줄인 바탕 PNG 를 보내 그 픽셀 [x, y] 로 받는다.
      //   키가 없거나 실패하면 Gemini(0~1000 [y, x]) 로.
      if (canvas && env.ANTHROPIC_API_KEY) {
        try {
          const size = { width: canvas.width, height: canvas.height };
          const { json, model } = await callClaudeJson(env, {
            prompt: buildGuidePointsPrompt(side, size),
            image: canvas.png,
            schema: GUIDE_POINTS_SCHEMA,
            model: env.GUIDE_MODEL || 'claude-haiku-5-5',
            fallbacks: false, // Haiku 5.5 는 서버 거절 대체를 받지 않는다
            maxTokens: 4000,
          });
          points = parseGuidePoints(json, side, size);
          by = model;
        } catch (e) {
          console.warn(`[Job ${job.id}] guide points (Claude) failed:`, e.message);
        }
      }
      if (canvas && !points) {
        const t = await callGemini(env, { prompt: buildGuidePointsPrompt(side), images: [room], want: 'text', temperature: 0 });
        points = parseGuidePoints(t.text, side);
        by = points ? textModel(env) : by;
      }
      const g = points && (await drawGuide(canvas, points));
      if (g) {
        const up = await uploadObject(env, `${prefix}/guide.png`, g.base64, g.mimeType);
        ck.guide = { path: up.path, url: up.url, by, points }; // points: 추천안 되붙이기가 다시 쓴다 (0~1)
        guideImg = { base64: g.base64, mimeType: g.mimeType };
        // 2026-10-19: 윤곽선만으로는 GPT 가 장을 뒷벽으로 되돌렸다 → 기본은 덩어리 합성(편집 대상 자체를 바꾼다).
        //   GUIDE_MODE='outline' 이면 예전처럼 윤곽선만 마지막 이미지로.
        if (env.GUIDE_MODE !== 'outline') {
          const m = await renderMassingImage(room, points, { doors: wardrobeDoors(wall.wallW) });
          if (m) {
            const upM = await uploadObject(env, `${prefix}/massing.png`, m.base64, m.mimeType);
            ck.guide.massing = { path: upM.path, url: upM.url };
            massingImg = { base64: m.base64, mimeType: m.mimeType };
          }
        }
      }
      console.log(`[Job ${job.id}] guide: ${ck.guide ? `drawn by ${by}` : points ? 'geometry rejected' : 'points missing'} ${Date.now() - t0}ms`);
    } catch (e) {
      console.warn(`[Job ${job.id}] guide skipped:`, e.message);
    }
    await save({ guide: ck.guide });
    if (ck.guide) await updateById(env, 'generations', job.id, { wall_analysis: { ...wall, guide: ck.guide } });
  } else if (wantGuide && ck.guide) {
    guideImg = await fetchObjectBase64(env, ck.guide.path); // 재실행 — 그려 둔 것을 쓴다
    if (ck.guide.massing) massingImg = await fetchObjectBase64(env, ck.guide.massing.path);
  }
  // ═══ 1-c. 싱크대 덩어리 합성 (2026-10-19) ═══
  //   기존 가구가 없는 사진(빈 벽·공사 현장)이고 Claude 키가 있을 때만. Haiku 가 뒷벽·옆벽 선을 찾고, kitchen.js 가
  //   두 소실점 + 벽 높이로 카메라를 풀어 하부장·상판·상부장을 사진에 투영해 칠한다. 화각은 사진 EXIF(room_focal35),
  //   없으면 24mm. 실패하면 글 지시로. GUIDE_MODE='outline' 이나 GUIDE_LINES='off' 면 하지 않는다.
  const wantKitchen =
    !planner && env.GUIDE_LINES !== 'off' && env.GUIDE_MODE !== 'outline' &&
    category === 'sink' && !wall.existing && !!env.ANTHROPIC_API_KEY;
  if (wantKitchen && ck.guide === undefined) {
    ck.guide = null;
    const t0 = Date.now();
    let why = 'points missing';
    try {
      const canvas = await prepareGuideCanvas(room);
      if (canvas) {
        const size = { width: canvas.width, height: canvas.height };
        const { json, model } = await callClaudeJson(env, {
          prompt: buildKitchenPointsPrompt(size),
          image: canvas.png,
          schema: KITCHEN_POINTS_SCHEMA,
          model: env.GUIDE_MODEL || 'claude-haiku-5-5',
          fallbacks: false,
          maxTokens: 4000,
        });
        const points = parseKitchenPoints(json, size);
        if (points) {
          why = 'camera not solved';
          const m = await renderKitchenMassing(room, points, {
            wallH: wall.wallH,
            waterPct: wall.waterPct,
            exhaustPct: wall.exhaustPct,
            focalMm: Number(opts.room_focal35) || 24,
          });
          if (m) {
            const upM = await uploadObject(env, `${prefix}/massing.png`, m.base64, m.mimeType);
            ck.guide = { kind: 'kitchen', by: model, cam: m.cam, mask: m.mask, massing: { path: upM.path, url: upM.url } };
            massingImg = { base64: m.base64, mimeType: m.mimeType };
            why = 'drawn';
          }
        }
      }
    } catch (e) {
      why = `failed: ${e.message}`;
    }
    console.log(`[Job ${job.id}] kitchen massing: ${why} ${Date.now() - t0}ms`);
    await save({ guide: ck.guide });
    if (ck.guide) await updateById(env, 'generations', job.id, { wall_analysis: { ...wall, guide: ck.guide } });
  } else if (wantKitchen && ck.guide && ck.guide.massing) {
    massingImg = await fetchObjectBase64(env, ck.guide.massing.path);
  }

  // ═══ 1-d. 플래너 도면 덩어리 (2026-10-20) ═══
  //   플래너 모드에서 줄 길이를 늘리는 실패(싱크대 26건: 일자 14/15)를 자리로 막는다 — 1-c 와 같은 선 찾기·카메라 풀기로
  //   도면의 실제 줄을 칠한 사진을 IMAGE A 로 준다 (planner-place.js). 기본은 꺼짐: PLANNER_PLACE_GUIDE='on' 일 때만.
  //   기존 가구가 없는 사진 · 일자(꺾인 벽 없음) · Claude 키가 있을 때만. 어느 단계든 실패하면 방 사진 그대로.
  let placeImg = null;
  const placeBlocks = planner ? plannerPlaceBlocks(opts.design_spec) : null;
  const wantPlace =
    planner && env.PLANNER_PLACE_GUIDE === 'on' && !!placeBlocks && !wall.existing && !!env.ANTHROPIC_API_KEY;
  if (wantPlace && ck.place === undefined) {
    ck.place = null;
    const t0 = Date.now();
    let why = 'points missing';
    try {
      const canvas = await prepareGuideCanvas(room);
      if (canvas) {
        const size = { width: canvas.width, height: canvas.height };
        const { json, model } = await callClaudeJson(env, {
          prompt: buildKitchenPointsPrompt(size),
          image: canvas.png,
          schema: KITCHEN_POINTS_SCHEMA,
          model: env.GUIDE_MODEL || 'claude-haiku-5-5',
          fallbacks: false,
          maxTokens: 4000,
        });
        const points = parseKitchenPoints(json, size);
        if (points) {
          why = 'camera not solved';
          const m = await renderFacesMassing(
            room,
            points,
            { wallH: wall.wallH, focalMm: Number(opts.room_focal35) || 24 },
            (cam) => plannerPlaceFaces(cam, placeBlocks),
            ['front']
          );
          if (m) {
            const up = await uploadObject(env, `${prefix}/place.png`, m.base64, m.mimeType);
            ck.place = { by: model, cam: m.cam, path: up.path, url: up.url };
            placeImg = { base64: m.base64, mimeType: m.mimeType };
            why = 'drawn';
          }
        }
      }
    } catch (e) {
      why = `failed: ${e.message}`;
    }
    console.log(`[Job ${job.id}] planner place guide: ${why} ${Date.now() - t0}ms`);
    await save({ place: ck.place });
    if (ck.place) await updateById(env, 'generations', job.id, { wall_analysis: { ...wall, place: ck.place } });
  } else if (wantPlace && ck.place) {
    placeImg = await fetchObjectBase64(env, ck.place.path);
  }
  if (placeImg) ctx.placeGuide = true;

  if (massingImg) {
    ctx.mockVolume = true;
    ctx.mockKind = ck.guide && ck.guide.kind === 'kitchen' ? 'kitchen' : 'wardrobe';
  } else if (guideImg) ctx.guide = true;

  const install = async (fix) => {
    if (planner) {
      // 2026-10-18: 공급자는 행에 기록된 값 (options.image_provider — worker.js 가 늘 기록, 없는 옛 행은 Gemini).
      //   GPT 면 편집 호출, 키가 없거나 실패하면 Gemini 가 대신 (images.js).
      //   누가 그렸는지는 칸(drawnBy)과 generations.model 에 남는다. Gemini 가 정상으로 그리면 칸 표시 없음.
      // 2026-10-19: IMAGE B 는 공급자마다 — GPT 는 번호 입면(있으면), Gemini 는 늘 번호 없는 입면.
      //   번호 입면을 보낼 때만 프롬프트에 "번호·치수선은 주석" 문장이 들어간다. GPT 실패 대체로 Gemini 가
      //   그릴 때는 번호 없는 입면 + 그 문장 없는 프롬프트로 다시 만든다.
      const payload = (who) => {
        const labeled = who === 'openai' && !!elevationLabeled;
        const b = labeled ? elevationLabeled : elevation;
        // 2026-10-19: 꺾인 벽 입면은 3/4 뒤에 (IMAGE C·D …) — GPT 는 번호 있는 것, Gemini 는 번호 없는 것만
        const rets = returnElevations
          .map((r) => {
            const useLabeled = who === 'openai' && !!r.labeled;
            const im = useLabeled ? r.labeled : r.plain;
            return im ? { side: r.side, labeled: useLabeled, im } : null;
          })
          .filter(Boolean);
        return {
          prompt: buildPlannerPrompt({
            ...ctx,
            labeledElevation: labeled,
            ...(rets.length ? { returnElevations: rets.map((r) => ({ side: r.side, labeled: r.labeled })) } : {}),
          }),
          images: [placeImg || room, b, ...(massing ? [massing] : []), ...rets.map((r) => r.im)],
          imageSize,
          temperature: 0.2,
          aspectRatio: ctx.aspect,
        };
      };
      const r = await renderPlannerImage(env, payload, opts.image_provider);
      if (!r.image) throw new Error('install returned no image');
      return { base64: r.image, mimeType: r.imageMime || 'image/jpeg', meta: drawnBy(r) };
    }
    // 연출컷 기본안 — 공급자는 images.js 가 고른다 (IMAGE_PROVIDER, GPT 실패 시 Gemini)
    const r = await renderImage(
      env,
      { prompt: buildInstallPrompt(ctx, fix ? { fix } : {}), images: massingImg ? [massingImg, ...refs] : [room, ...refs, ...(guideImg ? [guideImg] : [])], imageSize, aspectRatio },
      'base'
    );
    if (!r.image) throw new Error('install returned no image');
    return { base64: r.image, mimeType: r.imageMime || 'image/jpeg', meta: drawnBy(r) };
  };

  // ═══ 2. 설치 + 3. 검사 (1회 재시도) ═══
  let base = null; // {base64, mimeType}
  if (!ck.images.base) {
    await setStep(env, job, ck, 'rendering');
    base = await install();

    await setStep(env, job, ck, 'qc');
    let qc = { ok: true, issues: [], note: null };
    let qcTimer = null;
    try {
      // 검사 한 번에 90초 이상 걸리면 통과로 본다 — 검사 때문에 생성을 막지 않는다
      const q = await Promise.race([
        // 원본 방 사진을 함께 본다 — 가구가 원래 벽선보다 앞으로 나왔는지 비교해야 깊이를 판정한다 (2026-10-14)
        callGemini(env, { prompt: buildQcPrompt(ctx), images: [room, base], want: 'text' }),
        new Promise((_, reject) => {
          qcTimer = setTimeout(() => reject(new Error('qc timeout')), QC_TIMEOUT_MS);
        }),
      ]);
      qc = parseQc(q.text);
    } catch (e) {
      console.warn(`[Job ${job.id}] qc skipped:`, e.message);
    } finally {
      clearTimeout(qcTimer); // 검사가 먼저 끝나면 90초 타이머를 남기지 않는다
    }
    if (!qc.ok && planner) {
      // 플래너 모드는 재시도하지 않는다 (계획서 §4.5 · §11-④) — 결과는 images[base].qc 에 기록만.
      console.log(`[Job ${job.id}] qc issues (planner, recorded only): ${qc.issues.join(',')}`);
    } else if (qcNeedsRetry(qc)) {
      console.log(`[Job ${job.id}] qc issues: ${qc.issues.join(',')} — retrying install`);
      qc.retried = true;
      try {
        base = await install(qc.issues);
      } catch (e) {
        console.warn(`[Job ${job.id}] fixed install failed, keeping first:`, e.message);
      }
    } else if (!qc.ok) {
      // 천장 틈·글자·가전만 걸렸다 — 기록만 (QC_RECORD_ONLY)
      console.log(`[Job ${job.id}] qc issues (record only): ${qc.issues.join(',')}`);
      qc.retried = false;
    }

    const up = await uploadObject(
      env,
      `${prefix}/base.${extOf(base.mimeType)}`,
      base.base64,
      base.mimeType
    );
    ck.images.base = { label: `${labelOf(category)} · 기본안`, path: up.path, url: up.url, qc, ...(base.meta || {}) };
    await save({ images: ck.images });
    await updateById(env, 'generations', job.id, {
      images: slotList(ck.images),
      quote: buildQuote(category, wall.wallW),
    });
  } else {
    base = await fetchObjectBase64(env, ck.images.base.path);
  }

  // ═══ 3-b. 역판독 대조 (R4c, 2026-09-19 · 계획서 §4.1) ═══
  //   도면 요약이 있으면 기본안을 Claude 비전으로 읽어(layout.js) 우리가 보낸 도면과 순서·개수를 대조한다.
  //   2026-10-19: 플래너 모드는 판독 방식이 다르다 — 사진 + 정면 입면 + 도면 목록으로 모듈(L1·U1…)마다 센다
  //   (normalizePlannerRead). 같은 layout 모양이라 대조·화면은 그대로 받는다. 플래너가 아니면 옛 판독 그대로.
  //   절대 잡을 깨지 않는다 — 실패하면 layout.verify.error 만 남긴다. status 는 CHECK 제약 때문에 안 바꾸고 step_label 만 바꾼다.
  //   2026-10-19: 플래너 모드는 품목을 가리지 않는다(PLANNER_READ_CATEGORIES = CATEGORIES 전부) — 판독이 도면 목록을 센다.
  //   예전엔 신발장·화장대·서재·침실·사무실이 여기서 빠져 대조 기록이 없었고, 그래서 늘 internal_only 였다.
  //   플래너가 아니면 예전 그대로 LAYOUT_CATEGORIES 만 (옛 판독은 품목별 세그먼트 종류가 있어야 한다).
  const verifiable = planner ? PLANNER_READ_CATEGORIES.includes(category) : LAYOUT_CATEGORIES.includes(category);
  if (!ck.verify && opts.design_spec && verifiable) {
    await updateById(env, 'generations', job.id, { step_label: '도면과 대조하는 중', progress: 65 });
    let layout;
    const t0 = Date.now();
    try {
      if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
      if (base.base64.length > VERIFY_MAX_B64) throw new Error('image_too_large');
      const lctx = { category, wallAnalysis: wall, options: opts };
      if (planner) {
        // 2026-10-19: 플래너 모드는 [결과 사진, 정면 입면] + 도면 목록으로 모듈(L1·U1…)마다 센다 (layout.js §4).
        //   입면은 번호 있는 것(공급자와 상관없이)이 있으면 그것, 없거나 못 읽으면 번호 없는 것.
        const read = await plannerVerifyElevation(env, job, inputs, elevation, elevationLabeled);
        // 2026-10-19: 꺾인 벽 입면 — 번호 있는 것 먼저, 한도 안에 드는 것만 (주벽 입면이 있을 때만 — 그림 번호가 이어진다)
        const fits = (im) => im && typeof im.base64 === 'string' && im.base64.length <= VERIFY_MAX_B64;
        const rets = read.image
          ? returnElevations
            .map((r) => (fits(r.labeled) ? { side: r.side, labeled: true, im: r.labeled } : fits(r.plain) ? { side: r.side, labeled: false, im: r.plain } : null))
            .filter(Boolean)
          : [];
        const pctx = {
          category, designSpec: opts.design_spec, wallAnalysis: wall, elevation: read.kind,
          ...(rets.length ? { returnElevations: rets.map((r) => ({ side: r.side, labeled: r.labeled })) } : {}),
        };
        const { json: raw, model } = await callClaudeJson(env, {
          prompt: buildPlannerReadPrompt(pctx),
          images: read.image ? [base, read.image, ...rets.map((r) => r.im)] : [base],
          schema: PLANNER_READ_SCHEMA,
        });
        layout = normalizePlannerRead(raw, { ...pctx, slot: 'base', model, now: new Date().toISOString() });
      } else {
        const { json: raw, model } = await callClaudeJson(env, {
          prompt: buildLayoutPrompt(lctx),
          image: base,
          schema: LAYOUT_SCHEMA,
        });
        layout = normalizeLayout(raw, { ...lctx, slot: 'base', model, now: new Date().toISOString() });
      }
      layout.verify = compareLayoutToSpec(layout, opts.design_spec, category);
    } catch (e) {
      console.warn(`[Job ${job.id}] verify failed:`, e.message);
      layout = { version: 0, verify: { version: VERIFY_VERSION, ok: null, error: String(e.message || e).slice(0, 160) } };
    }
    layout.elapsed_ms = Date.now() - t0;
    ck.verify = { ok: layout.verify.ok, score: layout.verify.score ?? null };
    await save({ images: ck.images, verify: ck.verify });
    await updateById(env, 'generations', job.id, { layout, images: slotList(ck.images) });
    console.log(`[Job ${job.id}] verify: ok=${layout.verify.ok} score=${layout.verify.score ?? '-'} ${layout.elapsed_ms}ms`);
  }

  // 2026-09-22: 추천안을 끌 수 있다 (options.variants === false). 플래너 디테일의 실사화는
  //   도면을 바탕으로 한 **한 장**이 결과물이지 색을 바꾼 추천안이 아니다 — 4장 나올 이유가 없다.
  //   끄면 이미지 호출이 4회에서 1회로 준다. 기본안이 나오면 그대로 done.
  const wantVariants = !planner && opts.variants !== false; // 플래너 모드는 worker.js 가 이미 false 로 둔다 — 한 번 더 막는다
  // 마무리(5단계)가 읽으므로 추천안을 껐을 때도 있어야 한다 — 첫 실측에서 'variantErrors is not defined' 로 마무리가 실패했다
  const variantErrors = {};
  if (wantVariants) {
  // ═══ 4. 변형 3장 병렬 — 끝나는 대로 올리고 행을 갱신한다 ═══
  await setStep(env, job, ck, 'variants');

  // 되붙이기 자리는 다 그려진 기본안에서 다시 찾는다 (2026-10-19). GPT 가 기본안을 그리며 장을 덩어리보다
  //   위·옆으로 옮기면 덩어리 자리로는 문짝이 두 색으로 잘렸다. Haiku 가 기본안의 가구 윤곽을 준다. 실패하면 덩어리 자리.
  if (ck.guide && ck.guide.massing && ck.guide.baseMask === undefined) {
    ck.guide.baseMask = null;
    const t0 = Date.now();
    try {
      const canvas = await prepareGuideCanvas(base);
      if (canvas) {
        const size = { width: canvas.width, height: canvas.height };
        const { json } = await callClaudeJson(env, {
          prompt: buildFurnitureMaskPrompt(ck.guide.kind === 'kitchen' ? 'kitchen' : 'wardrobe', size),
          image: canvas.png,
          schema: FURNITURE_MASK_SCHEMA,
          model: env.GUIDE_MODEL || 'claude-haiku-5-5',
          fallbacks: false,
          maxTokens: 4000,
        });
        ck.guide.baseMask = parseFurnitureMask(json, size);
      }
    } catch (e) {
      console.warn(`[Job ${job.id}] base mask failed:`, e.message);
    }
    console.log(`[Job ${job.id}] base mask: ${ck.guide.baseMask ? `${ck.guide.baseMask.length} blocks` : 'none'} ${Date.now() - t0}ms`);
    await save({ guide: ck.guide });
    await updateById(env, 'generations', job.id, { wall_analysis: { ...wall, guide: ck.guide } });
  }

  // 테마 참고가 있으면 첫 추천안은 그 색감이다. 한 번 뽑아 체크포인트에 둔다.
  if (themeRefs.length && ck.themeFinish === undefined) {
    ck.themeFinish = null;
    try {
      const t = await callGemini(env, {
        prompt: buildThemePalettePrompt(themeNotes.slice(0, 3)),
        images: themeRefs.slice(0, 3),
        want: 'text',
      });
      ck.themeFinish = parseThemePalette(t.text);
      console.log(`[Job ${job.id}] theme palette:`, JSON.stringify(ck.themeFinish));
    } catch (e) {
      console.warn(`[Job ${job.id}] theme palette failed:`, e.message);
    }
    await save({ themeFinish: ck.themeFinish });
  }
  // 추천안 구성 — 순서대로 슬롯 v1..v3.
  //   테마 색감 (테마 참고가 있을 때) → 투톤 (싱크가 있는 품목) → 나머지는 팔레트
  const seed = wall.wallW + category.length * 7919;
  const specs = [];
  if (ck.themeFinish) {
    const f = ck.themeFinish;
    specs.push({
      key: 'theme',
      label: `AI 추천 · 테마 색감 (${f.tone})`,
      finish: { body: f.body, accent: f.accent },
      prompt: buildVariantPrompt(f),
    });
  }
  if (KITCHEN_CATEGORIES.includes(category)) {
    const pair = pickTwoTone(seed);
    specs.push({
      key: `two-tone:${pair.key}`,
      label: `AI 추천 · 투톤 (${pair.tone})`,
      finish: { upper: pair.upper, lower: pair.lower },
      prompt: buildTwoToneVariantPrompt(pair),
    });
  }
  // 붙박이장은 4장 중 2장이 내부 보기 (2026-10-19 사장님) — 색 추천안은 한 장 (테마가 있으면 테마 색감).
  //   내부 보기는 문을 전부 연다. 한 장은 기본안 색, 한 장은 그 색 추천안의 색.
  const interior = category === 'wardrobe';
  const interiorCount = interior ? 2 : 0;
  const palette = pickFinishes(Math.max(0, VARIANT_COUNT - interiorCount - specs.length), seed);
  for (const f of palette) {
    specs.push({ key: f.key, label: `AI 추천 · ${f.tone}`, finishSrc: f, prompt: buildVariantPrompt(f) });
  }
  if (interior) {
    const colourSpec = specs[0];
    const colour = colourSpec.finishSrc || (ck.themeFinish ? { body: ck.themeFinish.body, tone: ck.themeFinish.tone } : null);
    // 첫 장: 정본 기본형 + 기본안 색. 둘째 장: 추천 구조(그 슬롯 차례에 고른다) + 색 추천안 색
    const std = buildWardrobeInteriorPrompt(wall.wallW, null, { tag: '기본 구조', wallH: wall.wallH });
    specs.push({ key: 'interior', label: std.label, prompt: std.prompt, interior: true, structure: { kind: 'standard', plan: interiorPlanKo(wardrobeInteriorPlan(wall.wallW)) } });
    specs.push({ key: `interior:${colourSpec.key}`, interior: true, recommend: true, colour });
  }

  // 붙박이장 추천 구조 (2026-10-19 사장님 "정본 구조 이외에 추천 구조를 알아서 만들어 나머지 1장에").
  //   기본안 사진·방 메모·손님 요청을 Claude 에 보여 주고 정본 프리셋 **조합** 하나를 고르게 한다
  //   (prompts.js INTERIOR_PRESET_KEYS · 긴옷 내부 서랍 0~5 — 새 칸 규칙은 만들지 않는다).
  //   한 번 고르면 체크포인트에 둔다 — 재실행에도 같은 구조. 못 고르면 그 장은 정본 기본형 + 추천 색 (#854 와 같다).
  const recommendedInterior = async (colour) => {
    const canonical = wardrobeInteriorPlan(wall.wallW);
    if (ck.interiorRec === undefined) {
      // 고르는 동안 ck 에 null 을 두지 않는다 — 다른 슬롯의 save() 가 그 null 을 "추천 없음" 으로 굳혀
      //   중간에 재시작되면 추천을 다시 고르지 않았다. 결과는 끝나고 한 번에 넣는다.
      let decided = null;
      let timer = null;
      const t0 = Date.now();
      let why = 'no key';
      try {
        if (env.ANTHROPIC_API_KEY) {
          const model = env.INTERIOR_MODEL || claudeModel(env);
          // 프록시 경유 Claude 호출은 SDK 시간 제한(중단 신호)이 닿지 않는다 — 검사처럼 따로 끊는다
          const { json, model: by } = await Promise.race([
            callClaudeJson(env, {
              prompt: buildInteriorRecommendPrompt({
                sections: canonical.length,
                wallW: wall.wallW,
                wallH: wall.wallH,
                brief: wall.brief,
                customerRequest: ctx.customerRequest,
                canonical,
              }),
              image: base,
              schema: INTERIOR_RECOMMEND_SCHEMA,
              model,
              fallbacks: !/haiku/i.test(model), // Haiku 5.5 는 서버 거절 대체를 받지 않는다
              maxTokens: 4000,
            }),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('interior recommendation timeout')),
                Number(env.INTERIOR_REC_TIMEOUT_MS) || INTERIOR_REC_TIMEOUT_MS
              );
            }),
          ]);
          const rec = parseInteriorRecommendation(json, { sections: canonical.length, canonical, wallH: wall.wallH });
          if (rec) decided = { ...rec, by };
          why = rec ? `${by} ${interiorPlanKo(rec.plan)}` : `rejected ${JSON.stringify(json).slice(0, 160)}`;
        }
      } catch (e) {
        why = `failed: ${e.message}`;
      } finally {
        clearTimeout(timer);
      }
      console.log(`[Job ${job.id}] interior recommendation: ${why} ${Date.now() - t0}ms`);
      ck.interiorRec = decided;
      await save({ interiorRec: decided });
    }
    const rec = ck.interiorRec;
    const built = buildWardrobeInteriorPrompt(wall.wallW, colour, rec ? { plan: rec.plan, tag: '추천 구조', wallH: wall.wallH } : { wallH: wall.wallH });
    return {
      prompt: built.prompt,
      label: built.label,
      structure: rec
        ? { kind: 'recommended', plan: interiorPlanKo(rec.plan), concept: rec.concept, reason: rec.reason, by: rec.by }
        : { kind: 'standard', plan: interiorPlanKo(canonical), fallback: true },
    };
  };

  await Promise.all(
    specs.map(async (f, i) => {
      const slot = `v${i + 1}`;
      if (ck.images[slot]) return; // 재실행 시 이미 올라간 슬롯
      // 세 호출을 한꺼번에 쏘면 분당 한도에 걸릴 수 있어 살짝 어긋나게 보낸다.
      await sleep(i * VARIANT_STAGGER_MS);
      if (f.recommend) Object.assign(f, await recommendedInterior(f.colour));
      let lastErr = null;
      for (let attempt = 1; attempt <= VARIANT_ATTEMPTS; attempt++) {
        try {
          // 공급자는 images.js 가 고른다. 어느 모델이 그렸는지 칸에 남긴다.
          const r = await renderImage(env, { prompt: f.prompt, images: [base], imageSize, aspectRatio }, 'variant');
          if (!r.image) throw new Error('no image in response');
          let mime = r.imageMime || 'image/jpeg';
          let out = r.image;
          let pasted = false;
          // 덩어리 합성을 쓴 건: 장 영역만 추천안, 나머지는 기본안 (옆 세면대·벽이 같이 칠해지던 것)
          //   내부 보기는 열린 문짝이 장 윤곽 밖으로 나오므로 되붙이지 않는다
          if (!f.interior && ck.guide && ck.guide.massing && (ck.guide.points || ck.guide.mask)) {
            try {
              // 기본안에서 찾은 윤곽(baseMask)이 먼저 — 윤곽 오차를 덮게 조금 넓게.
              //   없으면 싱크대는 칠한 면 다각형(mask), 붙박이장은 앞면 점(points)
              const p = ck.guide.baseMask
                ? await pasteVariantInPolys(base, { base64: out, mimeType: mime }, ck.guide.baseMask, { grow: 0.012, feather: 0.006 })
                : ck.guide.mask
                ? await pasteVariantInPolys(base, { base64: out, mimeType: mime }, ck.guide.mask)
                : await pasteVariantInside(base, { base64: out, mimeType: mime }, ck.guide.points);
              if (p) {
                out = p.base64;
                mime = p.mimeType;
                pasted = true;
              }
            } catch (e) {
              console.warn(`[Job ${job.id}] variant ${slot} paste-back skipped:`, e.message);
            }
          }
          const up = await uploadObject(env, `${prefix}/${slot}.${extOf(mime)}`, out, mime);
          ck.images[slot] = {
            label: f.label,
            finish_key: f.key,
            finish: f.finish,
            path: up.path,
            url: up.url,
            ...drawnBy(r),
            ...(pasted ? { pasted: true } : {}),
            ...(f.structure ? { structure: f.structure } : {}),
          };
          await save({ images: ck.images });
          await updateById(env, 'generations', job.id, {
            images: slotList(ck.images),
            progress: 70 + 10 * Object.keys(ck.images).filter((k) => k !== 'base').length,
          });
          return;
        } catch (e) {
          lastErr = e;
          console.warn(`[Job ${job.id}] variant ${slot} attempt ${attempt} failed:`, e.message);
          if (attempt < VARIANT_ATTEMPTS) await sleep(VARIANT_RETRY_MS);
        }
      }
      variantErrors[slot] = (lastErr && lastErr.message ? lastErr.message : 'unknown').slice(
        0,
        160
      );
    })
  );

  }

  // ═══ 5. 마무리 ═══
  const variantCount = Object.keys(ck.images).filter((k) => /^v\d$/.test(k)).length;
  const failedSlots = Object.keys(variantErrors);
  // 플래너 모드 — 대조가 ok 가 아니면 done 과 같은 패치에 internal_only 를 싣는다 (done 인데 표시가 없는 틈을 두지 않는다)
  const internal = await internalOnlyPatch(env, job, ck);
  await updateById(env, 'generations', job.id, {
    status: 'done',
    progress: 100,
    step_label:
      !wantVariants || variantCount === VARIANT_COUNT ? '완료' : `완료 (추천안 ${variantCount}/${VARIANT_COUNT})`,
    // 빠진 추천안의 사유를 남긴다 — 없으면 왜 3/4 인지 알 길이 없다.
    error: failedSlots.length
      ? failedSlots.map((s) => `${s}: ${variantErrors[s]}`).join(' | ')
      : null,
    images: slotList(ck.images),
    quote: buildQuote(category, wall.wallW),
    model: (ck.images.base && ck.images.base.model) || env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image',
    elapsed_ms: Date.now() - startedAt,
    completed_at: new Date().toISOString(),
    ...internal,
  });
  console.log(
    `[Job ${job.id}] done: variants ${variantCount}/${VARIANT_COUNT}, ${Date.now() - startedAt}ms`
  );
}

/**
 * 칸에 남길 "누가 그렸나". Gemini 기본 모델이 정상으로 그렸으면 예전처럼 아무것도 안 남긴다
 * (옛 기록·시험과 같은 모양). GPT 이거나 대체 모델이면 provider·model, 대체면 fallback·사유, GPT 면 사용량.
 */
function drawnBy(r) {
  if (!r || (r.provider !== 'openai' && !r.fallback)) return {};
  return {
    provider: r.provider,
    model: r.model,
    ...(r.fallback ? { fallback: true } : {}),
    ...(r.fallback_reason ? { fallback_reason: r.fallback_reason } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
  };
}

function labelOf(category) {
  return (CATEGORIES[category] && CATEGORIES[category].label) || category;
}
