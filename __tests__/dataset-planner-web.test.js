/**
 * @jest-environment node
 *
 * 간편 플래너 웹판 → 학습 데이터 창고 (workers/dataset-api/src/planner-web.js, DB 0067 planner_draft_learn).
 *
 * 고정하는 것:
 *   1) 출처 · 묶음 키 · 검토 필요 · 사용 범위 · 동의는 워커가 정한다 (group_key planner-web:<업체>:<설계>, 새 표본은 늘 검토 필요)
 *   2) 사람이 검토한 표본은 라벨을 건드리지 않는다. 설계 내용이 그 뒤에 바뀌면 다시 검토 필요 — 등급 · 본 rev 는 남는다
 *   3) 사진은 다담 공장 것과 사진 제공을 켠 협력업체 것만, 크기 · 지문은 저장소 줄에서. 제공을 끄면 그 업체 사진 표본을 지운다
 *   4) 버린 설계 · 점검용 시험 설계는 표본을 두지 않는다. 설계 이름 · 메모 · 사진 기록은 넣지 않는다
 *   5) 수집 끝 표시는 지문이 그대로일 때만. 한 묶음이 실패해도 나머지는 계속하고, 실패는 그 줄에 적는다
 *   6) 0067 적용 전에는 조용히 건너뛴다
 *
 * ESM 을 jest(CJS) 에서 읽기 위해 import · export 를 떼고 평가한다 (dataset-planner.test.js 방식).
 * 사람 · 업체 · 설계는 모두 지어낸 시험 값이다.
 */

const fs = require('fs');
const path = require('path');

const read = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
function loadEsm(rel, names, deps = {}) {
  const src = read(rel)
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(/^export /gm, '');
  const keys = Object.keys(deps);
  return new Function(...keys, src + `\nreturn { ${names.join(', ')} };`)(
    ...keys.map((k) => deps[k])
  );
}

const W = loadEsm('workers/dataset-api/src/planner-web.js', [
  'ingestPlannerWeb',
  'ingestOne',
  'sweepConsents',
  'plannerFunnel',
  'webDesignRow',
  'webPhotoRow',
  'webGroupKey',
  'cleanRecord',
  'stableJson',
  'WEB_SRC_TABLE',
  'WEB_BATCH',
  'WEB_MAX_TRIES',
  'MEDIA',
  'PHASE',
  'SPACE',
  'FURNITURE',
  'SHAPE',
]);
const P = loadEsm(
  'workers/dataset-api/src/planner.js',
  ['MEDIA', 'PHASE', 'SPACE', 'FURNITURE', 'SHAPE'],
  {
    atob: (s) => Buffer.from(s, 'base64').toString('latin1'),
    crypto: require('crypto').webcrypto,
  }
);

const ENV = { SUPABASE_URL: 'https://example.supabase.co' };
const HQ = 'f0000000-0000-4000-8000-0000000000aa';
const CO = 'f0000000-0000-4000-8000-0000000000b1';
const APP_DESIGN = 'd0000000-0000-4000-8000-000000000001';
const ID = 'design-web-0001';
const GK = `planner-web:${CO}:${ID}`;
const SHA = 'a'.repeat(64);

const record = (over = {}) => ({
  record_id: 'x',
  item: 'sink',
  space: 'kitchen',
  furniture: 'sink',
  layout_shape: 'L',
  name: '김○○ 주방',
  design: {
    id: ID,
    name: '김○○ 주방',
    updatedAt: '2026-11-14T01:00:00.000Z',
    walls: [{ name: '공간 A' }],
    photos: [{ note: '현관 비번 1234' }],
    segan: [{}],
  },
  ...over,
});
const learnRow = (over = {}) => ({
  company_id: CO,
  draft_id: ID,
  rev: 3,
  bundle: { record: record(), samples: [] },
  bundle_sha256: SHA,
  ingest_tries: 0,
  ...over,
});

