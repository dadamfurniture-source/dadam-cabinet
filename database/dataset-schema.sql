-- =============================================
-- 학습 데이터셋 — dataset_samples · dataset_reviews  (라벨 체계 v1)
--
-- 메인 페이지의 네 가지 행동(시공사례 업로드 · 연출컷 생성 · 플래너 저장 ·
-- 상세설계 저장)이 쓰는 표를 Worker(workers/dataset-api, 예정)가 10분마다
-- 읽어 **한 모양의 레코드**로 옮겨 담는 곳이다. 클라이언트는 이 표에 직접
-- 쓰지 않는다 — 정규화는 Worker 만 한다. 라벨 체계가 바뀌면 고칠 곳이 하나다.
--
-- 라벨 축 다섯(media · phase · space · furniture · layout_shape)은 taxonomy v1 과
-- 같은 값이다. 값 목록을 CHECK 로 박아 DB 가 축 밖의 값을 막는다.
-- 체계를 바꿀 때는 값을 **더하기만** 하고(이름을 바꾸지 않는다) taxonomy_version 을 올린다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 실행.
--       기존 데이터에는 영향이 없다 — 새 표 둘, 기존 표에 NULL 허용 컬럼 셋.
-- =============================================


-- =============================================
-- 1. 기존 표에 붙는 컬럼 셋
-- =============================================

-- ① 시공사례 사진 ↔ 설계(플래너 도면 · BOM · 견적)를 잇는다.
--    이 연결이 없어서 오늘은 "사진을 보고 배치·자재·가격을 말하는" 정답 데이터를
--    만들 수 없었다. 과거 글은 NULL 로 두고, 업로드 화면에서 설계를 고르게 한다.
ALTER TABLE collection_posts ADD COLUMN IF NOT EXISTS design_id UUID REFERENCES designs(id) ON DELETE SET NULL;
ALTER TABLE collection_posts ADD COLUMN IF NOT EXISTS item_unique_id BIGINT;   -- design_items.unique_id (planner_snapshots 와 같은 키)
CREATE INDEX IF NOT EXISTS idx_collection_posts_design ON collection_posts (design_id) WHERE design_id IS NOT NULL;

-- ② 학습 사용 동의. 업로드·생성 시점에 체크박스로 받는다. 기본 해제(NULL = 미확인).
--    NULL 과 FALSE 는 둘 다 "내보내지 않는다" 다 — 구분은 통계용이다.
ALTER TABLE collection_posts ADD COLUMN IF NOT EXISTS consent_training BOOLEAN;
ALTER TABLE generations      ADD COLUMN IF NOT EXISTS consent_training BOOLEAN;


