"""쿠쿠 주방가전 — cuckoo.co.kr 상품 페이지(productView). (2026-10-25)

상품 목록 API(/rest/mall/mallProductSearch)와 제품설명서 검색(/rest/customer/productManualSearch)은 robots.txt 가
/rest/ 를 막아 쓰지 않는다. 사이트맵도 없다. 대신 robots.txt 가 허락한 페이지에서 상품 번호를 모은다:
  1) 홈 화면(/) · 기획전 목록(/planning · /planning?exhibitGubun=R)과 기획전 본문(/planning/planningView) 의 상품 링크
  2) 상품 페이지 안의 '함께 사면 좋은 제품' · 색상 변형(JSON-LD hasVariant) 링크 — 주방가전 상품에서만 따라간다
  3) 검색엔진으로 찾은 공식 상품 주소(CK_SEEDS) — 값은 늘 공식 페이지에서 읽는다
그래도 전체 목록은 아니다 (사이트 안 분류 목록은 /rest/ 로만 그린다).

종류: 밥솥 · 인덕션/하이브리드 전기레인지 · 가스레인지 · 식기세척기 · 전자레인지(광파 · 복합오븐레인지 포함).
에어프라이어 · 커피머신 · 부속품(내솥 · 패킹 · 필터 · 세제)은 뺀다.

치수:
  정본 = 상품정보고시 '크기(길이,폭,높이) 392x269x265(mm)' (길이 = 깊이 D, 폭 = 가로 W). 이 칸 이름이 '크기(넓이,길이,폭)' ·
    '크기(넓이,폭,길이)' 처럼 뒤섞인 페이지가 있다 (값은 423x305x290 — 셋째가 높이) → 같은 순서(깊이 × 가로 × 높이)로 읽고 '치수순서추정'.
  상품정보고시가 비면 '상세정보' 요약 글(핵심 사양) — 'W588 x D508 x H57mm' · '291(W) x 371(L) x 46(H)' 처럼 칸 표시가 있으면
    그대로, 없으면(밥솥 '392mm x 269mm x 265mm') 고시와 같은 깊이 × 가로 × 높이로 읽는다. 요약 글은 폭 · 깊이가 뒤바뀐 곳이
    있다 (트윈프레셔 6인용 'W383 x D262') → '요약문' (미검증).
  사용설명서(상품 페이지 '제품설명서' PDF)의 '제품규격 · 제품의 크기' 를 사람이 읽어 CK_MANUAL 에 옮겼다. 쿠쿠 설명서는 대부분
    글자가 그림(외곽선)이라 '이미지판독' 이다.
"""
import json
import re
import sys
import urllib.parse

BRAND_KEY = "cuckoo"
K = None   # collect.py 가 넘긴다

CK = "https://www.cuckoo.co.kr"

# 검색엔진(site:cuckoo.co.kr productView …)으로 찾은 공식 상품 번호 — 2026-10-25. 값은 늘 상품 페이지에서 읽는다
CK_SEEDS = [
    # 밥솥
    4904, 3809, 4506, 3604, 4994, 3707, 3711, 4952, 6292, 4798, 6804, 3710, 3470, 3899, 5819, 3493, 3920, 4996, 4017,
    5818, 4960, 5825, 3670, 6342, 3659, 3863, 4124, 3480, 4551, 5437, 4044, 6343, 3407, 5787, 3714, 3715, 3924, 3805,
    4268, 5993, 7051, 5015, 3875, 5070, 5061, 6160, 6916,
    # 인덕션 · 하이브리드 · 가스레인지
    5150, 4699, 4671, 7323, 7328, 7014, 4686, 4978, 4956, 9204, 6294, 4681, 4675, 5149, 7322, 4682, 4601, 4673, 9502,
    10478, 7061, 7325, 9925, 9927, 7016, 7481,
    # 식기세척기
    4791, 4508, 7449, 4788, 7476, 4509, 5918, 6514, 5925, 9324, 8688, 8190,
    # 전자레인지 · 광파 · 복합오븐레인지
    5102, 4177, 4549, 3902, 4785, 5286, 7808, 7138, 4814, 7720, 8470, 5625, 8566, 9585, 5369, 10351,
]
SEED_PAGES = ["/", "/planning", "/planning?exhibitGubun=R"]

# 상품 페이지 빵부스러기(JSON-LD BreadcrumbList 둘째 칸) → 종류
CK_CATS = {"밥솥": "rice_cooker", "인덕션": "cooktop", "전기레인지": "cooktop", "하이브리드": "cooktop", "가스레인지": "cooktop",
           "식기세척기": "dishwasher", "전자레인지": "microwave", "오븐": "microwave", "광파오븐": "microwave"}
KITCHEN_HINT = re.compile(r"밥솥|인덕션|하이브리드|레인지|식기세척기|광파|오븐레인지|CRP-|CR-\d|CIR-|CIHR-|CDW-|CMW-|CGC-")
NOT_KITCHEN = re.compile(r"부속품|내솥|패킹|필터|세제|린스|키트|트레이$|커버$|에어프라이어|커피|정수기|청소기|공기청정|CDWA-|CCP-|CRI-")

