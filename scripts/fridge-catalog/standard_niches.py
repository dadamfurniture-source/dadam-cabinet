"""
표준 니치 템플릿 → database/appliance-models-standard-niches.sql

  python -I standard_niches.py > ../../database/appliance-models-standard-niches.sql

빌트인 냉장고는 브랜드가 달라도 장 안쪽 치수(니치)가 표준 단계로 묶여 있다 — 몇 줄로 대부분을 덮는다.
특정 모델이 아니므로 brand '표준', verified false ('⚠ 표준' 배지), 냉장고 치수 칸 = 니치 최소값
(겉 치수를 지어내지 않는다 — 플래너는 니치 = 냉장고면 여유 0 으로 보고 '니치 + 전체 여유 6' 칸을 잡는다).
출처: research_notes/냉장고 브랜드 확장/highend_builtin.md (2026-10-19 조사).
"""
import json
import sys

EU_SRC = ('출처: Liebherr 제품 데이터 Nischenmaße(범위) · BSH 스펙시트 Required niche size(한 값) · '
          'Miele FS 시트. 환기: 받침 · 상부 각각 최소 200 cm² 개구. 도어: 고정도어(Flat hinge, 하이엔드 대부분) / '
          '슬라이딩(Sliding hinge) — 모델 설치설명서로 확인')
US_SRC = ('출처: Sub-Zero Designer QR 시트(개구 84" × 폭 × 25"). 깊이는 브랜드마다 다름 — Gaggenau Vario 400 610, '
          'Miele MasterCool 629, Thermador 24¾", Monogram/Dacor 미국 25". 국내판(220V)은 모델 설치설명서로 확인')

# (code, 이름, (h_min, h_max), (w_min, w_max), (d_min, d_max), BSH 한 값)
EU = [
    ('STD-EU-82', '언더카운터 82~88', (820, 880), (600, None), (550, None), None),
    ('STD-EU-88', '88', (874, 890), (560, 570), (550, None), 880),
    ('STD-EU-102', '102', (1024, 1040), (560, 570), (550, None), 1025),
    ('STD-EU-122', '122', (1216, 1236), (560, 570), (550, None), 1225),
    ('STD-EU-140', '140', (1397, 1413), (560, 570), (550, None), 1400),
    ('STD-EU-158', '158', (1574, 1590), (560, 570), (550, None), 1580),
    ('STD-EU-178', '178', (1772, 1788), (560, 570), (550, None), 1775),
    ('STD-EU-194', '194 (리페르)', (1940, 1950), (560, 570), (550, None), None),
    ('STD-EU-194W71', '194 · 폭 71 (리페르)', (1940, 1950), (710, 720), (560, None), None),
]
US = [
    ('STD-US-18', '18"', 457),
    ('STD-US-24', '24"', 610),
    ('STD-US-30', '30"', 762),
    ('STD-US-36', '36"', 914),
]


def row(code, name, h, w, d, line, notes):
    return {
        'category': 'refrigerator',
        'brand': '표준',
        'model_name': name,
        'model_code': code,
        'model_codes': [code],
        # 냉장고 치수 칸 = 니치 최소 (특정 냉장고가 아니다)
        'width_mm': w[0], 'height_mm': h[0], 'depth_mm': d[0],
        'capacity_l': None,
        'subtype': 'built_in',
        'line': line,
        'install_type': 'built_in',
        'niche_min_w_mm': w[0], 'niche_min_h_mm': h[0], 'niche_min_d_mm': d[0],
        'niche_max_w_mm': w[1], 'niche_max_h_mm': h[1], 'niche_max_d_mm': d[1],
        'verified': False,
        'source_url': None,
        'notes': notes,
    }


def main():
    rows = []
    for code, label, h, w, d, bsh in EU:
        note = f'표준 니치 — 냉장고 치수 칸은 니치 최소값(특정 모델 아님).{f" BSH(보쉬·지멘스·가게나우 200) 한 값 {bsh}." if bsh else ""} {EU_SRC}'
        rows.append(row(code, f'유럽 통합형 니치 {label}', h, w, d, '유럽 통합형', note))
    for code, label, w in US:
        rows.append(row(code, f'미국형 컬럼 니치 {label}', (2134, None), (w, None), (635, None), '미국형 컬럼',
                        f'표준 니치 — 냉장고 치수 칸은 개구 최소값(특정 모델 아님). {US_SRC}'))
    payload = json.dumps(rows, ensure_ascii=False)
    assert '$niche$' not in payload
    sys.stdout.reconfigure(encoding='utf-8')
    print('\n'.join([
        '-- 표준 니치 템플릿 13행 — scripts/fridge-catalog/standard_niches.py 가 만든 파일',
        '-- 유럽 통합형 9 (높이 88~194 단계 · 언더카운터 · 폭 71) + 미국형 컬럼 4 (18/24/30/36")',
        "-- 브랜드 '표준', verified false ('⚠ 표준'). 먼저 appliance-models-catalog.sql · appliance-models-niche.sql 실행.",
        '-- 여러 번 실행해도 중복이 생기지 않는다 (모델 코드 STD-* 로 갱신).',
        '',
        f'SELECT import_appliance_models($niche${payload}$niche$::jsonb);',
        '',
        "SELECT model_code, niche_min_w_mm, niche_max_w_mm, niche_min_h_mm, niche_max_h_mm, niche_min_d_mm FROM appliance_models WHERE brand = '표준' ORDER BY model_code;",
    ]))


if __name__ == '__main__':
    main()
