-- =============================================
-- 0010 — 시험용 가상 협력업체 숨기기
--
-- partners 에는 database/partners-seed.sql 로 넣은 가상 업체 10곳(인테리어 5 · 공장 5)이 있다.
-- 「Anyone can view active partners」 정책으로 비로그인도 읽힌다 — 이름 · 전화 · 카카오 · 평점 · 인증 표시.
-- is_active = false 로 바꿔 공개 읽기에서 뺀다. 지우지 않는다 (관리자는 그대로 읽는다).
--
-- 바꾸는 행: 시드 이름과 같고, 아직 어떤 회사(companies.partner_id)와도 이어지지 않은 행.
-- 다른 칸 · 정책 · 권한은 그대로다. updated_at 은 기존 트리거가 고친다.
-- 다시 돌려도 된다 (이미 숨긴 행은 건너뛴다).
-- =============================================

UPDATE public.partners p
   SET is_active = false
 WHERE p.is_active IS DISTINCT FROM false
   AND p.company_name IN (
         '리빙하우스', '공간제작소', '어반스튜디오', '홈앤리빙', '플레이스웍스',
         '우드보드', '정밀재단', '컬러팩토리', '클리어글라스', '메탈크래프트'
       )
   AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.partner_id = p.id);