/** 가짜 Supabase — 표마다 줄 배열, 부른 것을 적는다 */
function fake(db = {}) {
  const t = {
    companies: [
      { id: HQ, kind: 'hq' },
      { id: CO, kind: 'partner' },
    ],
    planner_drafts: [{ company_id: CO, id: ID, rev: 3, app_state: null, discarded_at: null }],
    planner_draft_photos: [],
    company_consents: [],
    dataset_samples: [],
    planner_draft_learn: [],
    dataset_ingest_state: [],
    ...db,
  };
  const calls = { upserts: [], patches: [], removes: [], selects: [] };
  const eq = (qs, key) => {
    const m = new RegExp(`(?:^|[?&])${key}=eq\\.([^&]+)`).exec(qs);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const h = {
    select: async (env, q) => {
      calls.selects.push(q);
      const table = q.split('?')[0];
      if (t[table] === null)
        throw new Error(
          `select ${table} 404: {"code":"PGRST205","message":"Could not find the table"}`
        );
      let rows = t[table].slice();
      if (table === 'dataset_samples')
        rows = rows.filter((r) => r.group_key === eq(q, 'group_key'));
      if (table === 'planner_drafts')
        rows = rows.filter((r) => r.company_id === eq(q, 'company_id') && r.id === eq(q, 'id'));
      if (table === 'companies') rows = rows.filter((r) => r.id === eq(q, 'id'));
      if (table === 'planner_draft_photos')
        rows = rows.filter(
          (r) =>
            r.company_id === eq(q, 'company_id') &&
            r.draft_id === eq(q, 'draft_id') &&
            !r.deleted_at
        );
      if (table === 'company_consents') {
        const co = eq(q, 'company_id');
        const gt = /created_at=gt\.([^&]+)/.exec(q);
        rows = rows.filter(
          (r) => (!co || r.company_id === co) && (!gt || r.created_at > decodeURIComponent(gt[1]))
        );
        rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
        if (/order=created_at\.desc/.test(q)) rows.reverse();
        if (/limit=1(&|$)/.test(q)) rows = rows.slice(0, 1);
      }
      if (table === 'dataset_ingest_state')
        rows = rows.filter((r) => r.src_table === eq(q, 'src_table'));
      if (table === 'planner_draft_learn')
        rows = rows.filter((r) => r.pending !== false && (r.ingest_tries || 0) < W.WEB_MAX_TRIES);
      return rows.map((r) => ({ ...r }));
    },
    upsert: async (env, table, rows, on) => {
      calls.upserts.push({ table, rows, on });
      if (table === 'dataset_samples') {
        for (const r of rows) {
          const i = t.dataset_samples.findIndex((x) => x.sample_id === r.sample_id);
          if (i >= 0) t.dataset_samples[i] = { ...t.dataset_samples[i], ...r };
          else t.dataset_samples.push({ ...r });
        }
      }
      return rows.length;
    },
    patch: async (env, q, values) => {
      calls.patches.push({ q, values });
      if (h.failPatch && h.failPatch(q)) throw new Error('patch 500');
    },
    remove: async (env, q) => {
      calls.removes.push(q);
      const m = /sample_id=in\.\(([^)]*)\)/.exec(q);
      if (m) {
        const ids = m[1].split(',').map((x) => decodeURIComponent(x).replace(/^"|"$/g, ''));
        t.dataset_samples = t.dataset_samples.filter((r) => !ids.includes(r.sample_id));
      }
    },
    count: async (env, q) => {
      calls.selects.push(`count:${q}`);
      const table = q.split('?')[0];
      if (t[table] === null) throw new Error(`count ${table} 404 PGRST205`);
      return (h.counts && h.counts(q)) || 0;
    },
  };
  return { h, t, calls };
}

