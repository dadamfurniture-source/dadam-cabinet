"""피코그램(퓨리얼) 하부장 가전 — 언더싱크 정수기 (퓨리얼 브랜드몰 pureal.co.kr). (2026-11-03)

피코그램(picogram.co.kr)은 필터 제조사다. 회사 사이트의 '언더싱크' 제품(Eco · Puri · PnP · 맥스트림 필터 시스템)은
OEM 필터 틀이라 필터 길이(10" · 11" · 17" …)만 있고 본체 치수가 없다 → 행을 만들지 않는다.
가정용 완제품은 자기 브랜드 '퓨리얼' 몰(www.pureal.co.kr, 회사 사이트의 '퓨리얼 브랜드몰' 링크)에서 판다.

목록: /shop/big_section.php?cno1=1041 (언더싱크 정수기) — 이름에 '언더싱크' 가 든 상품.
상세: /shop/detail.php?pno=… — 모델명은 글자(`모델명 | PPU-200`), 사양은 상세 그림 '제품 정보' 표에만 있다.
      그림을 사람이 읽어 PU_SPEC 에 옮겼다 → '이미지판독' (미검증). 그림 호스트 picopureal.wisacdn.com robots.txt 없음(404).
robots.txt (www.pureal.co.kr): /a/ · /_manage/ 만 막는다.
"""
import html
import re
import sys

BRAND_KEY = "picogram"
K = None   # collect.py 가 넘긴다

PR = "https://www.pureal.co.kr"
IMG = "https://picopureal.wisacdn.com"

# 상세 그림 '제품 정보' 표 — 모델명 → 값. dims = (W, D, H) 그림 표기 그대로
PU_SPEC = {
    "PPU-200": dict(dims=(97.5, 226, 252), raw="제품 크기 W97.5 X D226 X H252 (mm)", sub="purify",
                    kind="퓨리얼 언더싱크 정수기 퓨온싱크 · 직수형 여과방식 · 필터 3개 (복합카본블록 · 나노스트림 · 실버카본블록)",
                    img=f"{IMG}/_data/product/ppu200/PPU200_info_03-10.jpg",
                    note="상품 사진은 필터 3개가 옆으로 나란한 틀 — 226 이 가로로 보인다. 표기는 W97.5 · D226 이라 그대로 넣었다 (방향 확인 필요)"),
    "PPU-500": dict(dims=(95, 97, 500), raw="제품 크기 W95 X D97 X H500mm", sub="purify",
                    kind="퓨리얼 하이브리드 홈 정수기 · 필터여과식 · 필터 1개", img=f"{IMG}/_data/product/ppu500/ppu500_27.jpg", note=None),
    "PPC-200": dict(dims=(184, 135, 496), raw="제품크기 W184 x D135 x H496 mm", sub="purify",
                    kind="퓨리얼 대용량 언더싱크 정수기 · 직수형 여과방식 · 설치장소 가정/업소용/사무실/옥내용",
                    img=f"{IMG}/_data/migration/theme/picogram/img/detailpage/pureal_hybrid_filter_1_pd.jpg", note=None),
}


def collect(f, K_, sample=None):
    global K
    K = K_
    st, h = f.get(f"{PR}/shop/big_section.php?cno1=1041")
    items = {}
    for m in re.finditer(r'<a href="[^"]*detail\.php\?pno=([0-9A-F]{32})[^"]*"[^>]*>(.*?)</a>', h if st == 200 else "", re.S):
        t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if "언더싱크" in t:
            items.setdefault(m.group(1), t)
    print(f"[picogram] 퓨리얼 언더싱크 {len(items)}", file=sys.stderr)
    rows = []
    for pno, name in items.items():
        url = f"{PR}/shop/detail.php?pno={pno}"
        st, ph = f.get(url)
        if st != 200:
            continue
        m = re.search(r"모델명\s*</[^>]+>\s*<[^>]+>\s*([A-Z]{2,4}-\d{3,4})", ph) or re.search(r"\b(P[A-Z]{2}-\d{3})\b", name)
        mdl = m.group(1) if m else None
        spec = PU_SPEC.get(mdl)
        # 그 상품의 사진은 '#addimg' 가 붙은 것 (머리 · 추천 칸 사진은 다른 상품)
        img = re.search(r'(https://picopureal\.wisacdn\.com/_data/product/\d{6}/\d{2}/[0-9a-f]+\.jpg)#addimg', ph)
        row = K.base_row(brand="퓨리얼", category="water_purifier", category_subtype=(spec or {}).get("sub"), install_type="built_in",
                         model_name=re.sub(r"\s*\(1년필터포함\).*$", "", name).strip(), model_codes=[mdl] if mdl else [],
                         line="피코그램", source_url=(spec or {}).get("img") or url, page_url=url,
                         image_source_url=img.group(1) if img else None,
                         product_type_raw=(spec or {}).get("kind") or name)
        if spec:
            w, d_, hh = spec["dims"]
            dd, _ = K.dims_of("(W x D x H)", f"{w} x {d_} x {hh}", "wdh")
            K.put_dims(row, dd, spec["raw"])
            row["tags"].append("이미지판독")
            if spec.get("note"):
                row["install_notes"] = spec["note"]
        else:
            K.put_dims(row, None, None)
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
