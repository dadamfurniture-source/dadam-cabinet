"""린나이 주방가전 — ebook.rinnai.co.kr e-카탈로그의 글자 좌표 파일(coords.xml) 에서 '제품제원' 표를 읽는다. (2026-10-25)

www.rinnai.co.kr 는 회사 소개뿐이고, 공식몰 rinnaimall.com 은 robots.txt 가 모두 막는다 (User-agent: * Disallow: /).
e-카탈로그 서버(ebook.rinnai.co.kr)는 robots.txt 가 없다 (404 = 허용). 카탈로그 뷰어가 검색에 쓰는
catImage/<번호>/coords.xml 에 쪽마다 '글자:x0 y0 x1 y1' 이 들어 있다 — 원본 PDF 글자와 같다 (y 는 아래에서 위로).

  ① 표 (행) — 카탈로그 끝 '제품제원' 쪽: 모델명 · 규격 W×D×H · 상판가공치수 W×D · 매립깊이가 한 줄 (2026 종합카탈로그 70~71쪽)
  ② 표 (열) — 제품 쪽: '모델명' 줄에 모델이 열로 놓이고 아래로 구성 · 크기 · 상판가공치수 · 적용가능한 장 SIZE (2024 카탈로그)
최신 카탈로그가 우선이고, 옛 카탈로그에만 있는 모델은 그 카탈로그 값으로 넣는다 (product_type_raw 에 카탈로그 이름 · 쪽).
"""
import re
import sys

BRAND_KEY = "rinnai"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

EB = "https://ebook.rinnai.co.kr"
LIST = EB + "/include/catalistc.asp?Dir=0100000000&cimg="          # e-카탈로그 > 카탈로그
CODE = re.compile(r"^(?:R[A-Z]{0,3}|RT|IH[A-Z]*|IA)-?[A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*$|^RT-[\d/I]+$|^[A-Z]{2,5}\d{3,}[A-Z0-9]*$")   # 'PJI410AW' · 'IHFW3000N' 처럼 '-' 없는 코드도
SKIP_SECTIONS = ("가스오븐", "가스 오븐", "비움", "음식물")          # 프리스탠딩 가스오븐레인지 · 음식물처리기는 뺀다
KITCHEN = r"레인지|쿡탑|쥬벨|그릴|오븐|후드|인덕션|하이브리드|라디언트"   # 표 이름에 이 말이 없으면 주방가전이 아니다 (보일러 · 온수기)


# --------------------------------------------------------------------------- coords.xml


def pages_of(xml):
    """→ [(쪽 번호, [(x0, y0, x1, y1, 글자)])]."""
    out = []
    for m in re.finditer(r"<page>(.*?)</page>", xml, re.S):
        p = m.group(1)
        no = int(re.search(r"<no>(\d+)</no>", p).group(1))
        c = re.search(r"<!\[CDATA\[(.*?)\]\]>", p, re.S)
        words = []
        for line in (c.group(1).strip().splitlines() if c else []):
            i = line.rfind(":")
            try:
                x0, y0, x1, y1 = map(float, line[i + 1:].split())
            except ValueError:
                continue
            words.append((x0, y0, x1, y1, line[:i]))
        out.append((no, words))
    return out


def lines_of(words, tol=2.5):
    """같은 높이(y0 ±tol) 글자 → 줄. 위(큰 y)부터."""
    out = []
    for w in sorted(words, key=lambda w: (-w[1], w[0])):
        if out and abs(out[-1][0] - w[1]) <= tol:
            out[-1][1].append(w)
        else:
            out.append([w[1], [w]])
    return [(y, sorted(ws, key=lambda w: w[0])) for y, ws in out]


def joined(ws):
    return " ".join(w[4] for w in ws)


def is_title(ws):
    """행 표 위 가운데의 표 이름 ('전기레인지' · '프리미엄 쥬벨' · '레인지 후드') — 한글 1~3 낱말, 가운데 정렬."""
    return 0 < len(ws) <= 3 and all(240 < w[0] < 340 for w in ws) and re.fullmatch(r"[가-힣 ]+", joined(ws)) is not None


DIMS = re.compile(r"(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)")
CUT = re.compile(r"(?<![\d.×])(\d{3})\s*[×xX]\s*(\d{3})(?!\d)(?!\s*[×xX])")