describe('표본 줄 — 워커가 정하는 것', () => {
  test('라벨 범위는 PC 올리기(planner.js)와 같은 목록이다', () => {
    for (const k of ['MEDIA', 'PHASE', 'SPACE', 'FURNITURE', 'SHAPE']) expect(W[k]).toEqual(P[k]);
  });

  test('묶음 키에 업체 id 가 들어간다 — 업체끼리 설계 id 가 겹쳐도 따로, PC 올리기 키와도 안 겹친다', () => {
    expect(W.webGroupKey(CO, ID)).toBe(GK);
    expect(W.webGroupKey(HQ, ID)).not.toBe(GK);
    expect(GK.startsWith('planner-lite:design:')).toBe(false);
  });

  test('설계 줄 — 새 것은 검토 필요 · structured · restricted-internal, 이름 · 사진 기록 · 연출 원본은 빠진다', () => {
    const r = W.webDesignRow({
      companyId: CO,
      draftId: ID,
      rev: 3,
      record: record(),
      designId: APP_DESIGN,
      companyKind: 'partner',
      old: null,
    });
    expect(r).toMatchObject({
      sample_id: GK,
      source: 'dadam_planner',
      group_key: GK,
      image_url: null,
      media: 'floorplan',
      space: 'kitchen',
      furniture: 'sink',
      layout_shape: 'L',
      label_source: 'structured',
      needs_review: true,
      license: 'restricted-internal',
      consent: null,
      src_table: 'planner_drafts',
      design_id: APP_DESIGN,
      src_updated_at: '2026-11-14T01:00:00.000Z',
    });
    expect(r.attrs.web).toEqual({ rev: 3, company_kind: 'partner' });
    const text = JSON.stringify(r);
    expect(text).not.toContain('김○○');
    expect(text).not.toContain('현관 비번');
    expect(r.attrs.record.design.walls).toEqual([{ name: '공간 A' }]);
    expect(r.attrs.record.design.photos).toBeUndefined();
    expect(r.attrs.record.design.segan).toBeUndefined();
  });

  test('설계 줄 — 범위 밖 라벨은 기본값, 앱 설계 id 가 uuid 가 아니면 비운다, 너무 큰 레코드는 거절', () => {
    const r = W.webDesignRow({
      companyId: CO,
      draftId: ID,
      rev: 1,
      record: record({ space: 'garage', furniture: 'x', layout_shape: 'Z' }),
      designId: 'abc',
      companyKind: 'hq',
      old: null,
    });
    expect([r.space, r.furniture, r.layout_shape, r.design_id]).toEqual([
      'kitchen',
      'sink',
      'unknown',
      null,
    ]);
    expect(r.attrs.web.company_kind).toBe('hq');
    expect(() =>
      W.webDesignRow({
        companyId: CO,
        draftId: ID,
        rev: 1,
        record: record({ big: 'x'.repeat(600 * 1024) }),
        companyKind: 'hq',
        old: null,
      })
    ).toThrow('너무 큽니다');
    expect(() =>
      W.webDesignRow({
        companyId: CO,
        draftId: ID,
        rev: 1,
        record: null,
        companyKind: 'hq',
        old: null,
      })
    ).toThrow('레코드가 없습니다');
  });

  test('사람이 검토한 설계 — 내용이 그대로면 검토 결과 그대로, 바뀌면 다시 검토 필요 (등급 · 본 rev 는 남는다)', () => {
    const first = W.webDesignRow({
      companyId: CO,
      draftId: ID,
      rev: 3,
      record: record(),
      companyKind: 'partner',
      old: null,
    });
    const reviewed = {
      ...first,
      label_source: 'human',
      needs_review: false,
      space: 'dining',
      attrs: {
        ...first.attrs,
        grade: 'good',
        grade_reasons: [],
        reviewed_rev: 3,
        original: { space: 'kitchen' },
      },
    };
    const same = W.webDesignRow({
      companyId: CO,
      draftId: ID,
      rev: 3,
      record: record(),
      companyKind: 'partner',
      old: reviewed,
    });
    expect([same.label_source, same.needs_review, same.space, same.confidence]).toEqual([
      'human',
      false,
      'dining',
      1,
    ]);
    expect(same.attrs.grade).toBe('good');
    const changed = W.webDesignRow({
      companyId: CO,
      draftId: ID,
      rev: 4,
      record: record({ layout_shape: 'U' }),
      companyKind: 'partner',
      old: reviewed,
    });
    expect([changed.label_source, changed.needs_review, changed.space]).toEqual([
      'human',
      true,
      'dining',
    ]);
    expect([changed.attrs.grade, changed.attrs.reviewed_rev, changed.attrs.web.rev]).toEqual([
      'good',
      3,
      4,
    ]);
    expect(changed.attrs.original).toEqual({ space: 'kitchen' });
  });

  test('사진 줄 — 자리 · 크기 · 지문은 저장소 줄에서, 협력업체는 동의 true · 다담 공장은 동의 칸 없음, 메모는 빠진다', () => {
    const file = { file: 'photo-abc123.jpg', sha256: 'b'.repeat(64), width: 1200, height: 900 };
    const sample = {
      file: 'photo-abc123.jpg',
      media: 'photo',
      phase: 'after',
      space: 'kitchen',
      furniture: 'sink',
      layout_shape: 'I',
      width: 9,
      height: 9,
      license: 'cc0',
      consent: false,
      needs_review: false,
      attrs: { kind: 'complete', note: '고객 메모', judgeNote: 'x', name: 'y', wall: '공간 A' },
    };
    const r = W.webPhotoRow(ENV, {
      companyId: CO,
      draftId: ID,
      sample,
      file,
      companyKind: 'partner',
      designId: null,
      old: null,
    });
    expect(r).toMatchObject({
      sample_id: `${GK}:photo:photo-abc123`,
      group_key: GK,
      image_url: `https://example.supabase.co/storage/v1/object/authenticated/planner-photos/${CO}/${ID}/photo-abc123.jpg`,
      image_sha256: 'b'.repeat(64),
      width: 1200,
      height: 900,
      media: 'photo',
      phase: 'after',
      label_source: 'structured',
      needs_review: true,
      license: 'restricted-internal',
      consent: true,
      src_table: 'planner_drafts',
    });
    expect(r.attrs).toEqual({ kind: 'complete', wall: '공간 A' });
    expect(
      W.webPhotoRow(ENV, { companyId: HQ, draftId: ID, sample, file, companyKind: 'hq', old: null })
        .consent
    ).toBeNull();
    // 사람이 검토한 사진 — 라벨 그대로
    const old = {
      label_source: 'human',
      needs_review: false,
      media: 'photo',
      phase: 'before',
      space: 'living',
      furniture: 'storage',
      layout_shape: 'U',
      attrs: { grade: 'normal', grade_reasons: ['photo_blur'] },
    };
    const kept = W.webPhotoRow(ENV, {
      companyId: CO,
      draftId: ID,
      sample,
      file,
      companyKind: 'partner',
      old,
    });
    expect([
      kept.phase,
      kept.space,
      kept.furniture,
      kept.layout_shape,
      kept.needs_review,
      kept.label_source,
    ]).toEqual(['before', 'living', 'storage', 'U', false, 'human']);
    expect(kept.attrs.grade_reasons).toEqual(['photo_blur']);
  });
});

