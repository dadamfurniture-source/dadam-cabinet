"""쿠첸 — cuchenmall.co.kr 상품 페이지 '기본사양 · 사이즈' + 제품 매뉴얼(사용설명서) PDF. (2026-10-25)

상품 찾기: 사이트맵(sitemap-geo.xml) + 쇼핑 분류 목록(big_section.php — 밥솥 1001 · 전기레인지 1002 · 주방가전 1203 ·
콜라보 1005). 사이트맵에 없는 상품(인덕션 · 전자레인지 · 새 밥솥)이 목록에는 있다.

종류: 밥솥(이름에 '밥솥') · 전기레인지(인덕션 · 하이브리드 · 1구) · 전자레인지. 냉장고 · 블렌더 · 에어프라이어 · 음식물처리기 ·
소모품은 뺀다.

밥솥 상품 페이지는 색상마다 따로 있고 같은 모델인데 W · D 를 서로 반대로 적은 곳이 많다 (121 플러스 10인용 네이처 화이트
397(W)*301(D) · 블라썸화이트 301(W)*397(D)). 제품 매뉴얼 게시판(board/?db=blog_1)의 사용설명서 PDF '제품규격' 표에
'제품크기 (길이 X 폭 X 높이) 397×301×294 mm' 가 있다 — 길이 = 깊이(D), 폭 = 가로(W). PDF 는 Fetcher 로 받을 수 없어
(이진 파일) 따로 받아 글자를 읽었고(pdftotext / PyMuPDF), 읽은 값을 아래 CM_MANUAL 에 PDF 주소별로 옮겨 두었다.
게시판 목록(HTML)은 Fetcher 로 읽어 모델 코드 → PDF 주소를 잇는다.
"""
import re
import sys
import urllib.parse

BRAND_KEY = "cuchen"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

CM = "https://www.cuchenmall.co.kr"
CDN = "https://cuchencdn.wisacdn.com/board//_data/blog_1/"
LIST_CATS = ["1001", "1002", "1203", "1005"]          # 밥솥 · 전기레인지 · 주방가전 · 콜라보
# 매뉴얼 게시판 분류 (search_cno1, search_cno2) — 밥솥 · 전기레인지 · 전자레인지
MANUAL_CATS = [("1001", c) for c in ("1012", "1013", "1017", "1018", "1019", "1152", "1183", "1186", "1188", "1190")] \
    + [("1002", c) for c in ("1020", "1021", "1022")] + [("1003", "1024")]

# 사용설명서 PDF 글자에서 읽은 '제품크기' — PDF 주소(CDN 뒤 경로) → (길이, 폭, 높이 mm, 쪽, 원문)
#   밥솥: 길이 = 깊이(D) · 폭 = 가로(W). 전기레인지 · 전자레인지는 원문 칸 이름(가로 · 세로 / 폭 · 깊이)을 그대로 적는다.
#   '(W, D, H)' 로 바로 쓰려면 dims_wdh 를 둔다 (칸 이름이 길이 · 폭이 아닌 문서).
_PX06 = dict(place=6, page=5, dwh=(359, 258, 278), tag="이미지판독",
             raw="6인용 제품크기(길이×폭×높이) / 중량 359 × 258 × 278mm / 7.1kg (숫자 글꼴이 글자로 뽑히지 않아 눈으로 읽음)")
_PX10 = dict(place=10, page=5, dwh=(408, 298, 307), tag="이미지판독",
             raw="10인용 제품크기(길이×폭×높이) / 중량 408 × 298 × 307mm / 9.1kg (숫자 글꼴이 글자로 뽑히지 않아 눈으로 읽음)")
_PX06_ALIAS = dict(_PX06, raw=_PX06["raw"] + " — 이 설명서(PX_06 통합 Full)엔 크기가 없어 같은 PX_06 통합 설명서 12쪽판 5쪽 값")
_PX10_ALIAS = dict(_PX10, raw=_PX10["raw"] + " — 이 설명서(PX_10 통합 Full)엔 크기가 없어 같은 PX_10 통합 설명서 12쪽판 5쪽 값")
_MW20 = dict(page=2, wdh=(440, 359, 259), raw="크기 (폭 × 길이 × 높이) 제품 440 × 359 × 259 mm")
# 쿡탑: 사양표 '크기 (길이 x 폭 x 높이)' 의 길이 = 가로(W), 폭 = 깊이(D). 타공 숫자(560 · 480)는 설치 그림 안에만 있다 → '이미지판독'
#   (CEO-O2IF3A0NBA 설명서만 글자로 '560 | 480' 이 뽑힌다). 뒤 벽 여유는 그림 옆 글자 '최소 50 mm 벽면'.
_COOK_KD = dict(page=38, wdh=(595, 520, 53), raw="크기 (길이 x 폭 x 높이) 595 x 520 x 53 mm", cutout=(560, 480), cut_page=14,
                back_gap=50, cut_tag="이미지판독")
