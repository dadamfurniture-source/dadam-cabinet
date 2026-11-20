-- =============================================
-- 0073 — 가전 카탈로그: 세탁기 · 건조기 구분 + 조합(나란히 · 쌓기) 묶음
--
-- 사장님 2026-11-20 「가전 카탈로그도 만들어서, 냉장고, 세탁기, 전자레인지, 오븐, 밥솥 등 도」 · 질문 창 답
-- 「모델, 치수, 사진은 공용 카탈로그」 · 「냉장고, 세탁기 등의 경우 조합되거나 결합되는 경우의 수 모두 포함」.
--
-- 1) appliance_models 종류에 건조기(dryer)를 더한다. 세탁기 · 건조기에 세부 구분(subtype)을 둔다.
--      washing_machine  drum 드럼 · top_load 통돌이(일반) · mini 미니 · combo 세탁건조 일체 · washtower 세탁기 + 건조기 일체형(상하)
--      dryer            heat_pump 히트펌프 · electric 전기(히터) · gas 가스
--    나머지 종류 · 구분은 0032 그대로 (목록에 더하기만 — 기존 행은 모두 새 검사를 통과한다).
--
-- 2) 조합 묶음 — 「경우의 수 모두」를 행으로 늘어놓지 않고, 제조사가 안내한 묶음 규칙으로 둔다.
--      appliance_combos          묶음 하나 = 브랜드 · 이름 · 갈래(fridge 냉장고 · laundry 세탁) · 방식(side 나란히 | stack 쌓기) ·
--                                사이 여유(gap_mm) · 나란히 최대 대수(max_units) · 직렬 키트(kit_name · kit_code) · 출처 · 검증
--      appliance_combo_members   묶음에 드는 모델 = 모델 id + 자리(any 나란히 아무 자리 · lower 아래 · upper 위)
--    경우의 수는 화면이 짓는다 — 나란히는 같은 묶음 모델을 1 ~ max_units 대, 쌓기는 lower × upper 짝.
--    제조사가 안내하지 않은 조합(다른 브랜드끼리 · 사이 여유를 모르는 것)은 넣지 않는다.
--
-- 읽기 · 쓰기는 appliance_models 와 같다 — 누구나 읽고, 넣기 · 고치기 · 지우기는 사이트 관리자(admin · super_admin)만.
-- 가져오기 함수 import_appliance_combos(jsonb) 는 service_role 만 (수집기 SQL 을 SQL 편집기 · 서버 키로 돌린다).
-- 다시 돌려도 된다.
-- =============================================

-- 1) 종류 · 세부 구분 ---------------------------------------------------------------

ALTER TABLE public.appliance_models DROP CONSTRAINT IF EXISTS appliance_models_category_check;
ALTER TABLE public.appliance_models
    ADD CONSTRAINT appliance_models_category_check CHECK (category IN (
        'refrigerator', 'hood', 'dishwasher', 'sink', 'oven', 'cooktop', 'washing_machine', 'microwave',
        'rice_cooker', 'range', 'faucet',
        'robot_vacuum', 'food_disposer', 'water_purifier', 'wine_cellar',
        'dryer'
    ));

ALTER TABLE public.appliance_models DROP CONSTRAINT IF EXISTS appliance_models_subtype_chk;
ALTER TABLE public.appliance_models
    ADD CONSTRAINT appliance_models_subtype_chk CHECK (subtype IS NULL OR CASE category
        WHEN 'refrigerator' THEN subtype IN ('french_4door', 'side_by_side', 'two_door', 'one_door', 'built_in', 'kimchi_stand', 'kimchi_lid', 'wine', 'small')
        WHEN 'microwave' THEN subtype IN ('solo', 'combi')
        WHEN 'oven' THEN subtype IN ('oven', 'steam_oven', 'combi')
        WHEN 'dishwasher' THEN subtype IN ('built_in', 'freestanding', 'countertop')
        WHEN 'cooktop' THEN subtype IN ('induction', 'highlight', 'hybrid', 'gas')
        WHEN 'hood' THEN subtype IN ('chimney', 'slim', 'built_in', 'island')
        WHEN 'rice_cooker' THEN subtype IN ('pressure_ih', 'ih', 'pressure', 'electric')
        WHEN 'range' THEN subtype IN ('gas', 'induction', 'hybrid', 'highlight')
        WHEN 'robot_vacuum' THEN subtype IN ('toe_kick', 'built_in')
        WHEN 'food_disposer' THEN subtype IN ('grinder', 'grinder_microbial', 'microbial', 'dryer')
        WHEN 'water_purifier' THEN subtype IN ('purify', 'cold', 'hot', 'hot_cold')
        WHEN 'wine_cellar' THEN subtype IN ('under_counter', 'built_in')
        WHEN 'washing_machine' THEN subtype IN ('drum', 'top_load', 'mini', 'combo', 'washtower')
        WHEN 'dryer' THEN subtype IN ('heat_pump', 'electric', 'gas')
        ELSE false
    END);

