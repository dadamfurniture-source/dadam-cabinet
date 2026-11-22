-- =============================================
-- 0081 연출컷 AI 상담 정리본 (2026-11-23 대표님 「상담내역은 마이페이지에 정리본 자동저장해 줘」)
--
--   앱 연출컷 ② 「요청 · AI 상담」에서 「정리하기」를 누르면 서버(generate-api POST /api/chat/brief)가
--   그 정리본을 이 표에 적는다. 마이페이지 「AI 상담 기록」(segan/me.html#consult-notes)이 본인 것을 읽고 지운다.
--
--   make_consult_notes
--     user_id     고객 (auth.users — 계정을 지우면 같이 지워진다)
--     note_key    상담 한 번의 열쇠 (화면이 상담을 시작할 때 만든 uuid). 같은 상담에서 「다시 정리하기」를 누르면
--                 새 줄이 아니라 같은 줄을 고친다 (user_id, note_key 유니크)
--     category    품목 키 (sink · wardrobe … 1 ~ 32자)
--     brief       정리본 (1 ~ 600자 — 화면 · 서버 한도와 같다)
--     created_at · updated_at
--   대화 원문 · 방 사진은 적지 않는다 — 정리본 글만.
--
-- 읽기 · 쓰기:
--   authenticated — 본인 줄만 읽고(SELECT) 지운다(DELETE). 넣기 · 고치기는 서버(service_role)만.
--   anon — 아무것도 못 한다.
-- 다시 돌려도 된다 (IF NOT EXISTS · DROP … IF EXISTS 다음 CREATE · OR REPLACE).
-- =============================================

CREATE TABLE IF NOT EXISTS public.make_consult_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    note_key uuid NOT NULL,
    category text NOT NULL,
    brief text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT make_consult_notes_pkey PRIMARY KEY (id),
    CONSTRAINT make_consult_notes_user_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT make_consult_notes_user_key UNIQUE (user_id, note_key),
    CONSTRAINT make_consult_notes_category_check CHECK (char_length(category) BETWEEN 1 AND 32),
    CONSTRAINT make_consult_notes_brief_check CHECK (char_length(brief) BETWEEN 1 AND 600)
);

CREATE INDEX IF NOT EXISTS idx_make_consult_notes_user_updated
    ON public.make_consult_notes USING btree (user_id, updated_at DESC);

-- 고칠 때 updated_at (서버가 같은 상담을 다시 정리하면 고친 때가 바뀐다)
CREATE OR REPLACE FUNCTION public.make_consult_notes_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_make_consult_notes_touch ON public.make_consult_notes;
CREATE TRIGGER trg_make_consult_notes_touch
    BEFORE UPDATE ON public.make_consult_notes
    FOR EACH ROW EXECUTE FUNCTION public.make_consult_notes_touch();

ALTER TABLE public.make_consult_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS make_consult_notes_select ON public.make_consult_notes;
CREATE POLICY make_consult_notes_select ON public.make_consult_notes
    FOR SELECT
    TO authenticated
    USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS make_consult_notes_delete ON public.make_consult_notes;
CREATE POLICY make_consult_notes_delete ON public.make_consult_notes
    FOR DELETE
    TO authenticated
    USING ((user_id = (SELECT auth.uid())));

REVOKE ALL ON TABLE public.make_consult_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.make_consult_notes TO authenticated;
GRANT ALL ON TABLE public.make_consult_notes TO service_role;
REVOKE ALL ON FUNCTION public.make_consult_notes_touch() FROM PUBLIC, anon, authenticated;