_COOK_B2 = dict(page=37, wdh=(595, 520, 55), raw="크기 (길이 x 폭 x 높이) 595 x 520 x 55 mm", cutout=(560, 480), cut_page=13,
                back_gap=50, cut_tag="이미지판독")
CM_MANUAL = {
    "_data/manual/2526237/CRT-SPE067_Series.pdf": dict(place=6, page=2, dwh=(358, 261, 271), raw="제품크기 (길이 X 폭 X 높이) 358 x 261 x 271mm"),
    "_data/manual/361958/S1 밥솥 _ 10인용 MANUAL (GOOD) _ 2021-09-07.pdf": dict(place=10, page=2, dwh=(397, 301, 294), raw="제품크기 (길이 X 폭 X 높이) 397×301×294 mm"),  # PS_good series_10인용_0907
    "_data/manual/361960/S1 밥솥 _ 10인용 MANUAL (GOOD) _ 2021-09-07.pdf": dict(place=10, page=2, dwh=(397, 301, 294), raw="제품크기 (길이 X 폭 X 높이) 397×301×294 mm"),  # PS_good series_10인용_0907
    "_data/manual/361961/S1 밥솥 _ 06인용 MANUAL (GOOD) _ 2021-09-07.pdf": dict(place=6, page=2, dwh=(356, 266, 273), raw="제품크기 (길이 X 폭 X 높이) 356×266×273 mm"),  # PS_good series_6인용_0907
    "_data/manual/361962/S1 밥솥 _ 06인용 MANUAL (GOOD) _ 2021-09-07.pdf": dict(place=6, page=2, dwh=(356, 266, 273), raw="제품크기 (길이 X 폭 X 높이) 356×266×273 mm"),  # PS_good series_6인용_0907
    "board//_data/blog_1/202302/23/1e794ad6d893bcfd0980564f0d520477.pdf": dict(place=4, page=2, dwh=(266, 238, 212), raw="제품크기 (길이 X 폭 X 높이) 266 X 238 X 212 mm"),
    "board//_data/blog_1/202302/23/a373fd26770031775fbc38573dd0ad1b.pdf": dict(place=6, page=2, dwh=(358, 263, 273), raw="제품크기 (길이 X 폭 X 높이) 358×263×273 mm"),
    "board//_data/blog_1/202302/23/a79e7412a3a7e0238f44e79e70a1a889.pdf": dict(place=10, page=2, dwh=(391, 294, 293), raw="제품크기 (길이 X 폭 X 높이) 391×294×293 mm"),
    "board//_data/blog_1/202303/30/ff7587fea849c1dfd740f59ed2fd6d5a.pdf": dict(place=3, page=2, dwh=(337.5, 239.1, 243.6), raw="제품크기 (길이 X 폭 X 높이) 337.5×239.1×243.6 mm"),  # CRT-RPS031 Series (FULL)_iot_2022_1231
    "board//_data/blog_1/202304/04/0917718e9f1ef38e9d5fea0f79973c4c.pdf": dict(place=6, page=2, dwh=(302, 270, 224), raw="제품크기 (길이 X 폭 X 높이) 302 X 270 X 224 mm"),
    "board//_data/blog_1/202305/22/519457d9750502038eb8c807cff7c72e.pdf": dict(place=6, page=14, dwh=(358, 263, 273), raw="제품크기 (길이 X 폭 X 높이) 358×263×273 mm"),
    "board//_data/blog_1/202305/22/a1a6b45a9af8ad0b45b3c2574b330eab.pdf": dict(place=6, page=2, dwh=(370, 271.5, 268.5), raw="제품크기 (길이 × 폭 × 높이) 370 × 271.5 × 268.5 mm"),
    "board//_data/blog_1/202305/22/b030e5f91607bc509254cc4c2b8d6a86.pdf": dict(place=10, page=2, dwh=(391, 294, 293), raw="제품크기 (길이 X 폭 X 높이) 391×294×293 mm"),
    "board//_data/blog_1/202305/22/bbb3bc5b5d9826f2103b9219d374263e.pdf": dict(place=10, page=2, dwh=(409.5, 300, 294.5), raw="제품크기 (길이 × 폭 × 높이) 409.5 × 300 × 294.5 mm"),
    "board//_data/blog_1/202305/22/d8d5c0bad41d4b1245d6223f5eb41bbe.pdf": dict(place=6, page=2, dwh=(367.5, 264, 268), raw="제품크기 (길이 × 폭 × 높이) 367.5 × 264 × 268 mm"),
    "board//_data/blog_1/202305/22/da0c088b3f98a299a706e75e69577890.pdf": dict(place=6, page=14, dwh=(358, 263, 273), raw="제품크기 (길이 X 폭 X 높이) 358×263×273 mm"),
    "board//_data/blog_1/202405/03/37993dd2e772e25589275a2fbe00d2e2.pdf": dict(page=2, by_place={10: (391, 294, 293), 6: (358, 263, 273)}, raw="10인용 391 × 294 × 293mm / 6인용 358 × 263 × 273mm"),  # CRS-FSWD104_FSWD064_WK104_WK064 시리즈_온라인 
    "board//_data/blog_1/202405/03/7d5a160b8019c2c001e7379f8e1725b3.pdf": dict(page=2, by_place={10: (391, 294, 293), 6: (358, 263, 273)}, raw="10인용 391 × 294 × 293mm / 6인용 358 × 263 × 273mm"),  # CRS-FSWD104_FSWD064_WK104_WK064 시리즈_온라인 
    "board//_data/blog_1/202405/03/85b3cfc00e1cb2fb81e5368b113d3fa1.pdf": dict(page=2, by_place={10: (391, 294, 293), 6: (358, 263, 273)}, raw="10인용 391 × 294 × 293mm / 6인용 358 × 263 × 273mm"),  # CRS-FSWD104_FSWD064_WK104_WK064 시리즈_온라인 
    "board//_data/blog_1/202405/03/f70f527034cb21048621886ed9361449.pdf": dict(page=2, by_place={10: (391, 294, 293), 6: (358, 263, 273)}, raw="10인용 391 × 294 × 293mm / 6인용 358 × 263 × 273mm"),  # CRS-FSWD104_FSWD064_WK104_WK064 시리즈_온라인 
    "board//_data/blog_1/202406/03/fb567eff59933d32d6dae437ae1a8969.pdf": dict(place=10, page=2, dwh=(397, 301, 294), raw="제품크기 (길이 X 폭 X 높이) 397×301×294 mm"),  # CRT-RPS_VWP_VBWP_VKP_VIP109 Series (FULL
    "board//_data/blog_1/202411/05/45e6d4c677e2f506bb9d6db123b7d4db.pdf": dict(place=3, page=2, dwh=(342, 239, 245), raw="WS034 Series 제품크기(길이×폭×높이) 342 × 239 × 245mm"),  # BETTER_GOOD_CRT-WS03_TWK03 series 온라인 풀본
    "board//_data/blog_1/202411/29/b473545eae9f53c44fdca620d024c549.pdf": dict(place=6, page=2, dwh=(356, 266, 273), raw="제품크기 (길이 X 폭 X 높이) 356×266×273 mm"),  # CRT-RPS_VWP_VBWP_VKP_VIP069 Series (FULL
    "board//_data/blog_1/202502/27/0c09d3c932a45674d665205a757277bf.pdf": dict(page=2, by_place={10: (391, 294, 293), 6: (358, 263, 273)}, raw="10인용 391 × 294 × 293mm / 6인용 358 × 263 × 273mm"),  # CRS-WK1010_WK061 Series_업로드용_2024_
    "board//_data/blog_1/202505/19/125e31d970c22c560b8ed4864e708f82.pdf": dict(place=6, page=2, dwh=(358, 263, 273), raw="제품크기 (길이 X 폭 X 높이) 358×263×273 mm"),
    "board//_data/blog_1/202505/19/c451641aa584959d1e2c869933774a12.pdf": dict(place=10, page=2, dwh=(391, 294, 293), raw="제품크기 (길이 X 폭 X 높이) 391×294×293 mm"),
    "board//_data/blog_1/202507/24/6acb4f7334594d4925174d09702ae12d.pdf": dict(place=6, page=2, dwh=(356, 266, 273), raw="제품크기 (길이 X 폭 X 높이) 356×266×273 mm"),  # CRT-RPS-PBP_PBWP061 Series (FULL)_1230
    "board//_data/blog_1/202603/13/0b9226fc26fc37f7d4035508f93ea05f.pdf": dict(place=6, page=2, dwh=(355, 259, 272), raw="제품크기 (길이×폭×높이) 355 × 259 × 272mm"),  # CRH-ZWD064 Series_업로드용_dual_2025_0
    "board//_data/blog_1/202604/07/55125259e1c27fcdeb87245c587ca3ff.pdf": dict(place=6, page=2, dwh=(358, 263, 273), raw="제품크기 (길이 X 폭 X 높이) 358×263×273 mm"),
    "board//_data/blog_1/202604/07/ba5df60e37e192e2f69c071ddd6363f7.pdf": dict(place=10, page=2, dwh=(391, 294, 293), raw="제품크기 (길이 X 폭 X 높이) 391×294×293 mm"),
    "board//_data/blog_1/202606/10/cdf67d80f321a3ab7b495163397fb21f.pdf": dict(place=6, page=2, dwh=(267, 376, 264), raw="제품크기 (길이 X 폭 X 높이) 267 X 376 X 264 mm"),
    "board//_data/blog_1/202606/15/b2b159616a0069a6fb55056d34ff3788.pdf": dict(place=6, page=14, dwh=(358, 263, 273), raw="제품크기 (길이 X 폭 X 높이) 358×263×273 mm"),
    "board//_data/blog_1/202606/15/ba2a41177e96f1fa23db075619cd21aa.pdf": dict(place=10, page=14, dwh=(391, 294, 293), raw="제품크기 (길이 X 폭 X 높이) 391×294×293 mm"),
    "board//_data/blog_1/202606/16/0af7d13cd8616ce735a0be3854e29033.pdf": dict(place=10, page=2, dwh=(397, 301, 294), raw="제품크기 (폭 X 길이 X 높이) 301×397×294 mm"),  # CRT-VPRS104 Series_(FULL)
    "board//_data/blog_1/202606/16/488bd2cc25795ec28c032eff1544ac64.pdf": dict(place=6, page=2, dwh=(356, 266, 273), raw="제품크기 (폭 X 길이 X 높이) 266×356×273 mm"),  # CRT-VPRS064 Series_(FULL)
    "board//_data/blog_1/202606/16/ba0266839a0fdc344e3e8280c2b1d0b8.pdf": dict(place=10, page=14, dwh=(397, 301, 294), raw="제품크기 (길이 X 폭 X 높이) 397×301×294 mm"),  # CRT-RPS107 Series (16P축약본)_0715
    "board//_data/blog_1/202606/16/edba00992407f20b95bb78ae5a5ecea1.pdf": dict(place=6, page=14, dwh=(356, 266, 273), raw="제품크기 (길이 X 폭 X 높이) 356×266×273 mm"),  # CRT-RPS067 Series (16P축약본)_0715
    "board//_data/blog_1/202606/24/02421981250f6357eb572619a2116304.pdf": dict(place=3, page=2, dwh=(342, 239, 245), raw="3인용 제품크기(길이×폭×높이) 342 × 239 × 245mm"),  # BEST_CRT-TWS031_VWW031_VCYW0310ST series
    "board//_data/blog_1/202606/24/c7a08523a41ddf111d90cbc574b8e101.pdf": dict(page=2, by_place={10: (397, 301, 294), 6: (356, 266, 273)}, raw="10인용 397 × 301 × 294mm / 6인용 356 × 266 × 273mm"),  # CRT-RPD109_RPD069_(FULL)_2026_0511
    "board//_data/blog_1/202609/10/b1f570e6f3a853f26bb87c807cf5a88f.pdf": dict(place=6, page=2, dwh=(313, 251, 233), raw="제품크기 (길이×폭×높이) 313 × 251 × 233mm"),  # CRM-H0640 Series_full_2026_0910
    "board//_data/blog_1/202609/17/c3478ae479f6611fc0bbd1ddb704b433.pdf": dict(page=2, by_place={6: (356, 266, 273), 10: (397, 301, 294)}, raw="6인용 356×266×273 mm / 10인용 397×301×294 mm"),  # S1_titan_CRT-RPD0610TEI CRT-RPD1010TEI_(
    "board//_data/blog_1/202607/27/aae24896a6c256b39e62c77dd84f8cd9.pdf": dict(place=6, page=2, dwh=(351, 260, 270), raw="제품크기 (길이 X 폭 X 높이) 351×260×270 mm"),  # PMWS06 (큐브)
    # 123 듀얼프레셔 (PX 통합 설명서) — 12쪽판은 숫자를 눈으로 읽었다. Full 판에는 크기 칸이 없다
    "board//_data/blog_1/202606/15/bd06d913e067b7e6918ba7cafcb14fb6.pdf": _PX06,
    "board//_data/blog_1/202606/16/2e9637d16cc35a7c343d256b24246953.pdf": _PX06,
    "board//_data/blog_1/202606/16/a8f367892e603e93159b7ff9cf80734b.pdf": _PX06,
    "board//_data/blog_1/202606/16/0fa50253a002c5a8dfbd3a665873475f.pdf": _PX06,
    "board//_data/blog_1/202606/24/b12683909290f0b7b4c1bf15767e9c51.pdf": _PX06_ALIAS,
    "board//_data/blog_1/202606/24/6490b3455587b981b162d330a471f19f.pdf": _PX06_ALIAS,
    "board//_data/blog_1/202608/28/7bb7d0dc4a683fa4c8565a29fbe19091.pdf": _PX06_ALIAS,   # PX_06 저당
    "board//_data/blog_1/202606/16/ee06d4d29fd9d74c574e98954f54d020.pdf": _PX10,
    "board//_data/blog_1/202606/16/fedbd5b61ab86092352ebf7fdf33d0ce.pdf": _PX10,
    "board//_data/blog_1/202606/16/25345a5eb2e886c41bb37ccfa2c192b7.pdf": _PX10,
    "board//_data/blog_1/202606/15/de34a8216d1e4943399ac4747c5a314e.pdf": _PX10,
    "board//_data/blog_1/202606/22/7330b3a8f029aac6986cd19c78edfb5c.pdf": _PX10_ALIAS,
    "board//_data/blog_1/202508/19/b470ed7a2fba3e94e1ca340cd8e5728a.pdf": _PX10_ALIAS,
    # 전자레인지 (CMW-N200 · COV-N201 Series) — 폭 = 가로, 길이 = 깊이
    "board//_data/blog_1/202606/12/ab717f90739133b0c98a3656691874f3.pdf": _MW20,
    "board//_data/blog_1/202606/12/2ca06fc1e7972e6e2b81f912dbc64634.pdf": _MW20,
    "board//_data/blog_1/202606/12/c4f1e34b22b2fa1ca3700b7ba9c2c4b3.pdf": _MW20,
    # 전기레인지
    "board//_data/blog_1/202412/17/7f006f75db2b99ea6301d9c46557f3ac.pdf": _COOK_KD,      # *W3*KD*B1 (화이트 올파워)
    "board//_data/blog_1/202506/17/a3bb19a8bc740e4c3decacbd994b69a9.pdf": _COOK_B2,      # BLACK 3400
    "board//_data/blog_1/202606/12/597591aa67e29784d176f38ac9d44350.pdf": _COOK_B2,      # 히든매트 VB330MTOB2
    "board//_data/blog_1/202606/24/429a048670480b2db6e199dad1a50470.pdf": dict(
        page=37, wdh=(580, 510, 61), raw="크기 (길이 × 폭 × 높이) 580 X 510 X 61 mm", cutout=(560, 480), cut_page=13, back_gap=40,
        cut_tag="이미지판독"),                                                           # FLEX 하이브리드 C3F312
    "board//_data/blog_1/202501/23/64892221a89ba82aa5ed97bb35f743ee.pdf": dict(
        page=34, wdh=(580, 510, 57), raw="크기 (길이 × 폭 × 높이) 580 X 510 X 57 mm", cutout=(560, 480), cut_page=13,
        cut_tag="매뉴얼", cut_note="뒤 벽 여유 '최소 40 mm' 는 그림 안 숫자라 칸에 넣지 않았다"),  # FLEX 3구 IF3A
    # 게시판이 CEO-F160(1구 슬림)에 이 PDF 를 걸었지만 내용은 하이브리드 F312 · F3131 설명서다 — 쓰지 않는다
    "board//_data/blog_1/202606/24/8ba04e92d0020c6e8a720f82d89d2367.pdf": dict(mismatch="게시판이 건 설명서가 다른 모델(F312 · F3131 하이브리드) 것"),
}