def groups_of(rows, labels):
    """행 표 '구분' 칸 — 묶음 이름은 여러 행의 가운데에 한 번 적힌다 (전기레인지: 인덕션 8행 · 하이브리드 2행 · 라디언트 1행).
    rows [(code, y)] · labels [(이름, y)] (위부터) → {code: 이름}. 묶음마다 이어진 행이고 이름이 묶음 가운데에 가장 가깝게 나눈다."""
    import itertools
    n, k = len(rows), len(labels)
    if not k or k > n:
        return {}
    best = None
    for cuts in itertools.combinations(range(1, n), k - 1):
        b = [0, *cuts, n]
        score = 0
        for i in range(k):
            ys = [y for _, y in rows[b[i]:b[i + 1]]]
            if not min(ys) - 8 <= labels[i][1] <= max(ys) + 8:
                break
            score += abs((max(ys) + min(ys)) / 2 - labels[i][1])
        else:
            if best is None or score < best[0]:
                best = (score, b)
    if best is None:
        return {}
    b = best[1]
    return {code: labels[i][0] for i in range(k) for code, _ in rows[b[i]:b[i + 1]]}


def order_label(label):
    """'규격 W×D×H mm' · '크기 W × D × H mm' → '(W×D×H)' (K.dims_of 가 칸 순서를 읽는 꼴). 없으면 ''."""
    m = re.search(r"([WDH])\s*×\s*([WDH])\s*×\s*([WDH])", label)
    return f"({m.group(1)}×{m.group(2)}×{m.group(3)})" if m and sorted(m.groups()) == ["D", "H", "W"] else ""


def expand(code):
    """'RT-6510/6520I' → ['RT-6510', 'RT-6520I']."""
    parts = code.split("/")
    pre = parts[0].split("-")[0] + "-" if "-" in parts[0] else ""
    return [parts[0]] + [p if "-" in p else pre + p for p in parts[1:] if p]


# --------------------------------------------------------------------------- ① 행 표 ('제품제원')


def row_tables(no, words):
    """'모델명' 줄 오른쪽에 모델 코드가 없으면 행 표 — 그 아래 줄마다 '코드 … W×D×H … W×D … 매립깊이'."""
    out = {}
    ls = lines_of(words)
    heads = [(y, ws) for y, ws in ls if any(w[4] == "모델명" for w in ws)]
    for y_h, ws_h in heads:
        mx = next(w for w in ws_h if w[4] == "모델명")
        if any(CODE.match(w[4]) and w[0] > mx[0] + 20 for w in ws_h):
            continue                                                     # 열 표
        is_row = lambda ws: any(w[0] < 45 and CODE.match(w[4]) for w in ws)
        hlines = [(y, ws) for y, ws in ls if y_h - 10 <= y <= y_h + 12 and not is_row(ws)]   # 머리는 여러 줄
        band = [w for _, ws in hlines for w in ws]
        label = joined(band)
        x_cut = next((w[0] for w in band if w[4].startswith("상판가공치수")), None)
        # 매립깊이 칸 — 'H: 매립깊이'(빌트인 그릴 규격 설명)는 칸이 아니다: 상판가공치수 오른쪽에 있는 것만
        x_emb = next((w[0] for w in band if w[4].startswith("매립깊이") and x_cut and w[0] > x_cut), None)
        qual = " ".join(re.findall(r"[HD]\s*:\s*\S+(?:\s+엔드까지|\s*/\s*전체\s*높이\]?)?", label))
        top = max(y for y, _ in hlines)
        title = [l for l in ls if top < l[0] < top + 30 and is_title(l[1])]
        section = joined(title[-1][1]) if title else ""
        x_gb = next((w[0] for w in band if w[4] == "구분"), None)
        prev_y = min(y for y, _ in hlines)
        got, gb_labels = [], []
        for y, ws in ls:
            if y >= prev_y and not is_row(ws) or y >= y_h:
                continue
            if prev_y - y > 30 or any(w[4] == "모델명" for w in ws):
                break
            if x_gb:
                gb_labels += [(w[4], y) for w in ws if abs(w[0] - x_gb) < 20 and re.fullmatch(r"[가-힣]{2,6}", w[4])]
            code_w = [w for w in ws if w[0] < 45 and CODE.match(w[4])]
            if not code_w:
                if ws and not is_title(ws):
                    prev_y = y
                    continue
                break
            prev_y = y
            got.append((code_w[0][4], y))
            code = code_w[0][4]
            txt = joined([w for w in ws if w is not code_w[0]])
            dm = DIMS.search(txt)
            cut = CUT.search(txt[dm.end():]) if dm else None
            emb = next((w[4] for w in ws if x_emb and abs(w[0] - x_emb) < 20 and re.fullmatch(r"\d{2,3}", w[4])), None)
            out[code] = {"page": no, "section": section, "dims": dm.group(0) if dm else None, "label": label,
                         "order": order_label(label), "qual": qual, "cut": cut.group(0) if cut else None, "embed": emb,
                         "text": txt, "y": y, "gubun": None}
        if "전기레인지" in section:                       # 구분(인덕션 · 하이브리드 · 라디언트)이 세부 구분이 된다
            for code, gb in groups_of(got, gb_labels).items():
                out[code]["gubun"] = gb
    return out


