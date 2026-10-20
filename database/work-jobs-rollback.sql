-- ============================================================
-- 작업자 포털 되돌리기 — database/work-jobs.sql 이 만든 표를 모두 지운다
--
-- ⚠️ 데이터가 지워진다 (작업 · 신청 · 배정 · 보고 · 작업자 · 초대 · 메모 · 이벤트).
--    실수로 실행하지 않도록 work-jobs.sql 과 따로 둔다. 필요하면 먼저 백업한다.
--
-- 순서: 가리키는 쪽(자식)부터 역순으로 — work-jobs.sql 의 CREATE 순서를 거꾸로.
-- 표가 없어도 안전하다 (IF EXISTS). 워커는 표가 없으면 빈 목록 · { ready:false } 로 내려앉는다.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS work_job_events;
DROP TABLE IF EXISTS work_reviews;
DROP TABLE IF EXISTS work_photos;
DROP TABLE IF EXISTS work_updates;
DROP TABLE IF EXISTS work_assignments;
DROP TABLE IF EXISTS work_applications;
DROP TABLE IF EXISTS work_jobs;
DROP TABLE IF EXISTS worker_notes;
DROP TABLE IF EXISTS workers;
DROP TABLE IF EXISTS worker_invites;

COMMIT;