def spec_table(h, title):
    """'기본사양' · '상품 정보 고시' 표 → {칸: 값}."""
    i = h.find(f'<p class="tit">{title}</p>')
    if i < 0:
        return {}
    j = h.find("</table>", i)
    out = {}
    for th, td in re.findall(r"<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>", h[i:j], re.S):
        k = re.sub(r"\s+", " ", K.F.html.unescape(re.sub(r"<[^>]+>", " ", th))).strip()
        v = re.sub(r"\s+", " ", K.F.html.unescape(re.sub(r"<[^>]+>", " ", td))).strip()
        if k and k not in out:
            out[k] = v
    return out


def list_products(f):
    """분류 목록 → {pno: (분류, 목록 코드, 목록 이름)}."""
    out = {}
    for c in LIST_CATS:
        page = 1
        while True:
            st, h = f.get(f"{CM}/shop/big_section.php?cno1={c}" + (f"&page={page}" if page > 1 else ""))
            for m in re.finditer(r'<a href="https://www\.cuchenmall\.co\.kr/shop/detail\.php\?pno=([0-9A-F]+)[^"]*"\s*'
                                 r'class="product-content[^"]*">(.*?)</a>', h, re.S):
                code = re.search(r'product-code[^>]*>([^<]*)<', m.group(2))
                name = re.search(r'product-title[^>]*>([^<]*)<', m.group(2))
                out.setdefault(m.group(1), (c, K.F.html.unescape(code.group(1)).strip() if code else None,
                                            K.F.html.unescape(name.group(1)).strip() if name else None))
            pages = [int(x) for x in re.findall(r'href="\?page=(\d+)&(?:amp;)?cno1=%s"' % c, h)]
            if not pages or page >= max(pages):
                break
            page += 1
    return out