COMMENT ON TABLE public.appliance_models IS '가전 모델 카탈로그 (냉장고 · 주방가전 · 싱크볼 · 수전 · 하부장 가전 · 세탁기 · 건조기) — 도면 배치 W/D/H · 상판 타공 참조 · 앱 가전 카탈로그 · 플래너 가전 목록';
COMMENT ON COLUMN public.appliance_models.category IS 'refrigerator | hood | dishwasher | sink | oven | cooktop | washing_machine | microwave | rice_cooker | range | faucet | robot_vacuum | food_disposer | water_purifier | wine_cellar | dryer (0073)';
COMMENT ON COLUMN public.appliance_models.subtype IS '세부 구분 — 종류별 목록은 appliance_models_subtype_chk (database/migrations/0073_appliance_laundry_combos.sql)';

-- 2) 조합 묶음 ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appliance_combos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand text NOT NULL,
    name text NOT NULL,
    family text NOT NULL,
    kind text NOT NULL,
    line text,
    gap_mm integer,
    max_units smallint DEFAULT 2 NOT NULL,
    kit_name text,
    kit_code text,
    source_url text,
    verified boolean DEFAULT false NOT NULL,
    notes text,
    collected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appliance_combos_pkey PRIMARY KEY (id),
    CONSTRAINT appliance_combos_brand_check CHECK ((length(btrim(brand)) >= 1) AND (length(brand) <= 40)),
    CONSTRAINT appliance_combos_name_check CHECK ((length(btrim(name)) >= 1) AND (length(name) <= 120)),
    CONSTRAINT appliance_combos_family_check CHECK (family IN ('fridge', 'laundry')),
    CONSTRAINT appliance_combos_kind_check CHECK (kind IN ('side', 'stack')),
    -- 쌓기는 두 대 (아래 · 위), 나란히는 1 ~ 6 대
    CONSTRAINT appliance_combos_units_check CHECK ((kind = 'stack' AND max_units = 2) OR (kind = 'side' AND max_units BETWEEN 1 AND 6)),
    CONSTRAINT appliance_combos_gap_check CHECK ((gap_mm IS NULL) OR (gap_mm BETWEEN 0 AND 500)),
    CONSTRAINT appliance_combos_len_check CHECK (((line IS NULL) OR (length(line) <= 60)) AND ((kit_name IS NULL) OR (length(kit_name) <= 120))
        AND ((kit_code IS NULL) OR (length(kit_code) <= 60)) AND ((source_url IS NULL) OR (length(source_url) <= 500)) AND ((notes IS NULL) OR (length(notes) <= 1000)))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_appliance_combos_name ON public.appliance_combos USING btree (brand, lower(btrim(name)));
COMMENT ON TABLE public.appliance_combos IS '가전 조합 묶음 (0073) — 제조사가 안내한 나란히(side) · 쌓기(stack) 설치 묶음. 경우의 수는 화면이 짓는다 (나란히 = 같은 묶음 모델 1 ~ max_units 대, 쌓기 = lower × upper)';
COMMENT ON COLUMN public.appliance_combos.gap_mm IS '모델 사이 여유 (mm, 제조사 안내) — 모르면 NULL';
COMMENT ON COLUMN public.appliance_combos.kit_code IS '쌓기 · 연결 키트 모델 코드 (직렬 키트 등)';

