"""가게나우 (Gaggenau, BSH) 빌트인 주방가전 — 오븐 · 콤비 · 스팀오븐 · 전자레인지 · 쿡탑 · 후드 · 식기세척기. (2026-10-25)

  국내 판매  공식 수입사 ㈜화인어프라이언스 (fineappliances.co.kr — '가게나우 국내 독점 사업자') 의 제품 목록
             oven_list · cooktops_list · dishwasher_list → 상세 *_view*.php '제품 스펙' (제품 규격 · 설치타공치수)
  치수 · 니치 가게나우 글로벌 제품 페이지 (gaggenau.com/global/en/mkt-product/…) 의 JSON-LD additionalProperty
             'Dimensions (HxWxD)' · 'Niche height (min/max)' · 'Niche width (min/max)' · 'Niche depth' (제조사 글자)
  타공       수입사 상세 '설치타공치수 780(W)x490(H)' (H = 상판 깊이 방향). 수입사 목록에 없는 글로벌 쿡탑은
             공식 치수도(Line_Drawings) 를 눈으로 읽어 옮긴 GG_CUTOUTS 표 (→ '이미지판독'). 수입사 쿡탑 7종도 치수도와
             대조했다 — CI282-102 만 달라 (수입사 760 · 치수도 780) '출처불일치'
  그 밖      수입사 목록에 없는 글로벌 제품도 싣는다 — 전부 '국내판매미확인' (스팀오븐 · 가스쿡탑 · 후드는 수입사 목록에 없다).
             line 에 '(글로벌)' 을 붙여 크기가 같은 색상 변형이 수입사 행에 묶이지 않게 한다.
             수입사 규격(제품 규격) 과 글로벌 'Dimensions' 가 2 mm 넘게 다르면 '출처불일치' (VI262-120: 수입사 590 · 글로벌 580)

robots.txt: fineappliances.co.kr 없음(404 → 허용), gaggenau.com /global/ 제품 경로 허용. Fetcher 로만 (1.2초 · 캐시).
워밍 드로어 · 진공 드로어 · 커피머신 · 노브 · 냉장/와인(냉장고 수집기 몫) · 북미 전용(인치 · 208/120 V)은 뺀다.
치수도 그림은 수집기가 받지 않는다 — 사람이(에이전트가) curl 로 한 장씩 받아 읽은 값을 표로 옮겼다 (brands/gaggenau.md).
"""
import json
import re
import sys

BRAND_KEY = "gaggenau"
K = None   # collect.py 가 넘긴다

BRAND = "가게나우"
FA = "https://www.fineappliances.co.kr"
GG = "https://www.gaggenau.com"
FA_LISTS = ("oven_list.php", "cooktops_list.php", "dishwasher_list.php")

# 쿡탑 상판 타공 — 제품 페이지 · 스펙시트에 글자가 없어 공식 치수도(media3.bsh-group.com/Line_Drawings/1400x/{그림}_en-ZZ.jpg,
# 제품 페이지 JSON-LD image[] 에 걸린 그림)를 눈으로 읽어 옮긴 값 (2026-10-25, → '이미지판독'). 값을 지어내지 않는다.
#   키 = 모델 코드 (행의 model_codes 중 하나라도 맞으면). cut = (타공 W, 타공 D) — 플러시(면일체) 설치는 관통 타공,
#   단(rebate) 치수는 note 에. r = 모서리 R (그림의 상세 원에 적힌 값 — 플러시는 단 R / 관통 R). side = 그림 글자
#   'Minimum distance from the (hob/appliance) cut-out to the (side) wall' (그 밖의 ≥50 · ≥35 따위는 note 에만).
#   수입사 목록 쿡탑은 수입사 '설치타공치수' 글자가 정본 — 이 표는 대조에만 쓴다 (KR_CUT_CHECK).
_V28 = {"cut": (268, 492), "drawing": "MCZ_02635892_1992483_VI232120",
        "note": "268±1 x 492±1 (Vario 28 cm 한 대 — 2 · 3 · 4대 조합 561 · 854 · 1147±1), 뒤 ≥50 · 앞 ≥35 · 상판 ≥20"}
