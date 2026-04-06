-- =============================================
-- 협력업체 시드 데이터 (가상 업체)
-- 인테리어 5곳 + 제조공장 5곳
-- =============================================

INSERT INTO partners (company_name, description, partner_type, sido, gugun, address, lat, lng, specialty_categories, specialty_styles, specialty_text, phone, email, kakao_id, established_year, employee_count, rating, review_count, completed_projects, is_active, is_verified, portfolio_images) VALUES

-- ========== 인테리어 협력업체 ==========

('리빙하우스', '아파트 리모델링 전문 인테리어', 'interior',
 '서울특별시', '강남구', '서울 강남구 역삼로 123',
 37.4979, 127.0276,
 ARRAY['sink','wardrobe','fridge','vanity'], ARRAY['modern-minimal','scandinavian'],
 '아파트 전체 리모델링, 주방·수납 특화',
 '02-1234-5678', 'info@livinghouse.kr', 'livinghouse_kr',
 2018, '6-20', 4.5, 28, 156, true, true,
 '[]'::jsonb),

('공간제작소', '주거 인테리어 맞춤 시공', 'interior',
 '서울특별시', '마포구', '서울 마포구 월드컵북로 45',
 37.5572, 126.9068,
 ARRAY['sink','wardrobe','storage'], ARRAY['scandinavian','natural'],
 '빌라·주택 인테리어, 수납 공간 최적화',
 '02-2345-6789', 'hello@gongan.kr', 'gongan_studio',
 2020, '6-20', 4.3, 19, 87, true, true,
 '[]'::jsonb),

('어반스튜디오', '모던 인테리어 디자인 시공', 'interior',
 '경기도', '성남시 분당구', '경기 성남시 분당구 판교로 200',
 37.3947, 127.1112,
 ARRAY['sink','fridge','wardrobe','vanity'], ARRAY['modern-minimal','classic-luxury'],
 '프리미엄 주거 인테리어, 주방 특화',
 '031-345-6789', 'urban@urbanstudio.kr', 'urban_studio',
 2016, '21-50', 4.7, 42, 230, true, true,
 '[]'::jsonb),

('홈앤리빙', '빌라·다세대 전문 인테리어', 'interior',
 '부산광역시', '해운대구', '부산 해운대구 센텀중앙로 55',
 35.1696, 129.1314,
 ARRAY['sink','wardrobe','shoe','storage'], ARRAY['modern-minimal','natural'],
 '부산 지역 빌라 리모델링 전문',
 '051-456-7890', 'home@homeliving.kr', 'home_living_bs',
 2019, '6-20', 4.2, 15, 64, true, false,
 '[]'::jsonb),

('플레이스웍스', '상업·주거 겸용 인테리어', 'interior',
 '인천광역시', '연수구', '인천 연수구 컨벤시아대로 100',
 37.3813, 126.6570,
 ARRAY['sink','fridge','storage'], ARRAY['modern-minimal','scandinavian','natural'],
 '인천 지역 주거·상업 인테리어',
 '032-567-8901', 'info@placeworks.kr', 'placeworks_kr',
 2021, '1-5', 4.0, 8, 32, true, false,
 '[]'::jsonb),

-- ========== 제조공장 ==========

('우드보드', '가구용 보드 전문 제조', 'factory',
 '경기도', '김포시', '경기 김포시 양촌읍 산업단지로 88',
 37.6154, 126.7155,
 ARRAY['sink','wardrobe','fridge','vanity','shoe','storage'], ARRAY['modern-minimal','scandinavian','natural','classic-luxury'],
 'PB·MDF 보드 재단, CNC 가공',
 '031-678-9012', 'wood@woodboard.kr', 'woodboard_factory',
 2010, '21-50', 4.6, 35, 520, true, true,
 '[]'::jsonb),

('정밀재단', 'CNC 정밀 가공 전문', 'factory',
 '경기도', '화성시', '경기 화성시 동탄산단로 150',
 37.2048, 127.0767,
 ARRAY['sink','wardrobe','fridge','vanity','shoe','storage'], ARRAY['modern-minimal','scandinavian','natural','classic-luxury'],
 'CNC 재단·엣지밴딩·조립',
 '031-789-0123', 'info@jmjaedan.kr', 'jm_jaedan',
 2012, '21-50', 4.4, 22, 380, true, true,
 '[]'::jsonb),

('컬러팩토리', '가구 도장·표면처리 전문', 'factory',
 '인천광역시', '서구', '인천 서구 가좌동 산업로 200',
 37.5050, 126.6736,
 ARRAY['sink','wardrobe','vanity'], ARRAY['classic-luxury','modern-minimal'],
 'UV 도장, 래핑, 엠보싱 표면처리',
 '032-890-1234', 'color@colorfactory.kr', 'color_factory',
 2015, '6-20', 4.1, 12, 190, true, false,
 '[]'::jsonb),

('클리어글라스', '가구용 유리·거울 전문', 'factory',
 '경기도', '파주시', '경기 파주시 문산읍 유리로 77',
 37.8580, 126.7870,
 ARRAY['wardrobe','vanity','storage'], ARRAY['modern-minimal','scandinavian'],
 '강화유리, 거울, 유리 도어 제작',
 '031-901-2345', 'glass@clearglass.kr', 'clear_glass',
 2014, '6-20', 4.3, 18, 240, true, true,
 '[]'::jsonb),

('메탈크래프트', '가구 금속 부자재 제조', 'factory',
 '경기도', '시흥시', '경기 시흥시 정왕동 공단로 300',
 37.3390, 126.7332,
 ARRAY['sink','fridge','shoe','storage'], ARRAY['modern-minimal','scandinavian','natural'],
 '경첩·레일·손잡이 금속 가공',
 '031-012-3456', 'metal@metalcraft.kr', 'metal_craft',
 2008, '21-50', 4.5, 30, 450, true, true,
 '[]'::jsonb);