def manual_index(f):
    """매뉴얼 게시판 → {모델 코드: PDF 주소}. 한 글에 코드가 여럿 (CRT-RPS1071W, CRT-RPS1091W …)."""
    idx = {}
    for c1, c2 in MANUAL_CATS:
        page = 1
        while True:
            st, h = f.get(f"{CM}/board/?cate=&db=blog_1&search_cno1={c1}&search_cno2={c2}" + (f"&page={page}" if page > 1 else ""))
            rows = re.findall(r'<span class="ipt">([^<]*)</span></td>\s*<td class="brsp">(.*?)</td>', h, re.S)
            for codes, links in rows:
                pdf = re.search(r'href="(https://cuchencdn[^"]+\.pdf)"', links)
                if not pdf:
                    continue
                for code in K.F.html.unescape(codes).split(","):
                    code = code.strip()
                    if code:
                        idx.setdefault(code, pdf.group(1))
            pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", h)]
            if not rows or not pages or page >= max(pages):
                break
            page += 1
    return idx


def kind_of(name, spec):
    """→ (category, subtype, install_type) 또는 None (주방가전 아님)."""
    if K.is_rice_cooker(name):
        return "rice_cooker", K.rice_subtype(name), "freestanding"
    if "전자레인지" in name:
        return "microwave", ("combi" if re.search(r"오븐|그릴", name) else "solo"), "freestanding"
    if ("인덕션" in name or "전기레인지" in name or spec.get("화구")) and not re.search(r"부품|커버|스탠드케이스$|매트$", name):
        fire = spec.get("화구") or ""
        sub = "hybrid" if ("하이라이트" in fire or "하이브리드" in name) else ("highlight" if "하이라이트" in name else "induction")
        inst = "built_in" if "빌트인" in (spec.get("빌트인") or "") else "freestanding"
        return "cooktop", sub, inst
    return None