CREATE TABLE IF NOT EXISTS public.appliance_combo_members (
    combo_id uuid NOT NULL,
    model_id uuid NOT NULL,
    role text DEFAULT 'any'::text NOT NULL,
    CONSTRAINT appliance_combo_members_pkey PRIMARY KEY (combo_id, model_id, role),
    CONSTRAINT appliance_combo_members_role_check CHECK (role IN ('any', 'lower', 'upper')),
    CONSTRAINT appliance_combo_members_combo_id_fkey FOREIGN KEY (combo_id) REFERENCES public.appliance_combos(id) ON DELETE CASCADE,
    CONSTRAINT appliance_combo_members_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.appliance_models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_appliance_combo_members_model ON public.appliance_combo_members USING btree (model_id);
COMMENT ON TABLE public.appliance_combo_members IS '조합 묶음에 드는 모델 (0073) — 자리 any(나란히 아무 자리) · lower(쌓기 아래) · upper(쌓기 위). 묶음 방식과 맞는 자리만 (지킴이)';

-- 자리와 묶음 방식이 맞아야 한다 — 나란히는 any, 쌓기는 lower · upper
CREATE OR REPLACE FUNCTION public.appliance_combo_members_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $function$
DECLARE
  k TEXT;
BEGIN
  SELECT kind INTO k FROM public.appliance_combos WHERE id = NEW.combo_id;
  IF k = 'side' AND NEW.role <> 'any' THEN
    RAISE EXCEPTION '나란히 묶음의 모델 자리는 any 입니다' USING ERRCODE = '22023';
  END IF;
  IF k = 'stack' AND NEW.role NOT IN ('lower', 'upper') THEN
    RAISE EXCEPTION '쌓기 묶음의 모델 자리는 lower · upper 입니다' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.appliance_combo_members_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS appliance_combo_members_guard ON public.appliance_combo_members;
CREATE TRIGGER appliance_combo_members_guard BEFORE INSERT OR UPDATE ON public.appliance_combo_members
    FOR EACH ROW EXECUTE FUNCTION public.appliance_combo_members_guard();

DROP TRIGGER IF EXISTS update_appliance_combos_updated_at ON public.appliance_combos;
CREATE TRIGGER update_appliance_combos_updated_at BEFORE UPDATE ON public.appliance_combos
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) 읽기 · 쓰기 — appliance_models 와 같다 ----------------------------------------------

ALTER TABLE public.appliance_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appliance_combo_members ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.appliance_combos FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.appliance_combo_members FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.appliance_combos TO anon;
GRANT SELECT ON TABLE public.appliance_combo_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appliance_combos TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appliance_combo_members TO authenticated, service_role;

