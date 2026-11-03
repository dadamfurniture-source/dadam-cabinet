"""삼성 — 하부장 안에 들어가는 가전 (2026-11-03 사장님 "모델까지 수집해 카탈로그에 넣음").

  로봇청소기 빌트인 스테이션 (robot_vacuum · built_in)
    목록  goodsList dispClsfNo 37030000 (청소기 전체) 중 이름에 '자동 급배수' — 자동 급배수 모델만 싱크대 하부장 · 밥솥장 ·
          오븐장 안에 빌트인으로 설치한다 (설치 옵션 '설치' · '리폼+설치'). 일반 스테이션 모델은 프리스탠딩뿐이라 모으지 않는다.
    치수  compGoodsSpecList '제품 크기(본체+스테이션, 가로 × 높이 × 깊이)' (410x320x513 — 설치가이드 '스테이션 가로 410mm,
          세로 513mm, 높이 320mm' 와 같다)
    설치  /sec/bespoke_ai_steam_interior_fit '자동 급배수 빌트인 설치가이드 표' — 가구장 장 내측 폭 · 높이 · 깊이와 상부 · 측면
          이격 (두 줄 중 첫 줄을 칸으로, 둘 다 niche_raw), 벽 후면 이격 20 → back_gap_mm
  언더싱크 정수기 (water_purifier)
    목록  goodsList dispClsfNo 100020195 (정수기) — 사양 '설치 타입' 이 '언더싱크' 인 것만 (Bespoke AI 정수기는 카운터탑)
    치수  '크기(가로 × 높이 × 깊이)' = 싱크대 아래 본체. 파우셋 'SIZE' 는 원문만 비고로
    타공  '타공여부 = 필요(D25mm)' → faucet_hole_mm 25
  와인셀러 · 음식물처리기 — 없음 (와인냉장고는 키친핏 1도어 키큰 몸체뿐 = 냉장고 wine, 음식물처리기는 팔지 않는다)

robots.txt (www.samsung.com, 2026-11-03 직접 읽음): /sec/ 상품 · xhr · cxhr 경로 허용 — 막힌 것은 /*/search/ ·
/*/c/p/ · /*/system/* · /*/common/review/ · /sec/search/searchresultB2c/* 등. 이 파일은 그 경로를 부르지 않는다.
"""
import re
import sys

BRAND_KEY = "samsung_lower"
K = None   # collect.py 모듈 (base_row · dims_of · put_dims · F …)

ROBOT_DISP = "37030000"        # 청소기 전체
PURIFIER_DISP = "100020195"    # 정수기
INTERIOR_FIT = "/sec/bespoke_ai_steam_interior_fit"


def _norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


def _spec_pick(spec, *keys):
    for want in keys:
        for k, v in spec.items():
            if want in k and v and v != "-":
                return k, v
    return None, None


def robot_guide(f):
    """설치가이드 표 → (칸 dict, niche_raw, install_notes). 표 글자가 없으면 ({}, None, None)."""
    st, h = f.get(K.F.SS + INTERIOR_FIT)
    t = _norm(K.F.html_to_text(h)) if st == 200 else ""
    out, raw, notes = {}, None, []
    m = re.search(r"자동 급배수 빌트인 설치가이드 표 (폭에 따른 설치 공간 \(장 내측\) 높이 \(장 내측\) 깊이 \(장 내측\) "
                  r"상부 및 측면 이격 이격에 따른 설치공간 (.+?))(?= 자동 급배수 빌트인 급/배수관)", t)
    if m:
        raw = "자동 급배수 빌트인 설치가이드 표: " + m.group(1)
        rows = re.findall(r"(\d+)mm 이상 (\d+)mm 이상 (\d+)mm 이상 상부 이격 (\d+)mm / 측면이격 (\d+)mm", m.group(2))
        if rows:   # 첫 줄 (폭 420 · 높이 335 · 깊이 600 · 상부 15 · 측면 5) — 둘째 줄(폭 440 · 높이 330 · 상부 10 · 측면 15)은 원문에
            w, hh, d, top, side = (int(x) for x in rows[0])
            out.update(niche_min_w_mm=w, niche_min_h_mm=hh, niche_min_d_mm=d, top_gap_mm=top, side_gap_mm=side)
    b = re.search(r"자동 급배수 빌트인 모델 설치가이드입니다\. 스테이션과 벽 후면 이격 거리 (\d+)mm", t)
    if b:
        out["back_gap_mm"] = int(b.group(1))
    for pat in [r"가구장 로봇 출입구 개방 높이 \d+mm 이상", r"가구장 전면부 [\d.]+m 이내 장애물 없어야 설치 가능",
                r"배수\(바닥 기준, m\) [\d.]+ 이하", r"가구장 걸레받이를 기준으로 청정스테이션 발판의 최대 돌출 허용 길이는 \d+mm입니다",
                r"오븐장의 경우 삼성전자 오븐 아래에만 AI 스팀 설치가 가능합니다"]:
        x = re.search(pat, t)
        if x:
            notes.append(x.group(0))
    note = " · ".join(notes) + " (삼성 Bespoke AI 스팀 설치가이드)" if notes else None
    return out, raw, note


