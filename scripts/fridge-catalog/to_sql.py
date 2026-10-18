"""
수집 결과(fridges.json) → Supabase SQL 편집기에 붙여 넣을 가져오기 SQL.

  python -I to_sql.py fridges.json > import-fridges.sql

database/appliance-models-catalog.sql 의 import_appliance_models(jsonb) 를 부른다
(같은 브랜드에서 모델 코드가 겹치면 갱신 · 여유는 기존 값 우선 · 반복 실행 안전).
한 번에 너무 큰 문장이 되지 않게 100행씩 나눈다.
"""
import html
import json
import math
import re
import sys

# DB 에 이미 있는 이름에 맞춘다 (기존 냉장고 8개가 '삼성' · 'LG')
BRAND = {'Samsung': '삼성', 'samsung': '삼성', 'LG': 'LG', 'lg': 'LG'}
BATCH = 100
NOTES_MAX = 900


def notes_of(r):
    """설치 가이드에서 뽑은 값 중 칸이 없는 것 → 비고 한 덩어리 (사람이 읽는 용도)."""
    parts = []
    if r.get('niche_min_w_mm') or r.get('niche_min_h_mm') or r.get('niche_min_d_mm'):
        dims = ' × '.join(str(r.get(k) or '?') for k in ('niche_min_w_mm', 'niche_min_h_mm', 'niche_min_d_mm'))
        parts.append(f'장 최소 W×H×D {dims}')
    if r.get('niche_recommended_d_mm'):
        parts.append(f"장 권장 깊이 {r['niche_recommended_d_mm']}")
    if r.get('door_side_gap_mm') is not None:
        parts.append(f"도어 측면 여유 {r['door_side_gap_mm']}")
    if r.get('door_open_width_mm'):
        parts.append(f"도어 끝까지 열 때 폭 {r['door_open_width_mm']}")
    if r.get('door_swing_side_mm'):
        parts.append(f"도어 열림 측면 {r['door_swing_side_mm']}")
    if r.get('pair_gap_mm'):
        parts.append(f"나란히 설치 간격 {r['pair_gap_mm']}")
    if r.get('wine_bottles'):
        parts.append(f"{r['wine_bottles']}병")
    if r.get('size_raw'):
        parts.append(f"공식 크기 원문: {r['size_raw']}")
    if r.get('drawing_dims_raw'):
        parts.append(f"도면 치수: {r['drawing_dims_raw']}")
    if r.get('install_guide_title'):
        parts.append(f"설치 가이드: {r['install_guide_title']}")
    text = ' · '.join(str(p) for p in parts)
    return text[:NOTES_MAX] or None


def num(v, up=False):
    """DB 칸이 INT 라 정수로. 여유(gap)는 올림 — 16.5 → 17 (여유를 줄이지 않는다), 치수 · 용량은 반올림."""
    if v is None or v == '':
        return None
    try:
        x = float(str(v).replace(',', ''))
    except (TypeError, ValueError):
        return None
    return int(math.ceil(x)) if up else int(round(x))


def clean_name(s):
    """상품 이름의 HTML 태그 · 엔티티 ('LG SIGNATURE<br>와인셀러') → 글자만."""
    s = re.sub(r'<[^>]+>', ' ', str(s or ''))
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def refine_subtype(r, name):
    """
    수집기의 세부 구분(상품 이름 추정)을 사람 기준으로 바로잡는다 (2026-10-19 전체 수집 187행 검토).
      - 세워 쓰는 냉동고 단품(RZ22 · A202S · DF165ME)이 two_door/small 로 → one_door (키 1m 미만만 small)
      - built_in 은 '가구 도어를 붙이는 완전 빌트인'(삼성 BR* 계열)만. LG '빌트인 타입'은 장에 맞춰 넣는
        일반 냉장고라 도어 형태로 다시 나눈다 (설치 방식 install_type 은 원래 값을 둔다)
    """
    st = r.get('category_subtype')
    codes = r.get('model_codes') or []
    h = num(r.get('height_mm')) or 0
    w = num(r.get('width_mm')) or 0
    freezer = ('냉동고' in name or '냉동전용' in name) and '2도어' not in name
    if st in ('two_door', 'small') and freezer:
        return 'one_door' if h >= 1000 else 'small'
    if st == 'built_in' and not any(str(c).startswith('BR') for c in codes):
        if '김치' in name:
            return 'kimchi_stand'
        if '전용고' in name or '1도어' in name:
            return 'one_door'
        return 'french_4door' if w >= 900 else 'two_door'
    return st


def row_of(r):
    codes = [str(c).rstrip('_') for c in (r.get('model_codes') or []) if c]
    codes = list(dict.fromkeys(c for c in codes if c))
    name = clean_name(r.get('model_name'))
    return {
        'category': 'refrigerator',
        'brand': BRAND.get(r.get('brand'), r.get('brand')),
        'model_name': name,
        'model_code': codes[0] if codes else None,
        'model_codes': codes,
        'width_mm': num(r.get('width_mm')),
        'depth_mm': num(r.get('depth_mm')),
        'height_mm': num(r.get('height_mm')),
        'capacity_l': num(r.get('capacity_l')),
        'subtype': refine_subtype(r, name),
        'line': r.get('line'),
        'install_type': r.get('install_type'),
        'side_gap_mm': num(r.get('side_gap_mm'), up=True),
        'top_gap_mm': num(r.get('top_gap_mm'), up=True),
        'back_gap_mm': num(r.get('back_gap_mm'), up=True),
        'verified': True,  # 제조사 공식 스펙 API 값
        'source_url': r.get('page_url') or r.get('source_url'),
        'notes': notes_of(r),
    }


def main(path):
    data = json.load(open(path, encoding='utf-8'))
    rows = data if isinstance(data, list) else data.get('rows', [])
    out = [row_of(r) for r in rows]
    ok = [r for r in out if r['model_codes'] and all((r[k] or 0) > 0 for k in ('width_mm', 'depth_mm', 'height_mm'))]
    lines = [
        '-- 냉장고 모델 가져오기 — scripts/fridge-catalog/to_sql.py 가 만든 파일',
        f'-- 행 {len(ok)}개 (건너뜀 {len(out) - len(ok)}개 — 모델 코드나 치수 없음)',
        '-- 먼저 database/appliance-models-catalog.sql 을 실행해 두어야 한다. 여러 번 실행해도 중복이 생기지 않는다.',
        '',
    ]
    for i in range(0, len(ok), BATCH):
        chunk = json.dumps(ok[i:i + BATCH], ensure_ascii=False)
        assert '$fridge$' not in chunk
        lines.append(f'SELECT import_appliance_models($fridge${chunk}$fridge$::jsonb);')
    lines.append('')
    lines.append("SELECT subtype, brand, count(*) FROM appliance_models WHERE category = 'refrigerator' GROUP BY 1, 2 ORDER BY 1, 2;")
    sys.stdout.reconfigure(encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'fridges.json')