describe('묶음 하나 수집', () => {
  const photos = [
    {
      company_id: CO,
      draft_id: ID,
      file: 'photo-a1b2c3.jpg',
      sha256: 'c'.repeat(64),
      width: 800,
      height: 600,
      deleted_at: null,
    },
    {
      company_id: CO,
      draft_id: ID,
      file: 'photo-gone01.jpg',
      sha256: 'd'.repeat(64),
      width: 800,
      height: 600,
      deleted_at: '2026-11-14T00:00:00Z',
    },
  ];
  const samples = [
    { file: 'photo-a1b2c3.jpg', media: 'photo', phase: 'before', attrs: { kind: 'site' } },
    { file: 'photo-a1b2c3.jpg', media: 'photo' },
    { file: 'photo-gone01.jpg', media: 'photo' },
    { file: '../../etc/passwd' },
    'x',
  ];

  test('사진 제공을 안 켠 협력업체 — 설계 줄만, 사진은 넣지 않는다 (저장소도 읽지 않는다)', async () => {
    const { h, t, calls } = fake({ planner_draft_photos: photos });
    const out = await W.ingestOne(ENV, h, learnRow({ bundle: { record: record(), samples } }));
    expect(out).toEqual({ written: 1, deleted: 0, skipped: 5 });
    expect(t.dataset_samples.map((r) => r.sample_id)).toEqual([GK]);
    expect(calls.selects.some((q) => q.startsWith('planner_draft_photos'))).toBe(false);
    expect(calls.patches).toEqual([
      {
        q: `planner_draft_learn?company_id=eq.${CO}&draft_id=eq.${ID}&bundle_sha256=eq.${SHA}`,
        values: expect.objectContaining({
          ingested_sha256: SHA,
          ingested_rev: 3,
          ingest_error: null,
        }),
      },
    ]);
  });

  test('사진 제공을 켠 협력업체 — 저장소에 있는 사진만, 같은 파일은 한 번', async () => {
    const { h, t } = fake({
      planner_draft_photos: photos,
      company_consents: [
        {
          company_id: CO,
          kind: 'planner_photo_learning',
          granted: false,
          created_at: '2026-11-13T00:00:00Z',
        },
        {
          company_id: CO,
          kind: 'planner_photo_learning',
          granted: true,
          created_at: '2026-11-14T00:00:00Z',
        },
      ],
    });
    const out = await W.ingestOne(ENV, h, learnRow({ bundle: { record: record(), samples } }));
    expect(out).toEqual({ written: 2, deleted: 0, skipped: 4 });
    expect(t.dataset_samples.map((r) => r.sample_id)).toEqual([GK, `${GK}:photo:photo-a1b2c3`]);
    expect(t.dataset_samples[1]).toMatchObject({
      image_sha256: 'c'.repeat(64),
      phase: 'before',
      consent: true,
      needs_review: true,
    });
  });

  test('다담 공장 — 동의 없이 사진이 들어가고 동의 칸은 비운다, 앱 설계로 이어졌으면 design_id', async () => {
    const { h, t } = fake({
      planner_drafts: [
        {
          company_id: HQ,
          id: ID,
          rev: 2,
          app_state: { designId: APP_DESIGN, snapshotId: 's' },
          discarded_at: null,
        },
      ],
      planner_draft_photos: [
        {
          company_id: HQ,
          draft_id: ID,
          file: 'photo-a1b2c3.jpg',
          sha256: 'c'.repeat(64),
          width: 1,
          height: 1,
        },
      ],
    });
    await W.ingestOne(
      ENV,
      h,
      learnRow({
        company_id: HQ,
        rev: 2,
        bundle: { record: record(), samples: [{ file: 'photo-a1b2c3.jpg' }] },
      })
    );
    expect(t.dataset_samples.map((r) => [r.consent, r.design_id])).toEqual([
      [null, APP_DESIGN],
      [null, APP_DESIGN],
    ]);
  });

  test('묶음에서 빠진 사진 · 꺼진 사진 제공 — 남아 있던 표본을 지운다', async () => {
    const stale = {
      sample_id: `${GK}:photo:photo-old001`,
      group_key: GK,
      label_source: 'human',
      attrs: {},
    };
    const { h, t } = fake({
      dataset_samples: [
        { sample_id: GK, group_key: GK, label_source: 'structured', attrs: {} },
        stale,
      ],
    });
    const out = await W.ingestOne(ENV, h, learnRow());
    expect(out.deleted).toBe(1);
    expect(t.dataset_samples.map((r) => r.sample_id)).toEqual([GK]);
  });

  test('버린 설계 · 없는 설계 · 점검용 시험 설계 — 표본을 두지 않고 수집 끝으로 적는다', async () => {
    for (const [drafts, row] of [
      [
        [{ company_id: CO, id: ID, rev: 3, app_state: null, discarded_at: '2026-11-14T00:00:00Z' }],
        learnRow(),
      ],
      [[], learnRow()],
      [
        [{ company_id: HQ, id: 'probe-selfcheck', rev: 1, app_state: null, discarded_at: null }],
        learnRow({ company_id: HQ, draft_id: 'probe-selfcheck' }),
      ],
    ]) {
      const gk = W.webGroupKey(row.company_id, row.draft_id);
      const { h, t, calls } = fake({
        planner_drafts: drafts,
        dataset_samples: [{ sample_id: gk, group_key: gk, label_source: 'human', attrs: {} }],
      });
      const out = await W.ingestOne(ENV, h, row);
      expect(out).toEqual({ written: 0, deleted: 1, skipped: 0 });
      expect(t.dataset_samples).toEqual([]);
      expect(calls.upserts).toEqual([]);
      expect(calls.patches).toHaveLength(1);
    }
  });

  test('열쇠가 이상하면 아무것도 읽지 않고 던진다', async () => {
    const { h, calls } = fake();
    await expect(W.ingestOne(ENV, h, learnRow({ company_id: 'x' }))).rejects.toThrow('열쇠');
    await expect(W.ingestOne(ENV, h, learnRow({ draft_id: '../x' }))).rejects.toThrow('열쇠');
    expect(calls.selects).toEqual([]);
  });
});

