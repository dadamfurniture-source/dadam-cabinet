"""리젠스 싱크볼 — lizens.co.kr 제품 목록 → 제품 페이지 규격표 (2026-10-25).

  목록   홈 메뉴의 /kr/sinks/list.do?gc2=N (싱크볼: Jumbo · Single · Double · Bowls · Quadra · GOYO · Layon · Reginox · Altainox)
         · /kr/layons/list.do?gc2=N (리폼싱크볼: 일반 · Embo) — &pn=2,3… 쪽마다 12개
  사양   제품 페이지 규격표 'S(외부사이즈)' · 'B(내부사이즈)' · 'C(컷아웃사이즈)' · 'D(배수구사이즈)' · 'Cabinet(캐비닛사이즈)'
  사진   제품 페이지 첫 사진 (/upload/goods/…)

치수 순서: 리젠스 2026 카탈로그(/catalogfiledownload.do?seq=25) 'HOW TO READ' — SIZE '제품 가로 × 세로',
CUT-OUT '인셋 · 언더별 가로 × 세로 × 코너 R'. 페이지의 S · C 는 같은 표기라 그 순서(W × D)로 읽는다.
외부사이즈에 높이가 없어 높이(H)는 B(내부사이즈) 세 번째 값 = 볼 깊이 (README: 싱크볼 H = 볼 깊이). 2볼은 깊은 쪽.
컷아웃이 '(UNDER) / (INSET)' 둘이면 언더를 칸에 넣는다 (리젠스: "언더방식만 권장"). 범위(940~960) · 여러 R(R90/R1088) ·
세 번째 값이 R 이 아닌 컷아웃은 칸을 비우고 원문만 남긴다. 수전 구멍은 페이지에 없다.

같은 사이트의 수입 브랜드 Reginox(네덜란드) · Altainox(이탈리아)는 reginox.py · altainox.py 가 이 파일의 site_rows() 로 낸다.
"""
import re
import sys

BRAND_KEY = "lizens"
K = None   # collect.py 가 넘긴다

SITE = "https://lizens.co.kr"
IMPORT_TYPES = {"Reginox": "레지녹스", "Altainox": "알타이녹스"}
MENU = {"sinks": "싱크볼", "layons": "리폼싱크볼"}


# 리젠스 2026 카탈로그(규격 일람 p54~79)와 페이지 값이 다른 모델 — 어느 쪽이 맞는지 모른다. 페이지 값을 넣고 비고에 남긴다
#   (2026-10-25 대조. brands/lizens.md '정확도가 떨어지는 행')
CATALOG_DIFF = {
    'GQE 9803 엠보': "2026 카탈로그 PDF 28쪽 'GQ(E) 9803' 와 다름: 외경 웹 840×515 · 카탈로그 980×520",
    'GOYO 490': "2026 카탈로그 PDF 38쪽 'GOYO 490' 와 다름: 볼 깊이 웹 220 · 카탈로그 210",
    'GOYO 540': "2026 카탈로그 PDF 38쪽 'GOYO 540' 와 다름: 볼 깊이 웹 200 · 카탈로그 210",
    'GOYO 750': "2026 카탈로그 PDF 38쪽 'GOYO 750' 와 다름: 볼 깊이 웹 210 · 카탈로그 200",
    'GOYO 840': "2026 카탈로그 PDF 38쪽 'GOYO 840' 와 다름: 컷아웃 웹 806×430 R29 · 카탈로그 UNDER 806×426 R28",
    'GOYO 950': "2026 카탈로그 PDF 38쪽 'GOYO 950' 와 다름: 외경 웹 955×460 · 카탈로그 950×440",
    'LD 900': "2026 카탈로그 PDF 29쪽 'LD 900' 와 다름: 외경 웹 900×520 · 카탈로그 892×520 / 볼 깊이 웹 210 · 카탈로그 200",
    'LS 850': "2026 카탈로그 PDF 31쪽 'LS 850' 와 다름: 컷아웃 웹 826×491 R39 · 카탈로그 UNDER 820×485 R38",
    'LUT 900': "2026 카탈로그 PDF 29쪽 'LUT 900' 와 다름: 외경 웹 900×520 · 카탈로그 892×520 / 볼 깊이 웹 100 · 카탈로그 210",
    'LS 540(GD 선정)': "2026 카탈로그 PDF 34쪽 'LS 540' 와 다름: 볼 깊이 웹 185 · 카탈로그 85",
    'ISS 480(L)': "2026 카탈로그 PDF 34쪽 'ISS 480L' 와 다름: 컷아웃 웹 칸 비움(380 x 350 x 180) · 카탈로그 UNDER 450×400 R39",
    'LISDP 870': "2026 카탈로그 PDF 30쪽 'LISDP 870' 와 다름: 컷아웃 웹 838×448 R34 · 카탈로그 UNDER 841×452 R37",
    'LISD 870': "2026 카탈로그 PDF 30쪽 'LISD 870' 와 다름: 컷아웃 웹 838×448 R34 · 카탈로그 UNDER 841×452 R37",
    'LQ 490': "2026 카탈로그 PDF 34쪽 'LQ 490' 와 다름: 볼 깊이 웹 220 · 카탈로그 210",
    'LQ 840': "2026 카탈로그 PDF 32쪽 'LQ 840 (L/R)' 와 다름: 컷아웃 웹 806×430 R29 · 카탈로그 UNDER 806×426 R28",
    'LQ 940': "2026 카탈로그 PDF 29쪽 'LQ 940 (L/R)' 와 다름: 볼 깊이 웹 200 · 카탈로그 210",
    'LQCR 8345E 엠보': "2026 카탈로그 PDF 32쪽 'LQCR 8345E (EMBO)' 와 다름: 외경 웹 830×450 · 카탈로그 830×515",
    'LQCR 8345N NANO COATING': "2026 카탈로그 PDF 32쪽 'LQCR 8345N (NANO COATING)' 와 다름: 외경 웹 830×450 · 카탈로그 830×515",
}