GG_CUTOUTS = {
    "CE261114": {"cut": (560, 490), "side": 90, "drawing": "MCZ_00922712_553209_CE261113",
                 "note": "560+2 x 490+2 (위얹음), 뒤 ≥50, 벽까지 ≥90(A: 타공에서 벽까지 최소), 상판 깊이 ≥600"},
    "CE291101": {"cut": (885, 490), "side": 90, "drawing": "MCZ_00922148_552702_CE291100",
                 "note": "플러시 — 관통 885+2 x 490+2, 단 913±1 x 525±1, 벽까지 ≥90(A), 상판 깊이 ≥600"},
    "CE291111": {"cut": (880, 490), "side": 90, "drawing": "MCZ_00922151_552707_CE291110",
                 "note": "880+2 x 490+2 (위얹음), 벽까지 ≥90(A), 상판 깊이 ≥600"},
    "CG291210": {"cut": (850, 490), "drawing": "MCZ_01887892_1300888_CG291210",
                 "note": "850+2 x 490-500+2, 뒤 min. 50 · min. 30"},
    "CG492111": {"cut": (983, 580), "r": 9, "drawing": "MCZ_01857425_1280312_CG492111 · MCZ_005867_CG492210",
                 "note": "플러시 — 관통 983 x 580, 단 1007+1 x 604+1 R9, 상판 깊이 ≥700, 상판 두께 40-50"},
    "CI261115": {"cut": (560, 490), "drawing": "22179911_CI261115", "note": "560+3 x 490+3, 뒤 ≥50 · ≥35, 상판 깊이 ≥600"},
    "CI262105": {"cut": (560, 500), "r": 5, "drawing": "14920367_CI262105_1",
                 "note": "플러시 — 관통 560+2 x 500+2, 단 576±1 x 516±1 (단 R10 · 관통 R5, 깊이 6.5)"},
    "CI272103": {"cut": (672, 500), "r": 5, "drawing": "14926630_CI272103_1",
                 "note": "플러시 — 관통 672+2 x 500+2, 단 689±1 x 516±1 (단 R10 · 관통 R5)"},
    "CI272113": {"cut": (680, 490), "r": 3, "drawing": "14918660_CI272113", "note": "680+2 x 490+2 R3 (위얹음)"},
    "CI282112": {"cut": (780, 490), "r": 3, "drawing": "14918813_CI282112", "note": "780+2 x 490+2 R3 (위얹음)"},
    "CI283103": {"cut": (780, 490), "r": 3, "drawing": "14928867_CI283103",
                 "note": "플러시 — 관통 780+2 x 490+2, 단 798±1 x 518±1 (단 R5 · 관통 R3)"},
    "CI292102": {"cut": (880, 490), "r": 3, "drawing": "14929067_CI292102_1",
                 "note": "플러시 — 관통 880+2 x 490+2, 단 913±1 x 525±1 (단 R5 · 관통 R3)"},
    "CI292112": {"cut": (880, 490), "r": 3, "drawing": "14919856_CI292112", "note": "880+2 x 490+2 R3 (위얹음)"},
    "CV282101M": {"cut": (780, 490), "drawing": "MCZ_03281655_2634925_CV282101",
                  "note": "플러시 — 관통 780+2 x 490+2, 단 798±1 x 518±1, 하부장 폭 ≥600"},
    "CV282111": {"cut": (780, 490), "drawing": "MCZ_03281661_2634931_CV282111",
                 "note": "780+3 x 490+3 (위얹음), 뒤 ≥60, 하부장 폭 ≥600"},
    "CV492105": {"cut": (887, 492), "drawing": "16344907_CV492100",
                 "note": "플러시 — 관통 887±1 x 492±1, 단 912+1 x 524+1, 하부장 폭 ≥600"},
    "CX482111": {"cut": (784, 492), "r": 3, "drawing": "14583490_CX482111", "note": "784±1 x 492±1 R3 (위얹음)"},
    "CX492101": {"cut": (880, 490), "r": 3, "drawing": "14588327_CX492101",
                 "note": "플러시 — 관통 880+2 x 490+2, 단 913±1 x 525±1 (단 R5 · 관통 R3)"},
    "CX492111": {"cut": (887, 492), "r": 3, "drawing": "14625740_CX492111", "note": "887±1 x 492±1 R3 (위얹음)"},
    "VG231120F": {"cut": (268, 492), "side": 150, "drawing": "MCZ_02631166_1988473_VG231220",
                  "note": "268±1 x 492±1 (조합 561 · 854 · 1147), 옆벽까지 150"},
    "VG232220": {"cut": (268, 492), "side": 150, "drawing": "MCZ_02661506_2014855_VG232220",
                 "note": "268±1 x 492±1 (조합 561 · 854 · 1147), 옆벽까지 150"},
    "VG264220": {"cut": (560, 492), "side": 150, "drawing": "MCZ_02661526_2014887_VG264220",
                 "note": "560±1 x 492±1, 옆벽까지 150"},
    "VG295250": {"cut": (885, 492), "side": 300, "drawing": "MCZ_02661545_2014892_VG295220",
                 "note": "885±2 x 492±2, 옆벽까지 300"},
    "VG415115": {"cut": (360, 492), "r": 3, "drawing": "MCZ_01855507_1278273_VG415111",
                 "note": "360±1 x 492±1 R3 (위얹음. 덮개 쓰면 더 깊게 — 별도 안내). 같은 행 VG425115F 는 플러시 (384 x 524 단)"},
    "VG425115": {"cut": (360, 492), "r": 3, "drawing": "MCZ_01855480_1278263_VG425111",
                 "note": "플러시 — 관통 360±1 x 492±1, 단 384+1 x 524+1 (단 R4 · 관통 R3)"},
    "VG491115": {"cut": (887, 492), "r": 3, "drawing": "MCZ_01855392_1278218_VG491111", "note": "887±1 x 492±1 R3 (위얹음)"},
    "VI232121": _V28,
    "VI242120": {"cut": (360, 492), "drawing": "MCZ_02635893_1992484_VI242120", "note": "360±1 x 492±1"},
    "VI414105": {"cut": (360, 492), "r": 3, "drawing": "16355402_VI414104",
                 "note": "플러시 — 관통 360±1 x 492±1, 단 383+1 x 524+1 (단 R4 · 관통 R3)"},
    "VI414115": {"cut": (360, 492), "r": 3, "drawing": "MCZ_03267979_2618984_VI414113", "note": "360±1 x 492±1 R3 (위얹음)"},
    "VI462105": {"cut": (569, 492), "r": 3, "drawing": "MCZ_03269518_2620406_VI462103",
                 "note": "플러시 — 관통 569±1 x 492±1, 단 594+1 x 524+1 (단 R4 · 관통 R3)"},
    "VI462115": {"cut": (569, 492), "r": 3, "drawing": "MCZ_03268053_2619088_VI462113", "note": "569±1 x 492±1 R3 (위얹음)"},
    "VI482105": {"cut": (784, 492), "r": 3, "drawing": "MCZ_03269740_2620600_VI482103",
                 "note": "플러시 — 관통 784±1 x 492±1, 단 808+1 x 524+1 (단 R4 · 관통 R3)"},
    "VI482115": {"cut": (784, 492), "r": 3, "drawing": "MCZ_03268092_2619143_VI482113", "note": "784±1 x 492±1 R3 (위얹음)"},
    "VI492105": {"cut": (887, 492), "r": 3, "drawing": "MCZ_03269745_2620602_VI492103",
                 "note": "플러시 — 관통 887±1 x 492±1, 단 912+1 x 524+1 (단 R4 · 관통 R3)"},
    "VI492115": {"cut": (887, 492), "r": 3, "drawing": "MCZ_03268139_2619188_VI492113", "note": "887±1 x 492±1 R3 (위얹음)"},
    "VP230120": dict(_V28, drawing="MCZ_02635897_1992487_VP230120"),
    "VP414115": {"cut": (360, 492), "r": 3, "drawing": "MCZ_02547731_1915006_VP414111", "note": "360±1 x 492±1 R3 (위얹음)"},
}
# 크기가 같아 한 행으로 묶이는 변형(가스 종류 F · 색 · 좌우) → 위 표의 대표 코드. 변형마다 타공이 비면 merge 에서 행이 갈라진다
GG_CUT_ALIAS = {
    "VG231220": "VG231120F", "VG232120F": "VG231120F", "VG264120F": "VG264220", "VG295150F": "VG295250",
    "VG415115F": "VG415115", "VG415215": "VG415115", "VG425115F": "VG415115", "VG425215": "VG415115",
    "VG491115F": "VG491115", "VG491215": "VG491115", "CG492111F": "CG492111", "CG492211": "CG492111",
    "CI283113": "CI282112", "CV492105M": "CV492105", "VI422105": "VI414105", "VI422115": "VI414115",
    "VR230120": "VP230120", "VR414115": "VP414115",
}
# 수입사 '설치타공치수' 와 제조사 치수도 대조 — 다르면 '출처불일치' (어느 쪽인지 사장님 확인). 2026-10-25 판독.
#   CI282-102: 수입사 760(W)x490 · 치수도 15163906_CI282101_2 / 14928406_CI282102_4 = 관통 780+2 x 490+2, 단 798±1 x 518±1
#   (나머지 수입사 쿡탑 6종은 치수도와 같았다: CI262-115 560x490 · CX482-101 780x490 · CV282-101 780x490 · VI262-120 560x492 ·
#    VI232-120 268x492 · CV482-105 784x492)
KR_CUT_CHECK = {
    "CI282102": {"cut": (780, 490), "drawing": "15163906_CI282101_2 · 14928406_CI282102_4",
                 "note": "플러시 — 관통 780+2 x 490+2, 단 798±1 x 518±1 (단 R5 · 관통 R3)"},
}
# 후드 외형이 JSON 에 없을 때 — 공식 치수도 판독 (→ '이미지판독'). 높이 = 배기(Air extraction) 설치 때 덕트 커버 포함 전체
GG_HOOD_DIMS = {
    "AW240191": {"w": 900, "h": (652, 954), "d": 500, "drawing": "MCZ_02626210_1984136_AW240191",
                 "note": "W 900 · D 500 · 배기 높이 652-954 (천장 2.25~2.55 m, 바닥에서 후드 아래 1.60 m 기준) · 캐노피 80"},
    "AI240191": {"w": 900, "h": (744, 924), "d": 600, "drawing": "MCZ_02627039_1984728_AI240191",
                 "note": "W 900 · D 600 · 배기 높이 744-924 (천장 2.34~2.52 m, 바닥에서 후드 아래 1.60 m 기준) · 캐노피 80"},
}

