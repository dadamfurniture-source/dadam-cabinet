/**
 * 내보내기 — "학습에 넣어도 되는 것" 만 JSONL 로 내려 비공개 버킷에 둔다. 밤에 한 번.
 *
 * 무엇을 넣을지는 워커가 정하지 않는다. dataset_exportable 뷰가 정한다 —
 * 사람이 SQL 로 확인하는 정의와 자동 내보내기가 같은 문장을 보게 하려는 것이다.
 * (needs_review 아님 · rejected 아님 · generated 아님 · user-uploaded 는 동의+사람검수)
 */
import { select, putObject } from './supabase.js';

const PAGE = 1000;

/** 학습 쪽이 읽는 모양 — ohouse 로컬 데이터셋(dataset.jsonl)과 같은 키를 쓴다 */
function toRecord(r) {
  return {
    schema_version: r.taxonomy_version,
    sample_id: r.sample_id,
    source: r.source,
    group_key: r.group_key,
    image: { path: null, url: r.image_url, sha256: r.image_sha256, width: r.width, height: r.height },
    labels: { media: r.media, phase: r.phase, space: r.space, furniture: r.furniture, layout_shape: r.layout_shape },
    attrs: r.attrs || {},
    label_source: r.label_source,
    confidence: r.confidence,
    needs_review: r.needs_review,
    meta: {},
    provenance: { source_url: r.image_url, fetched_at: r.created_at, license: r.license, consent: r.consent },
    split: null,   // 분할은 학습 쪽에서 group_key 로 나눈다 (normalize.js 와 같은 규칙)
  };
}

export async function exportDataset(env, { prefix = 'exports' } = {}) {
  const bucket = env.EXPORT_BUCKET || 'datasets';
  const lines = [];
  const counts = {};
  for (let page = 0; page < 200; page++) {
    const rows = await select(
      env,
      `dataset_exportable?select=*&order=sample_id.asc&limit=${PAGE}&offset=${page * PAGE}`
    );
    if (!rows.length) break;
    for (const r of rows) {
      lines.push(JSON.stringify(toRecord(r)));
      counts[r.source] = (counts[r.source] || 0) + 1;
    }
    if (rows.length < PAGE) break;
  }

  const day = new Date().toISOString().slice(0, 10);
  const body = lines.join('\n') + (lines.length ? '\n' : '');
  const path = await putObject(env, bucket, `${prefix}/${day}.jsonl`, body, 'application/x-ndjson');
  // latest 는 늘 같은 이름 — 학습 스크립트가 날짜를 몰라도 되게
  await putObject(env, bucket, `${prefix}/latest.jsonl`, body, 'application/x-ndjson');

  return { records: lines.length, bytes: body.length, by_source: counts, path, day };
}
