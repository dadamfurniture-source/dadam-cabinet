-- =============================================
-- 0001 — design_rules · user_profiles · renders 버킷 정책 바로잡기
--
-- 1) public.design_rules
--    정책 "Anyone can read/insert/update/delete" 가 모두 TO PUBLIC · USING/WITH CHECK (true) 였고
--    anon 에 ALL 권한이 있어, 공개(anon) 키만으로 행을 넣고 · 고치고 · 지울 수 있었다.
--    - 읽기는 그대로 모두에게 둔다: mcp-server 의 RAG 검색이 anon 키로 RPC quick_trigger_search 를
--      부르고, 이 함수는 SECURITY INVOKER 라 호출한 역할 권한으로 design_rules 를 읽는다.
--    - 쓰기(INSERT · UPDATE · DELETE)는 관리자(public.is_admin())만. 관리자도 API 에서는
--      authenticated 역할이라 authenticated 에 INSERT · UPDATE · DELETE 권한은 남기고 정책으로 거른다.
--    - anon 은 SELECT 만. TRUNCATE · REFERENCES · TRIGGER · MAINTAIN 은 anon · authenticated 모두 회수
--      (TRUNCATE 는 RLS 를 타지 않는다). service_role 은 그대로 (RLS 우회).
--    - 시퀀스 design_rules_id_seq 는 anon 권한만 회수 (관리자 INSERT 는 authenticated 로 nextval 을 쓴다).
--
-- 2) public.user_profiles
--    정책 "Service role can insert profiles" 는 이름과 달리 TO PUBLIC · WITH CHECK (true) 라
--    누구나 행을 넣을 수 있었다. service_role 은 RLS 를 우회하므로 이 정책이 필요 없다 — 지운다.
--
-- 3) storage.objects — 버킷 renders 의 renders_select_own · renders_insert_own · renders_delete_own
--    하위 질의 `FROM public.designs d … (storage.foldername(name))[1]` 의 name 이 storage.objects.name 이
--    아니라 designs.name 으로 풀려 있었다 (designs 에도 name 열이 있다). 그래서 설계 소유자도
--    렌더를 올리거나 · 서명 URL 을 받거나 · 지울 수 없었다.
--    규칙은 그대로 두고 objects.name 을 이름까지 붙여 쓴다:
--      경로 {design_id}/{item_unique_id}/… 의 첫 폴더가 auth.uid() 가 가진 designs.id 일 때.
--    renders_select_admin 과 service_role(작업지시서 서명 URL)은 바꾸지 않는다.
--
-- 다시 돌려도 된다 (DROP POLICY IF EXISTS 다음 CREATE POLICY, REVOKE · GRANT).
-- =============================================

-- 1) design_rules ------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can read" ON public.design_rules;
DROP POLICY IF EXISTS "Anyone can insert" ON public.design_rules;
DROP POLICY IF EXISTS "Anyone can update" ON public.design_rules;
DROP POLICY IF EXISTS "Anyone can delete" ON public.design_rules;

DROP POLICY IF EXISTS design_rules_read ON public.design_rules;
CREATE POLICY design_rules_read ON public.design_rules
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS design_rules_admin_insert ON public.design_rules;
CREATE POLICY design_rules_admin_insert ON public.design_rules
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS design_rules_admin_update ON public.design_rules;
CREATE POLICY design_rules_admin_update ON public.design_rules
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS design_rules_admin_delete ON public.design_rules;
CREATE POLICY design_rules_admin_delete ON public.design_rules
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

ALTER TABLE public.design_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.design_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.design_rules TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.design_rules TO authenticated;

REVOKE ALL ON SEQUENCE public.design_rules_id_seq FROM PUBLIC, anon;

-- 2) user_profiles -----------------------------------------------------------

DROP POLICY IF EXISTS "Service role can insert profiles" ON public.user_profiles;

-- 3) storage.objects — renders 버킷 -----------------------------------------

DROP POLICY IF EXISTS renders_select_own ON storage.objects;
CREATE POLICY renders_select_own ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'renders'
        AND EXISTS (
            SELECT 1 FROM public.designs d
            WHERE d.id::text = (storage.foldername(objects.name))[1]
              AND d.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS renders_insert_own ON storage.objects;
CREATE POLICY renders_insert_own ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'renders'
        AND EXISTS (
            SELECT 1 FROM public.designs d
            WHERE d.id::text = (storage.foldername(objects.name))[1]
              AND d.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS renders_delete_own ON storage.objects;
CREATE POLICY renders_delete_own ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'renders'
        AND EXISTS (
            SELECT 1 FROM public.designs d
            WHERE d.id::text = (storage.foldername(objects.name))[1]
              AND d.user_id = auth.uid()
        )
    );