# ----------------------------------------------------------------------------- BSH 제품 페이지 (gaggenau · bosch · siemens 공통 꼴)
# 같은 코드가 bosch.py · siemens.py 에도 있다 (브랜드 파일끼리 서로 부르지 않는다 — brands/README.md)

SPEC_RE = re.compile(r'"key":"[A-Z_0-9]+","name":\{[^{}]*"text":"([^"]*)"\},"value":\{[^{}]*"text":"([^"]*)"\},'
                     r'"requiresValueTranslation":(?:true|false),"unit":(?:null|"([^"]*)")')


def bsh_page(h):
    """제품 페이지 HTML → {name, mpn, avail, props{이름: (값, 단위)}, images[url]}.
    JSON-LD Product.additionalProperty 가 먼저, 구조화 specifications (후드 '조리기구 위 최소 거리' 등 더 많다) 로 채운다."""
    out = {"name": None, "mpn": None, "avail": None, "props": {}, "images": []}
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', h, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        if d.get("@type") != "Product":
            continue
        out["name"], out["mpn"] = (d.get("name") or "").strip(), d.get("mpn")
        out["avail"] = ((d.get("offers") or {}).get("availability") or "").rsplit("/", 1)[-1] or None
        out["images"] = [i for i in (d.get("image") or []) if isinstance(i, str)]
        for p in d.get("additionalProperty") or []:
            if p.get("name"):
                out["props"][p["name"].strip()] = (str(p.get("value") or "").strip(), (p.get("unitText") or "").strip())
        break
    for m in SPEC_RE.finditer(h.replace('\\"', '"')):
        name, val, unit = m.group(1).strip(), m.group(2).strip(), (m.group(3) or "").strip()
        if name and val and not val.startswith(("specifications.", "GENERAL.")):
            out["props"].setdefault(name, (val, unit))
    return out