# 사용설명서에서 읽은 '제품의 크기' — PDF 파일 이름 → 값. dwh = (깊이 D, 가로 W, 높이 H) mm
#   tag: '매뉴얼'(PDF 글자) · '이미지판독'(그림 글자를 눈으로 읽음) · page: PDF 쪽(1부터) · raw: 원문
def _rc(page, d, w, h, txt=None):
    """밥솥 — 설명서 '제품의 크기 39.2cm(길이) X 26.9cm(폭) X 26.5cm(높이)' (길이 = 깊이)."""
    raw = txt or f"제품의 크기 {d / 10:g}cm(길이) X {w / 10:g}cm(폭) X {h / 10:g}cm(높이)"
    return dict(dwh=(d, w, h), tag="이미지판독", page=page, raw=raw)


def _ck(page, w, d, h, cut_page=None):
    """3구 전기레인지 — 설명서 '제품의 크기 58.8cm(길이) × 50.8cm(폭) × 5.7cm(높이)'. 전기레인지는 길이 = 가로(W), 폭 = 깊이(D).
    cut_page: 빌트인 설치 요령 그림 (타공 560 × 480 mm, 뒤 벽까지 60 mm, 모서리 R30 · C30 이하)."""
    e = dict(wdh=(w, d, h), tag="이미지판독", page=page, raw=f"제품의 크기 {w / 10:g}cm(길이) × {d / 10:g}cm(폭) × {h / 10:g}cm(높이)")
    if cut_page:
        e.update(cutout=(560, 480), back_gap=60, cut_page=cut_page)
    return e