describe('사진 제공을 켜고 끈 업체 따라가기', () => {
  test('끔 → 그 업체 사진 표본만 지운다 · 켬 → 그 업체 묶음을 다시 수집 대상으로 · 업체마다 마지막 줄', async () => {
    const { h, calls } = fake({
      dataset_ingest_state: [{ src_table: 'company_consents', watermark: '2026-11-13T00:00:00Z' }],
      company_consents: [
        {
          company_id: CO,
          kind: 'planner_photo_learning',
          granted: true,
          created_at: '2026-11-12T00:00:00Z',
        },
        {
          company_id: CO,
          kind: 'planner_photo_learning',
          granted: true,
          created_at: '2026-11-13T10:00:00Z',
        },
        {
          company_id: CO,
          kind: 'planner_photo_learning',
          granted: false,
          created_at: '2026-11-13T11:00:00Z',
        },
        {
          company_id: HQ,
          kind: 'planner_photo_learning',
          granted: true,
          created_at: '2026-11-13T12:00:00Z',
        },
      ],
    });
    const out = await W.sweepConsents(ENV, h);
    expect(out).toEqual({ changed: 2, revoked: 1, granted: 1 });
    expect(calls.removes).toEqual([
      `dataset_samples?src_table=eq.planner_drafts&group_key=like.${encodeURIComponent(`planner-web:${CO}:*`)}&image_url=not.is.null`,
    ]);
    expect(calls.patches).toEqual([
      {
        q: `planner_draft_learn?company_id=eq.${HQ}`,
        values: { ingested_sha256: null, ingested_rev: null, ingested_at: null },
      },
    ]);
    expect(calls.upserts[0]).toMatchObject({ table: 'dataset_ingest_state', on: 'src_table' });
    expect(calls.upserts[0].rows[0]).toMatchObject({
      src_table: 'company_consents',
      watermark: '2026-11-13T12:00:00Z',
      last_count: 2,
    });
  });

  test('새 줄이 없으면 아무것도 하지 않는다', async () => {
    const { h, calls } = fake();
    expect(await W.sweepConsents(ENV, h)).toEqual({ changed: 0, revoked: 0, granted: 0 });
    expect([calls.removes, calls.patches, calls.upserts]).toEqual([[], [], []]);
  });
});

