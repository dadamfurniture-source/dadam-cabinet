"""
주방가전 수집 결과(kitchen.json) → Supabase SQL 편집기에 붙여 넣을 가져오기 SQL.

  python -I to_sql.py kitchen.json > import-kitchen.sql
  python -I to_sql.py kitchen.json manual/x.json > import-kitchen.sql   # 여러 파일

database/appliance-models-kitchen.sql 의 import_appliance_models(jsonb) 를 부른다 (먼저 그 파일을 실행한다).
같은 브랜드에서 모델 코드가 겹치면 갱신 · 여유 · 니치 · 타공은 기존 값 우선 · 반복 실행 안전. 100행씩 나눈다.
냉장고 to_sql.py 의 이름 정리 · 정수 변환을 그대로 쓴다.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("fridge_to_sql", os.path.join(HERE, "..", "fridge-catalog", "to_sql.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)

BRAND = dict(T.BRAND, **{'Cuchen': '쿠첸', 'cuchen': '쿠첸'})
NICHE_KEYS = T.NICHE_KEYS
CUTOUT_KEYS = ('cutout_w_mm', 'cutout_d_mm', 'cutout_r_mm', 'faucet_hole_mm')
BATCH = 100
# 이 태그가 붙은 행은 검증 아님:
#   이미지판독 공식 이미지를 눈으로 읽은 값 · 요약문 사양표가 아닌 요약 글 · 고시불일치 판매 코드와 상품정보고시 코드가 다름
#   치수순서추정 W · D · H 순서 표시가 없음 · 치수순서의심 같은 모델 다른 색상 페이지끼리 순서가 다름
#   출처불일치 같은 회사의 웹 페이지 · 카탈로그 값이 서로 다름
UNVERIFIED_TAGS = {'이미지판독', '요약문', '고시불일치', '치수순서추정', '치수순서의심', '국내판매미확인', '출처불일치'}
# 브랜드 파일이 한쪽 값을 골라 넣었지만 공식 출처끼리 값이 다른 모델 (2026-10-25 각 brands/<key>.md) — '출처불일치' 로 미검증
SOURCE_CONFLICT = {
    'SI364BM': '스메그 고시 높이 50 · smeg.com 60', 'KT90PE': '스메그 900×740×480 · 비교표 · smeg.com 895×740×530',
    'KD90HXE': '스메그 900×800×540 · smeg.com 900×555×1230', 'EIS84041': '일렉트로룩스 높이 51 · 치수 PDF 44',
    'ECI6300S': '일렉트로룩스 높이 770 · 치수 PDF 750', 'NCH-90S': '하츠 높이 2026 카탈로그 840 · 2025 890',
    'DBS14': 'SKS 깊이 웹 574 · 고시 · 설명서 554',
    'NKRM231EWW': '위니아 깊이 페이지 363 · 설명서 381', 'MWD23ET': '위니아 깊이 362 · 설명서 358',
    'WKRL260EBW': '위니아 깊이 362 · 설명서 368', 'GKRL262DSW': '위니아 깊이 370 · 설명서 375',
    'EKRL263DWW': '위니아 깊이 370 · 설명서 365', 'EKRL150EGW': '위니아 깊이 320 · 설명서 316',
    'EKRL150EWW': '위니아 깊이 320 · 설명서 316', 'WKRM152DWK': '위니아 높이 229 · 설명서 224',
    'EKCL281DTW': '위니아 깊이 382 · 설명서 383',
    'CRM-H0640FPW': '쿠첸 페이지 417×300×290 · 설명서 313×251×233 (설명서 값)', 'CRM-H0640FCY': '쿠첸 페이지 417×300×290 · 설명서 313×251×233 (설명서 값)',
    'CRT-PMWS0640KFI': '쿠첸 페이지 높이 361 · 설명서 270 (설명서 값)', 'CRE-D0601W': '쿠첸 페이지 302(W) · 설명서 302(길이) — W · D 를 설명서로 바꿈',
}
# 이 태그가 붙은 행은 SQL 에 넣지 않는다 — 종류별 치수 범위를 벗어났다 (collect.py BOUNDS)
SKIP_TAGS = {'치수확인필요'}
CAT_LABEL = {'microwave': '전자레인지', 'oven': '오븐', 'dishwasher': '식기세척기', 'cooktop': '쿡탑', 'hood': '후드',
             'rice_cooker': '밥솥', 'sink': '싱크볼'}


def tags_of(r):
    tags = list(r.get('tags') or [])
    if any(str(c).strip() in SOURCE_CONFLICT for c in (r.get('model_codes') or [])) and '출처불일치' not in tags:
        tags.append('출처불일치')
    return tags


def notes_of(r):
    parts = []
    tags = tags_of(r)
    flags = [t for t in tags if t in UNVERIFIED_TAGS | {'치수범위', '후드일체형'}]
    if flags:
        parts.append('확인 필요: ' + ', '.join(flags) if set(flags) & UNVERIFIED_TAGS else ', '.join(flags))
    conflict = [SOURCE_CONFLICT[str(c).strip()] for c in (r.get('model_codes') or []) if str(c).strip() in SOURCE_CONFLICT]
    if conflict:
        parts.append('출처 차이: ' + conflict[0])
    if r.get('place_count'):
        parts.append(f"{r['place_count']}인용")
    if r.get('cutout_raw'):
        parts.append(f"타공 원문: {r['cutout_raw']}")
    if r.get('niche_raw'):
        parts.append(f"설치 공간 원문: {r['niche_raw']}")
    if r.get('install_notes'):
        parts.append(f"설치 안내: {r['install_notes']}")
    if 'size_raw' in r and r.get('size_raw') and ('치수범위' in (r.get('tags') or []) or '치수순서추정' in (r.get('tags') or [])):
        parts.append(f"공식 크기 원문: {r['size_raw']}")
    if r.get('product_type_raw'):
        parts.append(r['product_type_raw'])
    text = ' · '.join(str(p) for p in parts)
    return text[:T.NOTES_MAX] or None


def skip_reason(row, r):
    if not row['model_codes']:
        return '모델 코드 없음'
    if not all((row[k] or 0) > 0 for k in ('width_mm', 'depth_mm', 'height_mm')):
        return '치수 없음'
    if set(r.get('tags') or []) & SKIP_TAGS:
        return '치수 범위 밖'
    if row['cutout_w_mm'] and row['cutout_d_mm'] and (row['cutout_w_mm'] >= row['width_mm'] or row['cutout_d_mm'] >= row['depth_mm']):
        return '타공이 외경보다 크다'
    return None


def row_of(r):
    codes = list(dict.fromkeys(str(c).strip() for c in (r.get('model_codes') or []) if c and str(c).strip()))
    return {
        'category': r['category'],
        'brand': BRAND.get(r.get('brand'), r.get('brand')),
        'model_name': T.clean_name(r.get('model_name')),
        'model_code': codes[0] if codes else None,
        'model_codes': codes,
        'width_mm': T.num(r.get('width_mm')),
        'depth_mm': T.num(r.get('depth_mm')),
        'height_mm': T.num(r.get('height_mm')),
        'capacity_l': T.num(r.get('capacity_l')),
        'subtype': r.get('category_subtype'),
        'line': r.get('line'),
        'install_type': r.get('install_type'),
        'side_gap_mm': T.num(r.get('side_gap_mm'), up=True),
        'top_gap_mm': T.num(r.get('top_gap_mm'), up=True),
        'back_gap_mm': T.num(r.get('back_gap_mm'), up=True),
        **{k: T.num(r.get(k)) for k in NICHE_KEYS},
        **{k: T.num(r.get(k)) for k in CUTOUT_KEYS},
        'verified': not (set(tags_of(r)) & UNVERIFIED_TAGS),
        'source_url': r.get('page_url') or r.get('source_url'),
        'image_source_url': r.get('image_source_url') if str(r.get('image_source_url') or '').startswith('https://') else None,
        'notes': notes_of(r),
    }


def build(raw_rows):
    ok, skipped = [], []
    for r in raw_rows:
        row = row_of(r)
        why = skip_reason(row, r)
        (skipped if why else ok).append((row, why))
    return [x for x, _ in ok], [(x, why) for x, why in skipped]


def main(paths):
    rows = []
    for path in paths:
        data = json.load(open(path, encoding='utf-8'))
        rows += data if isinstance(data, list) else data.get('rows', [])
    ok, skipped = build(rows)
    lines = [
        '-- 주방가전 모델 가져오기 — scripts/kitchen-catalog/to_sql.py 가 만든 파일',
        f'-- 행 {len(ok)}개 (검증 {sum(1 for r in ok if r["verified"])} · 미검증 {sum(1 for r in ok if not r["verified"])}) · 건너뜀 {len(skipped)}개',
        '-- 먼저 database/appliance-models-kitchen.sql 을 실행해 두어야 한다 (밥솥 종류 · 종류별 세부 구분 · 타공 가져오기).',
        '-- 여러 번 실행해도 중복이 생기지 않는다.',
    ]
    for row, why in skipped:
        lines.append(f"--   건너뜀 [{why}] {row['brand']} {CAT_LABEL.get(row['category'], row['category'])} {row['model_name']} {','.join(row['model_codes'][:3])}")
    lines.append('')
    for i in range(0, len(ok), BATCH):
        chunk = json.dumps(ok[i:i + BATCH], ensure_ascii=False)
        assert '$kitchen$' not in chunk
        lines.append(f'SELECT import_appliance_models($kitchen${chunk}$kitchen$::jsonb);')
    lines.append('')
    lines.append("SELECT category, subtype, brand, count(*), count(*) FILTER (WHERE verified) AS verified FROM appliance_models"
                 " WHERE category IN ('microwave', 'oven', 'dishwasher', 'cooktop', 'hood', 'rice_cooker', 'sink') GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;")
    sys.stdout.reconfigure(encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main(sys.argv[1:] or ['kitchen.json'])