def place_of(name):
    """'6인용' → 6. '3.5인용' · '1.5인용' 처럼 소수는 정수 칸에 넣지 않는다 (K.place_count 는 3.5 를 5 로 읽는다)."""
    if re.search(r"\d\.\d+\s*인(?:용|분)", name or ""):
        return None
    return K.place_count(name)


def size_order(raw):
    seq = "".join(re.findall(r"[WDH]", raw or ""))
    return seq if sorted(seq) == ["D", "H", "W"] else None


def collect(f, K_, sample=None):
    global K
    K = K_
    st, x = f.get(CM + "/sitemap-geo.xml")
    sm = [re.search(r"pno=([0-9A-F]+)", u).group(1) for u in re.findall(r"<loc>([^<]+)</loc>", x) if "detail.php" in u]
    listed = list_products(f)
    pnos = list(dict.fromkeys(sm + list(listed)))
    print(f"[cuchen] sitemap={len(sm)} listed={len(listed)} union={len(pnos)}", file=sys.stderr)
    midx = manual_index(f)
    print(f"[cuchen] 매뉴얼 게시판 모델 코드={len(midx)}", file=sys.stderr)
    rows, per_kind = [], {}
    for pno in pnos:
        u = f"{CM}/shop/detail.php?pno={pno}"
        st, h = f.get(u)
        if st != 200:
            continue
        title = re.search(r"<title>([^<|]*)", h)
        name = K.F.html.unescape(title.group(1)).strip() if title else ""
        if not name and pno in listed:
            name = listed[pno][2] or ""
        spec = spec_table(h, "기본사양")
        kind = kind_of(name, spec)
        if not kind:
            continue
        cat, sub, inst = kind
        if sample and per_kind.get(cat, 0) >= sample:
            continue
        per_kind[cat] = per_kind.get(cat, 0) + 1
        t = K.F.html_to_text(h)
        # 판매 코드 = 상품 이름 바로 다음 줄. 상품정보고시 '품명 및 모델명' 이 다른 상품에서 복사된 곳이 있다
        #   (미니밥솥 더 동글: 판매 CRE-D0401W · 고시 CRM-E0101W) — 판매 코드만 모델 코드로, 다르면 미검증
        shown = re.search(re.escape(name) + r"\s*\n\s*([A-Z]{2,4}-[A-Z0-9]{3,})", t)
        notice = re.search(r"품명 및 모델명\s*\n?\s*([A-Z]{2,4}-[A-Z0-9]{3,})", t)
        code = (shown or notice).group(1) if (shown or notice) else (listed.get(pno, (None, None))[1])
        img = re.search(r'<meta property="og:image" content="([^"]+)"', h)
        row = K.base_row(brand="Cuchen", category=cat, category_subtype=sub, install_type=inst,
                         model_name=name, model_codes=[code] if code else [], line="쿠첸",
                         source_url=u, page_url=u, image_source_url=K.F.abs_url(img.group(1), CM) if img else None,
                         place_count=place_of(name) if cat == "rice_cooker" else None)
        if shown and notice and shown.group(1) != notice.group(1):
            row["tags"].append("고시불일치")
            row["product_type_raw"] = f"상품정보고시 모델명 {notice.group(1)}"
        if cat == "rice_cooker":
            # '기본사양 · 사이즈' 다음 줄 — '298(W)*408(D)*307(H)(mm)' · '215*258*208 (W*D*H)' · '368*264*268(mm)' (순서 표시 없음)
            size = re.search(r"사이즈\s*\n\s*(\d[^\n]{4,60})", t)
            raw = size.group(1).strip() if size else None
        else:
            raw = spec.get("사이즈")
            extra = " / ".join(f"{k} {spec[k]}" for k in ("화구", "빌트인", "색상", "상판색상") if spec.get(k))
            row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"], extra] if x)
            if cat == "microwave":
                row["capacity_l"] = K.litres(name)
        seq = size_order(raw)
        if raw and not seq:
            row["tags"].append("치수순서추정")   # 순서 표시가 없다 — 쿠첸이 표시한 곳의 순서(가로*깊이*높이)로 읽고 미검증
        d, _ = K.dims_of(f"({'x'.join(seq or '')})", raw, "wdh") if raw else (None, None)
        pdf = midx.get(code) if code else None
        if pdf:
            d, raw = apply_manual(row, d, raw, pdf)
        K.put_dims(row, d, raw)
        if row["category"] == "rice_cooker" and "사용설명서" in (row["product_type_raw"] or "") and (
                "매뉴얼" in row["tags"] or "이미지판독" in row["tags"] or "쪽과 같음" in row["product_type_raw"]):
            row["_manual_ok"] = True
        rows.append(row)
        if sample and len(per_kind) >= 3 and min(per_kind.values()) >= sample:   # 표본: 세 종류가 다 모였다
            break
    align_to_manuals(rows)
    for r in rows:
        r.pop("_manual_ok", None)
    return rows