def prop(p, *names):
    """첫 번째로 있는 속성 값 (단위 없이). 이름이 정확히 같은 것만 — 'Dimensions' 가 포장 치수로 새지 않게."""
    for n in names:
        if n in p["props"]:
            return p["props"][n][0]
    return None


def num(s):
    m = re.search(r"\d+(?:[.,]\d+)?", s or "")
    return K.F.to_num(m.group(0).replace(",", ".")) if m else None


def hwd(value):
    """'455x590x559' (HxWxD) → ({'w':(lo,hi),'h':…,'d':…}, 원문). 두 묶음이 붙어 나오는 값 '148x288x512106x288x512'
    (가스 쿡탑: 받침 포함 · 제외 높이) 은 첫 묶음을 쓰고 원문은 그대로 남긴다."""
    v = (value or "").replace(" ", "")
    m = re.fullmatch(r"(\d+)x(\d+)x(\d+?)(\d+)x\2x\3", v)
    if m:
        v = f"{m.group(1)}x{m.group(2)}x{m.group(3)}"
    d, _ = K.dims_of("(HxWxD)", v, "hwd")
    return d


def rng(s):
    """'560-568' · '490 - 500' · '815' → (lo, hi). 없으면 (None, None)."""
    nums = [K.F.to_num(x) for x in re.findall(r"\d+(?:\.\d+)?", s or "")]
    if not nums:
        return None, None
    return nums[0], (nums[1] if len(nums) > 1 else nums[0])


# 가스 종류 (2026-10-25 3차) — BSH 사양 칸. 같은 helper 가 bosch.py · siemens.py 에도 있다
GAS_PROPS = ("Gas type preset", "Gas type", "Certified gas types", "Other certified gas types",
             "Nozzle set included for alternative gas type", "Nozzle set included")


def gas_kinds(v):
    """'Nat gas H/E/(L) 20 (25) mbar, Liquid gas G30,31 28-30/37mbar' → ({'LNG', 'LPG'}, [모르는 이름]).
    천연가스(Natural gas · Nat gas · NG · G20 · G25) = LNG, 액화가스(Liquid gas · LPG · G30 · G31 · 프로판 · 부탄) = LPG.
    Town gas · Towngas (싱가포르 · 홍콩 제조가스, G110) 는 LNG 도 LPG 도 아니다 — 모르는 이름으로 남긴다."""
    out, other = set(), []
    for part in re.split(r",\s*(?=[A-Za-z])", v or ""):          # 'G30,31' 의 쉼표는 나누지 않는다
        p = part.lower()
        if re.search(r"nat(?:ural)?\.?\s*gas|\bng\b|\bg2[05]\b", p):
            out.add("LNG")
        elif re.search(r"liquid\s*gas|liquidgas|\blpg\b|\bg3[01]\b|propan|butan", p):
            out.add("LPG")
        elif part.strip():
            other.append(part.strip())
    return out, other