-- =============================================
-- 2. dataset_samples — 레코드 한 줄 = 사진(또는 구조 라벨) 하나
-- =============================================
CREATE TABLE IF NOT EXISTS dataset_samples (
    -- 'dadam:post:{uuid}' · 'dadam:gen:{uuid}:v1' · 'dadam:design:{uuid}' · 'ohouse:1871:031'
    sample_id       TEXT PRIMARY KEY,

    -- 어디서 왔나. 출처를 통째로 거를 때 쓴다.
    source          TEXT NOT NULL CHECK (source IN
                      ('dadam_collection', 'dadam_generation', 'dadam_planner', 'dadam_design', 'ohouse')),

    -- train/val/test 분할 단위. 같은 집(설계)의 사진이 양쪽에 갈리면 평가가 거짓말을 한다.
    --   dadam:post:{id} · dadam:design:{design_id} · dadam:gen:{root_generation_id} · ohouse:{item_id}
    group_key       TEXT NOT NULL,

    -- 이미지. 구조만 있는 레코드(플래너 · 상세설계)는 NULL — 같은 group_key 의 사진이 상속한다.
    image_url       TEXT,
    image_sha256    TEXT,
    width           INT,
    height          INT,

    -- 라벨 축 다섯 (taxonomy v1)
    media           TEXT NOT NULL DEFAULT 'photo'
                      CHECK (media IN ('photo', 'render3d', 'floorplan', 'generated')),
    phase           TEXT NOT NULL DEFAULT 'after'
                      CHECK (phase IN ('before', 'after', 'in_progress', 'unknown')),
    space           TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (space IN ('kitchen', 'living', 'bedroom', 'bathroom', 'entrance', 'balcony',
                                       'dressing', 'utility', 'corridor', 'study', 'unknown')),
    furniture       TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (furniture IN ('sink', 'builtin', 'fridge', 'storage', 'none', 'unknown')),
    layout_shape    TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (layout_shape IN ('I', 'L', 'U', 'island', 'unknown')),

    -- 열린 집합. 원 캡션 · 힌트 · 키워드 · 원래 라벨(검수로 바뀌기 전). 라벨을 바꾸지 않고 옆에 둔다.
    attrs           JSONB NOT NULL DEFAULT '{}',

    -- 라벨이 어디서 왔나. 평가셋은 human 만 쓴다.
    label_source    TEXT NOT NULL CHECK (label_source IN ('caption', 'structured', 'model', 'human')),
    confidence      REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    needs_review    BOOLEAN NOT NULL DEFAULT FALSE,

    -- 사용 조건. user-uploaded 는 consent = TRUE 이고 human 검수를 통과해야 내보낸다.
    license         TEXT NOT NULL CHECK (license IN ('owned', 'user-uploaded', 'restricted-internal', 'cc0')),
    consent         BOOLEAN,

    -- 역추적 — 어느 표의 어느 행에서, 그 행의 언제 값으로 만들었나 (Worker 의 watermark 와 같은 시각)
    src_table       TEXT,
    src_id          UUID,
    src_updated_at  TIMESTAMPTZ,

    taxonomy_version TEXT NOT NULL DEFAULT '1.0',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 검수 큐: needs_review 인 것만 (부분 인덱스)
CREATE INDEX IF NOT EXISTS idx_dataset_samples_review  ON dataset_samples (created_at) WHERE needs_review;
-- 분할 · 상속 조회
CREATE INDEX IF NOT EXISTS idx_dataset_samples_group   ON dataset_samples (group_key);
-- 역추적 · 재수집
CREATE INDEX IF NOT EXISTS idx_dataset_samples_src     ON dataset_samples (src_table, src_updated_at);
-- 내보내기 필터
CREATE INDEX IF NOT EXISTS idx_dataset_samples_export  ON dataset_samples (media, license, needs_review);


-- =============================================
-- 3. dataset_reviews — 검수는 덮어쓰지 않고 옆에 쌓는다
--    이력이 곧 규칙 오류의 근거라 지우지 않는다. 최신 판정이 dataset_samples 에 반영된다(트리거).
-- =============================================
CREATE TABLE IF NOT EXISTS dataset_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_id       TEXT NOT NULL REFERENCES dataset_samples(sample_id) ON DELETE CASCADE,
    reviewer        UUID NOT NULL REFERENCES auth.users(id),

    -- confirm: 그대로 맞다 · correct: 아래 값으로 고친다 · reject: 학습에서 뺀다 (개인정보 · 무관 사진)
    verdict         TEXT NOT NULL CHECK (verdict IN ('confirm', 'correct', 'reject')),

    -- correct 일 때 바꾸는 값만 NOT NULL. 축 값 제약은 dataset_samples 와 같다.
    media           TEXT CHECK (media IS NULL OR media IN ('photo', 'render3d', 'floorplan', 'generated')),
    phase           TEXT CHECK (phase IS NULL OR phase IN ('before', 'after', 'in_progress', 'unknown')),
    space           TEXT CHECK (space IS NULL OR space IN ('kitchen', 'living', 'bedroom', 'bathroom', 'entrance', 'balcony',
                                                          'dressing', 'utility', 'corridor', 'study', 'unknown')),
    furniture       TEXT CHECK (furniture IS NULL OR furniture IN ('sink', 'builtin', 'fridge', 'storage', 'none', 'unknown')),
    layout_shape    TEXT CHECK (layout_shape IS NULL OR layout_shape IN ('I', 'L', 'U', 'island', 'unknown')),

    -- 개인정보가 보였는가 (user-uploaded 검수의 핵심 항목). reject 사유로도 남는다.
    pii_found       BOOLEAN,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dataset_reviews_sample ON dataset_reviews (sample_id, created_at DESC);


-- =============================================
-- 4. 트리거 — 검수 한 줄이 샘플에 반영된다
-- =============================================

-- 원래 라벨을 attrs.original 에 **한 번만** 보관한 뒤 바꾼다.
-- reject 는 라벨을 건드리지 않고 needs_review 를 내리며 attrs.rejected = true 를 단다 —
-- 내보내기가 이 값으로 거른다. 행을 지우지 않는 이유: "왜 뺐는지" 가 이력이다.
CREATE OR REPLACE FUNCTION public.apply_dataset_review()
RETURNS TRIGGER AS $$
DECLARE
    s dataset_samples%ROWTYPE;
BEGIN
    SELECT * INTO s FROM dataset_samples WHERE sample_id = NEW.sample_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;

    IF NEW.verdict = 'reject' THEN
        UPDATE dataset_samples SET
            needs_review = FALSE,
            label_source = 'human',
            attrs = s.attrs || jsonb_build_object('rejected', TRUE, 'reject_note', COALESCE(NEW.note, ''), 'pii_found', COALESCE(NEW.pii_found, FALSE)),
            updated_at = now()
        WHERE sample_id = NEW.sample_id;
        RETURN NEW;
    END IF;

    UPDATE dataset_samples SET
        media        = COALESCE(NEW.media, s.media),
        phase        = COALESCE(NEW.phase, s.phase),
        space        = COALESCE(NEW.space, s.space),
        furniture    = COALESCE(NEW.furniture, s.furniture),
        layout_shape = COALESCE(NEW.layout_shape, s.layout_shape),
        label_source = 'human',
        confidence   = 1.0,
        needs_review = FALSE,
        attrs = CASE
                  WHEN s.attrs ? 'original' THEN s.attrs
                  ELSE s.attrs || jsonb_build_object('original', jsonb_build_object(
                         'media', s.media, 'phase', s.phase, 'space', s.space,
                         'furniture', s.furniture, 'layout_shape', s.layout_shape,
                         'label_source', s.label_source, 'confidence', s.confidence))
                END,
        updated_at = now()
    WHERE sample_id = NEW.sample_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_dataset_review_insert ON dataset_reviews;
CREATE TRIGGER on_dataset_review_insert
    AFTER INSERT ON dataset_reviews
    FOR EACH ROW EXECUTE FUNCTION public.apply_dataset_review();

-- updated_at 자동 갱신 (planner_snapshots 와 같은 방식)
CREATE OR REPLACE FUNCTION public.handle_dataset_samples_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_dataset_samples_update ON dataset_samples;
CREATE TRIGGER on_dataset_samples_update
    BEFORE UPDATE ON dataset_samples
    FOR EACH ROW EXECUTE FUNCTION public.handle_dataset_samples_updated_at();


-- =============================================
-- 5. RLS — 관리자만. Worker 는 서비스 롤이라 RLS 를 지나친다.
-- =============================================
ALTER TABLE dataset_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage dataset samples" ON dataset_samples;
CREATE POLICY "admins manage dataset samples" ON dataset_samples
    FOR ALL
    USING      (EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()));