# 사용설명서(상품 페이지 '제품설명서' PDF)에서 읽은 '제품규격' — PDF 파일 이름(%인코딩을 푼 것) → 값.
#   쿠쿠 설명서는 글자가 그림(외곽선 · 스캔)이라 사람이 쪽 그림을 보고 옮겼다 → '이미지판독' (미검증). page = PDF 쪽(1부터).
#   글자로 뽑히는 것(CMW-PF2310EW)만 '매뉴얼'.
CK_MANUAL = {
    # 밥솥
    "file_b5883363-011a-45db-b8e1-b6b984b191e0.pdf": _rc(68, 392, 269, 265),          # CRP-JHR0660FD
    "file_6ded706d-2715-495b-8bc1-81a6b210c8c0.pdf": _rc(68, 392, 269, 265),          # CRP-JHR0610FC
    "file_1db165da-f4e1-4f37-9263-066084a1b5ff.pdf": _rc(66, 423, 305, 290),          # CRP-JHR1060FD
    "file_61867ed8-e719-4b51-98b9-3dc15f627865.pdf": _rc(54, 375, 269, 268),          # CRP-PHNLTR0610FGW 사일런스 프로
    "file_e9b14dcb-2456-4c90-858e-1d52e898208e.pdf": _rc(67, 419, 303, 290),          # CRP-CHAS109F*
    "file_8d6a2391-3b04-437f-b356-84a384aabc7f.pdf": _rc(70, 335, 240, 227),          # CRP-MHTR0310FW 쁘띠 3인용
    "file_7fd29662-7499-4b0a-8dbb-190169bbdb39.pdf": _rc(81, 383, 262, 260),          # CRP-LHTR0610FG*M 마스터셰프 6인용
    "file_90160338-0867-4895-84b8-c7de8a77aed8.pdf": _rc(71, 371, 271, 253),          # CRP-NHTR0610FGW 사일런스 6인용
    "file_53851ad8-f942-4e26-b090-1170d5ebbbf7.pdf": _rc(76, 383, 262, 260),          # CRP-LHLR0610FW 저당 6인용
    "(383-575e) crp-lhlr1010fw user manual_rev.0(최종)_글꼴삭제.pdf": _rc(76, 425, 301, 289),   # CRP-LHLR1010FW
    "file_49c5e509-87ce-4ff5-83d6-cf548a4e0ad8.pdf": _rc(65, 356, 256, 267),          # CRP-UT0610FGW 사일런스 어반
    "file_e2af8807-7fc0-4974-b394-e32c69ce5d1f.pdf": _rc(71, 411, 302, 274),          # CRP-NHTR1010FGW 사일런스 10인용
    "file_8a1fb7a1-ecdb-451a-8ef7-7b31deb318ae.pdf": _rc(65, 378, 266, 256),          # CRP-DHP0610FW (383-904K)
    "file_b29972eb-88ac-44d4-8416-61bdcd43034c.pdf": _rc(65, 378, 266, 256),          # CRP-DHXB0610FS (383-904K)
    "file_77fecd42-6f14-4ca4-9443-eb8c3e415f9d.pdf": _rc(65, 378, 266, 256),          # CRP-DHP0610FD (383-904K)
    "crp-fhr067fg_fd_user_manua1.pdf": _rc(65, 379, 265, 258),                        # CRP-FHS0610FD
    "file_dc3e06bf-4460-4217-ba93-91f28bdfb520.pdf": _rc(43, 361, 272, 258),          # CRP-PK0620BUG
    "crp-lht10 사용설명서1.pdf": _rc(80, 425, 301, 289),                               # CRP-LHTR1010FW
    "191004(최종)_383-300b_print.pdf": _rc(79, 420, 303, 290),                         # CRP-KHTS1060FD
    "jht06_0130_383-573j rev.5.pdf": _rc(79, 392, 269, 268),                          # CRP-JHTS0660FS
    "file_7df13d72-7dda-4d29-81d6-4a9025961f6a.pdf": _rc(51, 316, 226, 233),          # CRP-T0310FGW 미니 3인용
    "383-855c_rev.0_08월25일.pdf": _rc(33, 337, 238, 216),                              # CRP-HQB0310FS
    "0718-383-880v rev.1(1).pdf": _rc(39, 409, 297, 290),                             # CRP-HWF1060FS
    "cr-0675f_z0383-0065a0.rev.0.pdf": _rc(29, 323, 238, 215, "외형 크기 323mm(길이) X 238mm(폭) X 215mm(높이)"),   # CR-0675FW
    "file_a76b19d6-7263-4691-ae43-1c39ed5d3dd7.pdf": _rc(16, 182, 182, 174, "외형 크기 182(길이) x 182(폭) x 174(높이)"),  # CR-0155MW
    "file_5b414c74-66a2-44d8-a7e2-8dd4d42a0d43.pdf": _rc(29, 330, 252, 215, "외형 크기 330mm(길이) X 252mm(폭) X 215mm(높이)"),  # CR-0685GW
    "file_c2ee403f-6f6a-4508-896c-722b4307fc95.pdf": _rc(65, 378, 266, 256),          # CRP-DHB0660FDM
    "crp-lht06_383-576a 사용설명서 (mkt).pdf": _rc(81, 383, 262, 260),                 # CRP-LHTR0610FWM
    "file_ac99643d-1798-434e-8fe9-12f06e5537b1.pdf": dict(dwh=(375, 269, 268), tag="매뉴얼", page=54,
                                                         raw="제품의 크기 37.5cm(길이)x26.9cm(폭)x26.8cm(높이)"),  # CRP-PHTR0610FSM (PDF 글자)
    # 전기레인지 (3구는 빌트인 설치 그림에서 타공도)
    "file_63e68f0b-a252-4aa0-92f9-bf9cf994eb4b.pdf": _ck(30, 588, 508, 57, cut_page=11),   # CIR-E30 Series
    "file_a25f76b1-0f17-40c7-b4f7-bc3d30a1d0a7.pdf": _ck(53, 588, 508, 57),                # CIR-EP30 Series (설치 그림 못 찾음)
    "file_68cb6326-e39f-4125-bf55-39fdd153024d.pdf": _ck(54, 588, 508, 57, cut_page=12),   # CIR-GP30 Series
    "file_ad90c274-0a22-43ab-88bc-8843b2c7bd70.pdf": _ck(30, 588, 508, 61, cut_page=11),   # CIR-FL30 Series
    "file_58727544-8ad2-4c35-a058-8a7a90225df0.pdf": dict(wdh=(291, 371, 46), tag="이미지판독", page=21,
                                                         raw="제품의 크기 29.1cm(길이) X 37.1cm(폭) X 4.6cm(높이)"),   # CIR-C10 1구
    # 전자레인지 · 광파오븐
    "file_00e3112a-f3c7-4d7f-bcd4-e3f66a58906a.pdf": dict(wdh=(469, 343, 302), tag="매뉴얼", page=20,
                                                         raw="제품외형크기(mm) (폭X깊이X높이) 469 x 343 x 302"),  # CMW-PF2310EW
    "file_1616194e-8856-4e84-9a9b-53819ac93458.pdf": dict(wdh=(485, 410, 280), tag="이미지판독", page=21,
                                                         raw="제품 외형 크기 485mm(W) x 410mm(D) x 280(H)mm"),   # CMW-F2510DW
    "file_42f53991-7353-4c10-83db-3ccfea55637a.pdf": dict(wdh=(440, 341, 258), tag="이미지판독", page=21,
                                                         raw="제품외형크기(mm) (폭X깊이X높이) 440X341X258"),       # CMW-A201DW
    "file_e9aa6d86-f3a9-49e5-97fb-7d52295dc83e.pdf": dict(wdh=(520, 515, 323), tag="이미지판독", page=21,
                                                         raw="제품 외형 크기 520㎜ (W) x 515㎜ (D) x 323㎜ (H)"),  # CMW-CO3010DW
    "file_91c56ac0-68c4-4dff-9a45-06bf87d9b8d1.pdf": dict(wdh=(485, 408, 293), tag="이미지판독", page=21,
                                                         raw="제품 외형 크기 485(W) × 408(D) × 293(H) mm"),         # CMW-2310DW · DB
    # 식기세척기
    "file_fb2f9f9f-da99-48ff-a9b5-e87dee8a44b5.pdf": dict(
        wdh=(598, 575, 815), tag="이미지판독", page=39, raw="제품 크기 (W)598mm X (D)575mm X (H)815mm · 깊이 D2 1150mm(도어 열림)",
        subtype="built_in", install="built_in",
        note="CDW-BS1410B · BSST14B · BSGL14B · BS1420B Series 공통 사용설명서 39쪽"),   # 14인용 스팀샷
    "file_6689c330-84ec-4dcb-a93d-af62f0e0e6bb.pdf": dict(wdh=(550, 350, 500), tag="이미지판독", page=31,
                                                         raw="제품 크기 (W)550mm X (D)350mm X (H)500mm · 깊이 D2 705mm(도어 열린 상태)"),  # CDW-D0620T
    "file_c5d81cd2-f6ca-4334-9d47-8584c78bcd05.pdf": dict(
        wdh=(598, 600, 845), tag="이미지판독", page=36, raw="제품 크기 (W)598 mm X (D)600mm X (H)845mm",
        subtype="freestanding", install="freestanding",
        note="CDW-BS1210U 는 프리스탠딩(상부판을 떼지 않고 설치), 세미빌트인은 CDW-BS12B10U · 39쪽 '제품 설치 및 공간 치수': "
             "상판을 떼면 높이 815 mm, 설치 공간 폭 600 이상 · 높이 820 이상 · 깊이 600 이상"),   # CDW-BS1210UDG
}


