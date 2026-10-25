-- ============================================================
-- 설계 유전체 연구 — 가명화 내보내기 (사장님이 Supabase SQL Editor 에서 실행)
--
-- 플래너 구조 단계 스냅샷만 꺼낸다. 이름·제목·주소·전화가 든 칸(designs.name/title, profiles …)은 고르지 않는다.
--   u    = sha256(소금 ‖ designs.user_id)     계정 구분만 남는다
--   d    = sha256(소금 ‖ designs.id)          설계 구분만 남는다
--   item = sha256(소금 ‖ item_unique_id)
--   payload = 플래너 localStorage 값 그대로 ({modules, structures} — 치수·구조 선택값뿐)
--   completed = 시공 완료 주문이 있는가 (고신뢰 표본 가중치)
--
-- 실행 전: 아래 'REPLACE_WITH_RANDOM_SALT' 를 아무도 모르는 긴 임의 문자열로 바꾼다. 소금은 어디에도 적지 않는다.
-- 결과: JSON 으로 내려받아 C:\Users\hchan\dadam-research\genome\export.json 에 둔다 (어떤 git 저장소에도 넣지 않는다).
-- pgcrypto 의 digest 가 search_path 에 없으면 extensions.digest 로 바꿔 쓴다.
-- ============================================================
with salt as (select 'REPLACE_WITH_RANDOM_SALT'::text as s)
select
  encode(digest((select s from salt) || d.user_id::text, 'sha256'), 'hex')          as u,
  encode(digest((select s from salt) || d.id::text, 'sha256'), 'hex')               as d,
  encode(digest((select s from salt) || ps.item_unique_id::text, 'sha256'), 'hex')  as item,
  ps.stage,
  ps.is_autosave,
  ps.updated_at,
  ps.payload,
  exists (
    select 1 from orders o where o.design_id = d.id and o.status = 'completed'
  ) as completed
from planner_snapshots ps
join designs d on d.id = ps.design_id
where ps.stage = 'structure'
order by u, ps.updated_at;