-- 검수는 관리자가 자기 이름으로만 남긴다 (reviewer = 본인). 지우지는 못한다 — 이력이다.
DROP POLICY IF EXISTS "admins read dataset reviews" ON dataset_reviews;
CREATE POLICY "admins read dataset reviews" ON dataset_reviews
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "admins add own dataset reviews" ON dataset_reviews;
CREATE POLICY "admins add own dataset reviews" ON dataset_reviews
    FOR INSERT
    WITH CHECK (reviewer = auth.uid() AND EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()));


-- =============================================
-- 6. 내보내기 뷰 — "학습에 넣어도 되는 것" 을 쿼리 한 곳에 못박는다
--    Worker 의 야간 내보내기와 사람의 확인이 같은 정의를 본다.
-- =============================================
CREATE OR REPLACE VIEW dataset_exportable AS
SELECT *
FROM dataset_samples
WHERE needs_review = FALSE
  AND COALESCE((attrs ->> 'rejected')::boolean, FALSE) = FALSE
  AND media <> 'generated'                                   -- 생성물은 실사와 섞지 않는다 (별도 내보내기)
  AND (license <> 'user-uploaded' OR (consent = TRUE AND label_source = 'human'));   -- 동의 + 사람 검수

GRANT SELECT ON dataset_exportable TO authenticated;   -- RLS 는 밑의 표가 건다