def gas_of(row, p):
    """가스 쿡탑 → gas_types. 기본 가스(Gas type / preset) + 인증 가스 · 동봉 노즐 세트로 바꿔 쓸 수 있는 가스를 모두 넣고
    원문은 install_notes 에. Town gas 뿐이면 None (LNG · LPG 가 아니다)."""
    raw, kinds, other = [], set(), []
    for n in GAS_PROPS:
        v = prop(p, n)
        if v:
            raw.append(f"{n}: {v}")
            k, o = gas_kinds(v)
            kinds |= k
            other += o
    if not raw:
        return None
    row["gas_types"] = [g for g in ("LNG", "LPG") if g in kinds] or None
    note = "가스 원문 " + " · ".join(raw)
    if len(kinds) > 1 and any(r.startswith("Nozzle set") for r in raw):
        note += " — 다른 가스는 동봉 노즐 세트로 바꿔 쓴다"
    elif len(kinds) > 1:
        note += " — 다른 가스는 인증 가스(바꾸는 방법은 설치설명서 확인)"
    if other and not kinds:
        note += " — Town gas(제조가스)는 LNG · LPG 가 아니라 gas_types 를 비움"
    return note


def put_niche(row, wmin, wmax, hmin, hmax, dmin, dmax, raw):
    """니치 — 한 값이면 min 만, 범위면 min · max (냉장고 수집기와 같은 규칙)."""
    for k, lo, hi in (("w", wmin, wmax), ("h", hmin, hmax), ("d", dmin, dmax)):
        if lo is None:
            continue
        row[f"niche_min_{k}_mm"] = lo
        if hi is not None and hi != lo:
            row[f"niche_max_{k}_mm"] = hi
    row["niche_raw"] = raw


def drawing_ids(p):
    return [re.sub(r"_[a-z]{2}-[A-Z]{2}$", "", u.rsplit("/", 1)[-1].split("?")[0].rsplit(".", 1)[0])
            for u in p["images"] if "/Line_Drawings/" in u]


def pick_image(p, code):
    """Product_Shots 중 모델 코드(앞 6자)가 든 제품 사진 → 제품 사진 → 첫 장. 연출 · 문 열림 · 부분 사진은 뒤로."""
    shots = [u for u in p["images"] if "/Product_Shots/" in u]
    if not shots:
        return None
    bad = lambda u: re.search(r"(?i)open|_IS_|_DS_|\d(?:IS|DS|SHS|PHS)\d|PGA|KUL_KUR|Inspiration|Detail|Live_Everyday", u)  # noqa
    good = [u for u in shots if not bad(u)]
    stem = re.sub(r"\d{3}[A-Z]?$", "", code)[:6]
    return next((u for u in good if stem in u), None) or (good or shots)[0]


# ----------------------------------------------------------------------------- 수입사 (화인어프라이언스)


def fa_specs(text):
    """상세 '제품 스펙' 칸 → {이름: 값}. '정격소비 전력 / 3.1kW / 제품 규격 / 590x455x559 (WxHxD) / … / 상세기능'."""
    i, j = text.find("제품 스펙"), text.find("상세기능")
    if i < 0:
        return {}
    lines = [x.strip() for x in text[i + 5:j if j > i else None].splitlines() if x.strip()]
    keys = ("정격소비 전력", "제품 규격", "내부용량", "도어방향", "설치타공치수", "정격소비전압")
    out, k = {}, None
    for x in lines:
        if x in keys:
            k = x
        elif k:
            out[k] = x
            k = None
    return out


def fa_models(f):
    """수입사 목록 3개 → [{code, kind, series, page, specs}]. 코드 'BMP250-130' 의 '-' 는 글로벌 코드에서 뗀다."""
    out = []
    for lp in FA_LISTS:
        st, h = f.get(f"{FA}/{lp}")
        if st != 200:
            print(f"  [gaggenau] 수입사 목록 {lp} status={st}", file=sys.stderr)
            continue
        views = list(dict.fromkeys(re.findall(r'href="\./([a-z]+_view\d*\.php)"', h)))
        for v in views:
            u = f"{FA}/{v}"
            st, vh = f.get(u)
            if st != 200:
                continue
            # 줄마다 앞뒤 공백 · 주석(<!-- -->) 을 걷어낸 글 — '제품 / 오븐 / 200 Series / Combi-microwave Oven / BMP250-130 / 견적문의'
            t = "\n".join(x.strip() for x in K.F.html_to_text(re.sub(r"(?s)<!--.*?-->", " ", vh)).splitlines() if x.strip())
            m = re.search(r"\n제품\n(오븐|쿡탑|식기세척기)\n([^\n]+)\n([^\n]+)\n([A-Z]{2,3} ?\d{3}-?\d{3})\n견적문의", t)
            if not m:
                print(f"  [gaggenau] {u}: 제품 이름 칸을 못 읽음", file=sys.stderr)
                continue
            out.append({"menu": m.group(1), "series": m.group(2).strip(), "kind": m.group(3).strip(),
                        "code_kr": m.group(4).replace(" ", ""), "code": m.group(4).replace(" ", "").replace("-", ""),
                        "page": u, "specs": fa_specs(t)})
    return out


