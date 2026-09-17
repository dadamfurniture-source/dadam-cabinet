/**
 * 다담 DB 행 → dataset_samples 한 줄.
 *
 * 여기가 "어느 컬럼이 어느 라벨로 가는가" 의 정본이다. 라벨 체계가 바뀌면 고칠 곳이
 * 이 파일과 database/dataset-schema.sql 둘뿐이다.
 *
 * 규칙 셋:
 *   1) 확정적인 값만 라벨로 올린다. category 는 확정(structured), 공간은 대개 모른다 →
 *      unknown + needs_review 로 두고 모델·사람이 채운다. 지어내지 않는다.
 *   2) 생성물(generations.images)은 media='generated' 로 **격리**한다. 실사와 분포가 다르다.
 *   3) 고객이 올린 현장 사진(inputs.room)은 license='user-uploaded' — 동의 + 사람 검수를
 *      통과해야 내보내기 뷰에 들어온다 (개인정보).
 *
 * import 가 없다 — 테스트가 ESM 을 그대로 평가해 읽는다 (generate-layout.test.js 방식).
 */

export const TAXONOMY_VERSION = '1.1';

/** collection_posts.category → 축. 붙박이장·수납장은 공간이 정해지지 않는다 (침실·드레스룸 어디든). */
export const COLLECTION_CATEGORY = {
  kitchen: { space: 'kitchen', furniture: 'sink' },
  builtin: { space: 'unknown', furniture: 'builtin' },
  storage: { space: 'unknown', furniture: 'storage' },
  interior: { space: 'unknown', furniture: 'unknown' },
  other: { space: 'unknown', furniture: 'unknown' },
};

/** generations.category → 축. 연출컷은 품목이 확정이라 furniture 를 믿는다. */
export const GENERATION_CATEGORY = {
  sink: { space: 'kitchen', furniture: 'sink' },
  kitchen: { space: 'kitchen', furniture: 'sink' },
  island: { space: 'kitchen', furniture: 'sink', layout_shape: 'island' },
  fridge: { space: 'kitchen', furniture: 'fridge' },
  wardrobe: { space: 'unknown', furniture: 'builtin' },
  builtin: { space: 'unknown', furniture: 'builtin' },
  shoerack: { space: 'entrance', furniture: 'storage' },
  storage: { space: 'unknown', furniture: 'storage' },
};

export const LAYOUT_SHAPES = ['I', 'L', 'U', 'island', 'unknown'];

const str = (v) => (typeof v === 'string' ? v : '');
const shapeOf = (v) => (LAYOUT_SHAPES.includes(v) ? v : 'unknown');

/**
 * 시공사례 게시물 → 레코드 하나.
 *
 * group_key 는 **설계가 있으면 설계 단위**다. 같은 집의 사진 여러 장이 train/test 로
 * 갈리면 평가가 거짓말을 한다 — design_id 를 넣게 한 이유가 이것이다.
 *
 * @param {{id,user_id,image_url,storage_path,title,description,category,region,
 *          design_id,item_unique_id,consent_training,created_at,updated_at}} row
 */
export function fromCollectionPost(row) {
  const m = COLLECTION_CATEGORY[str(row.category)] || COLLECTION_CATEGORY.other;
  return {
    sample_id: `dadam:post:${row.id}`,
    source: 'dadam_collection',
    group_key: row.design_id ? `dadam:design:${row.design_id}` : `dadam:post:${row.id}`,
    image_url: row.image_url || null,
    image_sha256: null,
    width: null,
    height: null,
    media: 'photo',
    phase: 'after',
    space: m.space,
    furniture: m.furniture,
    layout_shape: 'unknown',
    attrs: {
      raw_label: str(row.category),
      title: str(row.title),
      desc: str(row.description),
      region: str(row.region),
      storage_path: str(row.storage_path),
      item_unique_id: row.item_unique_id ?? null,
    },
    label_source: 'structured',
    confidence: 0.9,
    // 공간을 모르면 검수 대상이다. category 만으로는 "주방" 말고는 공간이 안 나온다.
    needs_review: m.space === 'unknown',
    design_id: row.design_id || null,   // 완료 판정(orders)과 조인하는 축
    license: 'owned',
    consent: row.consent_training ?? null,
    src_table: 'collection_posts',
    src_id: row.id,
    src_updated_at: row.updated_at || row.created_at || null,
    taxonomy_version: TAXONOMY_VERSION,
  };
}