def nums(s):
    return [int(x) for x in re.findall(r"\d+", s or "")]


def list_pages(f):
    """→ [(kind, seq, list_url)] — 홈 메뉴의 목록마다 쪽을 넘기며 제품 번호를 모은다"""
    st, h = f.get(SITE + "/")
    lists = sorted(set(re.findall(r"/kr/(?:sinks|layons)/list\.do\?gc2=\d+", h)))
    seen, out = set(), []
    for L in lists:
        kind = L.split("/")[2]
        for pn in range(1, 30):
            st, x = f.get(f"{SITE}{L}&pn={pn}")
            got = [s for s in re.findall(r"href='display\.do\?seq=(\d+)'", x) if (kind, s) not in seen]
            if not got:
                break
            for s in got:
                seen.add((kind, s))
                out.append((kind, s, L))
    return out


def page_spec(h):
    """제품 페이지 → (종류, 이름, {s,b,c,d,cabinet,color: 값}, 이름없는칸?, 첫 사진)"""
    typ = re.search(r'<span class="product-type">([^<]*)</span>', h)
    title = re.search(r'<h5 class="cl-title mb-3 fnb">([^<]*)</h5>', h)
    pairs = [(K.F.html.unescape(a).strip(), K.F.html.unescape(b).strip())
             for a, b in re.findall(r"<li class='d-flex'>\s*<span>([^<]*)</span>\s*<span>([^<]*)</span>", h)]
    spec, unnamed = {}, False
    keymap = (("S(", "s"), ("B(", "b"), ("C(", "c"), ("D(", "d"), ("Cabinet", "cabinet"), ("Color", "color"))
    if pairs and all(not a for a, _ in pairs) and len(pairs) == 4:
        # 칸 이름이 모두 비었다 (ISL 870) — 다른 페이지와 같은 순서 S · B · C · D 로 읽고 미검증
        spec = dict(zip("sbcd", (b for _, b in pairs)))
        unnamed = True
    else:
        for a, b in pairs:
            k = next((v for p, v in keymap if a.startswith(p)), None)
            if k and b:
                spec[k] = b
    img = re.search(r"<img class='mw-100 h-100' src='([^']+)'", h)
    return ((typ.group(1).strip() if typ else None), (K.F.html.unescape(title.group(1)).strip() if title else None),
            spec, unnamed, (K.F.abs_url(img.group(1), SITE) if img else None))


def bowl_depth(b):
    """'832 x 460 x 210' → 210 · '(L)380 X 390 X 190 / (R)380 X 390 X 190' → 190 · '770 x 390 x 220(180)' → 220"""
    depths = []
    for part in re.split(r"/", b or ""):
        p = re.sub(r"\([A-Z]\)", "", part)
        cells = re.split(r"\s*[xX×*]\s*", p.strip())
        if len(cells) >= 3:
            n = nums(cells[2])
            if n:
                depths.append(n[0])
    return max(depths) if depths else None


def single_bowl(b):
    """1볼 '832 x 460 x 210' → (832, 460). 2볼 · 값 부족 → None"""
    if not b or "/" in b:
        return None
    cells = re.split(r"\s*[xX×*]\s*", b.strip())
    n = [nums(x) for x in cells[:2]]
    return (n[0][0], n[1][0]) if len(n) == 2 and n[0] and n[1] else None