# --------------------------------------------------------------------------- ② 열 표 (제품 쪽)


def col_tables(no, words, page_w=600):
    """'모델명' 줄에 코드가 열로 — 아래 줄의 왼쪽 글자 = 항목 이름, 오른쪽 = 열마다 값. 한 줄에 표가 둘일 수 있다 (471쪽 27)."""
    out = {}
    ls = lines_of(words)
    for y_h, ws_h in ls:
        marks = [w for w in ws_h if w[4] == "모델명"]
        for mi, mk in enumerate(marks):
            # 표 이름 = 표 위로 가장 가까운 제품군 머리 (예: '컬러레인지 PF시리즈', '오븐 · 가스오븐 전기오븐')
            heads = [joined([w for w in ws if abs(w[0] - mk[0]) < 120]) for y, ws in ls if y_h < y < y_h + 420]
            heading = next((t for t in reversed(heads) if re.search(r"레인지|쿡탑|쥬벨|그릴|오븐|후드|인덕션|하이브리드|라디언트", t)
                            and "모델명" not in t and len(t) < 40), "")
            right = marks[mi + 1][0] if mi + 1 < len(marks) else page_w + 100
            codes = [w for w in ws_h if mk[0] + 20 < w[0] < right and re.match(r"^[A-Z]", w[4])]
            if not codes or not any(CODE.match(c[4]) for c in codes):
                continue
            cols = []                                                    # 가까운 코드는 한 칸 ('RBR-PF6001D / PF6000')
            for c in codes:
                gap = c[0] - cols[-1]["x1"] if cols else 999
                if gap < 12 or (gap < 30 and "-" not in c[4]):
                    cols[-1]["codes"].append(c[4])
                    cols[-1]["x1"] = c[2]
                else:
                    cols.append({"x0": c[0], "x1": c[2], "codes": [c[4]], "vals": {}})
            for c in cols:                                               # 한 칸 둘째 코드 'PF6000' → 'RBR-PF6000' (첫 코드 앞머리)
                head = c["codes"][0]
                pre = head.split("-")[0] + "-" if "-" in head else ""
                c["codes"] = [head] + [x if "-" in x or not pre else pre + x for x in c["codes"][1:]]
            left = mk[0] - 8
            rows, last_y, cur = [], y_h, None
            for y, ws in ls:
                if y >= y_h:
                    continue
                seg = [w for w in ws if left <= w[0] < right]
                if not seg:
                    continue
                if last_y - y > 22 or any(w[4] in ("모델명",) for w in seg) or seg[0][4].startswith(("※", "*")):
                    break
                last_y = y
                lab = [w for w in seg if w[0] < cols[0]["x0"] - 6]
                val = [w for w in seg if w[0] >= cols[0]["x0"] - 6]
                if lab:
                    cur = joined(lab)
                    rows.append([cur, val, y])
                elif rows:
                    rows[-1][1] = rows[-1][1] + val
            for lab, val, y in rows:
                for i, c in enumerate(cols):
                    nxt = cols[i + 1]["x0"] - 6 if i + 1 < len(cols) else right
                    v = joined([w for w in val if c["x0"] - 6 <= w[0] < nxt])
                    if v:
                        c["vals"][lab] = (c["vals"].get(lab, "") + " " + v).strip()
            for c in cols:
                for code in c["codes"]:
                    if CODE.match(code):
                        out[code] = {"page": no, "heading": heading, "vals": c["vals"], "codes": c["codes"]}
    return out


def headings_of(no, words):
    """후드 쪽 'I 침니 후드' · 'I 슬림 후드' 머리 아래 코드 → 머리 이름."""
    out = {}
    ls = lines_of(words)
    heads = [(y, joined(ws)) for y, ws in ls if re.search(r"(침니|슬림|디럭스|빌트인|아일랜드|벽부착)\s*후드", joined(ws)) and ws[0][0] < 80]
    for y, ws in ls:
        for w in ws:
            if CODE.match(w[4]):
                above = [h for h in heads if h[0] > y]
                if above:
                    out.setdefault(w[4], min(above, key=lambda h: h[0])[1])
    return out


# --------------------------------------------------------------------------- 종류


