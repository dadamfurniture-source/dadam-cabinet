"""나비엔 매직 (경동나비엔) 주방가전 — 가스레인지 · 전기레인지(인덕션 · 하이브리드 · 가스 하이브리드) · 레인지후드 · 전기오븐 · 전자레인지.
(2026-10-25 3차, 사장님 "나비엔 매직 수집")

SK매직이 2024년 가스 · 전기레인지 · 오븐 사업을 경동나비엔에 넘겼다 — 브랜드 '나비엔 매직'. 식기세척기는 팔지 않는다 (목록에 없음).

출처 (모두 공식)
  ① 목록 · 모델 코드 · 연료(가스) 옵션 · 사진 — 경동나비엔 공식몰 '나비엔 하우스' www.navienhouse.com
       sitemap.xml → /products/G… 상품 페이지. JSON-LD Product (name · mpn · category '주방기기 > 가스레인지' ·
       additionalProperty '타공 사이즈 (mm)' · '타입' · '용량(L)' · image · availability) + 페이지 RSC 데이터의 옵션
       '연료' — 'LNG(도시가스)' / 'LPG(프로판가스)' 와 SAP 자재 코드 (PGRB6303NDBLN = GRB-6303ND · PGRB6303PDBLN = GRB-6303PD).
       robots.txt 첫 줄이 'Allow: /' 라 파이썬 robotparser 가 아래 Disallow 를 무시한다 — 막힌 /mypage · /cart · /order ·
       /searchResult · 광고 매개변수(?utm_ 등)는 부르지 않는다 (사이트맵의 /products/G… 만).
  ② 치수 · 타공 · 사용가스 (글자) — 나비엔 E-카탈로그(catalog.kdnavien.co.kr, robots.txt 없음 = 허용)의 '카탈로그 다운로드' PDF
       '나비엔 매직 주방기기 종합 카탈로그 KA대리점 2512' (28쪽 펼침면). 표 '모델명 · 사이즈 · 타공 사이즈 · 사용가스 ·
       가스소비량' 을 PyMuPDF 글자 위치로 읽는다 (haatz.py 와 같은 방법 — python -E 로 따로 띄워 cache/ 에 글자만).
       → 태그 '매뉴얼' (공식 PDF 글자 — 검증). 후드 표에는 크기 칸이 없다 (치수는 그림 글자뿐).
  ③ 치수 (그림) — 카탈로그 글자에 없는 상품은 상품 페이지 상세 그림(static.navienhouse.com — robots.txt 없음)의 '제품사양' 표를
       사람이(에이전트가) 한 장씩 받아 읽어 NV_IMG 에 옮겼다 (2026-10-25) → '이미지판독' (미검증). 수집기는 그림을 받지 않는다.
       같은 표를 카탈로그 행과도 맞춰 보았다 (NV_IMG_CHECK) — 2 mm 넘게 다르면 '출처불일치'.

가스 종류 (사장님 "가스레인지는 LPG, LNG(도시가스) 두 가지로 나눠야함")
  나비엔 매직은 가스마다 모델 코드가 다르다 — 끝 두 글자 ND / NA = LNG(도시가스), PD / PA = LPG(프로판가스)
  (카탈로그 '모델명' 칸이 코드마다 나뉘고 '사용가스' 칸이 LNG · LPG, 나비엔 하우스 '연료' 옵션의 SAP 코드도 같다).
  그래서 코드 하나 = 행 하나로 만들고 gas_types 를 하나씩 넣는다 (collect.py merge 가 gas_types 가 다르면 묶지 않는다).
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

BRAND_KEY = "navien"
K = None   # collect.py 가 넘긴다

BRAND = "나비엔 매직"
NH = "https://www.navienhouse.com"
NH_SITEMAP = NH + "/sitemap.xml"
NH_IMG = "https://static.navienhouse.com/data/navienhouse/backup/nextprod/cdn/images/ko/product/navienmagic/"
EC = "https://catalog.kdnavien.co.kr"
EC_DETAIL = EC + "/product-detail?model=16&category=Kitchen&subcategory=&product="   # pdf-download.js 를 부르는 쪽
EC_PDF_FALLBACK = EC + "/" + urllib.parse.quote("나비엔 매직 주방기기 종합_카탈로그_KA대리점_2512.pdf")
CODE_GROUP = {}   # 코드 → 같은 제품(나비엔 하우스 상품 · 카탈로그 제목 묶음)의 코드들 (collect 가 채운다) — LNG · LPG 짝 찾기
CODE = re.compile(r"^(?:GR[BF]|ER[IGH]|CE[IR]|EO[BF]|MWR|R[AG][A-Z])\d{0,3}-?\d{2,4}[A-Z0-9]*$")

# PDF 한 권 → 쪽마다 span [x0, y0, x1, y1, 글자크기, 글자]. 같은 파이썬을 -E -P 로 (fitz 는 사용자 site-packages)
FITZ = r"""
import sys, json, fitz
d = fitz.open(sys.argv[1]); out = []
for p in d:
    ss = []
    for b in p.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                t = s["text"].strip()
                if t:
                    x0, y0, x1, y1 = s["bbox"]
                    ss.append([round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1), round(s["size"], 1), t])
    out.append({"w": round(p.rect.width, 1), "h": round(p.rect.height, 1), "spans": ss})