def align_to_manuals(rows, tol=2):
    """설명서로 크기를 확인하지 못한 밥솥 행 중, 같은 인분 · 같은 세 치수(±2)인데 W · D 방향만 다른 행을 설명서로 확인한 행의
    방향에 맞추고 '치수순서추정'(미검증)을 단다. 이렇게 하지 않으면 collect.py flag_permuted 가 설명서로 확인한 행까지
    '치수순서의심'으로 묶는다. 값은 그 행 페이지의 값을 크기 순서대로 옮길 뿐 바꾸지 않는다."""
    refs = [r for r in rows if r.get("_manual_ok") and r.get("width_mm")]
    for r in rows:
        if r.get("_manual_ok") or not r.get("width_mm") or r["category"] != "rice_cooker":
            continue
        mine = {"w": r["width_mm"], "d": r["depth_mm"], "h": r["height_mm"]}
        for ref in refs:
            if ref.get("place_count") != r.get("place_count"):
                continue
            theirs = {"w": ref["width_mm"], "d": ref["depth_mm"], "h": ref["height_mm"]}
            if not all(abs(a - b) <= tol for a, b in zip(sorted(mine.values()), sorted(theirs.values()))):
                continue
            if all(abs(mine[k] - theirs[k]) <= tol for k in "whd"):
                break                                              # 이미 같은 방향
            rank_mine = sorted(mine, key=lambda k: mine[k])
            rank_theirs = sorted(theirs, key=lambda k: theirs[k])
            new = {kt: mine[km] for km, kt in zip(rank_mine, rank_theirs)}
            before = f"{mine['w']}(W)×{mine['d']}(D)×{mine['h']}(H)"
            r["width_mm"], r["depth_mm"], r["height_mm"] = new["w"], new["d"], new["h"]
            if "치수순서추정" not in r["tags"]:
                r["tags"].append("치수순서추정")
            code = (ref.get("model_codes") or ["?"])[0]
            r["product_type_raw"] = " · ".join(x for x in [r["product_type_raw"],
                f"W · D 방향을 같은 크기 다른 모델({code})의 사용설명서 방향으로 맞춤 (상품 페이지 {before})"] if x)
            mine_code = (r.get("model_codes") or ["?"])[0]
            for v in refs:   # collect.py merge 는 먼저 온 행의 태그 · 비고를 남긴다 — 설명서로 확인한 행에 이 사실을 적어 둔다
                if v.get("place_count") == r.get("place_count") and all(
                        abs(v[k] - r[k]) <= tol for k in ("width_mm", "depth_mm", "height_mm")):
                    v["product_type_raw"] = " · ".join(x for x in [v["product_type_raw"],
                        f"{mine_code} 상품 페이지는 W · D 가 반대({before}) — 이 방향으로 맞춤"] if x)
            break
    # 같은 크기로 묶일 때 설명서로 확인한 행이 앞에 오게 한다 (merge 는 첫 행의 태그를 남긴다)
    rows.sort(key=lambda r: 0 if r.get("_manual_ok") else 1)


