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
 */

import { callGemini } from './gemini.js';
import {
  CATEGORIES,
  DEFAULT_STYLE,
  STYLES,
  buildAnalysisPrompt,
  buildInstallPrompt,
  buildQcPrompt,
  buildThemePalettePrompt,
  buildTwoToneVariantPrompt,
  buildVariantPrompt,
  KITCHEN_CATEGORIES,
  clampWall,
  parseAnalysis,
  parseQc,
  parseThemePalette,
  pickFinishes,
  pickTwoTone,
  resolveCategory,
} from './prompts.js';
import { buildQuote } from './quote.js';
import { updateById, uploadObject, fetchObjectBase64, extOf } from './supabase.js';
import { refundCreditService } from './credits.js';

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 15_000;
const JOB_TIMEOUT_MS = 10 * 60_000; // 환불 창(30분) 안에 끝나야 한다
const VARIANT_COUNT = 3;
const VARIANT_ATTEMPTS = 2; // 실패·빈 응답이면 한 번 더
const VARIANT_RETRY_MS = 4_000;
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
      await runPipeline(this.env, job, ck, (patch) =>
        this.state.storage.put('ckpt', { ...ck, ...patch })
      );
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
      await updateById(this.env, 'generations', job.id, {
        status: hasBase ? 'done' : 'failed', // 기본안이 있으면 결과로 인정한다
        progress: hasBase ? 100 : ck.step === 'analyzing' ? 10 : 30,
        step_label: hasBase ? '완료 (추천안 일부 실패)' : '생성 실패',
        error: reason,
        completed_at: new Date().toISOString(),
        ...(hasBase ? { images: slotList(ck.images) } : {}),
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

// ─── 파이프라인 ───

function slotList(images) {
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

async function runPipeline(env, job, ck, save) {
  const opts = job.options || {};
  const inputs = job.inputs || {};
  const category = resolveCategory(job.category);
  const startedAt = job.startedAt || Date.now();

  // 입력 이미지는 Storage 에서 읽는다 — DO storage 에 base64 를 두지 않는다.
  const room = await fetchObjectBase64(env, inputs.room.path);
  // 참고 이미지는 역할이 둘이다.
  //   style (업로드·시공사례) → 설치 단계에 첨부, 마감·분위기 참고
  //   theme (식물·명품·회화 등)  → 색감만 뽑아 추천안 한 장으로
  const refs = []; // style
  const themeRefs = [];
  for (const r of inputs.refs || []) {
    try {
      const img = await fetchObjectBase64(env, r.path);
      (r.role === 'theme' ? themeRefs : refs).push(img);
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
      waterPct: 30,
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
    }
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
  };
  const imageSize = env.GEMINI_IMAGE_SIZE || '2K';
  const prefix = `${job.userId}/${job.id}`;

  // ═══ 2. 설치 + 3. 검사 (1회 재시도) ═══
  let base = null; // {base64, mimeType}
  if (!ck.images.base) {
    await setStep(env, job, ck, 'rendering');
    let r = await callGemini(env, {
      prompt: buildInstallPrompt(ctx),
      images: [room, ...refs],
      imageSize,
    });
    if (!r.image) throw new Error('install returned no image');
    base = { base64: r.image, mimeType: r.imageMime || 'image/jpeg' };

    await setStep(env, job, ck, 'qc');
    let qc = { ok: true, issues: [], note: null };
    try {
      const q = await callGemini(env, { prompt: buildQcPrompt(ctx), images: [base], want: 'text' });
      qc = parseQc(q.text);
    } catch (e) {
      console.warn(`[Job ${job.id}] qc skipped:`, e.message);
    }
    if (!qc.ok) {
      console.log(`[Job ${job.id}] qc issues: ${qc.issues.join(',')} — retrying install`);
      try {
        const r2 = await callGemini(env, {
          prompt: buildInstallPrompt(ctx, { fix: qc.issues }),
          images: [room, ...refs],
          imageSize,
        });
        if (r2.image) base = { base64: r2.image, mimeType: r2.imageMime || 'image/jpeg' };
      } catch (e) {
        console.warn(`[Job ${job.id}] fixed install failed, keeping first:`, e.message);
      }
    }
    r = null;

    const up = await uploadObject(
      env,
      `${prefix}/base.${extOf(base.mimeType)}`,
      base.base64,
      base.mimeType
    );
    ck.images.base = { label: `${labelOf(category)} · 기본안`, path: up.path, url: up.url, qc };
    await save({ images: ck.images });
    await updateById(env, 'generations', job.id, {
      images: slotList(ck.images),
      quote: buildQuote(category, wall.wallW),
    });
  } else {
    base = await fetchObjectBase64(env, ck.images.base.path);
  }

  // ═══ 4. 변형 3장 병렬 — 끝나는 대로 올리고 행을 갱신한다 ═══
  await setStep(env, job, ck, 'variants');

  // 테마 참고가 있으면 첫 추천안은 그 색감이다. 한 번 뽑아 체크포인트에 둔다.
  if (themeRefs.length && ck.themeFinish === undefined) {
    ck.themeFinish = null;
    try {
      const t = await callGemini(env, {
        prompt: buildThemePalettePrompt(),
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
  for (const f of pickFinishes(VARIANT_COUNT - specs.length, seed)) {
    specs.push({ key: f.key, label: `AI 추천 · ${f.tone}`, prompt: buildVariantPrompt(f) });
  }

  const variantErrors = {};
  await Promise.all(
    specs.map(async (f, i) => {
      const slot = `v${i + 1}`;
      if (ck.images[slot]) return; // 재실행 시 이미 올라간 슬롯
      // 세 호출을 한꺼번에 쏘면 분당 한도에 걸릴 수 있어 살짝 어긋나게 보낸다.
      await sleep(i * VARIANT_STAGGER_MS);
      let lastErr = null;
      for (let attempt = 1; attempt <= VARIANT_ATTEMPTS; attempt++) {
        try {
          const r = await callGemini(env, {
            prompt: f.prompt,
            images: [base],
            imageSize,
          });
          if (!r.image) throw new Error('no image in response');
          const mime = r.imageMime || 'image/jpeg';
          const up = await uploadObject(env, `${prefix}/${slot}.${extOf(mime)}`, r.image, mime);
          ck.images[slot] = {
            label: f.label,
            finish_key: f.key,
            finish: f.finish,
            path: up.path,
            url: up.url,
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

  // ═══ 5. 마무리 ═══
  const variantCount = Object.keys(ck.images).length - 1;
  const failedSlots = Object.keys(variantErrors);
  await updateById(env, 'generations', job.id, {
    status: 'done',
    progress: 100,
    step_label:
      variantCount === VARIANT_COUNT ? '완료' : `완료 (추천안 ${variantCount}/${VARIANT_COUNT})`,
    // 빠진 추천안의 사유를 남긴다 — 없으면 왜 3/4 인지 알 길이 없다.
    error: failedSlots.length
      ? failedSlots.map((s) => `${s}: ${variantErrors[s]}`).join(' | ')
      : null,
    images: slotList(ck.images),
    quote: buildQuote(category, wall.wallW),
    model: env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image',
    elapsed_ms: Date.now() - startedAt,
    completed_at: new Date().toISOString(),
  });
  console.log(
    `[Job ${job.id}] done: variants ${variantCount}/${VARIANT_COUNT}, ${Date.now() - startedAt}ms`
  );
}

function labelOf(category) {
  return (CATEGORIES[category] && CATEGORIES[category].label) || category;
}