DROP POLICY IF EXISTS appliance_combos_read_all ON public.appliance_combos;
CREATE POLICY appliance_combos_read_all ON public.appliance_combos FOR SELECT TO PUBLIC USING (true);
DROP POLICY IF EXISTS appliance_combos_admin_insert ON public.appliance_combos;
CREATE POLICY appliance_combos_admin_insert ON public.appliance_combos FOR INSERT TO PUBLIC
    WITH CHECK ((auth.uid() IN ( SELECT admin_roles.user_id FROM public.admin_roles WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));
DROP POLICY IF EXISTS appliance_combos_admin_update ON public.appliance_combos;
CREATE POLICY appliance_combos_admin_update ON public.appliance_combos FOR UPDATE TO PUBLIC
    USING ((auth.uid() IN ( SELECT admin_roles.user_id FROM public.admin_roles WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));
DROP POLICY IF EXISTS appliance_combos_admin_delete ON public.appliance_combos;
CREATE POLICY appliance_combos_admin_delete ON public.appliance_combos FOR DELETE TO PUBLIC
    USING ((auth.uid() IN ( SELECT admin_roles.user_id FROM public.admin_roles WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));

DROP POLICY IF EXISTS appliance_combo_members_read_all ON public.appliance_combo_members;
CREATE POLICY appliance_combo_members_read_all ON public.appliance_combo_members FOR SELECT TO PUBLIC USING (true);
DROP POLICY IF EXISTS appliance_combo_members_admin_insert ON public.appliance_combo_members;
CREATE POLICY appliance_combo_members_admin_insert ON public.appliance_combo_members FOR INSERT TO PUBLIC
    WITH CHECK ((auth.uid() IN ( SELECT admin_roles.user_id FROM public.admin_roles WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));
DROP POLICY IF EXISTS appliance_combo_members_admin_update ON public.appliance_combo_members;
CREATE POLICY appliance_combo_members_admin_update ON public.appliance_combo_members FOR UPDATE TO PUBLIC
    USING ((auth.uid() IN ( SELECT admin_roles.user_id FROM public.admin_roles WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));
DROP POLICY IF EXISTS appliance_combo_members_admin_delete ON public.appliance_combo_members;
CREATE POLICY appliance_combo_members_admin_delete ON public.appliance_combo_members FOR DELETE TO PUBLIC
    USING ((auth.uid() IN ( SELECT admin_roles.user_id FROM public.admin_roles WHERE (admin_roles.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))));

-- 4) 가져오기 — 수집기가 낸 묶음 (service_role 만) -----------------------------------------
--   rows = [{ brand, name, family, kind, line?, gap_mm?, max_units?, kit_name?, kit_code?, source_url?, verified?, notes?,
--             members: [{ code, role? }] }]
--   같은 브랜드 · 같은 이름이면 고치고 모델 목록을 새로 맞춘다. 모델은 같은 브랜드의 모델 코드(model_code · model_codes)로 찾는다.
--   찾은 모델이 모자라면(나란히 1대 미만 · 쌓기는 아래 · 위 하나씩 미만) 그 묶음은 건너뛴다. 못 찾은 코드는 돌려준다.

CREATE OR REPLACE FUNCTION public.import_appliance_combos(rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $function$
DECLARE
  r        JSONB;
  m        JSONB;
  cid      UUID;
  mid      UUID;
  k        TEXT;
  rl       TEXT;
  found    JSONB;
  n_any    INT;
  n_lower  INT;
  n_upper  INT;
  n_ins    INT := 0;
  n_upd    INT := 0;
  n_skip   INT := 0;
  missing  JSONB := '[]'::jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(rows) LOOP
    k := r->>'kind';
    found := '[]'::jsonb;
    n_any := 0; n_lower := 0; n_upper := 0;
    FOR m IN SELECT * FROM jsonb_array_elements(COALESCE(r->'members', '[]'::jsonb)) LOOP
      rl := COALESCE(m->>'role', CASE WHEN k = 'side' THEN 'any' END);
      SELECT id INTO mid FROM appliance_models
       WHERE brand = r->>'brand' AND (model_code = m->>'code' OR (m->>'code') = ANY(model_codes))
       ORDER BY verified DESC, updated_at DESC LIMIT 1;
      IF mid IS NULL THEN
        IF jsonb_array_length(missing) < 200 THEN
          missing := missing || jsonb_build_array(jsonb_build_object('combo', r->>'name', 'code', m->>'code'));
        END IF;
        CONTINUE;
      END IF;
      found := found || jsonb_build_array(jsonb_build_object('model_id', mid, 'role', rl));
      IF rl = 'any' THEN n_any := n_any + 1; ELSIF rl = 'lower' THEN n_lower := n_lower + 1; ELSIF rl = 'upper' THEN n_upper := n_upper + 1; END IF;
    END LOOP;
    IF (k = 'side' AND n_any < 1) OR (k = 'stack' AND (n_lower < 1 OR n_upper < 1)) OR k IS NULL OR k NOT IN ('side', 'stack') THEN
      n_skip := n_skip + 1;
      CONTINUE;
    END IF;

    SELECT id INTO cid FROM appliance_combos WHERE brand = r->>'brand' AND lower(btrim(name)) = lower(btrim(r->>'name'));
    IF cid IS NULL THEN
      INSERT INTO appliance_combos (brand, name, family, kind, line, gap_mm, max_units, kit_name, kit_code, source_url, verified, notes, collected_at)
      VALUES (r->>'brand', btrim(r->>'name'), r->>'family', k, r->>'line', NULLIF(r->>'gap_mm', '')::INT,
              COALESCE(NULLIF(r->>'max_units', '')::SMALLINT, 2), r->>'kit_name', r->>'kit_code', r->>'source_url',
              COALESCE((r->>'verified')::BOOLEAN, false), r->>'notes', NOW())
      RETURNING id INTO cid;
      n_ins := n_ins + 1;
    ELSE
      UPDATE appliance_combos SET
        family = r->>'family', kind = k, line = COALESCE(r->>'line', line), gap_mm = COALESCE(NULLIF(r->>'gap_mm', '')::INT, gap_mm),
        max_units = COALESCE(NULLIF(r->>'max_units', '')::SMALLINT, max_units), kit_name = COALESCE(r->>'kit_name', kit_name),
        kit_code = COALESCE(r->>'kit_code', kit_code), source_url = COALESCE(r->>'source_url', source_url),
        verified = COALESCE((r->>'verified')::BOOLEAN, verified), notes = COALESCE(r->>'notes', notes), collected_at = NOW()
      WHERE id = cid;
      DELETE FROM appliance_combo_members WHERE combo_id = cid;
      n_upd := n_upd + 1;
    END IF;
    INSERT INTO appliance_combo_members (combo_id, model_id, role)
    SELECT cid, (x->>'model_id')::UUID, x->>'role' FROM jsonb_array_elements(found) x
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'skipped', n_skip, 'missing', missing);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_appliance_combos(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_appliance_combos(jsonb) TO service_role;
COMMENT ON FUNCTION public.import_appliance_combos(jsonb) IS '가전 조합 묶음 가져오기 (0073) — 수집기 SQL. 같은 브랜드 · 이름이면 고치고 모델 목록을 다시 맞춘다';
