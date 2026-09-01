-- ═══════════════════════════════════════════════════════════════
-- 회원탈퇴가 가능하도록 FK 정리
--
-- auth.users 를 참조하는 외래키 중 넷이 NO ACTION 이다:
--   collection_inquiries.from_user_id / .to_user_id
--   design_feedback.user_id
--   expert_requests.reviewed_by
--
-- 그 행이 하나라도 있으면 탈퇴가 FK 위반으로 실패한다.
-- 지금 전부 0행이라 안 터지고 있을 뿐이고, 문의가 한 건만 들어와도 막힌다.
--
-- CASCADE 가 아니라 SET NULL 로 두는 이유:
--   문의·피드백·검토 이력은 사람이 떠나도 남아야 하는 기록이다.
--   사람만 지우고 기록은 익명으로 남긴다.
--   (to_user_id 는 NOT NULL 이라 먼저 풀어준다)
--
-- 재실행 안전(idempotent).
-- ═══════════════════════════════════════════════════════════════

-- collection_inquiries
ALTER TABLE collection_inquiries ALTER COLUMN to_user_id DROP NOT NULL;

ALTER TABLE collection_inquiries DROP CONSTRAINT IF EXISTS collection_inquiries_from_user_id_fkey;
ALTER TABLE collection_inquiries
  ADD CONSTRAINT collection_inquiries_from_user_id_fkey
  FOREIGN KEY (from_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE collection_inquiries DROP CONSTRAINT IF EXISTS collection_inquiries_to_user_id_fkey;
ALTER TABLE collection_inquiries
  ADD CONSTRAINT collection_inquiries_to_user_id_fkey
  FOREIGN KEY (to_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- design_feedback
ALTER TABLE design_feedback ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE design_feedback DROP CONSTRAINT IF EXISTS design_feedback_user_id_fkey;
ALTER TABLE design_feedback
  ADD CONSTRAINT design_feedback_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- expert_requests.reviewed_by (user_id 쪽은 이미 CASCADE)
ALTER TABLE expert_requests DROP CONSTRAINT IF EXISTS expert_requests_reviewed_by_fkey;
ALTER TABLE expert_requests
  ADD CONSTRAINT expert_requests_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