def kind_of(code, section, burner, hood_head, gubun=None):
    """→ (category, subtype, install_type, 원문) · None 이면 뺀다 (보일러 · 온수기 표 · 가스오븐레인지 · 음식물처리기)."""
    if not re.search(KITCHEN, section) or any(x in section for x in SKIP_SECTIONS) or code.startswith("RSF"):
        return None
    if "후드" in section or code.startswith("RSH"):
        sub = ("chimney" if "침니" in hood_head else "slim" if "슬림" in hood_head else "island" if "아일랜드" in hood_head
               else "built_in" if "빌트인" in hood_head else None)
        return "hood", sub, None, hood_head.replace("I ", "").strip() or None
    if "오븐" in section and "빌트인" in section:
        return "oven", "oven", "built_in", "빌트인 가스오븐레인지 (상판 가스쿡탑 + 오븐, 카탈로그 '빌트인 오븐')"
    if "전기오븐" in section or code.startswith("RCD"):
        return "microwave", "combi", "freestanding", "전기 복합오븐 (전자레인지 겸용)"
    b = burner or ""
    ih, rd, gas = "인덕션" in b or "듀오존" in b, "라디언트" in b, "가스" in b
    if ih and gas:
        sub, raw = None, f"가스+인덕션 ({b})"
    elif ih and rd:
        sub, raw = "hybrid", None
    elif ih:
        sub, raw = "induction", None
    elif rd:
        sub, raw = "highlight", None
    elif gubun in ("인덕션", "하이브리드", "라디언트"):                 # 행 표 '구분' 묶음 이름
        sub, raw = {"인덕션": "induction", "하이브리드": "hybrid", "라디언트": "highlight"}[gubun], None
    elif re.search(r"전기레인지|인덕션|하이브리드|라디언트", section):
        sub = ("hybrid" if "하이브리드" in section else "highlight" if "라디언트" in section else "induction" if "인덕션" in section else None)
        raw = None if sub else section
    else:
        sub, raw = "gas", None
    if "그릴" in section:
        raw = "빌트인 그릴 (가스 2버너 + 그릴)"
    return "cooktop", sub, None, raw


# --------------------------------------------------------------------------- 수집


def catalogs(f):
    """e-카탈로그 목록 — 주방 · 가스쿡탑 · 레인지가 든 이름 (업소용 · 자동조리 리플릿 · 시스템 제품 제외), 번호가 큰(새) 것부터."""
    st, h = f.get(LIST)
    items = re.findall(r"link_click\('(\d+)&amp;catimage=[^']*'\);\"><img[^>]*><p><span>([^<]+)</span>", h)
    out = [(int(i), t.strip()) for i, t in items if re.search(r"주방|쿡탑", t) and "업소용" not in t]
    return sorted(out, reverse=True)