def pick_name(ph):
    names = [re.sub(r"^\([^)]*\)\s*", "", K.F.html.unescape(x).strip())   # '(타임딜)' · '(특가판매)' 앞말은 뗀다
             for x in re.findall(r'class="[^"]*prd[^"]*name[^"]*"[^>]*>([^<]+)<', ph)]
    name = names[0] if names else ""
    code = next((x for x in names[1:] if re.fullmatch(r"[A-Z]{2,5}-[A-Z0-9]{3,}", x)), None)
    return name, code


def ld_graph(ph):
    out = []
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', ph, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        out += d.get("@graph", [d]) if isinstance(d, dict) else d
    return out


def notice_table(ph):
    i = ph.find('<div class="prd_tbl_info">')
    if i < 0:
        return {}
    seg = ph[i:ph.find("</table>", i)]
    return {re.sub(r"\s+", "", th): re.sub(r"\s+", " ", K.F.html.unescape(re.sub(r"<[^>]+>", " ", td))).strip()
            for th, td in re.findall(r'<th scope="row">(.*?)</th>\s*<td>(.*?)</td>', seg, re.S)}


def notice_order(label):
    """'크기(길이,폭,높이)' → 'dwh' · '크기(폭,깊이,높이)' → 'wdh' · '크기(길이x폭x높이)'. 길이 = 깊이.
    '크기(넓이,길이,폭)' 처럼 뜻이 모호하거나 셋이 맞지 않으면 None."""
    m = re.search(r"\(([^)]*)\)", label or "")
    toks = [t.strip() for t in re.split(r"[,xX×*]", m.group(1) if m else "")]
    key = {"길이": "d", "깊이": "d", "폭": "w", "가로": "w", "높이": "h"}
    if not all(t in key for t in toks):
        return None
    seq = "".join(key[t] for t in toks)
    return seq if sorted(seq) == ["d", "h", "w"] else None


def geo_text(ph):
    g = re.search(r'<div class="geo_detail_cont">(.*?)</div>', ph, re.S)
    return re.sub(r"\s+", " ", K.F.html.unescape(re.sub(r"<[^>]+>", " ", g.group(1)))).strip() if g else ""


