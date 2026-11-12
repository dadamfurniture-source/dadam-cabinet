-- ============================================================
-- 0004_drop_user_profiles.sql — 쓰지 않는 옛 회원 표와 그 표만 쓰는 함수 둘을 지운다
--
-- 회원 정보는 public.profiles 에 있다. public.user_profiles 는 사이트 · 워커 · mcp-server 어디서도
-- 읽거나 쓰지 않는다. 이 표를 가리키는 외래 키 · 뷰 · 트리거도 없고, 본문에 이 표 이름이 나오는
-- 함수는 아래 둘뿐이다 (둘 다 다른 곳에서 부르지 않는다).
--
--   1. public.approve_expert(uuid, uuid) — user_profiles.role 을 고치던 옛 승인 함수
--   2. public.get_user_role(uuid)        — user_profiles.role 을 읽던 옛 함수
--   3. public.user_profiles              — 표 (자기 정책 · 제약 · 인덱스는 표와 함께 지워진다)
--
-- 함수를 먼저 지운다. CASCADE 는 쓰지 않는다 — 모르는 의존 객체가 있으면 지우지 말고 멈춰야 한다.
-- 다시 돌려도 된다 (IF EXISTS).
-- ============================================================

DROP FUNCTION IF EXISTS public.approve_expert(uuid, uuid);

DROP FUNCTION IF EXISTS public.get_user_role(uuid);

DROP TABLE IF EXISTS public.user_profiles;
