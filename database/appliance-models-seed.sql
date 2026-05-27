-- ============================================================================
-- W9-44: 가전 모델 seed — 현재 mockup-shell.html 의 8 종 냉장고
-- 추후 후드/식세기/분배기 모델도 같은 테이블에 추가
-- ============================================================================

INSERT INTO appliance_models (category, brand, model_name, model_code, width_mm, depth_mm, height_mm, capacity_l, verified, source_url, notes)
VALUES
  -- ✓ 검증 (제조사 공식 사양)
  ('refrigerator', '삼성', 'BESPOKE 4도어 905L (쇼케이스)',          'RM70F90M2',  912, 922, 1853, 905, true,  'https://www.samsung.com/sec/refrigerators/', '후면 핸들 포함 922mm / 미포함 908mm'),
  ('refrigerator', '삼성', 'BESPOKE 4도어 905L (1등급)',              'RM70F90R1',  912, 922, 1830, 905, true,  'https://www.samsung.com/sec/refrigerators/', '1등급 효율'),
  ('refrigerator', '삼성', 'BESPOKE 4도어 키친핏 Max 633L',           'RM70F64',    912, 697, 1853, 633, true,  'https://www.samsung.com/sec/refrigerators/', '키친핏 (D 700mm 빌트인 호환)'),
  ('refrigerator', '삼성', 'BESPOKE AI 4도어 키친핏 Max 640L',        'RM70F63R2A', 912, 697, 1853, 640, true,  'https://www.samsung.com/sec/refrigerators/french-door-rm70f63r2a-d2c/RM70F63R2A/', 'AI 하이브리드 쿨링'),
  ('refrigerator', 'LG',   '오브제컬렉션 양문형 870L',                  'T875MEE111', 914, 918, 1787, 870, true,  'https://www.lge.co.kr/object-collection', 'Magic Space 홈바'),

  -- ⚠ 표준 추정 (카테고리 일반 치수, 공식 확인 권장)
  ('refrigerator', '삼성', 'BESPOKE 1도어 키친핏 380L',                'RR39A7695AP', 595, 700, 1853, 380, false, 'https://www.samsung.com/sec/refrigerators/one-door-rr39a7695ap-d2c/RR39A7695AP/', '좌열림/우열림 가변'),
  ('refrigerator', '삼성', 'BESPOKE 1도어 키친핏 409L',                'RR40C7805AP', 595, 700, 1853, 409, false, 'https://www.samsung.com/sec/refrigerators/one-door-rr40c7805ap-d2c/RR40C7805AP/', '우열림 냉장 전용'),
  ('refrigerator', 'LG',   'DIOS 빌트인 양문형 (홈바)',                  'S715SI24B',  910, 738, 1790, NULL, false, 'https://www.lge.co.kr/kr/business/product/builtin/cooling-list/lg-S715SI24B', 'B2B 빌트인')
ON CONFLICT DO NOTHING;