def links_with_hint(h):
    """→ [(productNo, 링크 글자 · 그림 alt · JSON-LD 이름)] — 번호마다 글자가 있는 것을 먼저 쓴다."""
    out = {}

    def put(no, hint):
        if hint or no not in out:
            out[no] = (out.get(no) or "") + " " + hint if out.get(no) else hint

    for m in re.finditer(r'<a[^>]+href="(?:https://www\.cuckoo\.co\.kr)?/mall/productView\?productNo=(\d+)[^"]*"[^>]*>(.*?)</a>', h, re.S):
        put(int(m.group(1)), re.sub(r"\s+", " ", K.F.html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip())
    for m in re.finditer(r'<area[^>]*alt="([^"]*)"[^>]*href="(?:https://www\.cuckoo\.co\.kr)?/mall/productView\?productNo=(\d+)', h):
        put(int(m.group(2)), m.group(1))
    for g in ld_graph(h):   # 색상 변형 (ProductGroup.hasVariant)
        for v in g.get("hasVariant") or []:
            m = re.search(r"productNo=(\d+)", str(v.get("@id") or v.get("url") or ""))
            if m:
                put(int(m.group(1)), str(v.get("name") or ""))
    for m in re.finditer(r'productView\?productNo=(\d+)', h):   # 스크립트 안 링크 — 글자 없음
        put(int(m.group(1)), "")
    return list(out.items())


# 치수 셋 — 'W588 x D508 x H57mm' · '291(W) x 371(L) x 46(H)' · '38.3cm(길이)x26.2cm(폭)x26.0cm(높이)' ·
#   '238㎜(W) × 329㎜(L) × 220㎜(H)' · '588 x 508 x 57 mm' · '37.8 x 26.6 x 25.6cm'
_NUM = r"(\d{1,4}(?:\.\d+)?)"
_LAB = r"(W|D|H|L|길이|폭|높이|깊이|가로)"
_TOK = r"(?:" + _LAB + r"\s*)?" + _NUM + r"\s*(mm|cm|㎜)?\s*(?:\(\s*" + _LAB + r"\s*\))?\s*(mm|cm|㎜)?"
TRIPLE = re.compile(_TOK + r"\s*[xX×*]\s*" + _TOK + r"\s*[xX×*]\s*" + _TOK)
LAB_KEY = {"W": "w", "가로": "w", "폭": "w", "D": "d", "L": "d", "길이": "d", "깊이": "d", "H": "h", "높이": "h"}
DEFAULT_ORDER = {"rice_cooker": "dwh"}   # 쿠쿠 밥솥은 고시처럼 길이(깊이) × 폭 × 높이. 나머지는 가로 × 깊이 × 높이


def parse_triple(text, cat):
    """→ (d, 원문, 칸표시있음?) — 조리실 · 내부 · 포장 치수는 건너뛴다. 'L'(길이) = 깊이."""
    for m in TRIPLE.finditer(text or ""):
        before = text[max(0, m.start() - 14):m.start()]
        if re.search(r"조리실|내부|포장|박스", before):
            continue
        g = m.groups()   # 셋마다 (앞표시, 수, 단위, 뒤표시, 단위)
        nums, labs, cm = [], [], False
        for i in range(3):
            pre, num, u1, post, u2 = g[i * 5:(i + 1) * 5]
            nums.append(float(num))
            labs.append(LAB_KEY.get(pre or post or ""))
            cm = cm or "cm" in ((u1 or "") + (u2 or ""))
        if cm or (max(nums) < 100 and "cm" in text[m.end():m.end() + 3]):
            nums = [x * 10 for x in nums]
        nums = [int(round(x)) for x in nums]
        if all(labs) and sorted(labs) == ["d", "h", "w"]:
            return {k: (n, n) for k, n in zip(labs, nums)}, m.group(0).strip(), True
        if any(labs):
            continue    # 표시가 일부만 있다 — 믿지 않는다
        seq = DEFAULT_ORDER.get(cat, "wdh")
        return {k: (n, n) for k, n in zip(seq, nums)}, m.group(0).strip(), False
    return None, None, False


def manual_urls(ph, graph):
    urls = []
    for a in re.findall(r'href="([^"]+\.pdf)"', ph):
        urls.append(K.F.abs_url(a, CK))
    for g in graph:
        for p in g.get("additionalProperty") or []:
            if p.get("name") == "사용설명서" and str(p.get("value", "")).endswith(".pdf"):
                urls.append(K.F.abs_url(p["value"], CK))
    return list(dict.fromkeys(u for u in urls if u))


def name_crumb(name):
    if re.search(r"부속품|내솥|패킹|필터|세제|키트|케이스$|에어프라이어|프라이팬|웍|냄비", name or ""):
        return None
    for pat, crumb in ((r"밥솥", "밥솥"), (r"가스레인지", "가스레인지"), (r"인덕션|하이브리드|전기레인지", "인덕션"),
                       (r"식기세척기", "식기세척기"), (r"전자레인지|광파오븐|오븐레인지", "전자레인지")):
        if re.search(pat, name or ""):
            return crumb
    return None


def classify(crumb, name, code, text, place):
    cat = CK_CATS.get(crumb)
    if not cat:
        return None
    if cat == "rice_cooker":
        if not K.is_rice_cooker(name):
            return None
        return cat, K.rice_subtype(name + " " + text[:200]), "freestanding"
    if cat == "cooktop":
        if crumb == "가스레인지" or "가스" in name:
            return cat, "gas", "freestanding"           # 스탠드 가스레인지 (상판 위에 놓는다)
        hybrid = "하이브리드" in name or (code or "").startswith("CIHR")
        sub = "hybrid" if hybrid else ("highlight" if "하이라이트" in name else "induction")
        # 3구는 빌트인 · 프리스탠딩 겸용이다 (설명서마다 '빌트인 설치 요령' 이 있다) — 빌트인으로 둔다. 1구 · 케이스포함은 놓고 쓴다
        inst = "freestanding" if re.search(r"1구|포터블|스탠드형|케이스포함", name) else (
            "built_in" if ("빌트인" in text + name or "3구" in name) else None)
        return cat, sub, inst
    if cat == "dishwasher":
        if "빌트인" in name + text[:300]:
            return cat, "built_in", "built_in"
        if place and place <= 8:
            return cat, "countertop", "freestanding"
        if "프리스탠딩" in name + text[:300]:
            return cat, "freestanding", "freestanding"
        return cat, None, None
    if cat == "microwave":
        combi = bool(re.search(r"오븐|광파|에어|그릴|컨벡션", name))
        return cat, ("combi" if combi else "solo"), "freestanding"
    return None


def make_row(no, u, ph):
    graph = ld_graph(ph)
    crumb = next((it.get("name") for g in graph if g.get("@type") == "BreadcrumbList"
                  for it in g.get("itemListElement") or [] if it.get("position") == 2), None)
    name, code = pick_name(ph)
    prod = next((g for g in graph if g.get("@type") == "Product"), {})
    code = code or prod.get("mpn") or prod.get("model")
    notice = notice_table(ph)
    code = code or notice.get("모델명")
    geo = geo_text(ph)
    place = K.place_count(name) or K.place_count(notice.get("용량(인용,형태등)") or "")
    if crumb is None:   # 옛 상품 페이지엔 JSON-LD 빵부스러기가 없다 — 상품 이름으로 가린다
        crumb = name_crumb(name)
    kind = classify(crumb, name, code, geo, place)
    if not kind:
        return None, crumb
    cat, sub, inst = kind
    img = (prod.get("image") or [None])[0] if isinstance(prod.get("image"), list) else prod.get("image")
    if not img:
        m = re.search(r'<meta property="og:image" content="([^"]+)"', ph)
        img = m.group(1) if m else None
    avail = ((prod.get("offers") or {}).get("availability") or "").rsplit("/", 1)[-1] or None
    row = K.base_row(brand="쿠쿠", category=cat, category_subtype=sub, install_type=inst, model_name=name,
                     model_codes=[code] if code else [], line="쿠쿠", source_url=u, page_url=u,
                     image_source_url=K.F.abs_url(img, CK) if img else None, sale_status=avail,
                     place_count=place if cat in ("rice_cooker", "dishwasher") else None,
                     product_type_raw=crumb)
    if cat == "microwave":
        row["capacity_l"] = K.litres(name)
    # 1) 상품정보고시 '크기(…)' 칸
    sk = next((k for k in notice if k.startswith("크기")), None)
    sv = notice.get(sk) if sk else None
    d, raw = None, None
    if sv:
        m = re.search(r"외형\s*[:：]?\s*(.+)", sv)        # '조리실:305*297*215/제품외형:440*341*258(MM)' — 외형 부분만
        d, traw, labeled = parse_triple(m.group(1) if m else sv, cat)
        if d and not labeled:
            seq = notice_order(sk)
            if seq:
                nums = [d[k][0] for k in DEFAULT_ORDER.get(cat, "wdh")]
                d = {k: (n, n) for k, n in zip(seq, nums)}
            else:   # '크기' · '크기(넓이,길이,폭)' — 칸 이름이 없거나 맞지 않는다 → 종류별 기본 순서로 읽고 미검증
                row["tags"].append("치수순서추정")
        if d:
            raw = f"상품정보고시 {sk} {sv}"
    # 2) 요약 글
    if not d:
        d, sraw, labeled = parse_triple(geo, cat)
        if d:
            raw = f"요약 글 '{sraw}'"
            row["tags"].append("요약문")
            if not labeled:
                row["tags"].append("치수순서추정")
    # 3) 사용설명서
    mans = manual_urls(ph, graph)
    row["_mans"] = mans
    if mans:
        row["product_type_raw"] = " · ".join(x for x in [row["product_type_raw"], "사용설명서 " + mans[0]] if x)
    d, raw = apply_manual(row, d, raw, mans)
    K.put_dims(row, d, raw)
    if cat == "cooktop" and sub == "gas":
        gas_of(row, name, geo)
    return row, crumb


def gas_of(row, name, geo):
    """가스레인지 → gas_types (2026-10-25 3차). 공식 상품 이름이 가스를 적는다 ('2구 스탠드 LNG 가스레인지'),
    핵심 사양 글은 'LNG 가스 전용' · 'LNG 전용 모델'. 이름 · 글에 'LNG' · 'LPG' 낱말이 없으면 None."""
    found = [g for g in ("LNG", "LPG") if re.search(rf"\b{g}\b", name or "")]
    src = "상품 이름"
    if not found:
        found = [g for g in ("LNG", "LPG") if re.search(rf"\b{g}\b", geo or "")]
        src = "핵심 사양 글"
    if not found:
        return
    row["gas_types"] = found
    only = re.search(r"(?:LNG|LPG)\s*(?:가스\s*)?전용", geo or "")
    note = f"가스 종류: {src} '{'/'.join(found)}'" + (f" · 핵심 사양 '{only.group(0)}'" if only else "")
    row["install_notes"] = "; ".join(x for x in [row.get("install_notes"), note] if x)


def apply_manual(row, d, raw, mans):
    """CK_MANUAL 에 옮겨 둔 설명서 값으로 맞추거나 고친다. → (d, raw)"""
    for mu in mans:
        man = CK_MANUAL.get(urllib.parse.unquote(mu.rsplit("/", 1)[-1]))
        if not man:
            continue
        if "wdh" in man:
            w, dd, hh = man["wdh"]
        else:
            dd, w, hh = man["dwh"]
        md = {"w": (w, w), "d": (dd, dd), "h": (hh, hh)}
        same = bool(d) and all(abs(d[k][0] - md[k][0]) <= 2 for k in "whd")
        weak = set(row["tags"]) & {"요약문", "치수순서추정"}
        if same and not weak:
            row["product_type_raw"] += f" · 사용설명서 {man['page']}쪽 '{man['raw']}' 와 같음"
        else:
            old = raw
            d, raw = md, f"사용설명서 {man['page']}쪽 '{man['raw']}'" + (f" (전: {old})" if old else "")
            row["tags"] = [t for t in row["tags"] if t not in ("요약문", "치수순서추정")] + [man["tag"]]
            row["source_url"] = mu
            row["product_type_raw"] += " · 사용설명서와 같음 (요약 글 확인)" if same else " · 사용설명서로 고침"
        if man.get("cutout") and row["install_type"] == "built_in":
            row["cutout_w_mm"], row["cutout_d_mm"] = man["cutout"]
            row["cutout_raw"] = (f"사용설명서 {man['cut_page']}쪽 '빌트인 설치 요령' 그림: 타공 {man['cutout'][0]} × "
                                 f"{man['cutout'][1]} mm, 모서리 R30 또는 C30 이하")
            row["back_gap_mm"] = man["back_gap"]
            row["install_notes"] = (f"사용설명서 {man['cut_page']}쪽 그림: 타공 뒤쪽 벽까지 {man['back_gap']} mm · 제품 바닥 20 mm 이상 띄움 · "
                                    "싱크대 내부 뒤쪽 공간 40 mm 이상")
            if "이미지판독" not in row["tags"]:
                row["tags"].append("이미지판독")
        if man.get("subtype"):
            row["category_subtype"], row["install_type"] = man["subtype"], man["install"]
        if man.get("note"):
            row["install_notes"] = man["note"]
        break
    return d, raw


# 사용설명서가 시리즈 공통인데 그 시리즈의 한 페이지에만 '제품설명서' 단추가 있는 경우 — 코드 앞부분 → 설명서 주소
CK_SERIES = [
    (r"^CDW-(BS1410B|BSST14B|BSGL14B|BS1420B)",
     "https://cdn.cuckoo.co.kr/upload_cuckoo/_bo_rep/manual/file_fb2f9f9f-da99-48ff-a9b5-e87dee8a44b5.pdf"),
]


def share_manuals(rows):
    """특가 · 타임딜 페이지엔 '제품설명서' 단추가 없는 곳이 있다 — 같은 모델 코드의 다른 페이지가 건 설명서를 쓴다."""
    by_code, place = {}, {}
    for r in rows:
        if r.get("_mans") and r.get("model_codes"):
            by_code.setdefault(r["model_codes"][0], r["_mans"])
        if r.get("place_count") and r.get("model_codes"):
            place.setdefault(r["model_codes"][0], r["place_count"])
    for r in rows:   # 이름에 '3인용' 이 없는 페이지 (트윈프레셔쁘띠밥솥) — 같은 코드의 다른 페이지 인분
        if r["category"] in ("rice_cooker", "dishwasher") and not r.get("place_count") and r.get("model_codes"):
            r["place_count"] = place.get(r["model_codes"][0])
    for r in rows:
        mans = r.pop("_mans", None)
        code = (r.get("model_codes") or [None])[0]
        if mans or not code:
            continue
        mans = by_code.get(code) or [u for pat, u in CK_SERIES if re.search(pat, code)]
        if not mans:
            continue
        d = {"w": (r["width_mm"],) * 2, "d": (r["depth_mm"],) * 2, "h": (r["height_mm"],) * 2} if r.get("width_mm") else None
        r["product_type_raw"] = " · ".join(x for x in [r["product_type_raw"], "사용설명서(같은 코드 다른 페이지) " + mans[0]] if x)
        d2, raw2 = apply_manual(r, d, r.get("size_raw"), mans)
        if d2 is not d:
            r["tags"] = [t for t in r["tags"] if t not in ("치수확인필요", "치수범위")]
            K.put_dims(r, d2, raw2)
    for r in rows:
        r.pop("_mans", None)


def collect(f, K_, sample=None):
    global K
    K = K_
    queue, seen = [], set()

    def push(no, hint, force=False):
        if no in seen:
            return
        if not force and hint and (NOT_KITCHEN.search(hint) or not KITCHEN_HINT.search(hint)):
            return
        seen.add(no)
        queue.append(no)

    # 시작 페이지 — 홈 · 기획전. 글자 없는 링크(그림)는 일단 받아 본다 (빵부스러기로 종류를 가린다)
    plan_pages = []
    for p in SEED_PAGES:
        st, h = f.get(CK + p)
        for no, hint in links_with_hint(h):
            push(no, hint)
        plan_pages += re.findall(r'href="(/planning/planningView\?[^"]+)"', h)
    for p in dict.fromkeys(x.replace("&amp;", "&") for x in plan_pages):
        st, h = f.get(CK + p)
        for no, hint in links_with_hint(h):
            push(no, hint)
    for no in CK_SEEDS:
        push(no, "", force=True)
    print(f"[cuckoo] 시작 상품 번호={len(queue)} (홈 · 기획전 · 검색엔진)", file=sys.stderr)
    rows, per_cat, skipped = [], {}, {}
    while queue:
        no = queue.pop(0)
        u = f"{CK}/mall/productView?productNo={no}"
        st, ph = f.get(u)
        if st != 200:
            continue
        row, crumb = make_row(no, u, ph)
        if not row:
            skipped[crumb] = skipped.get(crumb, 0) + 1
            continue
        if sample and per_cat.get(row["category"], 0) >= sample:
            continue
        per_cat[row["category"]] = per_cat.get(row["category"], 0) + 1
        rows.append(row)
        if sample and len(per_cat) >= 4 and min(per_cat.values()) >= sample:   # 표본: 네 종류가 다 모이면 멈춘다
            break
        if not sample:   # 주방가전 상품에서만 옆 링크(변형 · 함께 사면 좋은 제품)를 따라간다
            for n2, hint in links_with_hint(ph):
                push(n2, hint)
    print(f"[cuckoo] 주방가전 아님(빵부스러기별) {skipped}", file=sys.stderr)
    share_manuals(rows)
    align_summaries(rows)
    return rows


def align_summaries(rows, tol=2):
    """요약 글에서만 크기를 읽은 밥솥 행 중, 같은 인분 · 같은 세 치수(±2)인 확인된 행(상품정보고시 또는 사용설명서)과
    W · D 방향만 다른 행을 확인된 행의 방향에 맞추고 '치수순서추정' 을 더한다 ('요약문' 은 그대로 — 미검증).
    요약 글은 폭 · 깊이를 뒤바꿔 적은 곳이 많다 (트윈프레셔 6인용 'W383 x D262' — 설명서 '38.3cm(길이) x 26.2cm(폭)').
    맞추지 않으면 collect.py flag_permuted 가 확인된 행까지 '치수순서의심' 으로 묶는다. 값은 바꾸지 않고 칸만 옮긴다."""
    weak = {"요약문", "치수순서추정"}
    refs = [r for r in rows if r["category"] == "rice_cooker" and r.get("width_mm") and not set(r["tags"]) & weak]
    for r in rows:
        if r["category"] != "rice_cooker" or not r.get("width_mm") or not set(r["tags"]) & weak:
            continue
        mine = {"w": r["width_mm"], "d": r["depth_mm"], "h": r["height_mm"]}
        for ref in refs:
            if ref.get("place_count") != r.get("place_count"):
                continue
            theirs = {"w": ref["width_mm"], "d": ref["depth_mm"], "h": ref["height_mm"]}
            if not all(abs(a - b) <= tol for a, b in zip(sorted(mine.values()), sorted(theirs.values()))):
                continue
            if all(abs(mine[k] - theirs[k]) <= tol for k in "whd"):
                break
            new = {kt: mine[km] for km, kt in zip(sorted(mine, key=mine.get), sorted(theirs, key=theirs.get))}
            before = f"{mine['w']}(W)×{mine['d']}(D)×{mine['h']}(H)"
            r["width_mm"], r["depth_mm"], r["height_mm"] = new["w"], new["d"], new["h"]
            if "치수순서추정" not in r["tags"]:
                r["tags"].append("치수순서추정")
            code = (ref.get("model_codes") or ["?"])[0]
            mine_code = (r.get("model_codes") or ["?"])[0]
            r["product_type_raw"] += f" · W · D 방향을 같은 크기 {code} (상품정보고시 · 설명서) 방향으로 맞춤 (요약 글 {before})"
            ref["product_type_raw"] += f" · {mine_code} 요약 글은 W · D 가 반대({before}) — 이 방향으로 맞춤"
            break
    # 같은 크기로 묶일 때 확인된 행이 앞에 오게 한다 (collect.py merge 는 첫 행의 태그를 남긴다)
    unver = {"요약문", "치수순서추정", "이미지판독", "고시불일치"}
    rows.sort(key=lambda r: 2 if set(r["tags"]) & weak else (1 if set(r["tags"]) & unver else 0))