def collect(f, K_, sample=None):
    global K
    K = K_
    cats = catalogs(f)
    print(f"[rinnai] 카탈로그 {cats}", file=sys.stderr)
    models = {}                                  # 코드 → 행 재료 (앞 카탈로그 우선)
    parsed = []
    for cid, ctitle in cats:
        st, xml = f.get(f"{EB}/catImage/{cid}/coords.xml")
        if st != 200:
            print(f"[rinnai] {cid} coords.xml {st} — 건너뜀", file=sys.stderr)
            continue
        rows, cols, heads = {}, {}, {}
        for no, words in pages_of(xml):
            rows.update(row_tables(no, words))
            cols.update(col_tables(no, words))
            heads.update(headings_of(no, words))
        print(f"[rinnai] {cid} {ctitle}: 행 표 {len(rows)} · 열 표 {len(cols)}", file=sys.stderr)
        parsed.append((cid, ctitle, rows, cols, heads))
    # 구성(버너) · 적용가능한 장 은 새 카탈로그 제품 쪽에 없으면 옛 카탈로그 같은 코드에서 (RBR-IG300 '인덕션2 듀오존 가스 대1')
    any_vals = {}
    for _, _, _, cols, _ in parsed:
        for code, c in cols.items():
            for k, v in c["vals"].items():
                any_vals.setdefault(code, {}).setdefault(k, v)
    for cid, ctitle, rows, cols, heads in parsed:
        for code in list(rows) + [c for c in cols if c not in rows]:
            if code in models:
                continue
            r, c = rows.get(code), cols.get(code)
            vals = (c or {}).get("vals", {})
            dlab = next((k for k in vals if re.search(r"크기|사이즈|규격", k) and DIMS.search(vals[k])), None)
            clab = next((k for k in vals if "상판가공" in k), None)
            fit = next((vals[k] for k in vals if "적용가능한" in k), None)
            burner = next((vals[k] for k in vals if "구성" in k), None) or next((v for k, v in any_vals.get(code, {}).items() if "구성" in k), None)
            fit = fit or next((v for k, v in any_vals.get(code, {}).items() if "적용가능한" in k), None)
            if r and r["dims"]:
                dims, label, page, section, cut, emb = r["dims"], r["label"], r["page"], r["section"], r["cut"], r["embed"]
                order = r["order"]
                extra = None
            elif dlab:
                v = vals[dlab]
                m = DIMS.search(v)
                dims, label, page, section = m.group(0), dlab, c["page"], c["heading"]
                order = order_label(dlab)
                nx = re.match(r"\s*(\d+(?:\.\d+)?)(?!\s*[×xX\d])", v[m.end():])   # '595×510×35 / 54' 의 54 (그레이트까지 높이)
                extra = nx.group(1) if nx else None
                cm = CUT.search(vals.get(clab, "")) if clab else None
                cut, emb = (cm.group(0) if cm else None), None
            else:
                continue
            section = section or (c or {}).get("heading", "")
            models[code] = {"code": code, "cid": cid, "ctitle": ctitle, "page": page, "section": section, "dims": dims,
                            "label": label, "order": order, "cut": cut, "embed": emb, "fit": fit, "burner": burner,
                            "extra": extra, "hood": heads.get(code, ""), "qual": (r or {}).get("qual", ""),
                            "gubun": (r or {}).get("gubun"), "grate": "그레이트" in label + " ".join(vals) + " ".join(vals.values())}
    out, per_cat = [], {}
    for code, m in models.items():
        kind = kind_of(code, m["section"], m["burner"], m["hood"], m["gubun"])
        if kind is None:
            continue
        cat, sub, inst, raw = kind
        if sample and per_cat.get(cat, 0) >= sample:
            continue
        per_cat[cat] = per_cat.get(cat, 0) + 1
        url = f"{EB}/ecatalog5.asp?Dir={m['cid']}&start={m['page']}"
        name = " ".join(x for x in [m["section"].replace("I ", "").strip(), m["hood"].replace("I ", "").strip()] if x) or "린나이"
        row = K.base_row(brand="린나이", category=cat, category_subtype=sub, install_type=inst, model_name=f"{name} {code}",
                         model_codes=expand(code), line="린나이", source_url=f"{EB}/catImage/{m['cid']}/coords.xml#page={m['page']}",
                         page_url=url, image_source_url=None,
                         product_type_raw=" / ".join(x for x in [raw, f"카탈로그 {m['ctitle']} {m['page']}쪽"] if x))
        dims = m["dims"]
        notes = []
        if m["extra"] and re.fullmatch(r"\d+(?:\.\d+)?", m["extra"]) and m["grate"]:
            # 2024 카탈로그 '595×510×35 / 54 (H:그레이트까지)' — 뒤 값이 그레이트까지 높이 (2026 표는 같은 모델을 54 로 적는다)
            a, b_, h = DIMS.search(dims).groups()
            notes.append(f"높이 원문 '{dims} / {m['extra']}' — 몸체 {h} · 그레이트까지 {m['extra']}, 그레이트까지 값을 넣음")
            dims = f"{a}×{b_}×{m['extra']}"
        d, _ = K.dims_of(m["order"] or "(W×D×H)", dims, "wdh")
        if not m["order"]:
            row["tags"].append("치수순서추정")
        K.put_dims(row, d, f"{dims} ({(m['order'] or '(W×D×H)').strip('()')}{' · ' + m['qual'] if m['qual'] else ''})")
        row["tags"].append("매뉴얼")
        if m["cut"] and cat in ("cooktop", "oven"):
            cw, cd = map(int, re.findall(r"\d+", m["cut"])[:2])
            row["cutout_w_mm"], row["cutout_d_mm"], row["cutout_raw"] = cw, cd, f"상판가공치수 {m['cut']}"
            if cat == "cooktop":
                row["install_type"] = "built_in"
        elif cat == "cooktop":
            row["install_type"] = "freestanding"     # 타공이 없는 쿡탑 = 테이블형 가스레인지 · 포터블 인덕션
        if m["embed"]:
            notes.append(f"매립깊이 {m['embed']}mm")
        if m["qual"]:
            notes.append(f"표 머리 '{m['qual']}'")
        if m["fit"]:
            notes.append(f"적용가능한 장 SIZE {m['fit']}mm")
        row["install_notes"] = " · ".join(notes) or None
        out.append(row)
    return out