def robots(f, sample=None):
    rows, done = [], set()
    count, prods = K.F.ss_list(f, ROBOT_DISP)
    prods = [p for p in prods if "자동 급배수" in (p.get("goodsNm") or "")]
    print(f"[samsung_lower] robot_vacuum: listed={count} 자동 급배수={len(prods)}", file=sys.stderr)
    if sample:
        prods = prods[:sample]
    guide, niche_raw, note = robot_guide(f)
    for p in prods:
        for mdl, gid in K.F.ss_variants(p).items():
            if mdl in done:
                continue
            done.add(mdl)
            spec = K.F.ss_spec(f, gid)
            if not spec or "자동" not in (spec.get("스테이션 타입") or "") + (spec.get("자동 급배수 시스템") or ""):
                continue
            name = _norm(spec.get("제품명") or p.get("goodsNm"))
            row = K.base_row(brand="Samsung", category="robot_vacuum", category_subtype="built_in", install_type="built_in",
                             model_name=name, model_codes=[mdl], line=name.replace(" 자동 급배수", ""),
                             source_url=f"{K.F.SS}/sec/xhr/pf/compGoodsSpecList?goodsIds={gid}",
                             page_url=f"{K.F.SS}/sec/{p['goodsDetailUrl']}", image_source_url=K.F.ss_image(p),
                             sale_status=p.get("saleStatCd"),
                             product_type_raw=f"스테이션 타입 {spec.get('스테이션 타입')} · 자동 급배수 빌트인 (하부장 · 밥솥장 · 오븐장 안)")
            sk, sv = _spec_pick(spec, "본체+스테이션")
            d, _ = K.dims_of(sk, sv, "whd")
            K.put_dims(row, d, sv)
            row.update(guide)
            if niche_raw:
                row["niche_raw"] = niche_raw
            if note:
                row["install_notes"] = note
            rows.append(row)
    return rows


def purifier_subtype(detail):
    t = detail.replace(" ", "")
    cold, hot = "냉수" in t, "온수" in t
    return "hot_cold" if cold and hot else "cold" if cold else "hot" if hot else "purify"


def purifiers(f, sample=None):
    rows, done = [], set()
    count, prods = K.F.ss_list(f, PURIFIER_DISP)
    # 인덕션 + 정수기 묶음 상품은 뺀다 (정수기 단품이 따로 있다)
    prods = [p for p in prods if "인덕션" not in (p.get("goodsNm") or "")]
    print(f"[samsung_lower] water_purifier: listed={count} 정수기 상품={len(prods)}", file=sys.stderr)
    if sample:
        prods = prods[:sample]
    for p in prods:
        for mdl, gid in K.F.ss_variants(p).items():
            if mdl in done:
                continue
            done.add(mdl)
            spec = K.F.ss_spec(f, gid)
            if not spec or "언더싱크" not in (spec.get("설치 타입") or ""):
                continue
            detail = spec.get("제품 상세") or ""
            # 이름은 그 코드의 사양에서 — 묶음 상품(…+교체용 필터) 의 색상 · 기능 변형은 상품 이름과 기능이 다를 때가 있다
            #   ('Bespoke 정수기 일체형 (정수전용)+교체용 필터' 상품 안의 RWP54220BF7MF = 정수 / 냉수)
            name = _norm(f"{spec.get('제품 타입') or 'Bespoke 정수기'} 언더싱크 ({_norm(detail)}"
                         + (f", {spec['파우셋 형태']})" if spec.get("파우셋 형태") else ")"))
            row = K.base_row(brand="Samsung", category="water_purifier", category_subtype=purifier_subtype(detail),
                             install_type="built_in", model_name=name, model_codes=[mdl],
                             line="Bespoke", source_url=f"{K.F.SS}/sec/xhr/pf/compGoodsSpecList?goodsIds={gid}",
                             page_url=f"{K.F.SS}/sec/{p['goodsDetailUrl']}", image_source_url=K.F.ss_image(p),
                             sale_status=p.get("saleStatCd"),
                             product_type_raw=" / ".join(x for x in [spec.get("제품 타입"), detail, spec.get("설치 타입"),
                                                                    spec.get("파우셋 형태")] if x))
            sk, sv = _spec_pick(spec, "크기(가로")
            d, _ = K.dims_of(sk, sv, "whd")
            K.put_dims(row, d, sv)
            hole = spec.get("타공여부") or ""
            hm = re.search(r"D\s*(\d+)\s*mm", hole)
            if hm:
                row["faucet_hole_mm"] = int(hm.group(1))
                row["cutout_raw"] = f"타공여부 {hole}"
            if spec.get("SIZE"):
                row["install_notes"] = f"파우셋 SIZE {spec['SIZE']} (사양 원문 — 칸 순서 표시 없음)"
            rows.append(row)
    return rows


def collect(f, K_, sample=None):
    global K
    K = K_
    return robots(f, sample) + purifiers(f, sample)
