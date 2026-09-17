-- =============================================
-- 학습 데이터 사슬 — 연출컷 → 도면 → 완성 사진 → 피드백
--
-- 학습 단위는 "한 현장" 이다. 그 등뼈는 designs.id 다.
--   ① 예상 AI 이미지   generations           (designs.generation_id 로 설계에 붙는다)
--   ② 플래너 도면      design_items · planner_snapshots
--   ③ 시공 완성 이미지  collection_posts      (design_id 로 설계에 붙는다)
--   ④ 피드백           design_feedback       (design_id)
--
-- 그리고 **시공이 끝난 것만 학습에 쓴다.** 그 판정의 정본은 ERP 의 수주다:
--   orders.status = 'completed'  (CHECK 로 completed_at 이 보장된다)
-- 사진이 올라왔다는 사실은 완료의 증거가 아니다 — 렌더를 올릴 수도 있다.
--
-- 적용: Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 실행.
--       dataset-schema.sql 을 먼저 실행해 두었어야 한다. 재실행 안전.
-- =============================================


-- =============================================
-- 1. 사슬을 잇는 컬럼 둘
-- =============================================

-- ① 연출컷 → 설계. 상세설계가 detaildesign.html?gen=<id> 로 열렸을 때 클라이언트가 적는다.
--    지금까지 이 연결은 플래너 배치 JSON 안(layout.genId)에만 묻혀 있어 조회가 불가능했다.
ALTER TABLE designs ADD COLUMN IF NOT EXISTS generation_id UUID REFERENCES generations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_designs_generation ON designs (generation_id) WHERE generation_id IS NOT NULL;

-- ② 샘플 → 설계. Worker 가 채운다. 완료 판정(orders)과 조인하는 축이고,
--    같은 현장의 사진이 train/test 로 갈리지 않게 하는 group_key 의 근거이기도 하다.
ALTER TABLE dataset_samples ADD COLUMN IF NOT EXISTS design_id UUID REFERENCES designs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dataset_samples_design ON dataset_samples (design_id) WHERE design_id IS NOT NULL;


-- =============================================
-- 2. 내보내기 뷰 — 시공 완료 조건을 더한다
--
--    security_invoker = on 을 붙이는 이유: 뷰는 기본적으로 **소유자 권한**으로 돌아
--    밑 표의 RLS 를 지나친다. GRANT ... TO authenticated 와 겹치면 로그인한 누구나
--    고객 사진 URL 을 포함한 전 샘플을 읽게 된다. invoker 로 돌리면 dataset_samples 의
--    관리자 정책이 그대로 적용된다 (Worker 는 service_role 이라 영향 없다).
-- =============================================
CREATE OR REPLACE VIEW dataset_exportable
WITH (security_invoker = on) AS
SELECT *
FROM dataset_samples
WHERE needs_review = FALSE
  AND COALESCE((attrs ->> 'rejected')::boolean, FALSE) = FALSE
  AND media <> 'generated'                                   -- 생성물은 실사와 섞지 않는다 (사슬 학습은 dataset_chains)
  AND (license <> 'user-uploaded' OR (consent = TRUE AND label_source = 'human'))   -- 동의 + 사람 검수
  AND (
    -- 외부 수집물은 이미 "완성된 시공 사진" 이다. 다담 데이터만 완료를 따진다.
    source NOT IN ('dadam_collection', 'dadam_generation', 'dadam_planner', 'dadam_design')
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.design_id = dataset_samples.design_id
        AND o.status = 'completed'
    )
  );

GRANT SELECT ON dataset_exportable TO authenticated;   -- RLS 는 밑의 표가 건다 (security_invoker)


-- =============================================
-- 3. dataset_chains — 완료된 현장 하나가 한 줄
--    "예상 이미지 ↔ 실제 결과" 를 학습하려면 생성물이 쌍으로 필요하다.
--    그래서 실사 전용인 dataset_exportable 과 따로 둔다.
-- =============================================
CREATE OR REPLACE VIEW dataset_chains
WITH (security_invoker = on) AS
SELECT
    o.design_id,
    o.order_no,
    o.completed_at,
    o.contract_amount,
    count(s.sample_id)                                          AS samples,
    count(s.sample_id) FILTER (WHERE s.media = 'generated')      AS generated_n,   -- ① 예상 AI 이미지
    count(s.sample_id) FILTER (WHERE s.phase = 'before')         AS before_n,      -- 고객이 올린 현장 사진
    count(s.sample_id) FILTER (WHERE s.source = 'dadam_collection') AS finished_n, -- ③ 시공 완성 이미지
    count(s.sample_id) FILTER (WHERE s.needs_review)             AS review_n,
    (SELECT count(*) FROM design_feedback f WHERE f.design_id = o.design_id) AS feedback_n   -- ④ 피드백
FROM orders o
LEFT JOIN dataset_samples s ON s.design_id = o.design_id
WHERE o.status = 'completed'
GROUP BY o.design_id, o.order_no, o.completed_at, o.contract_amount;

GRANT SELECT ON dataset_chains TO authenticated;

COMMENT ON VIEW dataset_chains IS
  '시공 완료된 현장 단위 학습 묶음. ①연출컷 ②도면 ③완성사진 ④피드백이 design_id 하나로 묶인다.';