open(sys.argv[2], "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
"""

# ----------------------------------------------------------------------------- ③ 상세 그림에서 읽은 값 (→ '이미지판독')
# 키 = 상품 페이지 mpn 의 첫 코드. wdh = (가로, 깊이, 높이) — 높이가 범위면 (낮은, 높은). cut = 빌트인 타공 (가로, 깊이[, 매립 높이]).
# img = 그림 경로 (NH_IMG 뒤). labeled = 표에 W · D · H 표시가 있다 (없으면 '치수순서추정'). 2026-10-25 판독.
_GRF2 = (590, 410, 160)


def _g(img, wdh, labeled=False, note=None):
    return {"img": img, "wdh": wdh, "labeled": labeled, "note": note}


def _e(img, wdh, cut, note=None):
    return {"img": img, "wdh": wdh, "cut": cut, "labeled": True, "note": note}


NV_IMG = {
    # 프리스탠딩(스탠드) 가스레인지 — 표 '모델명 GRF-1012ND(LNG사양) / GRF-1012PD(LPG사양) · 제품사이즈 590 X 410 X 160 mm'
    "GRF-1012ND": _g("GRF-1012ND/GRF-1012ND_12_1.jpg", _GRF2),
    "GRF-1022ND": _g("GRF-1022ND/GRF-1022ND_12_1.jpg", _GRF2),
    "GRF-1032ND": _g("GRF-1032ND/section_12_1.jpg", _GRF2),
    "GRF-1042ND": _g("GRF-1042ND/section_12_1.jpg", _GRF2),
    "GRF-1052ND": _g("GRF-1052ND/section_12_1.jpg", _GRF2),
    "GRF-1102ND": _g("GRF-1102ND/GRF-1102ND_14_1.jpg", _GRF2),
    "GRF-1112ND": _g("GRF-1112ND/GRF-1112ND_15_1.jpg", _GRF2),
    "GRF-1122ND": _g("GRF-1122ND/GRF-1122ND_14_1.jpg", _GRF2),
    "GRF-1202ND": _g("GRF-1202ND/GRF-1202ND_14_1.jpg", _GRF2),
    "GRF-1302ND": _g("GRF-1302ND/GRF-1302ND_12_1.jpg", _GRF2),
    "GRF-1312ND": _g("GRF-1312PD/GRF-1312PD_12_1.jpg", _GRF2),
    "GRF-1322ND": _g("GRF-1322ND/GRF-1322ND_12_1.jpg", _GRF2),
    "GRF-1342ND": _g("GRF-1342ND/GRF-1342ND_12_1.jpg", _GRF2),
    "GRF-1352ND": _g("GRF-1352ND/section_12_1.jpg", _GRF2, note="그림 표가 'GRF-1352PD(LNG사양)' 로 적었다 — 연료 옵션(LPG = …PD)이 맞는 것으로 봄"),
    "GRF-1362ND": _g("GRF-1362ND/section_12_1.jpg", _GRF2, note="그림 표가 'GRF-1362PD(LNG사양)' 로 적었다 — 연료 옵션(LPG = …PD)이 맞는 것으로 봄"),
    "GRF-2002ND": _g("GRF-2002ND/GRF-2002ND_14_1.jpg", (594, 430, 163)),
    "GRF-2102ND": _g("GRF-2102ND/GRF-2102ND_14_1.jpg", (594, 450, 163), note="그림 표의 LPG 코드가 'GRA-2102PD' (오타로 보임)"),
    "GRF-2112ND": _g("GRF-2112ND/GRF-2112ND_14_1.jpg", (594, 450, 163), note="그림 표의 LPG 코드가 'GRA-2112PD' (오타로 보임)"),
    "GRF-3002ND": _g("GRF-3002ND/GRF-3002ND_14_1.jpg", (594, 530, 165)),
    "GRF-6103ND": _g("GRF-6103ND/GRF-6103ND_14_1.jpg", (594, 519, 165)),
    "GRF-6203ND": _g("GRF-6203ND/GRF-6203ND_14_1.jpg", (594, 530, 165)),
    "GRF-7003ND": _g("GRF-7003ND/GRF-7003ND_14_1.jpg", (594, 520, 180)),
    # 전기레인지 — '제품 사이즈(W*D*H)' · '빌트인 타공 치수(W*D*H)'
    "ERI-1001AN": _e("ERI-1001AN/ERI-1001AN_11_260603.jpg", (300, 315, 54), None, "빌트인 타공 치수 '프리스탠딩 모델(빌트인 불가)'"),
    "ERI-1011AN": _e("ERI-1011AN/ERI-1011AN_11_260603.jpg", (300, 315, 54), None, "빌트인 타공 치수 '프리스탠딩 모델(빌트인 불가)'"),
    "ERI-3423AF": _e("ERI-3423AF/ERI-3423AF_12.jpg", (594, 510, 60), (560, 480), "다음 그림 ERI-3423AF_13_260603 '싱크대 타공 치수 W560 X D480 X H80'"),
    "ERI-3603AF": _e("ERI-3603AF/ERI-3603AF_10.jpg", (594, 510, 60), (560, 480), "다음 그림 ERI-3603AF_11 '싱크대 타공 치수 W560 X D480 X H80'"),
    "ERI-3623AF": _e("ERI-3623AF/ERI-3623AF_12_1.jpg", (594, 510, 60), (560, 480), "다음 그림 ERI-3623AF_13_260603 '싱크대 타공 치수 W560 X D480 X H80'"),
    "ERI-3643AF": _e("ERI-3643AF/ERI-3643AF_12.jpg", (594, 510, 60), (560, 480), "다음 그림 ERI-3643AF_13_260603 '싱크대 타공 치수 W560 X D480 X H80'"),
    "ERI-4103AF": _e("ERI-4103AF/ERI-4103AF_10_1.jpg", (594, 510, 60), (560, 480), "다음 그림 ERI-4103AF_11 '싱크대 타공 치수 W560 X D480 X H80'"),
    "ERI-4013AN": _e("ERI-4013AN/ERI-4013AN_10_1_260603.jpg", (595, 525, 60), (560, 480, 80)),
    "ERI-4033AN": _e("ERI-4033AN/ERI-4033AN_15_1_260603.jpg", (595, 525, 60), (560, 480, 80)),
    "ERI-5013AF": _e("ERI-5013AF/ERI-5013AF_15_1_260603.jpg", (594, 510, 62), (560, 480, 80)),
    "ERI-5033AF": _e("ERI-5033AF/ERI-5033AF_12_1_260603.jpg", (594, 510, 62), (560, 480, 80)),
    "ERI-5053AF": _e("ERI-5053AF/ERI-5053AF_13_1_260603.jpg", (594, 510, 62), (560, 480, 80)),
    "ERI-5203AF": _e("ERI-5203AF/ERI-5203AF_16_260603.jpg", (594, 510, 62), (560, 480, 80)),
    "ERI-5233AF": _e("ERI-5233AF/ERI-5233AF_16_260603.jpg", (594, 510, 62), (560, 480, 80)),
    "ERI-5243AF": _e("ERI-5243AF/ERI-5243AF_16_260603.jpg", (594, 510, 62), (560, 480, 80)),
    "ERH-3803DN": _e("ERH-3803DN/ERH-3803DN_13_1_260603.jpg", (580, 500, 60), (560, 480, 80)),
    # 상세 그림에 타공만 있고 제품 크기 표가 없다 (색상 변형 페이지) — 치수 없는 행
    "ERI-3443AF": _e("ERI-3443AF/ERI-3443AF_13_260603.jpg", None, (560, 480, 80), "제품 크기 표가 없다 (그림 '싱크대 타공 치수 W560 X D480 X H80' 만)"),
    "ERI-3463AF": _e("ERI-3463AF/ERI-3463AF_13_260603.jpg", None, (560, 480, 80), "제품 크기 표가 없다 (그림 '싱크대 타공 치수 W560 X D480 X H80' 만)"),
    "ERI-3663AF": _e("ERI-3663AF/ERI-3663AF_13_260603.jpg", None, (560, 480, 80), "제품 크기 표가 없다 (그림 '싱크대 타공 치수 W560 X D480 X H80' 만)"),
    # 전기오븐 · 전자레인지 — '제품사이즈 · 제품 외형 (W)594 X (D)541 X (H)465 mm'
    "EOB-5004SF": _g("EOB-5004SF/EOB-5004SF_10_260701.jpg", (594, 541, 465), True, "조리실 (W)407 X (D)402 X (H)256 mm"),
    "EOF-1102NT": _g("EOF-1102NT/EOF-1102NT_09_260701.jpg", (469, 400, 280), True, "조리실 (W)301 X (D)329 X (H)228 mm"),
    "EOF-1112NT": _g("EOF-1112NT/EOF-1112NT_09_260701.jpg", (469, 400, 280), True, "조리실 (W)301 X (D)329 X (H)228 mm"),
    "EOF-1202NT": _g("EOF-1202NT/EOF-1202NT_13_260701.jpg", (472, 414, 297), True, "조리실 (W)301 X (D)329 X (H)228 mm"),
    "EOF-1302NT": _g("EOF-1302NT/EOF-1302NT_09_260701.jpg", (520, 501, 326), True, "조리실 (W)332 X (D)348 X (H)242 mm"),
    "EOF-1312NT": _g("EOF-1312NT/EOF-1312NT_09_260701.jpg", (520, 501, 326), True, "조리실 (W)332 X (D)348 X (H)242 mm"),
    "EOF-1403NT": _g("EOF-1403NT/EOF-1403NT_09_260701.jpg", (520, 528, 327), True, "조리실 (W)351 X (D)351 X (H)240.5 mm"),
    "MWR-1001MT": _g("MWR-1001MT_1011MT/MWR-1001MT_09.jpg", (440, 355, 259), True, "조리실 306(W) X 304(D) X 209(H) mm"),
    "MWR-1201MT": _g("MWR-1201MT/MWR-1201MT_10.jpg", (440, 355, 259), True, "조리실 306(W) X 304(D) X 206(H) mm"),
    "MWR-1411ET": _g("MWR-1411ET/08.jpg", (440, 323, 257), True, "조리실 306(W) × 307(D) × 208(H) mm"),
    "MWR-1502EF": _g("MWR-1502EF/07.jpg", (472, 344, 295), True, "외형 깊이 '344(370)(D)' — 괄호 값 370 은 뜻이 적혀 있지 않다 (손잡이 포함으로 보임). 조리실 326 × 328 × 218"),
    "MWR-1512EF": _g("MWR-1512EF/07.jpg", (472, 344, 295), True, "외형 깊이 '344(370)(D)' — 괄호 값 370 은 뜻이 적혀 있지 않다 (손잡이 포함으로 보임). 조리실 326 × 328 × 218"),
    # 레인지후드 — '사이즈(WxDxH, mm) 898 x 450 x 350~630mm' (높이 범위 = 덕트 커버 조절)
    "RAB552-09TCAC": _g("RAB552-09TCAC/RAB552-09TCAC_08.jpg", (898, 520, 350), True),
    "RAC552-09TCAC": _g("RAC552-09TCAC_TCBC/RAC552-09TCBC_08.jpg", (898, 520, (430, 760)), True, "중량 20.8 (TCAC) · 21.3 kg (TCBC)"),
    "RGB150-09TBAC": _g("RGB150-09TBAC/RGB150-09TBAC_09.jpg", (898, 460, 350), True),
    "RGC150-06PAA": _g("RGC150-06PAA/RGC150-06PAA_07.jpg", (598, 450, (400, 700)), True),
    "RGC150-09PAB": _g("RGC150-09PAB/RGC150-09PAB_07.jpg", (898, 450, (350, 630)), True),
    "RGC150-09PAC": _g("RGC150-09PAC/RGC150-09PAC_07.jpg", (898, 450, (350, 630)), True),
    "RGC150-09TAA": _g("RGC150-09TAA/RGC150-09TAA_07.jpg", (898, 450, (350, 630)), True),
    "RGC150-09TBAC": _g("RGC150-09TBAC/RGC150-09TBAC_10.jpg", (898, 450, (420, 700)), True),
    "RGI150-03TAA": _g("RGI150-03TAA/RGI150-03TAA_08.jpg", (360, 360, 750), True),
    "RGI150-04TAA": _g("RGI150-04TAA/RGI150-04TAA_08.jpg", (450, 360, 770), True),
    "RGM150-06PAB": _g("RGM150-06PAB/RGM150-06PAB_06.jpg", (598, 285, 142), True),
    "RGM350-06PAA": _g("RGM350-06PAA/RGM350-06PAA_07.jpg", (518, 278, 281), True),
    "RGM350-09PAA": _g("RGM350-09PAA/RGM350-09PAA_07.jpg", (719, 286, 351), True),
    "RGS150-06PAB": _g("RGS150-06PAB/RGS150-06PAB_07.jpg", (598, 252, 210), True),
    "RGS151-06PAB": _g("RGS151-06PAB/RGS151-06PAB_07.jpg", (598, 252, 210), True),
    "RGT150-06PAA": _g("RGT150-06PAA/RGT150-06PAA_07.jpg", (598, 310, 700), True),
    "RGT150-06TAA": _g("RGT150-06TAA/RGT150-06TAA_07.jpg", (598, 310, 700), True),
    "RGX150-06PAA": _g("RGX150-06PAA/RGX150-06PAA_08.jpg", (598, 500, (619, 900)), True),
    "RGX150-09PAA": _g("RGX150-09PAA/RGX150-09PAA_08.jpg", (898, 500, (560, 776)), True),
    "RGX150-09PAB": _g("RGX150-09PAB/RGX150-09PAB_08.jpg", (898, 500, (619, 900)), True),
}
# 카탈로그 글자 값과 상세 그림 값 대조 (2026-10-25 판독). 2 mm 넘게 다르면 '출처불일치' — 칸에는 카탈로그 글자 값, 그림 값은 비고에.
#   같았던 것: GRB-2003NA · 2103ND · 3303ND · 4103ND · 6103ND · 6303ND · GRF-1002ND · CEI150-02B2N · CER150-02B2N ·
#   ERG-5003DN · ERG-5103DF · EOB-3004ST. ERI-5023AF · 5043AF 는 높이 1 mm 차이 (카탈로그 61 · 그림 62) — 비고만
NV_IMG_CHECK = {
    "GRB-1002NA": ("GRB-1002NA/GRB-1002NA_12_1.jpg", (290, 510, 60)),
    "GRB-1102ND": ("GRB-1102ND/GRB-1102ND_12_1.jpg", (290, 510, 60)),
    "GRB-2003NA": ("GRB-2003NA/GRB-2003NA_12_1.jpg", (588, 470, 50)),
    "GRB-2103ND": ("GRB-2103ND/GRB-2103ND_12_1.jpg", (588, 470, 50)),
    "GRB-3203NA": ("GRB-3203NA/GRB-3203NA_12_1.jpg", (594, 510, 51)),
    "GRB-3303ND": ("GRB-3303ND/GRB-3303ND_12_1.jpg", (594, 510, 51)),
    "GRB-4103ND": ("GRB-4103ND/GRB-4103ND_12_1.jpg", (588, 470, 50)),
    "GRB-6003NA": ("GRB-6003NA/GRB-6003NA_13_1.jpg", (588, 470, 50)),
    "GRB-6103ND": ("GRB-6103ND/GRB-6103ND_13_1.jpg", (583, 466, 55)),
    "GRB-6203NA": ("GRB-6203NA/GRB-6203NA_13_1.jpg", (594, 510, 55)),
    "GRB-6303ND": ("GRB-6303ND/GRB-6303ND_13_1.jpg", (594, 510, 55)),
    "GRB-7003ND": ("GRB-7003ND/GRB-7003ND_14_1.jpg", (588, 470, 20)),
    "GRB-9104NA": ("GRB-9104NA/GRB-9104NA_12_1.jpg", (598, 510, 56)),
    "GRF-1002ND": ("GRF-1002ND/GRF-1002ND_12_1.jpg", (590, 410, 160)),
    "GRF-6003ND": ("GRF-6003ND/GRF-6003ND_12_1.jpg", (594, 520, 165)),
    "CEI150-02B2N": ("CEI150-02B2N/CEI150-02B2N_14_260603.jpg", (285, 510, 57)),
    "CER150-02B2N": ("CER150-02B2N/CER150-02B2N_12_260603.jpg", (285, 510, 55)),
    "ERG-5003DN": ("ERG-5003DN/ERG-5003DN_10_260603.jpg", (594, 510, 57.6)),
    "ERG-5103DF": ("ERG-5103DF/ERG-5103DF_13_260929.jpg", (594, 510, 57.6)),
    "ERH-3603DN": ("ERH-3603DN/ERH-3603DN_13_1_260603.jpg", (580, 500, 60)),
    "ERI-5023AF": ("ERI-5023AF/ERI-5023AF_15_1_260603.jpg", (594, 510, 62)),
    "ERI-5043AF": ("ERI-5043AF/ERI-5043AF_13_1_260603.jpg", (594, 510, 62)),
    "EOB-3004ST": ("EOB-3004ST/EOB-3004ST_12_260701.jpg", (595, 568, 455)),
}

# ----------------------------------------------------------------------------- PDF


def pdf_spans(f, url):
    """공식 PDF → 쪽 목록 (span). Fetcher 와 같은 규칙 (robots.txt · 1.2초 간격 · 같은 UA), 결과는 cache/ 에 글자만."""
    cp = f._cache_path("PDFSPANS", url, None)
    if os.path.exists(cp):
        with open(cp, encoding="utf-8") as fp:
            c = json.load(fp)
        f.cache_hits += 1
        return json.loads(c["body"]) if c["status"] == 200 else []
    if f.offline:
        raise RuntimeError(f"offline and not cached: {url}")
    if not f.allowed(url):
        raise PermissionError(f"robots.txt disallows {url}")
    f._sleep()
    req = urllib.request.Request(url, headers={"User-Agent": K.F.UA})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, b""
    f.net_count += 1
    pages = []
    if status == 200 and raw[:5] == b"%PDF-":
        with tempfile.TemporaryDirectory() as td:
            src, out = os.path.join(td, "in.pdf"), os.path.join(td, "out.json")
            with open(src, "wb") as fp:
                fp.write(raw)
            subprocess.run([sys.executable, "-E", "-P", "-c", FITZ, src, out], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not os.path.exists(out):
                print("[navien] PyMuPDF(fitz) 로 PDF 를 읽지 못했다 — 카탈로그 없이 진행 (pip install --user pymupdf)", file=sys.stderr)
                return []
            with open(out, encoding="utf-8") as fp:
                pages = json.load(fp)
    elif status == 200:
        status = 415
    print(f"  [net {status}] PDF {url[:110]} ({len(raw)} B, {len(pages)} 쪽)", file=sys.stderr)
    with open(cp, "w", encoding="utf-8") as fp:
        json.dump({"url": url, "method": "PDFSPANS", "status": status, "bytes": len(raw),
                   "fetched_at": dt.datetime.now().isoformat(timespec="seconds"),
                   "body": json.dumps(pages, ensure_ascii=False)}, fp, ensure_ascii=False)
    return pages


def catalog_url(f):
    """E-카탈로그 '카탈로그 다운로드' — pdf-download.js 의 주방기기(KITCHEN) PDF 주소. 못 찾으면 2025.12 판 주소."""
    try:
        st, h = f.get(EC_DETAIL)
        js = re.search(r'src="(/js/util/pdf-download\.js[^"]*)"', h) if st == 200 else None
        if js:
            st, t = f.get(EC + js.group(1))
            m = re.search(r'"KITCHEN"\)\s*\{\s*url\s*=\s*\'([^\']+\.pdf)\'', t) if st == 200 else None
            if m:
                u = m.group(1)
                return u.split("://", 1)[0] + "://" + urllib.parse.quote(u.split("://", 1)[1], safe="/:")
    except (RuntimeError, PermissionError) as e:
        print(f"[navien] 카탈로그 주소 찾기 실패 ({e}) — 기본 주소", file=sys.stderr)
    return EC_PDF_FALLBACK


def halves(page):
    """펼침면(가로 1190) → 왼쪽 · 오른쪽 쪽 (x 를 쪽 안 좌표로)."""
    half = page["w"] / 2
    left = [s for s in page["spans"] if s[0] < half]
    right = [[s[0] - half, s[1], s[2] - half, s[3], s[4], s[5]] for s in page["spans"] if s[0] >= half]
    return [left, right]


def tables_of(spans):
    """'모델명' 줄 = 표 머리, 그 아래 왼쪽 칸 이름(x < 115) 줄마다 값. 값이 놓인 x 로 열(모델 코드)에 붙인다:
    표 위 큰 제목(글자 12pt 이상, 'GRB-9104NA / PA' · 'GRB-9004NA')이 제품 묶음, 묶음 안 값이 한 코드 바로 아래면 그 코드,
    두 코드 사이(가운데)면 묶음의 모든 코드."""
    out = []
    labs = sorted([s for s in spans if s[0] < 115 and 5 <= s[4] <= 7 and not s[5].startswith(("*", "※"))], key=lambda s: s[1])
    heads = [s for s in labs if s[5] == "모델명"]
    for hi, h in enumerate(heads):
        y0 = h[1]
        y_end = heads[hi + 1][1] if hi + 1 < len(heads) else 9999
        codes = sorted([s for s in spans if abs(s[1] - y0) <= 1.5 and s[0] > 115 and CODE.match(s[5])], key=lambda s: s[0])
        titles = [s for s in spans if s[4] >= 12 and y0 - 260 < s[1] < y0]
        if titles:
            ty = max(t[1] for t in titles)
            titles = sorted([t for t in titles if abs(t[1] - ty) < 3], key=lambda t: t[0])
        blocks = [t[0] for t in titles] or [115]
        cols = []
        for c in codes:
            cx = (c[0] + c[2]) / 2
            bi = max([i for i, bx in enumerate(blocks) if cx >= bx - 15] or [0])
            cols.append({"code": c[5], "cx": cx, "block": bi, "title": titles[bi][5] if titles else "", "vals": {}})
        rows, last = [], y0
        for lab in labs:
            if lab[1] <= y0 or lab[1] >= y_end:
                continue
            if lab[1] - last > 40:
                break
            last = lab[1]
            rows.append(lab)
        for lab in rows:
            for v in [s for s in spans if abs(s[1] - lab[1]) <= 2 and s[0] > 115 and s not in codes]:
                vx = (v[0] + v[2]) / 2
                bi = max([i for i, bx in enumerate(blocks) if vx >= bx - 15] or [0])
                mine = [c for c in cols if c["block"] == bi]
                near = [c for c in mine if abs(c["cx"] - vx) < 25]
                for c in (near or mine):
                    c["vals"][lab[5]] = (c["vals"].get(lab[5], "") + " " + v[5]).strip()
        out.append(cols)
    return out


def catalog_models(pages, url):
    """카탈로그 → {코드: {'vals': {칸: 값}, 'page': PDF 쪽, 'title': 제목, 'section': 쪽 머리('빌트인 가스레인지' 등)}}."""
    out = {}
    for pi, page in enumerate(pages):
        # 오른쪽 끝 색인 탭 ('침니형 후드' · '가스레인지' · '3D 에어후드') — 나비엔 하우스에 없는 모델의 종류에 쓴다
        tab = " ".join(s[5] for s in sorted(page["spans"], key=lambda s: s[1])
                       if s[0] > page["w"] - 45 and 6.5 <= s[4] <= 9 and not re.fullmatch(r"\d+", s[5]))
        for side in halves(page):
            sec = " ".join(s[5] for s in sorted(side, key=lambda s: s[1]) if s[0] < 115 and 9.5 <= s[4] <= 11.5 and s[1] < 80)
            for cols in tables_of(side):
                for c in cols:
                    out.setdefault(c["code"], {"vals": c["vals"], "page": pi + 1, "title": c["title"], "section": sec,
                                               "tab": tab, "url": url})
    return out


# ----------------------------------------------------------------------------- 나비엔 하우스


def expand(mpn):
    """'GRB-6303ND/PD' → [GRB-6303ND, GRB-6303PD], 'ERG-5003DN/5013DN' → [ERG-5003DN, ERG-5013DN],
    'RAC552-09TCAC/TCBC' → [RAC552-09TCAC, RAC552-09TCBC], 'MWR-1001MT/1011MT' → [MWR-1001MT, MWR-1011MT]."""
    parts = [p.strip() for p in (mpn or "").split("/") if p.strip()]
    if not parts:
        return []
    base, out = parts[0], [parts[0]]
    for p in parts[1:]:
        if "-" in p:
            out.append(p)
        elif p.isalpha() and len(p) < len(base):
            out.append(base[:-len(p)] + p)
        else:
            out.append(base.split("-")[0] + "-" + p)
    return out


def options_of(h):
    """상품 페이지 RSC 조각(self.__next_f.push) → [(옵션 이름, 항목 이름, SAP 자재 코드)].
    옵션 상세는 항목 목록을 바로 담거나("prdOptnItmDtos":[{…}]) 다른 줄을 가리킨다("prdOptnItmDtos":"$61" → 61:["$62"] → 62:{…})."""
    parts = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', h)
    s = "".join(json.loads('"' + p + '"') for p in parts)
    refs = dict(re.findall(r"(?m)^([0-9a-f]+):(.+)$", s))

    def deref(v, depth=0):
        if isinstance(v, str) and v.startswith("$") and v[1:] in refs and depth < 4:
            try:
                return deref(json.loads(refs[v[1:]]), depth + 1)
            except ValueError:
                return None
        if isinstance(v, list):
            return [deref(x, depth + 1) for x in v]
        return v

    out = []
    for m in re.finditer(r'\{"prdOptnItmDtos":(\[[^\]]*\]|"\$[0-9a-f]+"),[^{}]*?"sapMtrilCd":"([^"]*)"', s):
        try:
            items = deref(json.loads(m.group(1)))
        except ValueError:
            continue
        for it in items or []:
            if isinstance(it, dict) and it.get("prodOptnNm"):
                out.append((it["prodOptnNm"], it.get("prodOptnItmNm") or "", m.group(2)))
    return sorted(set(out))


def nh_product(h, url):
    """상품 페이지 → {name, mpn, codes, category, props{이름: [값]}, image, avail, fuel{코드: 'LNG'|'LPG'}, fuel_raw}."""
    prod = None
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', h, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        for g in d.get("@graph", [d]):
            if g.get("@type") == "Product":
                prod = g
    if not prod:
        return None
    props = {}
    for p in prod.get("additionalProperty") or []:
        props.setdefault(str(p.get("name") or "").strip(), []).append(str(p.get("value") or "").strip())
    codes = expand(prod.get("mpn"))
    fuel, fuel_raw = {}, []
    for nm, item, sap in options_of(h):
        if nm != "연료":
            continue
        g = "LNG" if "LNG" in item else "LPG" if "LPG" in item else None
        hit = [c for c in codes if c.replace("-", "") in sap]
        if g and len(hit) == 1:
            fuel[hit[0]] = g
            fuel_raw.append(f"{item} = {hit[0]} (SAP {sap})")
    img = prod.get("image")
    img = img[0] if isinstance(img, list) and img else img
    return {"name": (prod.get("name") or "").strip(), "mpn": prod.get("mpn"), "codes": codes, "category": prod.get("category") or "",
            "props": props, "image": img, "url": url, "fuel": fuel, "fuel_raw": sorted(set(fuel_raw)),
            "avail": ((prod.get("offers") or {}).get("availability") or "").rsplit("/", 1)[-1] or None}


def nh_products(f, sample=None):
    st, xml = f.get(NH_SITEMAP)
    urls = [u for u in re.findall(r"<loc>([^<]+)</loc>", xml) if re.search(r"/products/G\d+$", u)]
    out = []
    for u in urls:
        st, h = f.get(u)
        if st != 200:
            continue
        p = nh_product(h, u)
        if p and p["category"].startswith("주방기기") and p["codes"]:
            out.append(p)
    print(f"[navien] 나비엔 하우스 상품 {len(urls)} · 주방기기 {len(out)}", file=sys.stderr)
    return out


# ----------------------------------------------------------------------------- 종류


def kind_of(code, name, cat_path, props, cat_vals):
    """→ (category, subtype, install_type, 원문)."""
    leaf = cat_path.split(">")[-1].strip()
    typ = " / ".join(props.get("타입", []) + props.get("설치형태", []))
    raw = " / ".join(x for x in [cat_path or None, typ or None] if x)
    if code.startswith(("GRB", "GRF")):
        return "cooktop", "gas", ("built_in" if code.startswith("GRB") else "freestanding"), raw
    if code.startswith("ERG"):
        return "cooktop", None, "built_in", (raw + " / 가스+인덕션 (인덕션 2구 + 가스 1구)").strip(" /")
    if code.startswith(("ERH",)):
        burners = (cat_vals or {}).get("화구구성", "") + name
        if "하이라이트 3" in burners or code.startswith("ERH-14"):
            return "cooktop", "highlight", "built_in", raw
        return "cooktop", "hybrid", "built_in", raw
    if code.startswith("CER"):
        return "cooktop", "highlight", "built_in", raw
    if code.startswith(("ERI", "CEI")):
        return "cooktop", "induction", ("freestanding" if code.startswith("ERI-10") else "built_in"), raw
    if code.startswith("EOB"):
        return "oven", "combi", "built_in", (raw + " / 빌트인 멀티 광파 오븐 (전자레인지 겸용)").strip(" /")
    if code.startswith("EOF"):
        return "microwave", "combi", "freestanding", (raw + " / 프리스탠딩 멀티 오븐 (전자레인지 겸용)").strip(" /")
    if code.startswith("MWR"):
        return "microwave", "solo", "freestanding", raw
    if code.startswith(("RG", "RA")) or leaf == "레인지후드":
        t = typ + " " + name
        sub = ("island" if "아일랜드" in t else "built_in" if "매립" in t else "slim" if re.search(r"슬림|슬라이딩", t)
               else "chimney" if "침니" in t else None)       # 박스형 · 디럭스형(통후드)은 맞는 값이 없다
        return "hood", sub, ("built_in" if sub in ("built_in", "slim") else None), raw
    return None, None, None, raw


# ----------------------------------------------------------------------------- 칸 값


def nums(s):
    return [float(x) for x in re.findall(r"\d+(?:\.\d+)?", (s or "").replace(" ", ""))]


def dims_text(s):
    """'W588×D510×H56mm' · 'W 595 × D 568 × H 455mm' · 'W594 × D510 × H57 . 6mm' → (w, d, h)."""
    t = re.sub(r"(\d)\s*\.\s*(\d)", r"\1.\2", s or "")
    m = re.search(r"W\s*([\d.]+)\s*[×xX]\s*D\s*([\d.]+)\s*[×xX]\s*H\s*([\d.]+)", t)
    return tuple(float(x) for x in m.groups()) if m else None


def cut_text(s):
    """'W560×D480(R25)mm' · 'W560 × D430 ~ 440 ( R15 ) mm' · 'W560×D480×H40(R25)mm' → (w, d, d_max, h, r)."""
    t = (s or "").replace(" ", "")
    m = re.search(r"W(\d+)[×xX]D(\d+)(?:~(\d+))?(?:[×xX]H(\d+))?(?:\(R(\d+)\))?", t)
    if not m:
        return None
    w, d, dmax, h, r = m.groups()
    return int(w), int(d), int(dmax) if dmax else None, int(h) if h else None, int(r) if r else None


def round_mm(x):
    return int(x) if float(x).is_integer() else x


def make_row(code, p, cm, sample_note=None):
    """code: 모델 코드 하나. p: 나비엔 하우스 상품 (없으면 None). cm: 카탈로그 값 (없으면 None)."""
    name = (p or {}).get("name") or ""
    cat_path = (p or {}).get("category") or ""
    props = (p or {}).get("props") or {}
    vals = (cm or {}).get("vals") or {}
    if not p and cm:     # 나비엔 하우스에 없는 모델 — 카탈로그 색인 탭 · 쪽 머리를 종류 원문으로
        props = {"타입": list(dict.fromkeys(x for x in [cm.get("tab"), cm.get("section")] if x))}
    cat, sub, inst, raw = kind_of(code, name, cat_path, props, vals)
    if cat is None:
        return None
    if not name:
        name = " ".join(x for x in [BRAND, (cm or {}).get("tab") or (cm or {}).get("section"), code] if x)
    first = (p or {}).get("codes", [code])[0]
    img = NV_IMG.get(code) or NV_IMG.get(first)
    src = []
    if cm:
        src.append(f"카탈로그 {cm['page']}쪽")
    if img and not (cm and dims_text(vals.get("사이즈") or vals.get("제품 사이즈") or vals.get("제품 외형"))):
        src.append(f"상세 그림 {img['img']}")
    row = K.base_row(brand=BRAND, category=cat, category_subtype=sub, install_type=inst, model_name=name,
                     model_codes=[code], line=BRAND,
                     source_url=(f"{cm['url']}#page={cm['page']}" if cm else (NH_IMG + img["img"]) if img else (p or {}).get("url")),
                     page_url=(p or {}).get("url") or (f"{cm['url']}#page={cm['page']}" if cm else None),
                     image_source_url=(p or {}).get("image"), sale_status=(p or {}).get("avail"),
                     product_type_raw=" / ".join(x for x in [raw or None, " · ".join(src) or None] if x))
    notes = []
    # 외형
    dv = vals.get("사이즈") or vals.get("제품 사이즈") or vals.get("제품 외형")
    dt_ = dims_text(dv)
    d, size_raw = None, None
    if dt_:
        w, dd, h = dt_
        d, _ = K.dims_of("(W x D x H)", f"{w} x {dd} x {h}", "wdh")
        size_raw = f"카탈로그 '{dv}'"
        row["tags"].append("매뉴얼")
        chk = NV_IMG_CHECK.get(code) or NV_IMG_CHECK.get(first)
        if chk:
            diff = max(abs(a - b) for a, b in zip(dt_, chk[1]))
            iv = " × ".join(str(round_mm(x)) for x in chk[1])
            if diff > 2:
                row["tags"].append("출처불일치")
                notes.append(f"상세 그림 {chk[0]} 제품사이즈 {iv} 와 카탈로그 {dv} 가 다르다 (칸에는 카탈로그 값)")
            elif diff > 0:
                notes.append(f"상세 그림 {chk[0]} 제품사이즈 {iv} (카탈로그와 {round_mm(diff)} mm 차이)")
    elif img and img.get("wdh"):
        w, dd, h = img["wdh"]
        hv = f"{h[0]}~{h[1]}" if isinstance(h, tuple) else h
        d, _ = K.dims_of("(W x D x H)", f"{w} x {dd} x {hv}", "wdh")
        size_raw = f"상세 그림 {img['img']} '{w} x {dd} x {hv}'" + ("" if img["labeled"] else " (W · D · H 표시 없음 — 가로 × 깊이 × 높이로 읽음)")
        row["tags"].append("이미지판독")
        if not img["labeled"]:
            row["tags"].append("치수순서추정")
    K.put_dims(row, d, size_raw)
    if img and img.get("note"):
        notes.append(img["note"])
    # 타공 (쿡탑)
    if cat == "cooktop":
        cv = vals.get("타공 사이즈")
        ct = cut_text(cv)
        if ct:
            row["cutout_w_mm"], row["cutout_d_mm"], row["cutout_r_mm"] = ct[0], ct[1], ct[4]
            row["cutout_raw"] = f"카탈로그 타공 사이즈 '{cv}'" + (" (깊이 범위 — 작은 값)" if ct[2] else "")
            if ct[3]:
                notes.append(f"타공 H{ct[3]} = 상판 아래 매립 깊이 (카탈로그 '{cv}')")
        elif img and img.get("cut"):
            c = img["cut"]
            row["cutout_w_mm"], row["cutout_d_mm"] = c[0], c[1]
            row["cutout_raw"] = f"상세 그림 {img['img']} 빌트인 타공 치수 {' × '.join(map(str, c))}"
            if len(c) > 2:
                notes.append(f"타공 높이 {c[2]} = 상판 아래 매립 깊이 (그림)")
            if "이미지판독" not in row["tags"]:
                row["tags"].append("이미지판독")
        else:
            tp = (props.get("타공 사이즈 (mm)") or [None])[0]       # 나비엔 하우스 JSON-LD '560x480'
            m = re.match(r"^\s*(\d+)\s*[xX×]\s*(\d+)\s*$", tp or "")
            if m:
                row["cutout_w_mm"], row["cutout_d_mm"] = int(m.group(1)), int(m.group(2))
                row["cutout_raw"] = f"나비엔 하우스 사양 '타공 사이즈 (mm) {tp}'"
        if row["cutout_w_mm"] is None and inst == "built_in" and code.startswith(("ERI", "ERH", "ERG", "CEI", "CER")):
            row["install_type"] = None
        tp = (props.get("타공 사이즈 (mm)") or [None])[0]
        if tp and row["cutout_raw"] and "나비엔 하우스" not in row["cutout_raw"]:
            m = re.match(r"^\s*(\d+)\s*[xX×]\s*(\d+)\s*$", tp)
            if m and (int(m.group(1)), int(m.group(2))) != (row["cutout_w_mm"], row["cutout_d_mm"]):
                notes.append(f"나비엔 하우스 사양 '타공 사이즈 (mm) {tp}' 는 다르다")
    # 용량
    if cat in ("oven", "microwave"):
        cap = (props.get("용량(L)") or [None])[0] or vals.get("용량") or vals.get("색상 / 용량")
        m = re.search(r"(\d+(?:\.\d+)?)\s*L?", str(cap or ""))
        if m:
            row["capacity_l"] = K.F.to_num(m.group(1))
    if cat == "oven":
        notes.append("설치 공간(니치)은 카탈로그 · 상품 페이지에 없다")
    # 후드 — 카탈로그 덕트 연결구
    if cat == "hood":
        duct = vals.get("덕트 연결구(Φ)")
        if duct:
            notes.append(f"덕트 연결구 Φ{duct} (카탈로그)")
        if not d:
            notes.append("치수가 공식 글자 · 그림 어디에도 없다 (카탈로그 표에 크기 칸 없음, 상품 페이지에 사양 그림 없음)")
    if notes:
        row["install_notes"] = " · ".join(notes)
    # 가스 종류
    if code.startswith(("GRB", "GRF", "ERG")):
        gas_of(row, code, p, vals, img)
    return row


def gas_of(row, code, p, vals, img):
    """코드 하나의 가스: 카탈로그 '사용가스' 칸 (코드 열마다) · 나비엔 하우스 '연료' 옵션 (SAP 코드) — 글자. 둘이 다르면 비운다."""
    cat_g = (vals.get("사용가스") or "").strip()
    cat_g = cat_g if cat_g in ("LNG", "LPG") else None
    opt_g = ((p or {}).get("fuel") or {}).get(code)
    ev = []
    if cat_g:
        ev.append(f"카탈로그 사용가스 '{cat_g}'")
    if opt_g:
        ev.append(f"나비엔 하우스 연료 옵션 {'LNG(도시가스)' if opt_g == 'LNG' else 'LPG(프로판가스)'} (SAP …{code.replace('-', '')}…)")
    if cat_g and opt_g and cat_g != opt_g:
        row["install_notes"] = "; ".join(x for x in [row["install_notes"], f"가스 종류가 출처마다 다르다 ({' · '.join(ev)}) — 비움"] if x)
        return
    g = cat_g or opt_g
    if not g:
        return
    row["gas_types"] = [g]
    pair = sorted(c for c in CODE_GROUP.get(code, ()) if c != code)
    note = (f"가스 종류 {g} ({code}): " + " · ".join(ev)
            + (f" — 가스마다 모델 코드가 따로 있다 (같은 제품의 다른 가스 코드 {', '.join(pair)})" if pair
               else f" — {g} 코드만 있다 (다른 가스 코드는 카탈로그 · 나비엔 하우스에 없음)"))
    row["install_notes"] = "; ".join(x for x in [row["install_notes"], note] if x)


# ----------------------------------------------------------------------------- 수집


def collect(f, K_, sample=None):
    global K
    K = K_
    curl = catalog_url(f)
    pages = pdf_spans(f, curl)
    cat = catalog_models(pages, curl)
    print(f"[navien] 카탈로그 {curl.rsplit('/', 1)[-1][:60]}: 쪽 {len(pages)} · 표 코드 {len(cat)}", file=sys.stderr)
    prods = nh_products(f, sample)
    CODE_GROUP.clear()
    blocks = {}
    for c, cm in cat.items():
        blocks.setdefault((cm["page"], cm["title"]), set()).add(c)
    for g in list(blocks.values()) + [set(p["codes"]) for p in prods]:
        for c in g:
            CODE_GROUP.setdefault(c, set()).update(g)
    rows, seen, per_cat = [], set(), {}
    for p in prods:
        for code in p["codes"]:
            if code in seen:
                continue
            seen.add(code)
            r = make_row(code, p, cat.get(code))
            if r is None:
                continue
            if sample and per_cat.get(r["category"], 0) >= sample * 2:
                continue
            per_cat[r["category"]] = per_cat.get(r["category"], 0) + 1
            rows.append(r)
    # 카탈로그에만 있는 모델 (나비엔 하우스 목록에 없다 — 대리점 판매 · 단종일 수 있다)
    if not sample:
        for code, cm in cat.items():
            if code in seen:
                continue
            seen.add(code)
            r = make_row(code, None, cm)
            if r is None:
                continue
            r["install_notes"] = "; ".join(x for x in [r["install_notes"], "나비엔 하우스 상품 목록에 없다 (카탈로그에만)"] if x)
            rows.append(r)
    return rows
