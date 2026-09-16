#!/usr/bin/env node
// ============================================================
// database/seed/yerim-lux.json → SQL 두 장을 만든다.
//
//   database/materials-yerim-lux-seed.sql     처음 넣는 DB 용 시드 (INSERT … WHERE NOT EXISTS)
//   database/materials-yerim-textures.sql     **이미 시드를 넣은 DB** 용 갱신 (UPDATE … WHERE code = …)
//
// 시드는 코드가 이미 있으면 건드리지 않는(더하기만) 계약이라, 이미 시드를 돌린 DB 에는
// 새 texture_url·color_hex·tile_mm 이 닿지 않는다. 그래서 UPDATE 파일이 따로 있다.
//
// 쓰는 법: node scripts/build-yerim-sql.mjs
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_PATH = path.join(ROOT, 'database/seed/yerim-lux.json');
const SEED_SQL = path.join(ROOT, 'database/materials-yerim-lux-seed.sql');
const TEX_SQL = path.join(ROOT, 'database/materials-yerim-textures.sql');

/** SQL 문자열 리터럴 — 작은따옴표만 두 번으로. (지금 데이터에는 없지만 계약으로 둔다) */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** 빈 값은 SQL NULL 로 (예림 제품코드가 없는 한 건 — 글로시 다크그레이). */
const qn = (s) => (s === null || s === undefined || s === '' ? 'NULL' : q(s));
const num = (n) => String(n);
const arr = (a) => `ARRAY[${a.map(q).join(',')}]::TEXT[]`;

const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
const items = seed.items;

// ── 시드 (INSERT) ─────────────────────────────────────────────

const seedHeader = `-- =============================================
-- 예림보드 럭스(LUX) 가구재 카탈로그 시드 — materials 표 (vendor = 'yerim')
--
-- 출처: https://www.yerim.net/kor/products/kitchen_new.html (2026-09-15 수집, database/seed/yerim-lux.json)
--   도어재 Prestige(Acryl·PP·PET·Glass) · Supreme(PP·PET Matt·PET Glossy) · Deco(PVC) · Prime(MFB·UV) = 117
--   바디재 PVC·MFC = 27  → 합계 144
--
-- 코드 체계: code = 'YR-' + 예림 제품코드 (예 YR-SM-01 = Supreme PET Matt 매트 화이트). vendor_code 에 원 코드.
--   기존 PET-OAK-M 체계(materials-catalog-v2.sql)와 접두사가 달라 충돌하지 않는다 (I6: 더하기만).
-- category: 'door_material'(slot door·drawer_front) / 'body_material'(slot body — 새 값).
-- color_hex: 잘라낸 스와치 타일 전체의 **선형광 평균색** (2026-09-16 재계산, scripts/fetch-yerim-textures.mjs).
--   텍스처가 있으므로 이 값은 텍스처를 못 읽었을 때의 대체색이다. 결(grain)은 이름으로 추정 [확인 필요].
-- tone: PET Matt/Glossy·이름의 유광/무광·Acryl(무광)·Glass(유광)만 확정, 나머지는 무광 기본 (2026-09-15 결정).
-- texture_url: 저장소 안의 512px 타일 assets/materials/yerim/<code>.jpg — 예림 스와치 사진에서 흰 테두리를
--   잘라내 만든다 (scripts/fetch-yerim-textures.mjs). 플래너 페이지와 같은 출처라 CORS 가 없다.
--   tile_mm 은 그 타일이 실제 가구 면에서 덮는 크기 — 우드 계열(PP·PVC·MFB·MFC) 600, 무지 300.
--   image_url 은 여전히 예림 원본 링크(참고용)다.
--
-- 적용: materials-catalog-v2.sql 을 먼저 실행한 뒤 Supabase SQL Editor 에서 이 파일 전체 실행.
--   - ALTER 는 전부 ADD COLUMN IF NOT EXISTS
--   - INSERT 는 전부 WHERE NOT EXISTS (code) 로 보호 — 두 번 실행해도 안전
--   - 파괴 문장 없음
--   ⚠ 이 파일은 code 가 이미 있으면 **아무것도 하지 않는다**. 2026-09-15 시드를 이미 넣은 DB 에
--     새 color_hex·texture_url·tile_mm 을 반영하려면 database/materials-yerim-textures.sql 을 실행한다.
--
-- 이 파일은 scripts/build-yerim-sql.mjs 가 database/seed/yerim-lux.json 에서 만든다 — 직접 고치지 말 것.
-- =============================================

ALTER TABLE materials ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS series TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS texture_url TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS tile_mm INT;
COMMENT ON COLUMN materials.vendor IS '자재 공급사 식별자 (예: yerim)';
COMMENT ON COLUMN materials.series IS '공급사 라인업 (예: Prestige / Supreme / Deco / Prime / Body)';
COMMENT ON COLUMN materials.source_url IS '공급사 제품 페이지';
COMMENT ON COLUMN materials.image_url IS '공급사 스와치 이미지(외부 링크, 참고용)';

INSERT INTO materials
  (category, slot, applicable_to, is_active, active, vendor,
   code, finish_code, color_code, vendor_code, tone, color_name, color_hex, finish,
   texture_prompt,
   roughness, metalness, clearcoat, grain, series, source_url, image_url, texture_url, tile_mm, sort, sort_order)
SELECT
  v.category, v.slot, ARRAY['sink','wardrobe','fridge']::TEXT[], TRUE, TRUE, 'yerim',
  v.code, v.finish_code, v.color_code, v.vendor_code, v.tone, v.color_name, v.color_hex, v.finish,
  v.texture_prompt,
  v.roughness, v.metalness, v.clearcoat, v.grain, v.series, v.source_url, v.image_url, v.texture_url, v.tile_mm, v.sort, v.sort
FROM (VALUES
`;

