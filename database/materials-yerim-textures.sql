-- =============================================
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

UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-01.jpg', color_hex = '#ffffff', tile_mm = 300 WHERE code = 'YR-YPA-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-02.jpg', color_hex = '#f5eee7', tile_mm = 300 WHERE code = 'YR-YPA-02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-03.jpg', color_hex = '#cdc2b4', tile_mm = 300 WHERE code = 'YR-YPA-03';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-04.jpg', color_hex = '#a69d96', tile_mm = 300 WHERE code = 'YR-YPA-04';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-05.jpg', color_hex = '#c6c8c9', tile_mm = 300 WHERE code = 'YR-YPA-05';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-06.jpg', color_hex = '#5a687f', tile_mm = 300 WHERE code = 'YR-YPA-06';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-07.jpg', color_hex = '#2a293a', tile_mm = 300 WHERE code = 'YR-YPA-07';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-08.jpg', color_hex = '#65676e', tile_mm = 300 WHERE code = 'YR-YPA-08';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-09.jpg', color_hex = '#d4612a', tile_mm = 300 WHERE code = 'YR-YPA-09';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPA-10.jpg', color_hex = '#2a422e', tile_mm = 300 WHERE code = 'YR-YPA-10';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPG-01.jpg', color_hex = '#f8f6f3', tile_mm = 300 WHERE code = 'YR-YPG-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPG-02.jpg', color_hex = '#ebe9e8', tile_mm = 300 WHERE code = 'YR-YPG-02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-AM-50.jpg', color_hex = '#808081', tile_mm = 300 WHERE code = 'YR-AM-50';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-401.jpg', color_hex = '#707275', tile_mm = 300 WHERE code = 'YR-LP-401';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-402.jpg', color_hex = '#191c33', tile_mm = 300 WHERE code = 'YR-LP-402';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-500.jpg', color_hex = '#f5f4f4', tile_mm = 300 WHERE code = 'YR-LP-500';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-501.jpg', color_hex = '#919096', tile_mm = 300 WHERE code = 'YR-LP-501';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PE-01.jpg', color_hex = '#e2e0d9', tile_mm = 300 WHERE code = 'YR-PE-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PE-02.jpg', color_hex = '#bbb4b0', tile_mm = 300 WHERE code = 'YR-PE-02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PM-60.jpg', color_hex = '#b8bbbd', tile_mm = 300 WHERE code = 'YR-PM-60';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PM-61.jpg', color_hex = '#7d6d64', tile_mm = 300 WHERE code = 'YR-PM-61';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PM-62.jpg', color_hex = '#6e635f', tile_mm = 300 WHERE code = 'YR-PM-62';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PM-63.jpg', color_hex = '#422e21', tile_mm = 300 WHERE code = 'YR-PM-63';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPW-01.jpg', color_hex = '#9c7b5b', tile_mm = 600 WHERE code = 'YR-YPW-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPW-02.jpg', color_hex = '#433027', tile_mm = 600 WHERE code = 'YR-YPW-02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPW-03.jpg', color_hex = '#40352f', tile_mm = 600 WHERE code = 'YR-YPW-03';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPW-04.jpg', color_hex = '#cea875', tile_mm = 600 WHERE code = 'YR-YPW-04';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-YPW-05.jpg', color_hex = '#dabe98', tile_mm = 600 WHERE code = 'YR-YPW-05';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-U1802.jpg', color_hex = '#5a5658', tile_mm = 300 WHERE code = 'YR-U1802';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-01.jpg', color_hex = '#fbfbfb', tile_mm = 300 WHERE code = 'YR-SG-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-02.jpg', color_hex = '#fffef8', tile_mm = 300 WHERE code = 'YR-SG-02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-03.jpg', color_hex = '#e3e1d6', tile_mm = 300 WHERE code = 'YR-SG-03';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-04.jpg', color_hex = '#c2b9b2', tile_mm = 300 WHERE code = 'YR-SG-04';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-06.jpg', color_hex = '#949397', tile_mm = 300 WHERE code = 'YR-SG-06';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-100.jpg', color_hex = '#f9f9f9', tile_mm = 300 WHERE code = 'YR-SG-100';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-11.jpg', color_hex = '#3e4b5d', tile_mm = 300 WHERE code = 'YR-SG-11';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-14.jpg', color_hex = '#b7cad2', tile_mm = 300 WHERE code = 'YR-SG-14';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-16.jpg', color_hex = '#f5eddc', tile_mm = 300 WHERE code = 'YR-SG-16';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-20.jpg', color_hex = '#bababa', tile_mm = 300 WHERE code = 'YR-SG-20';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-200.jpg', color_hex = '#434343', tile_mm = 300 WHERE code = 'YR-SG-200';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-21.jpg', color_hex = '#d4cfc8', tile_mm = 300 WHERE code = 'YR-SG-21';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-22.jpg', color_hex = '#474f44', tile_mm = 300 WHERE code = 'YR-SG-22';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SG-300.jpg', color_hex = '#212121', tile_mm = 300 WHERE code = 'YR-SG-300';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-01.jpg', color_hex = '#fbfbfb', tile_mm = 300 WHERE code = 'YR-SM-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-02.jpg', color_hex = '#fffef8', tile_mm = 300 WHERE code = 'YR-SM-02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-03.jpg', color_hex = '#e3e1d6', tile_mm = 300 WHERE code = 'YR-SM-03';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-04.jpg', color_hex = '#b7afa1', tile_mm = 300 WHERE code = 'YR-SM-04';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-05.jpg', color_hex = '#6d5d51', tile_mm = 300 WHERE code = 'YR-SM-05';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-06.jpg', color_hex = '#989494', tile_mm = 300 WHERE code = 'YR-SM-06';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-07.jpg', color_hex = '#3b3835', tile_mm = 300 WHERE code = 'YR-SM-07';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-08.jpg', color_hex = '#272727', tile_mm = 300 WHERE code = 'YR-SM-08';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-10.jpg', color_hex = '#2f4952', tile_mm = 300 WHERE code = 'YR-SM-10';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-100.jpg', color_hex = '#f9f9f9', tile_mm = 300 WHERE code = 'YR-SM-100';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-11.jpg', color_hex = '#3e4b5d', tile_mm = 300 WHERE code = 'YR-SM-11';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-12.jpg', color_hex = '#2e2f3f', tile_mm = 300 WHERE code = 'YR-SM-12';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-14.jpg', color_hex = '#b7cad2', tile_mm = 300 WHERE code = 'YR-SM-14';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-15.jpg', color_hex = '#a5afa0', tile_mm = 300 WHERE code = 'YR-SM-15';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-16.jpg', color_hex = '#f5eddc', tile_mm = 300 WHERE code = 'YR-SM-16';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-19.jpg', color_hex = '#f3e9de', tile_mm = 300 WHERE code = 'YR-SM-19';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-20.jpg', color_hex = '#bababa', tile_mm = 300 WHERE code = 'YR-SM-20';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-200.jpg', color_hex = '#434343', tile_mm = 300 WHERE code = 'YR-SM-200';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-21.jpg', color_hex = '#d4cfc8', tile_mm = 300 WHERE code = 'YR-SM-21';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-22.jpg', color_hex = '#474f44', tile_mm = 300 WHERE code = 'YR-SM-22';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-28.jpg', color_hex = '#e7e5d8', tile_mm = 300 WHERE code = 'YR-SM-28';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-29.jpg', color_hex = '#efe6df', tile_mm = 300 WHERE code = 'YR-SM-29';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-30.jpg', color_hex = '#f0eee5', tile_mm = 300 WHERE code = 'YR-SM-30';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-300.jpg', color_hex = '#212121', tile_mm = 300 WHERE code = 'YR-SM-300';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-31.jpg', color_hex = '#c0bbb3', tile_mm = 300 WHERE code = 'YR-SM-31';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-32.jpg', color_hex = '#e4d9ad', tile_mm = 300 WHERE code = 'YR-SM-32';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-33.jpg', color_hex = '#cca47c', tile_mm = 300 WHERE code = 'YR-SM-33';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-34.jpg', color_hex = '#abc5e2', tile_mm = 300 WHERE code = 'YR-SM-34';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-SM-35.jpg', color_hex = '#6e4639', tile_mm = 300 WHERE code = 'YR-SM-35';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-CP-01.jpg', color_hex = '#e2e0d4', tile_mm = 600 WHERE code = 'YR-CP-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-CP-02.jpg', color_hex = '#959387', tile_mm = 600 WHERE code = 'YR-CP-02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-CP-03.jpg', color_hex = '#45423d', tile_mm = 600 WHERE code = 'YR-CP-03';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-CP-04.jpg', color_hex = '#77462d', tile_mm = 600 WHERE code = 'YR-CP-04';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LC-010.jpg', color_hex = '#d6cfc9', tile_mm = 600 WHERE code = 'YR-LC-010';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LC-011.jpg', color_hex = '#c6c2c2', tile_mm = 600 WHERE code = 'YR-LC-011';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PL-10.jpg', color_hex = '#d7cec0', tile_mm = 600 WHERE code = 'YR-PL-10';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PL-11.jpg', color_hex = '#5e4a3f', tile_mm = 600 WHERE code = 'YR-PL-11';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PW-20.jpg', color_hex = '#d8c8ba', tile_mm = 600 WHERE code = 'YR-PW-20';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PW-21.jpg', color_hex = '#bca580', tile_mm = 600 WHERE code = 'YR-PW-21';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PW-22.jpg', color_hex = '#9a8464', tile_mm = 600 WHERE code = 'YR-PW-22';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PW-23.jpg', color_hex = '#544135', tile_mm = 600 WHERE code = 'YR-PW-23';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-PW-24.jpg', color_hex = '#8f7755', tile_mm = 600 WHERE code = 'YR-PW-24';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HC801.jpg', color_hex = '#f4f1ee', tile_mm = 600 WHERE code = 'YR-HC801';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HC802.jpg', color_hex = '#bdb7b5', tile_mm = 600 WHERE code = 'YR-HC802';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HP521.jpg', color_hex = '#f1f1f1', tile_mm = 600 WHERE code = 'YR-HP521';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HP522.jpg', color_hex = '#e9e8e2', tile_mm = 600 WHERE code = 'YR-HP522';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HS004.jpg', color_hex = '#fdfbee', tile_mm = 600 WHERE code = 'YR-HS004';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HS046.jpg', color_hex = '#f4f4f2', tile_mm = 600 WHERE code = 'YR-HS046';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HW1019.jpg', color_hex = '#a58d69', tile_mm = 600 WHERE code = 'YR-HW1019';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HW1064.jpg', color_hex = '#604b39', tile_mm = 600 WHERE code = 'YR-HW1064';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HW1065.jpg', color_hex = '#423127', tile_mm = 600 WHERE code = 'YR-HW1065';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HW1069.jpg', color_hex = '#f1ebdd', tile_mm = 600 WHERE code = 'YR-HW1069';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HW1077.jpg', color_hex = '#8d7354', tile_mm = 600 WHERE code = 'YR-HW1077';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-HW1081.jpg', color_hex = '#a4917b', tile_mm = 600 WHERE code = 'YR-HW1081';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-100.jpg', color_hex = '#fffdfa', tile_mm = 600 WHERE code = 'YR-MFB-100';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-200.jpg', color_hex = '#fcfeff', tile_mm = 600 WHERE code = 'YR-MFB-200';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-302.jpg', color_hex = '#eacca4', tile_mm = 600 WHERE code = 'YR-MFB-302';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-303.jpg', color_hex = '#a56c43', tile_mm = 600 WHERE code = 'YR-MFB-303';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-304.jpg', color_hex = '#504029', tile_mm = 600 WHERE code = 'YR-MFB-304';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-400.jpg', color_hex = '#dfdfdf', tile_mm = 600 WHERE code = 'YR-MFB-400';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-401.jpg', color_hex = '#a6a4a2', tile_mm = 600 WHERE code = 'YR-MFB-401';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-402.jpg', color_hex = '#4d4c4c', tile_mm = 600 WHERE code = 'YR-MFB-402';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-500.jpg', color_hex = '#383434', tile_mm = 600 WHERE code = 'YR-MFB-500';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-501.jpg', color_hex = '#ededeb', tile_mm = 600 WHERE code = 'YR-MFB-501';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-502.jpg', color_hex = '#ddded8', tile_mm = 600 WHERE code = 'YR-MFB-502';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-503.jpg', color_hex = '#e1d9d1', tile_mm = 600 WHERE code = 'YR-MFB-503';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-504.jpg', color_hex = '#cab8a9', tile_mm = 600 WHERE code = 'YR-MFB-504';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-MFB-505.jpg', color_hex = '#907760', tile_mm = 600 WHERE code = 'YR-MFB-505';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-100.jpg', color_hex = '#f8f6f4', tile_mm = 300 WHERE code = 'YR-LP-100';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-101.jpg', color_hex = '#d2d2c8', tile_mm = 300 WHERE code = 'YR-LP-101';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-200.jpg', color_hex = '#faf7f4', tile_mm = 300 WHERE code = 'YR-LP-200';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LP-201.jpg', color_hex = '#584f4c', tile_mm = 300 WHERE code = 'YR-LP-201';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LS-001.jpg', color_hex = '#fcfcfa', tile_mm = 300 WHERE code = 'YR-LS-001';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-LS-002.jpg', color_hex = '#d3d3c9', tile_mm = 300 WHERE code = 'YR-LS-002';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-F200.jpg', color_hex = '#fcfeff', tile_mm = 600 WHERE code = 'YR-F200';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-F303.jpg', color_hex = '#735845', tile_mm = 600 WHERE code = 'YR-F303';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-P01.jpg', color_hex = '#cdc4b5', tile_mm = 600 WHERE code = 'YR-P01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-P02.jpg', color_hex = '#c8bbaa', tile_mm = 600 WHERE code = 'YR-P02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-S100.jpg', color_hex = '#fffef8', tile_mm = 600 WHERE code = 'YR-S100';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-S200.jpg', color_hex = '#ebe5e3', tile_mm = 600 WHERE code = 'YR-S200';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-S204.jpg', color_hex = '#d3cac3', tile_mm = 600 WHERE code = 'YR-S204';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-S208.jpg', color_hex = '#5b5555', tile_mm = 600 WHERE code = 'YR-S208';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-S213.jpg', color_hex = '#f9f8f0', tile_mm = 600 WHERE code = 'YR-S213';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-S250.jpg', color_hex = '#b4a997', tile_mm = 600 WHERE code = 'YR-S250';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-S815.jpg', color_hex = '#d7d0c4', tile_mm = 600 WHERE code = 'YR-S815';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-W01.jpg', color_hex = '#e0dccb', tile_mm = 600 WHERE code = 'YR-W01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-W02.jpg', color_hex = '#bfa884', tile_mm = 600 WHERE code = 'YR-W02';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-W03.jpg', color_hex = '#413126', tile_mm = 600 WHERE code = 'YR-W03';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-100.jpg', color_hex = '#e3dfdb', tile_mm = 600 WHERE code = 'YR-BP-100';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-101.jpg', color_hex = '#ddd7c9', tile_mm = 600 WHERE code = 'YR-BP-101';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-21.jpg', color_hex = '#ccc6ba', tile_mm = 600 WHERE code = 'YR-BP-21';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-70.jpg', color_hex = '#958f8a', tile_mm = 600 WHERE code = 'YR-BP-70';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-91.jpg', color_hex = '#e8e8e8', tile_mm = 600 WHERE code = 'YR-BP-91';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-92.jpg', color_hex = '#ebe4dc', tile_mm = 600 WHERE code = 'YR-BP-92';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-93.jpg', color_hex = '#c8caca', tile_mm = 600 WHERE code = 'YR-BP-93';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-95.jpg', color_hex = '#e5dfdd', tile_mm = 600 WHERE code = 'YR-BP-95';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BP-96.jpg', color_hex = '#a0a0a0', tile_mm = 600 WHERE code = 'YR-BP-96';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BS-01.jpg', color_hex = '#fbf7f9', tile_mm = 600 WHERE code = 'YR-BS-01';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BS-100.jpg', color_hex = '#fefdf5', tile_mm = 600 WHERE code = 'YR-BS-100';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BS-11.jpg', color_hex = '#cec9c1', tile_mm = 600 WHERE code = 'YR-BS-11';
UPDATE materials SET texture_url = 'assets/materials/yerim/YR-BS-200.jpg', color_hex = '#bdb4a9', tile_mm = 600 WHERE code = 'YR-BS-200';

-- 확인용 (선택):
--   SELECT count(*) FROM materials WHERE vendor = 'yerim' AND texture_url IS NOT NULL;  -- 144 이어야 한다
--   SELECT code, color_hex, tile_mm, texture_url FROM materials WHERE vendor = 'yerim' ORDER BY sort LIMIT 10;
