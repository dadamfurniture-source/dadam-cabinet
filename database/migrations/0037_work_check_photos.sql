-- =============================================
-- 0037 — 작업자 필수 확인 사진 버킷
--
-- 2026-11-04 사장님 확정 (작업자 필수 확인 추천안 — 「사진 필수」 항목만 사진을 받는다): 조립 「포장 전 정면 사진」 · 설치 「완료 사진」은
-- 사진을 올려야 체크된다. 사진은 비공개 버킷 work-check-photos 에 서버(service_role)가 올리고, 체크 기록(work_checks.photo_path, 0035)에
-- 경로만 남긴다. 화면은 서버를 거친다 — 본사는 서명 주소(1시간)로 본다. 버킷 정책을 두지 않는다 (서버만).
--   경로: <회사 id>/<주문 id>/<문서 id>/<uuid>.jpg|png · 5MB · JPEG · PNG 만 (장부 사진 ledger-evidence 와 같은 한도)
--
-- 다시 돌려도 된다.
-- =============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('work-check-photos', 'work-check-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
