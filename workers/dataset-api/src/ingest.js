/**
 * 수집 — 메인 페이지의 표를 읽어 dataset_samples 로 옮긴다. 10분마다.
 *
 * 원칙 넷:
 *   1) **워터마크**로 증분만 읽는다 (updated_at). 상태는 dataset_ingest_state 한 줄.
 *   2) **사람이 검수한 라벨은 건드리지 않는다.** 원본 행이 다시 저장돼도 덮어쓰지 않는다 —
 *      검수 결과가 크롤러 재실행으로 날아가면 아무도 검수하지 않는다.
 *   3) **동의가 없으면 데이터셋에 넣지 않는다.** 동의를 내렸다면 이미 넣은 것도 지운다.
 *   4) 실패해도 워터마크를 올리지 않는다 — 다음 실행이 같은 구간을 다시 읽는다.
 */
import { select, upsert, remove, patch } from './supabase.js';
import { fromCollectionPost, fromGeneration, rootOf } from './adapters.js';

const EPOCH = '1970-01-01T00:00:00Z';
const PAGE = 200;          // 한 번에 읽는 원본 행 수
const MAX_PAGES = 5;       // 한 실행에서 원본당 최대 쪽수 (10분마다 도니 밀려도 곧 따라잡는다)

async function stateOf(env, table) {
  const rows = await select(env, `dataset_ingest_state?src_table=eq.${table}&select=*`);
  return rows[0] || { src_table: table, watermark: EPOCH };
}

async function saveState(env, table, patch) {
  await upsert(env, 'dataset_ingest_state', [{ src_table: table, ...patch }], 'src_table');
}

/** 사람이 확정한 샘플 — 이번 실행 동안 건드리지 않을 목록 */
async function humanLocked(env, table) {
  const rows = await select(
    env,
    `dataset_samples?select=sample_id&label_source=eq.human&src_table=eq.${table}&limit=20000`
  );
  return new Set(rows.map((r) => r.sample_id));
}

const esc = (s) => encodeURIComponent(s);

/** 연출컷 → 그것에서 시작된 설계 (designs.generation_id). 사슬의 등뻐를 잊는 조회다. */
async function designsByGeneration(env, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {   // URL 이 길어지지 않게 나눠 묻는다
    const rows = await select(
      env,
      `designs?generation_id=in.(${ids.slice(i, i + 50).join(',')})&select=id,generation_id&order=created_at.asc`
    );
    // 한 연출컷으로 설계를 여러 번 만들 수 있다 — 먼저 만든 것을 본다
    for (const r of rows) if (!out.has(r.generation_id)) out.set(r.generation_id, r.id);
  }
  return out;
}

/** 연출컷 재생성 계보의 뿌리 — 배치 밖의 부모는 필요한 것만 더 읽는다 */
async function resolveRoots(env, rows) {
  const parentOf = new Map(rows.map((r) => [r.id, r.parent_id || null]));
  for (let depth = 0; depth < 5; depth++) {
    const need = [...new Set([...parentOf.values()].filter((p) => p && !parentOf.has(p)))];
    if (!need.length) break;
    let found = [];
    for (let i = 0; i < need.length; i += 50) {   // URL 이 길어지지 않게 나눠 묻는다
      found = found.concat(await select(env, `generations?id=in.(${need.slice(i, i + 50).join(',')})&select=id,parent_id`));
    }
    if (!found.length) break;
    for (const f of found) parentOf.set(f.id, f.parent_id || null);
  }
  const roots = new Map();
  for (const r of rows) roots.set(r.id, rootOf(r.id, parentOf));
  return roots;
}

/**
 * 표 하나를 따라잡는다.
 * @returns {{table:string, read:number, written:number, deleted:number, skipped:number, watermark:string}}
 */
