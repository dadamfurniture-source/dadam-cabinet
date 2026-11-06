-- =============================================
-- 0044 상담 신청 — 시공 사진 학습 활용 동의 (2026-11-06 사장님 결정 · 작업 분배 ⑥)
--
--   ⑥ 완료 사진을 학습 자료로: 고객이 동의한 수주의 사진만 — 상담 신청 때 받는 동의에 「시공 사진 학습 활용」 한 줄을 더한다.
--
-- 바꾸는 것: consultations.photo_learn_agreed_at — 고객이 상담 신청서에서 그 동의를 체크한 시각 (선택 동의 — 비우면 동의 없음).
--   업체 제공 동의(third_party_agreed_at, 0019)와 따로다. 신청서는 지금처럼 고객이 직접 넣는다 (넣기 정책은 그대로 —
--   이 칸은 고객 본인이 정한다). 팩토리 사본 상담은 원래 상담(origin_consultation_id)의 값을 본다 — 사본에 옮기지 않는다.
--   수주의 완료 보고 사진(0043)은 그 수주 프로젝트의 상담(또는 그 원래 상담)에 이 칸이 있을 때만 학습에 쓴다 (서버가 판정).
--
-- 다시 돌려도 된다.
-- =============================================

ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS photo_learn_agreed_at timestamp with time zone;

COMMENT ON COLUMN public.consultations.photo_learn_agreed_at IS '시공 사진 학습 활용 동의 시각 (선택) — 동의한 수주의 완료 사진만 학습에 쓴다 (0044 · 2026-11-06 작업 분배 ⑥)';