/**
 * 연출컷 한 건 → 레코드 여럿 (생성 이미지 n 장 + 고객이 올린 현장 사진 1장).
 *
 * @param {{id,parent_id,user_id,category,options,inputs,images,layout,quote,
 *          consent_training,created_at,updated_at}} row
 * @param {string} rootId 재생성 계보의 뿌리 id — 같은 방에서 나온 변형은 한 그룹이다
 * @param {string} [designId] 이 연출컷에서 시작된 설계 (designs.generation_id). 있으면 **설계가 그룹**이다 —
 *                            같은 현장의 연출컷·도면·완성 사진이 한 묶음이어야 사슬 학습이 된다
 */
export function fromGeneration(row, rootId, designId) {
  const cat = GENERATION_CATEGORY[str(row.category)] || { space: 'unknown', furniture: 'unknown' };
  const shape = shapeOf(
    (row.layout && row.layout.lowerLayoutShape) || (row.options && row.options.layoutShape) || cat.layout_shape
  );
  const group_key = designId
    ? `dadam:design:${designId}`
    : `dadam:gen:${rootId || row.parent_id || row.id}`;
  const common = {
    source: 'dadam_generation',
    group_key,
    design_id: designId || null,
    image_sha256: null,
    width: null,
    height: null,
    label_source: 'structured',
    src_table: 'generations',
    src_id: row.id,
    src_updated_at: row.updated_at || row.created_at || null,
    taxonomy_version: TAXONOMY_VERSION,
  };
  const out = [];

  for (const [i, im] of (Array.isArray(row.images) ? row.images : []).entries()) {
    if (!im || !im.url) continue;
    out.push({
      ...common,
      sample_id: `dadam:gen:${row.id}:${im.slot || i}`,
      image_url: im.url,
      media: 'generated',
      phase: 'after',
      space: cat.space,
      furniture: cat.furniture,
      layout_shape: shape,
      attrs: {
        raw_label: str(row.category),
        slot: str(im.slot),
        finish_key: str(im.finish_key),
        options: row.options || {},
        has_quote: !!row.quote,
      },
      confidence: 0.9,
      needs_review: false,   // 생성물은 라벨이 확정이다. 내보내기 뷰가 media 로 따로 가른다
      license: 'owned',
      consent: row.consent_training ?? null,
    });
  }

  const room = row.inputs && row.inputs.room;
  if (room && room.url) {
    out.push({
      ...common,
      sample_id: `dadam:gen:${row.id}:room`,
      image_url: room.url,
      media: 'photo',
      phase: 'before',            // 고객이 올린 현장 사진 = 시공 전
      space: cat.space,
      furniture: 'none',
      layout_shape: 'unknown',
      attrs: { raw_label: 'room', options: row.options || {}, storage_path: str(room.path) },
      confidence: 0.6,
      needs_review: true,         // 개인정보 검수 전엔 학습 금지
      license: 'user-uploaded',
      consent: row.consent_training ?? null,
    });
  }
  return out;
}

/**
 * 재생성 계보의 뿌리를 찾는다. parent_id 를 타고 올라가며 이미 아는 것은 map 에서 꺼낸다.
 * 순환(있을 리 없지만)과 폭주를 막으려 10 홉에서 끊는다 — 그 위는 그 지점을 뿌리로 본다.
 *
 * @param {string} id
 * @param {Map<string,string|null>} parentOf  id → parent_id
 */
export function rootOf(id, parentOf) {
  let cur = id;
  for (let i = 0; i < 10; i++) {
    const p = parentOf.get(cur);
    if (!p) return cur;
    cur = p;
  }
  return cur;
}