describe('수집 한 번', () => {
  test('아직 수집 안 한 묶음만 · 한 번에 정한 수까지 · 해 본 수가 찬 것은 빼고 읽는다', async () => {
    const { h, calls } = fake();
    await W.ingestPlannerWeb(ENV, h);
    const q = calls.selects.find((s) => s.startsWith('planner_draft_learn'));
    expect(q).toContain('pending=is.true');
    expect(q).toContain(`ingest_tries=lt.${W.WEB_MAX_TRIES}`);
    expect(q).toContain(`limit=${W.WEB_BATCH}`);
    expect(q).toContain('order=updated_at.asc');
  });

  test('한 묶음이 실패해도 나머지는 계속한다 — 실패는 그 줄에 적고 해 본 수를 올린다', async () => {
    const bad = learnRow({
      draft_id: 'design-web-bad1',
      bundle: { record: null, samples: [] },
      ingest_tries: 2,
    });
    const { h, t, calls } = fake({
      planner_drafts: [
        { company_id: CO, id: ID, rev: 3, app_state: null, discarded_at: null },
        { company_id: CO, id: 'design-web-bad1', rev: 1, app_state: null, discarded_at: null },
      ],
      planner_draft_learn: [bad, learnRow()],
    });
    const out = await W.ingestPlannerWeb(ENV, h);
    expect(out).toMatchObject({ table: 'planner_drafts', read: 2, written: 1, failed: 1 });
    expect(t.dataset_samples.map((r) => r.sample_id)).toEqual([GK]);
    expect(calls.patches[0]).toEqual({
      q: `planner_draft_learn?company_id=eq.${CO}&draft_id=eq.design-web-bad1`,
      values: { ingest_error: '설계 레코드가 없습니다', ingest_tries: 3 },
    });
    const state = calls.upserts.find(
      (u) => u.table === 'dataset_ingest_state' && u.rows[0].src_table === 'planner_drafts'
    );
    expect(state.rows[0]).toMatchObject({ last_count: 1, last_error: '설계 레코드가 없습니다' });
    expect(state.rows[0].watermark).toBeUndefined();
  });

  test('0067 적용 전 — 조용히 건너뛴다 (오류로 세지 않는다)', async () => {
    for (const db of [{ company_consents: null }, { planner_draft_learn: null }]) {
      const { h, calls } = fake(db);
      expect(await W.ingestPlannerWeb(ENV, h)).toEqual({
        table: 'planner_drafts',
        pending_db: true,
      });
      expect(calls.upserts).toEqual([]);
    }
  });
});