def cutout_of(c):
    """→ ((가로, 세로, R) 또는 None, 쓴 쪽 'UNDER'·'INSET'·'' , 이유)"""
    if not c:
        return None, "", None
    segs = [s.strip() for s in c.split(" / ")] if " / " in c else [s.strip() for s in re.split(r"\s*/\s*(?=\d)", c)]
    tagged = []
    for s in segs:
        q = re.search(r"\((UNDER|INSET|언더|인셋)\)", s, flags=re.I)
        side = {"언더": "UNDER", "인셋": "INSET"}.get(q.group(1), q.group(1).upper()) if q else ""
        tagged.append((side, re.sub(r"\([^)]*\)", "", s).strip()))
    pick = next((t for t in tagged if t[0] == "UNDER"), tagged[0])
    side, s = pick
    if "~" in s:
        return None, side, "범위 값"
    cells = [x.strip() for x in re.split(r"\s*[xX×*]\s*", s) if x.strip()]
    if len(cells) < 2 or not re.fullmatch(r"\d{2,4}", cells[0]) or not re.fullmatch(r"\d{2,4}", cells[1]):
        return None, side, "읽을 수 없음"
    w, d, r = int(cells[0]), int(cells[1]), None
    if len(cells) >= 3:
        if re.fullmatch(r"R\s*\d{1,3}", cells[2]):
            r = int(nums(cells[2])[0])
        elif "/" in cells[2] or re.match(r"R\d+/R", cells[2]):
            return None, side, "모서리 R 이 여럿 (사각이 아닌 모양)"
        else:
            return None, side, "세 번째 값이 R 이 아님"
    return (w, d, r), side, None


def site_rows(f, K_, want_brand, sample=None):
    """리젠스 사이트에서 want_brand('리젠스' · '레지녹스' · '알타이녹스') 제품만 행으로."""
    global K
    K = K_
    items = list_pages(f)
    print(f"[lizens.co.kr] product pages={len(items)}", file=sys.stderr)
    rows = []
    for kind, seq, L in items:
        url = f"{SITE}/kr/{kind}/display.do?seq={seq}"
        st, h = f.get(url)
        if st != 200:
            continue
        typ, title, spec, unnamed, img = page_spec(h)
        brand = IMPORT_TYPES.get(typ, "리젠스")
        if brand != want_brand or not title:
            continue
        s, b, c = spec.get("s"), spec.get("b"), spec.get("c")
        sn = K.split_dims(s)
        if len(sn) >= 3 and not b:      # 'ST 300~1200' · 'SG 600' — 볼 없는 작업대 · 가스대
            continue
        color = spec.get("color")
        row = K.base_row(brand=brand, category="sink", category_subtype=None, install_type=None,
                         model_name=title, model_codes=[f"{title} {color}" if color else title],
                         line=(typ if brand == "리젠스" else re.sub(r"[\s-]*\d.*$", "", title).strip() or typ),
                         source_url=url, page_url=url, image_source_url=img)
        notes = []
        kinds = [f"{MENU.get(kind, kind)} > {typ}" if typ else MENU.get(kind, kind)]
        if unnamed:
            row["tags"].append("치수순서추정")
            notes.append("규격표 칸 이름이 비어 있다 — 다른 페이지 순서(S · B · C · D)로 읽음")
        depth = bowl_depth(b)
        if len(sn) >= 2 and depth:
            d = {"w": sn[0], "d": sn[1], "h": (depth, depth)}
            raw = f"S {s} · B {b}"
        else:
            d, raw = None, f"S {s} · B {b}" if s or b else None
        K.put_dims(row, d, raw)
        bw = single_bowl(b)
        if d and bw and (bw[0] > d["w"][0] or bw[1] > d["d"][0]):
            # 외부사이즈가 볼(내부)보다 작다 — 페이지 오기 (GQE 9803 엠보 'S 840 x 515 · B 910 x 400'). SQL 에서 뺀다
            row["tags"].append("치수확인필요")
            notes.append(f"외부사이즈 {s} 가 내부사이즈 {b} 보다 작다 — 페이지 오기로 보고 뺌")
        if c:
            row["cutout_raw"] = c
            cut, side, why = cutout_of(c)
            if cut:
                row["cutout_w_mm"], row["cutout_d_mm"], row["cutout_r_mm"] = cut
            sides = sorted(set(re.findall(r"UNDER|INSET|언더|인셋", c, flags=re.I)))
            if sides:
                kinds.append("컷아웃 " + "·".join(x.upper() for x in sides))
            if side and cut and len(sides) > 1:
                notes.append(f"컷아웃 둘 중 {side} 값을 칸에 넣음")
            if why:
                notes.append(f"컷아웃 칸 비움 — {why}")
        if color:
            notes.append(f"색상 {color}")
        if spec.get("d"):
            notes.append(f"배수구 {spec['d']}")
        if spec.get("cabinet"):
            notes.append(f"캐비닛(하부장) {spec['cabinet']}")
        notes.append("높이 = 볼 깊이 (B 세 번째 값)")
        if title in CATALOG_DIFF:
            notes.append(CATALOG_DIFF[title])
            row["tags"].append("출처불일치")   # 웹 · 카탈로그 중 어느 쪽이 맞는지 모른다 — 미검증 (to_sql UNVERIFIED_TAGS)
        row["product_type_raw"] = " / ".join(kinds)
        row["install_notes"] = " · ".join(notes)
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows


def collect(f, K_, sample=None):
    return site_rows(f, K_, "리젠스", sample)