# ----------------------------------------------------------------------------- 글로벌 사이트맵

KITCHEN_PATH = re.compile(r"/global/en/mkt-product/((?:ovens|cooktops|extractors|dishwashing)/.*)/([A-Z]{2,3}\d{3}[A-Z0-9]{3,5})$")
SKIP_PATH = re.compile(r"warming|vacuum|knobs|coffee")


def gg_global(f):
    """→ {code: (url, 경로)} — 글로벌 사이트맵의 주방 제품 (워밍 · 진공 드로어, 노브 제외)."""
    st, xml = f.get(f"{GG}/global/sitemap.xml")
    out = {}
    for u in re.findall(r"<loc>([^<]+)</loc>", xml):
        m = KITCHEN_PATH.search(u)
        if m and not SKIP_PATH.search(m.group(1)) and m.group(2) not in out:
            out[m.group(2)] = (u, m.group(1))
    return out


def classify(path, name, p):
    """→ (category, subtype, install_type, 원문). 메뉴 경로가 정한다."""
    pl, nl = path.lower(), (name or "").lower()
    raw = f"{path} / {name}"
    if path.startswith("dishwashing"):
        return "dishwasher", "built_in", "built_in", raw
    if path.startswith("ovens"):
        # 전자레인지 단독 — 200 시리즈 'microwave-ovens' 메뉴(BMP224/225), Minimalistic 콤비 메뉴 안의 'microwave oven'(GM220/221)
        if "microwave" in nl and "combi" not in nl or "microwave-ovens" in pl and "combi" not in pl:
            return "microwave", "solo", "built_in", raw
        if "combimicrowave" in pl or "combi-microwave" in pl:
            return "oven", "combi", "built_in", raw
        if "steam" in pl:
            return "oven", "steam_oven", "built_in", raw + (" (콤비스팀오븐)" if "combi" in pl else "")
        return "oven", "oven", "built_in", raw
    if path.startswith("cooktops"):
        if "downdraft-ventilation" in pl and "induction" not in pl or "varioseriesdowndraft" in pl:
            return "hood", None, "built_in", raw + " (쿡탑 옆 다운드래프트 환기 모듈)"
        if "induction" in pl or "induction" in nl:
            return "cooktop", "induction", "built_in", raw
        if "gas" in pl or re.search(r"\bgas\b", nl):
            return "cooktop", "gas", "built_in", raw
        if "vitroceramique" in pl:
            return "cooktop", "highlight", "built_in", raw
        return "cooktop", None, "built_in", raw                     # 전기 그릴 · 테판야키 · 그 밖 Vario 모듈
    if path.startswith("extractors"):
        sub = ("chimney" if "wall" in pl else "island" if "island" in pl else "slim" if "flat" in pl
               else "built_in" if "canopy" in pl else None)      # 천장형 · 테이블 환기는 맞는 값이 없다
        return "hood", sub, ("built_in" if sub in ("built_in", "slim") or "table" in pl or "ceiling" in pl else None), raw
    return None, None, None, raw


def series_of(path, fa):
    """수입사 목록 제품 = '200 시리즈'. 글로벌에만 있는 제품 = '200 시리즈 (글로벌)' — 크기가 같은 색상 변형(BMP250110)이
    수입사 행(BMP250-130)에 묶여 국내 판매로 보이지 않게 line 을 나눈다 (collect.py merge 키에 line 이 있다)."""
    if fa:
        return fa["series"].replace(" ", "").replace("Series", " 시리즈")
    pl = path.lower()
    s = ("Expressive" if "expressive" in pl else "Minimalistic" if "minimalistic" in pl
         else "400 시리즈" if "400" in pl else "200 시리즈" if "200" in pl else "EB 333" if "eb-333" in pl else "기타")
    return s + " (글로벌)"


# ----------------------------------------------------------------------------- 행