const seedRows = items.map((i) => (
  `  (${q(i.category)}, ${arr(i.slot)}, ${q(i.code)}, ${qn(i.finish_code)}, ${qn(i.color_code)}, `
  + `${qn(i.vendor_code)}, ${q(i.tone)}, ${q(i.color_name)}, ${q(i.color_hex)}, ${q(i.finish)},\n`
  + `   ${q(i.texture_prompt)},\n`
  + `   ${num(i.roughness)}, ${num(i.metalness)}, ${num(i.clearcoat)}, ${q(i.grain)}, ${q(i.series)}, `
  + `${q(i.source_url)}, ${q(i.image_url)}, ${q(i.texture_url)}, ${num(i.tile_mm)}, ${num(i.sort)})`
)).join(',\n');

const seedFooter = `
) AS v(category, slot, code, finish_code, color_code, vendor_code, tone, color_name, color_hex, finish,
       texture_prompt, roughness, metalness, clearcoat, grain, series, source_url, image_url, texture_url, tile_mm, sort)
WHERE NOT EXISTS (SELECT 1 FROM materials m WHERE m.code = v.code);
`;

// ── 갱신 (UPDATE) ─────────────────────────────────────────────

const texHeader = `-- =============================================
-- 예림 LUX 자재 — 무늬 텍스처·보정된 대체색 반영 (이미 시드를 넣은 DB 용)
--
-- ⚠ 왜 이 파일이 따로 있는가: database/materials-yerim-lux-seed.sql 의 INSERT 는
--   WHERE NOT EXISTS (code) 로 보호되어 있다 (I6: 카탈로그는 더하기만). 그래서 2026-09-15 에
--   시드를 이미 실행한 DB 에서는 시드를 다시 돌려도 **기존 144행을 건드리지 않는다**.
--   texture_url · color_hex · tile_mm 을 그 DB 에 닿게 하는 길은 이 UPDATE 파일뿐이다.
--
-- 담는 것 (모두 database/seed/yerim-lux.json 이 정본):
--   texture_url  저장소 안의 512px 타일 assets/materials/yerim/<code>.jpg
--                예림 스와치 사진에서 흰 테두리를 잘라 만든 것 (scripts/fetch-yerim-textures.mjs).
--                플래너 페이지와 같은 출처(GitHub Pages)라 CORS 도 Storage 자격증명도 필요 없다.
--   color_hex    잘라낸 타일 전체의 **선형광(linear-light) 평균색**. 처음 시드는 sRGB 값을 그대로
--                평균해 어두운 쪽으로 치우쳤다. 이제는 텍스처를 못 읽었을 때의 **대체색**이다.
--   tile_mm      타일 한 장이 실제 가구 면에서 덮는 크기 — 우드 계열(PP·PVC·MFB·MFC) 600mm, 무지 300mm.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행. 그 다음 GitHub Pages 배포가 끝나야
--   /assets/materials/yerim/*.jpg 가 실제로 보인다 (Cloudflare 캐시 퍼지 필요할 수 있음).
--
-- 안전:
--   - ALTER 는 ADD COLUMN IF NOT EXISTS, UPDATE 는 code 한 건씩 — 몇 번 실행해도 결과가 같다 (멱등)
--   - DROP · DELETE · TRUNCATE 없음. 다른 vendor 의 행은 건드리지 않는다.
--   - 되돌리기: UPDATE materials SET texture_url = NULL WHERE vendor = 'yerim'; 그리고 폴더를 지우면 끝.
--
-- 이 파일은 scripts/build-yerim-sql.mjs 가 database/seed/yerim-lux.json 에서 만든다 — 직접 고치지 말 것.
-- =============================================

ALTER TABLE materials ADD COLUMN IF NOT EXISTS texture_url TEXT;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS tile_mm INT;
COMMENT ON COLUMN materials.texture_url IS '자재 무늬 타일(저장소 상대경로 assets/materials/yerim/<code>.jpg)';
COMMENT ON COLUMN materials.tile_mm IS '텍스처 타일 한 장이 덮는 실제 크기(mm)';

`;

const texRows = items.map((i) => (
  `UPDATE materials SET texture_url = ${q(i.texture_url)}, color_hex = ${q(i.color_hex)}, `
  + `tile_mm = ${num(i.tile_mm)} WHERE code = ${q(i.code)};`
)).join('\n');

const texFooter = `

-- 확인용 (선택):
--   SELECT count(*) FROM materials WHERE vendor = 'yerim' AND texture_url IS NOT NULL;  -- 144 이어야 한다
--   SELECT code, color_hex, tile_mm, texture_url FROM materials WHERE vendor = 'yerim' ORDER BY sort LIMIT 10;
`;

// ── 쓰기 (원본과 같은 CRLF) ────────────────────────────────────

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

fs.writeFileSync(SEED_SQL, crlf(seedHeader + seedRows + seedFooter), 'utf8');
fs.writeFileSync(TEX_SQL, crlf(texHeader + texRows + texFooter), 'utf8');

process.stdout.write(`${path.relative(ROOT, SEED_SQL)} · ${path.relative(ROOT, TEX_SQL)} — ${items.length}행\n`);