async function ingestTable(env, table, columns, toSamples) {
  const st = await stateOf(env, table);
  const locked = await humanLocked(env, table);
  let watermark = st.watermark || EPOCH;
  const out = { table, read: 0, written: 0, deleted: 0, skipped: 0, watermark };

  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await select(
      env,
      `${table}?select=${columns}&updated_at=gt.${esc(watermark)}&order=updated_at.asc&limit=${PAGE}`
    );
    if (!rows.length) break;
    out.read += rows.length;

    // 동의한 것만 넣는다. 동의를 내린 행은 이미 들어간 샘플을 지운다.
    const keep = rows.filter((r) => r.consent_training === true);
    const drop = rows.filter((r) => r.consent_training !== true);

    const samples = await toSamples(env, keep);
    const writable = samples.filter((s) => !locked.has(s.sample_id));
    out.skipped += samples.length - writable.length;
    out.written += await upsert(env, 'dataset_samples', writable, 'sample_id');

    for (const r of drop) {
      await remove(env, `dataset_samples?src_table=eq.${table}&src_id=eq.${r.id}`);
      out.deleted++;
    }

    watermark = rows[rows.length - 1].updated_at;
    out.watermark = watermark;
    if (rows.length < PAGE) break;
  }

  await saveState(env, table, {
    watermark,
    last_run: new Date().toISOString(),
    last_count: out.written,
    last_error: null,
  });
  return out;
}


/**
 * 뒤늦게 생긴 연결을 메운다.
 *
 * 연출컷을 먼저 수집한 뒤에 사용자가 그걸로 설계를 만들면, generations 행은 그대로라
 * 워터마크가 다시 읽지 않는다 — 샘플은 영영 design_id 없이 남는다. 그래서 designs 를
 * 따로 보고, 새로 붙은 generation_id 를 그 연출컷의 샘플에 내려 준다.
 * (group_key 도 설계 기준으로 바꾼다 — 같은 현장이 한 묶음이어야 사슬 학습이 된다.)
 */
async function backfillDesignLinks(env) {
  const table = 'designs';
  const st = await stateOf(env, table);
  let watermark = st.watermark || EPOCH;
  const out = { table, read: 0, linked: 0, watermark };
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = await select(
        env,
        `designs?select=id,generation_id,updated_at&generation_id=not.is.null&updated_at=gt.${esc(watermark)}&order=updated_at.asc&limit=${PAGE}`
      );
      if (!rows.length) break;
      out.read += rows.length;
      for (const d of rows) {
        await patch(env, `dataset_samples?src_table=eq.generations&src_id=eq.${d.generation_id}`, {
          design_id: d.id,
          group_key: `dadam:design:${d.id}`,
        });
        out.linked++;
      }
      watermark = rows[rows.length - 1].updated_at;
      out.watermark = watermark;
      if (rows.length < PAGE) break;
    }
    await saveState(env, table, { watermark, last_run: new Date().toISOString(), last_count: out.linked, last_error: null });
  } catch (e) {
    await saveState(env, table, { last_run: new Date().toISOString(), last_error: String(e.message || e).slice(0, 500) });
    return { table, error: String(e.message || e).slice(0, 300) };
  }
  return out;
}

export async function ingestAll(env) {
  const results = [];
  const jobs = [
    [
      'collection_posts',
      'id,image_url,storage_path,title,description,category,region,design_id,item_unique_id,consent_training,created_at,updated_at',
      async (_env, rows) => rows.map(fromCollectionPost),
    ],
    [
      'generations',
      'id,parent_id,category,options,inputs,images,layout,quote,consent_training,created_at,updated_at',
      async (e, rows) => {
        if (!rows.length) return [];
        const roots = await resolveRoots(e, rows);
        const designs = await designsByGeneration(e, rows.map((r) => r.id));
        return rows.flatMap((r) => fromGeneration(r, roots.get(r.id), designs.get(r.id)));
      },
    ],
  ];

  for (const [table, columns, toSamples] of jobs) {
    try {
      results.push(await ingestTable(env, table, columns, toSamples));
    } catch (e) {
      // 워터마크는 그대로 둔다 — 다음 실행이 같은 구간을 다시 읽는다
      await saveState(env, table, { last_run: new Date().toISOString(), last_error: String(e.message || e).slice(0, 500) });
      results.push({ table, error: String(e.message || e).slice(0, 300) });
    }
  }
  // 원본을 다 읽은 뒤에 연결을 메운다 — 방금 들어온 샘플에도 곧바로 붙는다
  results.push(await backfillDesignLinks(env));
  return results;
}
