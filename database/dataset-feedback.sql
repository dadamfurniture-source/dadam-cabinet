-- =============================================
-- 사슬 ④ — 시공 후 피드백
--
-- design_feedback 표는 처음부터 있었지만 **쓰는 화면이 하나도 없었다.**
-- 사슬(연출컷 → 도면 → 완성 사진 → 피드백)의 마지막 칸이 비어 있던 이유다.
--
-- 여기서 하는 일은 셋:
--   ① 어느 완성 사진에 대한 평가인지 가리키는 post_id
--   ② 관리자 읽기 정책 (지금은 본인만 볼 수 있어 검수·집계가 불가능하다)
--   ③ dataset_chains 에 만족도·수정 여부를 실어 준다
--
-- 적용: Supabase SQL Editor 에서 실행. dataset-chain.sql 이 선행. 재실행 안전.
-- =============================================


-- =============================================
-- 1. 어느 완성 사진에 대한 평가인가
--    설계 단위 평가가 기본이고, 사진을 고르면 그 장에 붙는다 (선택).
-- =============================================
ALTER TABLE design_feedback ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES collection_posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_design_feedback_post ON design_feedback (post_id) WHERE post_id IS NOT NULL;


-- =============================================
-- 2. 관리자 읽기
--    기존 정책은 "본인 것만"(FOR ALL USING auth.uid() = user_id) 하나뿐이라
--    관리자도 못 본다 — 집계도 검수도 안 된다. 읽기만 연다(쓰기는 본인만).
-- =============================================
DROP POLICY IF EXISTS "admins read design feedback" ON design_feedback;
CREATE POLICY "admins read design feedback" ON design_feedback
    FOR SELECT
    USING (EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid()));


-- =============================================
-- 3. dataset_chains — 만족도를 실어 준다
--    "설계대로 나왔나(accuracy) · 쓰기 좋은가(usability) · 고쳐야 했나(was_modified)"
--    는 사슬 학습의 정답 라벨이다. 개수만 세던 것을 값까지 낸다.
-- =============================================
CREATE OR REPLACE VIEW dataset_chains
WITH (security_invoker = on) AS
SELECT
    o.design_id,
    o.order_no,
    o.completed_at,
    o.contract_amount,
    count(s.sample_id)                                              AS samples,
    count(s.sample_id) FILTER (WHERE s.media = 'generated')          AS generated_n,   -- ① 예상 AI 이미지
    count(s.sample_id) FILTER (WHERE s.phase = 'before')             AS before_n,      -- 고객이 올린 현장 사진
    count(s.sample_id) FILTER (WHERE s.source = 'dadam_collection')  AS finished_n,    -- ③ 시공 완성 이미지
    count(s.sample_id) FILTER (WHERE s.needs_review)                 AS review_n,
    f.feedback_n,                                                                      -- ④ 피드백
    f.accuracy_avg,
    f.usability_avg,
    f.was_modified,
    f.last_feedback_at
FROM orders o
LEFT JOIN dataset_samples s ON s.design_id = o.design_id
LEFT JOIN LATERAL (
    SELECT count(*)                       AS feedback_n,
           avg(accuracy_score)::numeric(3,2)  AS accuracy_avg,
           avg(usability_score)::numeric(3,2) AS usability_avg,
           bool_or(coalesce(was_modified, FALSE)) AS was_modified,
           max(created_at)                AS last_feedback_at
    FROM design_feedback df
    WHERE df.design_id = o.design_id
) f ON TRUE
WHERE o.status = 'completed'
GROUP BY o.design_id, o.order_no, o.completed_at, o.contract_amount,
         f.feedback_n, f.accuracy_avg, f.usability_avg, f.was_modified, f.last_feedback_at;

GRANT SELECT ON dataset_chains TO authenticated;

COMMENT ON VIEW dataset_chains IS
  '시공 완료된 현장 단위 학습 묶음. ①연출컷 ②도면 ③완성사진 ④피드백이 design_id 하나로 묶인다.';