def manual_key(pdf):
    """PDF 주소 → CM_MANUAL 열쇠 (호스트 뒤 경로, %인코딩을 푼 것)."""
    return urllib.parse.unquote(pdf).replace("https://cuchencdn.wisacdn.com/", "")


def _mm(x):
    """설명서 소수 mm (271.5) → 정수 mm, 반올림 (0.5 는 올린다)."""
    return int(float(x) + 0.5)


def apply_manual(row, d, raw, pdf):
    """사용설명서 '제품크기' 로 맞추거나 고친다. → (d, raw).
    설명서가 있으면 설명서 값이 정본이다 (같은 모델의 색상 페이지끼리 W · D 가 엇갈리는 곳이 많다).
      밥솥: 길이 = 깊이(D), 폭 = 가로(W) — 쿠첸 설명서는 이 뜻으로 일관된다 (NEW 121 6인용 '길이 267 × 폭 376' 은 페이지
            375(W) * 269(D) 와 같은 뜻, 121 플러스 10인용 '397×301' 은 블라썸화이트 페이지 301(W) * 397(D) 와 같은 뜻).
      쿡탑 · 전자레인지: 원문 칸 이름대로 (쿡탑 길이 = 가로) — CM_MANUAL 에 wdh 로 적어 두었다.
    페이지 값과 ±2 mm 안에서 같으면 페이지 값을 그대로 두고 태그를 달지 않는다."""
    man = CM_MANUAL.get(manual_key(pdf))
    note = None
    if not man:
        note = f"사용설명서 {pdf} (크기 글자 없음)"
    elif man.get("mismatch"):
        note = f"사용설명서 {pdf} — {man['mismatch']} (쓰지 않음)"
        man = None
    if not man:
        row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"], note] if x)
        return d, raw
    if man.get("place") and row.get("place_count") and man["place"] != row["place_count"]:
        # 게시판이 6인용 설명서를 10인용 코드에도 걸어 둔 곳이 있다 (121 마스터플러스 CRT-PBWP1010SR → PBWP061 설명서)
        row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"],
                                                        f"사용설명서 {pdf} 는 {man['place']}인용 설명서라 쓰지 않음"] if x)
        return d, raw
    if "by_place" in man:
        dwh = man["by_place"].get(row.get("place_count"))
        if not dwh:
            row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"], f"사용설명서 {pdf} ({row.get('place_count')}인용 크기 없음)"] if x)
            return d, raw
        w, dd, hh = dwh[1], dwh[0], dwh[2]
    elif "wdh" in man:
        w, dd, hh = man["wdh"]
    else:
        dd, w, hh = man["dwh"]
    mw = {"w": (_mm(w), _mm(w)), "d": (_mm(dd), _mm(dd)), "h": (_mm(hh), _mm(hh))}
    tag = man.get("tag", "매뉴얼")
    same = d and all(abs(d[k][0] - mw[k][0]) <= 2 for k in "whd") and "치수순서추정" not in row["tags"]
    if same:
        row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"], f"사용설명서 {man['page']}쪽과 같음 ({pdf})"] if x)
    else:
        row["tags"] = [t for t in row["tags"] if t != "치수순서추정"]
        if tag not in row["tags"]:
            row["tags"].append(tag)
        row["source_url"] = pdf
        row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"],
                                                        f"사용설명서 {man['page']}쪽으로 고침 — 상품 페이지 '{raw or '치수 없음'}'"] if x)
        raw = f"사용설명서 {man['page']}쪽 {man['raw']}"
        d = mw
    if man.get("cutout") and row["category"] == "cooktop" and row["install_type"] == "built_in":
        row["cutout_w_mm"], row["cutout_d_mm"] = man["cutout"]
        row["cutout_raw"] = f"사용설명서 {man['cut_page']}쪽 빌트인 설치방법 '타공 사이즈' {man['cutout'][0]} × {man['cutout'][1]} mm"             + (" (그림 안 숫자)" if man.get("cut_tag") == "이미지판독" else "")
        if man.get("back_gap"):
            row["back_gap_mm"] = man["back_gap"]
            row["install_notes"] = f"사용설명서 {man['cut_page']}쪽: 타공 뒤쪽은 벽면에서 최소 {man['back_gap']} mm"
        if man.get("cut_note"):
            row["install_notes"] = man["cut_note"]
        ct = man.get("cut_tag", "매뉴얼")
        if ct not in row["tags"]:
            row["tags"].append(ct)
    return d, raw