describe('가는 길의 수 (GET /planner/funnel)', () => {
  test('설계 → 묶음 → 표본 → 검토 → 내보내기, 시험 설계는 세지 않는다', async () => {
    const { h, calls } = fake({
      dataset_ingest_state: [
        {
          src_table: 'planner_drafts',
          last_run: '2026-11-14T02:00:00Z',
          last_count: 4,
          last_error: null,
        },
      ],
    });
    const n = {
      'planner_drafts?': 12,
      'planner_draft_learn?draft_id': 9,
      'planner_draft_learn?pending': 2,
      'planner_draft_learn?ingest_error': 1,
      needs_review: 5,
      'grade=eq.good': 3,
      'grade=eq.normal': 1,
      'grade=eq.exclude': 1,
      'image_url=not.is.null': 20,
      dataset_exportable: 2,
    };
    h.counts = (q) => {
      const k = Object.keys(n).find((key) => q.includes(key));
      return k ? n[k] : 7;
    };
    expect(await W.plannerFunnel(ENV, h)).toEqual({
      drafts: 12,
      bundles: 9,
      pending: 2,
      failed: 1,
      samples: 7,
      waiting_review: 5,
      grades: { good: 3, normal: 1, exclude: 1 },
      photos: 20,
      exportable: 2,
      last_run: '2026-11-14T02:00:00Z',
      last_count: 4,
      last_error: null,
    });
    const probe = encodeURIComponent('probe-*');
    expect(calls.selects).toContain(
      `count:planner_drafts?discarded_at=is.null&id=not.like.${probe}`
    );
    expect(calls.selects).toContain(
      `count:planner_draft_learn?pending=is.true&draft_id=not.like.${probe}`
    );
  });

  test('0067 적용 전 — { pending_db: true }', async () => {
    const { h } = fake({ planner_draft_learn: null });
    expect(await W.plannerFunnel(ENV, h)).toEqual({ pending_db: true });
  });
});

describe('워커에 이어져 있다', () => {
  const worker = read('workers/dataset-api/src/worker.js');
  test('크론 · POST /ingest 가 웹판 묶음도 같이 돌리고, 한쪽이 실패해도 다른 쪽 결과는 남는다', () => {
    expect(worker).toContain(
      'results.push(await ingestPlannerWeb(env, { select, upsert, patch, remove }));'
    );
    expect(worker).toContain("results.push({ table: 'planner_drafts', error:");
    expect(worker.match(/await ingestEverything\(env\)/g)).toHaveLength(2);
    expect(worker).not.toMatch(/= await ingestAll\(env\);\s+return jsonResponse/);
  });
  test('GET /planner/funnel 은 관리자 토큰 뒤에 있다', () => {
    const auth = worker.search(/const auth = await verifyAdmin/);
    const route = worker.search(/url\.pathname === '\/planner\/funnel'/);
    expect(auth).toBeGreaterThan(0);
    expect(route).toBeGreaterThan(auth);
  });
  test('행 수 세기 — 본문 없이 (HEAD · count=exact), 표가 없으면 메시지로 알 수 있다', () => {
    const sb = read('workers/dataset-api/src/supabase.js');
    expect(sb).toContain("method: 'HEAD', headers: headers(env, { Prefer: 'count=exact' })");
    expect(sb).toContain("res.status === 404 ? ' PGRST205' : ''");
  });
});