def build_row(code, url, path, p, fa):
    cat, sub, inst, raw = classify(path, p["name"], p)
    if cat is None:
        return None
    name = p["name"] or code
    row = K.base_row(brand=BRAND, category=cat, category_subtype=sub, install_type=inst,
                     model_name=f"가게나우 {name}", model_codes=[fa["code_kr"] if fa else code], line=series_of(path, fa),
                     source_url=url, page_url=fa["page"] if fa else url, image_source_url=pick_image(p, code),
                     product_type_raw=raw)
    if fa:
        row["model_codes"].append(code)            # 글로벌 표기 (BMP250130) 도 같이 — 같은 제품
        row["product_type_raw"] = f"수입사: {fa['menu']} · {fa['series']} {fa['kind']} / 글로벌: {raw}"
    else:
        row["tags"].append("국내판매미확인")
    if cat == "cooktop" and "downdraft" in path.lower():
        row["tags"].append("후드일체형")                # 다운드래프트 환기 일체형 인덕션 (CV…)
    row["sale_status"] = p["avail"]
    notes = []
    # 외형
    dv = prop(p, "Dimensions (HxWxD)", "Dimensions")
    d = hwd(dv) if dv else None
    size_raw = f"Dimensions (HxWxD) {dv} mm (gaggenau.com/global)" if dv else None
    if not d and cat == "hood":
        hw, hh, hd = prop(p, "Width of the appliance"), prop(p, "Height of the appliance"), prop(p, "Depth of the product")
        if hw and hh and hd:
            d = {"w": rng(hw), "h": rng(hh), "d": rng(hd)}
            size_raw = f"W {hw} · H {hh} · D {hd} mm"
    if not d and code in GG_HOOD_DIMS:
        e = GG_HOOD_DIMS[code]
        d = {"w": (e["w"], e["w"]), "h": e["h"], "d": (e["d"], e["d"])}
        size_raw = f"공식 치수도 {e['drawing']} 판독: {e['note']}"
        row["tags"].append("이미지판독")
    if fa and fa["specs"].get("제품 규격"):
        size_raw = "; ".join(x for x in [size_raw, f"수입사 제품 규격 {fa['specs']['제품 규격']}"] if x)
        if not d:
            # 수입사 규격은 '(WxHxD)' 라 적었지만 쿡탑은 W x D x H 로 적혀 있다 (793x513x76) — 글로벌 값이 없을 때만, 오븐 · 식기세척기만
            if cat in ("oven", "microwave", "dishwasher"):
                d, _ = K.dims_of("(WxHxD)", fa["specs"]["제품 규격"], "whd")
    K.put_dims(row, d, size_raw)
    if fa and d and fa["specs"].get("제품 규격"):
        mine = sorted(v[0] for v in d.values())
        theirs = sorted(x[0] for x in K.split_dims(fa["specs"]["제품 규격"])[:3])
        if len(theirs) == 3 and any(abs(a - b) > 2 for a, b in zip(mine, theirs)):
            notes.append(f"수입사 규격 {fa['specs']['제품 규격']} 과 글로벌 {dv} 가 다르다")
            row["tags"].append("출처불일치")
    # 니치 (오븐 · 식기세척기)
    nh = (prop(p, "Niche height (min)"), prop(p, "Niche height (max)"))
    nw = (prop(p, "Niche width (min)"), prop(p, "Niche width (max)"))
    nd = (prop(p, "Niche depth (min)", "Niche depth"), prop(p, "Niche depth (max)"))
    if any(nh + nw + nd):
        put_niche(row, num(nw[0]), num(nw[1]), num(nh[0]), num(nh[1]), num(nd[0]), num(nd[1]),
                  f"Niche width {nw[0]}~{nw[1]} · height {nh[0]}~{nh[1]} · depth {nd[0]}"
                  + (f"~{nd[1]}" if nd[1] else "") + " mm (gaggenau.com/global)")
    # 타공 (쿡탑)
    if cat in ("cooktop", "hood"):
        cut = fa["specs"].get("설치타공치수") if fa else None
        if cut:
            parts = K.split_dims(cut)
            if len(parts) >= 2:
                row["cutout_w_mm"], row["cutout_d_mm"] = parts[0][0], parts[1][0]
                row["cutout_raw"] = f"수입사 설치타공치수 {cut} (H = 상판 깊이 방향)"
                e = KR_CUT_CHECK.get(code)
                if e and tuple(e["cut"]) != (parts[0][0], parts[1][0]):
                    # 수입사 글자 ≠ 제조사 치수도 — 제조사 값을 칸에 넣고 둘 다 남긴다 (사장님 확인)
                    row["cutout_w_mm"], row["cutout_d_mm"] = e["cut"]
                    row["cutout_raw"] += f" ≠ 제조사 공식 치수도 {e['drawing']} 판독: {e['note']} — 칸에는 제조사 값"
                    row["tags"] += ["출처불일치", "이미지판독"]
        else:
            e = next((GG_CUTOUTS[GG_CUT_ALIAS.get(c, c)] for c in row["model_codes"]
                      if GG_CUT_ALIAS.get(c, c) in GG_CUTOUTS), None)
            if e:
                row["cutout_w_mm"], row["cutout_d_mm"] = e["cut"]
                row["cutout_r_mm"] = e.get("r")
                row["cutout_raw"] = f"공식 치수도 {e['drawing']} 판독: {e['note']}"
                if e.get("side"):
                    row["side_gap_mm"] = e["side"]     # 그림 글자 '타공에서 (옆)벽까지 최소 거리'
                if "이미지판독" not in row["tags"]:
                    row["tags"].append("이미지판독")
        t = prop(p, "Minimum worktop thickness")
        if t:
            notes.append(f"상판 최소 두께 {t} mm")
        bd = prop(p, "Built-in design")
        if bd:
            notes.append(f"설치: {bd}")
    # 후드 — 조리기구 위 최소 거리
    if cat == "hood":
        for n in ("Minimum distance above electric cooktops", "Minimum distance above gas cooktops", "Height of the chimney"):
            v = prop(p, n)
            if v:
                notes.append(f"{n} {v} mm")
    # 용량 · 인용 · 도어
    vol = prop(p, "Net volume", "Usable volume")
    if vol and cat in ("oven", "microwave"):
        row["capacity_l"] = num(vol)
    pc = prop(p, "Number of place settings (max)", "Maximum number of place settings")
    if pc and cat == "dishwasher":
        row["place_count"] = num(pc)
    hinge = prop(p, "Door hinge")
    if hinge:
        notes.append(f"도어 경첩 {hinge}")
    if fa and fa["specs"].get("도어방향"):
        notes.append(f"수입사 도어방향 {fa['specs']['도어방향']}")
    if cat == "dishwasher":
        for n in ("Installation", "Door panel weight (min - max)", "Depth with open door (90°)"):
            v = prop(p, n)
            if v:
                notes.append(f"{n} {v}")
    if cat == "cooktop" and sub == "gas":
        gn = gas_of(row, p)
        if gn:
            notes.append(gn)
    if notes:
        row["install_notes"] = " · ".join(notes)
    dids = drawing_ids(p)
    if dids:
        row["product_type_raw"] += " / 치수도 " + ", ".join(dids[:4])
    return row


