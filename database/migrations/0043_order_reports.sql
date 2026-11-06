-- =============================================
-- 0043 수주 완료 보고 — 설치 · A/S 를 팩토리가 하고 본사에 완료 보고 (2026-11-06 사장님 결정 · 작업 분배 묶음)
--
--   ④(구조 답) 설치 · A/S 는 팩토리마다 자기 사람으로 — 「본사에 작업 요청」 길은 만들지 않는다
--   ⑤ 완료 보고 방법: 수주에서 「설치 완료」 · 「A/S 완료」 + 사진. 담당자나 대표 · 실장이 누르고 사진을 올린다.
--      본사는 받아서 기록만 한다 (검수 없음)
--
-- 바꾸는 것:
--   1) order_reports — 완료 보고 한 번 = 한 줄. 추가만 하고 고치거나 지우지 않는다 (수주 기록 order_events 와 같은 결).
--        kind      install_done 설치 완료 · as_done A/S 완료
--        note      한 줄 메모 (500자까지, 없어도 된다)
--        photos    사진 경로 배열 (버킷 order-report-photos, 10장까지) — 경로 모양은 서버가 정한다
--        reported_by  누른 사람
--      수주와 같은 팩토리의 줄만 (orders (id, company_id) 복합 FK — 0013 이 만든 유니크).
--   2) 비공개 버킷 order-report-photos — 서버(service_role)가 올리고, 화면은 서버의 서명 주소(1시간)로 본다. 버킷 정책 없음.
--        경로: <팩토리 id>/<수주 id>/<uuid>.jpg|png · 5MB · JPEG · PNG (작업자 필수 확인 사진 0037 과 같은 한도)
--
-- 읽기: 그 팩토리의 지금 구성원 (RLS). 본사 모아 보기는 서버(service_role)가 한다. 쓰기는 서버만. 지우기 · 비우기는 아무도 못 한다.
-- 수주 상태(완료 등)는 바꾸지 않는다 — 보고는 기록이다.
-- =============================================

-- 1) 완료 보고 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    order_id uuid NOT NULL,
    kind text NOT NULL,
    note text,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    reported_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_reports_pkey PRIMARY KEY (id),
    CONSTRAINT order_reports_kind_check CHECK (kind = ANY (ARRAY['install_done'::text, 'as_done'::text])),
    CONSTRAINT order_reports_note_check CHECK ((note IS NULL) OR (length(note) <= 500)),
    CONSTRAINT order_reports_photos_check CHECK ((jsonb_typeof(photos) = 'array'::text) AND (jsonb_array_length(photos) <= 10)
        AND (octet_length(photos::text) <= 4000)),
    CONSTRAINT order_reports_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
    CONSTRAINT order_reports_order_fkey FOREIGN KEY (order_id, company_id) REFERENCES public.orders(id, company_id) ON DELETE RESTRICT,
    CONSTRAINT order_reports_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.order_reports IS '수주 완료 보고 — 설치 완료 · A/S 완료 + 사진 (2026-11-06 작업 분배 ⑤). 본사는 기록만(검수 없음). 추가만 하고 고치거나 지우지 않는다. 쓰기는 service_role 만';

CREATE INDEX IF NOT EXISTS idx_order_reports_order ON public.order_reports USING btree (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_reports_created ON public.order_reports USING btree (created_at DESC);

-- 고치기 막기 — 사람 칸(reported_by)이 지워져 비는 것(ON DELETE SET NULL)만 된다
CREATE OR REPLACE FUNCTION public.order_reports_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.id, NEW.company_id, NEW.order_id, NEW.kind, NEW.note, NEW.photos, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.company_id, OLD.order_id, OLD.kind, OLD.note, OLD.photos, OLD.created_at)
     OR (NEW.reported_by IS NOT NULL AND NEW.reported_by IS DISTINCT FROM OLD.reported_by) THEN
    RAISE EXCEPTION 'order_reports: 보고 내용은 바꿀 수 없습니다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.order_reports_guard() IS '완료 보고 지킴이 — 내용은 바뀌지 않는다 (누른 사람 칸이 지워져 비는 것만)';

REVOKE ALL ON FUNCTION public.order_reports_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_order_reports_guard ON public.order_reports;
CREATE TRIGGER trg_order_reports_guard BEFORE UPDATE ON public.order_reports FOR EACH ROW EXECUTE FUNCTION public.order_reports_guard();

ALTER TABLE public.order_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_reports TO authenticated;
GRANT SELECT, INSERT ON TABLE public.order_reports TO service_role;
-- 고치기 · 지우기 · 비우기는 아무도 못 한다 (사람이 지워질 때 FK 가 reported_by 를 비우는 것은 표 주인 권한으로 돈다)
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.order_reports FROM service_role;

DROP POLICY IF EXISTS order_reports_member_read ON public.order_reports;
CREATE POLICY order_reports_member_read ON public.order_reports
    FOR SELECT
    TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()));

-- 2) 사진 버킷 ------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('order-report-photos', 'order-report-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
