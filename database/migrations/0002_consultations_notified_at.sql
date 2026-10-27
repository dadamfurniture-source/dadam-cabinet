-- ============================================================
-- 0002_consultations_notified_at.sql — 새 상담 Slack 알림 표시
--
-- 상담 신청(public.consultations)은 브라우저(consultation.html · segan/consult.html)가 바로 넣는다.
-- workflow-api 워커가 5분마다 아직 알리지 않은 행을 잡아 회사 Slack 에 짧게 알리고 표시한다
-- (workers/workflow-api/src/consult-notify.js).
--
--   1. notified_at 칸 — 알렸다고(또는 알리지 않기로) 표시한 시각. NULL = 아직.
--   2. 부분 인덱스 — 아직 표시하지 않은 행만, created_at 순.
--   3. 고객 INSERT 정책 — notified_at IS NULL 을 더한다. 브라우저가 칸을 미리 채워 알림을 건너뛰게 할 수 없다.
--      나머지 조건은 라이브(0000 기준선) 그대로:
--      (user_id IS NULL OR user_id = auth.uid()) AND public.consultation_generation_ok(generation_id)
--   4. claim_consultation_notices(p_fresh_since, p_limit) — 잡기 + 표시를 한 번에. service_role 만 부른다.
--
-- 0001 이 먼저 적용돼 있어야 한다 (db-migrate 는 맨 앞 대기 번호만 받는다). 다시 돌려도 된다.
-- ============================================================

ALTER TABLE public.consultations ADD COLUMN IF NOT EXISTS notified_at timestamp with time zone;

COMMENT ON COLUMN public.consultations.notified_at IS '새 상담 Slack 알림 표시 시각 (workflow-api 5분 cron). NULL = 아직 — 고객 INSERT 는 NULL 만 받는다';

CREATE INDEX IF NOT EXISTS idx_consultations_unnotified ON public.consultations USING btree (created_at) WHERE (notified_at IS NULL);

DROP POLICY IF EXISTS "Users can insert consultations" ON public.consultations;
CREATE POLICY "Users can insert consultations" ON public.consultations
    FOR INSERT
    TO PUBLIC
    WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND public.consultation_generation_ok(generation_id) AND (notified_at IS NULL)));

-- 잡기: 아직 표시하지 않은 행을 한 트랜잭션 안에서 표시하고, 알림에 쓸 코드 칸만 돌려준다.
--   - p_fresh_since 보다 오래된(또는 created_at 이 빈) 행은 알리지 않고 표시만 한다 → 'stale' 건수
--     (처음 켤 때의 옛 상담, 워커가 오래 멈췄던 동안의 상담)
--   - 그 뒤 행은 오래된 것부터 p_limit 건(1~50)을 표시하고 돌려준다 → 'rows'
--   - 고르는 SELECT 가 FOR UPDATE SKIP LOCKED 라 겹친 실행은 같은 행을 잡지 못한다. 표시는 이 함수 안에서
--     끝나므로, 돌려받은 행은 워커가 보내기에 실패해도 다시 잡히지 않는다 (최대 한 번).
--   - 돌려주는 칸에 이름 · 이메일 · 연락처 · 상담 제목 · 요청 내용 · 메모는 없다.
-- SECURITY INVOKER(기본): 부르는 쪽은 service_role 하나뿐이고 service_role 은 RLS 를 건너뛴다 — DEFINER 로 올릴
-- 권한이 없다. 실수로 다른 역할이 부를 수 있게 되더라도 그 역할의 RLS 로 돌아 남의 행을 잡거나 읽지 못한다.
CREATE OR REPLACE FUNCTION public.claim_consultation_notices(p_fresh_since timestamp with time zone, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_stale integer;
  v_rows jsonb;
BEGIN
  IF p_fresh_since IS NULL THEN
    RAISE EXCEPTION 'p_fresh_since is required';
  END IF;

  WITH stale AS (
    UPDATE public.consultations c
       SET notified_at = now()
     WHERE c.id IN (
             SELECT s.id
               FROM public.consultations s
              WHERE s.notified_at IS NULL
                AND (s.created_at IS NULL OR s.created_at < p_fresh_since)
                FOR UPDATE SKIP LOCKED)
    RETURNING c.id
  )
  SELECT count(*)::integer INTO v_stale FROM stale;

  WITH claimed AS (
    UPDATE public.consultations c
       SET notified_at = now()
     WHERE c.id IN (
             SELECT f.id
               FROM public.consultations f
              WHERE f.notified_at IS NULL
                AND f.created_at >= p_fresh_since
              ORDER BY f.created_at, f.id
              LIMIT least(greatest(coalesce(p_limit, 20), 1), 50)
                FOR UPDATE SKIP LOCKED)
    RETURNING c.id, c.created_at, c.consultation_type, c.furniture_categories, c.preferred_date,
              c.preferred_time, c.sido, c.gugun, c.consult_target, c.generation_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_at', k.created_at,
           'consultation_type', k.consultation_type,
           'furniture_categories', k.furniture_categories,
           'preferred_date', k.preferred_date,
           'preferred_time', k.preferred_time,
           'sido', k.sido,
           'gugun', k.gugun,
           'consult_target', k.consult_target,
           'has_generation', k.generation_id IS NOT NULL,
           'category', g.category)
         ORDER BY k.created_at, k.id), '[]'::jsonb)
    INTO v_rows
    FROM claimed k
    LEFT JOIN public.generations g ON g.id = k.generation_id;

  RETURN jsonb_build_object('stale', v_stale, 'rows', v_rows);
END;
$function$;

COMMENT ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) IS '새 상담 Slack 알림 — 미알림 행을 잡아 notified_at 표시 (오래된 행은 표시만). service_role 전용 (workflow-api cron)';

REVOKE ALL ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_consultation_notices(timestamp with time zone, integer) TO service_role;