def collect(f, K_, sample=None):
    global K
    K = K_
    fa = fa_models(f)
    print(f"[gaggenau] 수입사(화인어프라이언스) 주방 제품={len(fa)}", file=sys.stderr)
    glob = gg_global(f)
    print(f"[gaggenau] 글로벌 주방 제품={len(glob)}", file=sys.stderr)
    fa_codes = {m["code"]: m for m in fa}
    todo = []                                               # (code, url, path, fa)
    for m in fa:
        u, path = glob.get(m["code"], (f"{GG}/global/mkt-product/{m['code']}", None))
        todo.append((m["code"], u, path, m))
    extras = [(c, u, path, None) for c, (u, path) in glob.items() if c not in fa_codes]
    if sample:
        todo = todo[:sample]
        groups = {}
        for x in extras:
            groups.setdefault(x[2].split("/")[0] + "/" + x[2].split("/")[-1], []).append(x)
        extras = [g[0] for g in groups.values()][:sample * 4]
    rows = []
    for code, u, path, m in todo + extras:
        st, h = f.get(u)
        if st != 200:
            print(f"  [gaggenau] {code}: 글로벌 페이지 status={st} — 건너뜀", file=sys.stderr)
            continue
        p = bsh_page(h)
        volt = prop(p, "Nominal voltage") or ""
        if code.endswith("CA") or re.search(r"\d\s*(?:\"|'')", p["name"] or "") or re.search(r"\b(?:208|120)\b", volt):
            # 북미 전용 (인치 이름 · 240/208 V · 120 V) — CG280212CA 'Gas cooktop 30"', GS460720 'combi-steam oven 30''' (240/208 V).
            #   냉장고 수집기와 같이 뺀다
            print(f"  [gaggenau] {code}: 북미 전용 '{p['name']}' — 건너뜀", file=sys.stderr)
            continue
        if path is None:   # 사이트맵에 없던 수입사 코드 (VI232120) — 페이지의 빵부스러기 대신 제품명으로 메뉴를 정한다
            nl = (p["name"] or "").lower()
            path = ("cooktops/vario/induction" if "induction" in nl else "cooktops/vario/gas" if "gas" in nl
                    else "ovens/oven" if "oven" in nl else "dishwashing" if "dishwasher" in nl else "")
        if p["mpn"] and p["mpn"] != code:
            print(f"  [gaggenau] {code}: 페이지 mpn={p['mpn']} 다름", file=sys.stderr)
        row = build_row(code, u, path, p, m)
        if row:
            rows.append(row)
    return rows
