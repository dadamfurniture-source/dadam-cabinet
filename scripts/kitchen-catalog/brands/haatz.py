"""하츠 후드 · 쿡탑 — haatz.com 제품 목록(board_ajax) + 공식 카타로그 PDF(/upload/catalog/) 의 W · D · H · 상판 따내기. (2026-10-25)

제품 상세 페이지의 사양은 /cheditor/ 그림에만 있고, 설명서 받기는 /lib/ 라 robots.txt 가 둘 다 막는다 (Disallow).
카타로그 PDF 는 /upload/catalog/ (허용) — 고객지원 > E-카탈로그 의 '미리보기' 링크 그대로다.
PDF 글자 위치는 PyMuPDF 로 읽는다. collect.py 는 python -I 로 돌아 사용자 site-packages(fitz)를 못 읽으므로
같은 파이썬을 -E -P 로 따로 띄워 줄 단위 글자 · 글자 크기 · 좌표만 뽑아 cache/ 에 둔다 (--offline 재실행 가능).
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

BRAND_KEY = "haatz"
K = None   # collect.py 가 넘긴다 (split_dims · dims_of · base_row · put_dims · F …)

HZ = "https://www.haatz.com"
AJAX = HZ + "/INC/board_ajax.php"           # robots.txt 가 /INC/ 중 이 파일만 Allow
# 목록 묶음: 탭(depth2) 후드 52 · 쿡탑 56 + 필터 후드 263 · 쿡탑 197 (부띠끄 탭 제품은 필터에만) + 아일랜드형 219
#   필터 표시가 빠진 제품이 많아(쿡탑 필터 8개 · 탭 16개) 둘을 합친다. 부띠끄 탭(depth2 51)은 응답이 55MB 라 쓰지 않는다
LISTS = [("depth2", "52", "hood"), ("depth2", "56", "cooktop"), ("fil", "263", "hood"), ("fil", "197", "cooktop"), ("fil", "219", "island")]
CAT_TITLE = re.compile(r"(20\d\d)\s*년?\s*(유통 소매점|하츠)\s*카타로그")
CATALOGS = 2   # 최신 카타로그 몇 권 (2026 유통 소매점 · 2025 하츠). 앞 권이 우선

# PDF 한 권 → 쪽마다 줄 [x0, y0, x1, y1, 글자크기, 글자]. 같은 파이썬을 -E -P 로 (fitz 는 사용자 site-packages)
FITZ = r"""
import sys, json, fitz
d = fitz.open(sys.argv[1]); out = []
for p in d:
    ls = []
    for b in p.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if t:
                x0, y0, x1, y1 = l["bbox"]
                ls.append([round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1), round(max(s["size"] for s in l["spans"]), 1), t])
    out.append({"w": round(p.rect.width, 1), "h": round(p.rect.height, 1), "lines": ls})
open(sys.argv[2], "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
"""


def pdf_lines(f, url):
    """공식 PDF → 쪽 목록. Fetcher 와 같은 규칙 (robots.txt · 1.2초 간격 · 같은 UA), 결과는 cache/ 에 글자만."""
    cp = f._cache_path("PDFLINES", url, None)
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
        with urllib.request.urlopen(req, timeout=120) as r:
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
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            if os.path.exists(out):
                with open(out, encoding="utf-8") as fp:
                    pages = json.load(fp)
            else:   # fitz 가 없거나 실패 — 캐시에 남기지 않는다 (설치 뒤 다시 돌리면 읽는다)
                print("[haatz] PyMuPDF(fitz) 로 PDF 를 읽지 못했다 — 치수 없이 진행 (pip install --user pymupdf)", file=sys.stderr)
                return []
    elif status == 200:
        status = 415
    print(f"  [net {status}] PDF {url[:110]} ({len(raw)} B, {len(pages)} 쪽)", file=sys.stderr)
    with open(cp, "w", encoding="utf-8") as fp:
        json.dump({"url": url, "method": "PDFLINES", "status": status, "bytes": len(raw),
                   "fetched_at": dt.datetime.now().isoformat(timespec="seconds"),
                   "body": json.dumps(pages, ensure_ascii=False)}, fp, ensure_ascii=False)
    return pages


# --------------------------------------------------------------------------- 모델 코드


def norm(c):
    return re.sub(r"\s+", " ", (c or "").replace("Ⅱ", "II")).strip().upper()


def expand(line):
    """'IH-3606TTLW / P / M' · 'RNH-90C,R,L' · 'BAR-90 (GR/PK/MT) CI' · 'NBH-200 / 280' · 'SHIRE 600 / 900' → 코드 목록."""
    s = norm(line).lstrip("*")
    s = re.sub(r"\s*\([^)]*[+ ][^)]*\)", "", s)                     # 'IH-366DTL (2 IH + 1 HL)' 설명 괄호는 뗀다
    s = re.sub(r"(?<=[A-Z0-9])\s+\((?=[A-Z0-9]+\)$)", "(", s)          # 'ISH-46S (T1)' = 'ISH-46S(T1)'
    m = re.match(r"^(\S+?)\s*\(([A-Z ]+/[A-Z/ ]+)\)\s*(\S*)$", s)  # 괄호 안 색상 묶음 ('(P)' 한 글자는 코드 그대로)
    if m:
        return [m.group(1) + p.strip() + m.group(3) for p in m.group(2).split("/") if p.strip()]
    parts = [p.strip() for p in re.split(r"\s*[/,]\s*", s) if p.strip()]
    if not parts:
        return []
    base, out = parts[0], [parts[0]]
    for p in parts[1:]:
        if "-" in p and p[0] == base[0] and re.match(r"^[A-Z]+\d*-", p):           # 'HGR-2040SAS-02' · 'G70-BL' 온전한 코드
            out.append(p)
        elif "-" in p and re.match(r"^(.*\d)([A-Z]+(?:-\d+)?)$", base):         # 'EDRH-02' → 'GC-3606' + 'EDRH-02'
            out.append(re.match(r"^(.*\d)([A-Z]+(?:-\d+)?)$", base).group(1) + p)
        elif p.isdigit():                                                       # 'NBH-200 / 280' · 'SHIRE 600 / 900'
            out.append(re.sub(r"\d+(?=\D*$)", p, base, count=1) if re.search(r"\d+$", base) else base + p)
        elif len(p) == 1:                                                       # 'IH-3606TTLW / P / M'
            out.append(base[:-1] + p)
        else:                                                                   # 'CBST-90WHCI / SCI' · 'GC-3605SDSH/SASH'
            out.append(re.sub(r"[A-Z]+$", p, base) if re.search(r"\d-?[A-Z]+$", base) else p)
    return list(dict.fromkeys(out))


def key_of(c):
    """사이트 코드와 견줄 때 — 공백 · '-' · 끝 괄호를 뗀다 ('G60BL' = 'G60-BL', 'SIH-30S(T1)' → 'SIH30S')."""
    return re.sub(r"[\s-]", "", re.sub(r"\s*\([^)]*\)$", "", c))


def related(a, b):
    """같은 제품의 코드인가 — 같거나, 숫자가 든 코드끼리 한쪽이 다른 쪽 앞부분 ('B60' ↔ 'B60-AL', 'ALIAS 603' ↔ 'ALIAS 603 BM')."""
    a, b = key_of(a), key_of(b)
    if a == b:
        return True
    return bool(re.search(r"\d", a) and re.search(r"\d", b) and min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a)))


def width_class(c):
    """'G70-BL' → 7, 'NCH-90S' → 9, 'KCH-60BL' → 6 (모르면 None) — 카타로그 W 와 크기 번호가 다른 코드를 가려낸다."""
    m = re.match(r"^[A-Z]{1,4}-?(60|70|80|90)(?!\d)", c)
    return int(m.group(1)) // 10 if m else None


CODE_RX = re.compile(r"^\*?[A-Z][A-Z0-9]{0,6}(?:-[A-Z0-9]+)+(?:\s*\([A-Z0-9]+\))?$|^[A-Z]{2,}(?: [A-Z0-9Ⅱ]+)*(?: ?\d{3}(?: ?/ ?\d{3})?)?$|^[A-Z]\d{2}[A-Z]*$")


# --------------------------------------------------------------------------- 카타로그 쪽 → 제품 묶음


def halves(page):
    """펼침면(가로 1190pt) → 왼쪽 · 오른쪽 쪽. 오른쪽 끝 색인 탭(연동 시스템 · 후드 …)은 뺀다."""
    w = page["w"]
    ls = [l[:5] + [re.sub(r"[\x00-\x1f]", " ", l[5]).strip()] for l in page["lines"] if l[0] < w - 40]   # 'D \x07310(560mm)'
    if w < 900:
        return [ls]
    half = w / 2
    return [[l for l in ls if l[0] < half], [[l[0] - half, l[1], l[2] - half, l[3], l[4], l[5]] for l in ls if l[0] >= half]]


def blocks_of(ls):
    """제목(글자 17pt 이상) 아래 같은 칸 9.5pt 줄 = 모델 코드. 제목이 코드인 곳(B60-AL · I60WHT · ILLUSION)도 있다."""
    out = []
    for t in sorted((l for l in ls if l[4] >= 17 and len(re.findall(r"[가-힣A-Za-z0-9]", l[5])) >= 2), key=lambda l: l[1]):
        mid = lambda l: (l[0] + l[2]) / 2            # 신상품 쪽은 제목 · 코드가 가운데 정렬 (빌트인 전기오븐 EV-B3402B)
        under = sorted((l for l in ls if 5 < l[1] - t[1] < 45 and (abs(l[0] - t[0]) < 4 or abs(mid(l) - mid(t)) < 30)
                        and 8 <= l[4] <= 12), key=lambda l: l[1])
        code = under[0][5] if under and CODE_RX.match(norm(re.split(r"\s*[/(,]", under[0][5].lstrip("*"))[0])) else None
        if code is None and CODE_RX.match(norm(t[5])):
            code = t[5]
        out.append({"x": t[0], "y": t[1], "title": t[5], "code": code})
    return out


def wdh_of(ls):
    """'W 898mm' 아래 같은 칸의 'D …' · 'H …' (사이에 도면이 끼면 멀다). 둥근 후드는 '∅ 505mm' + 'H …'."""
    out = []
    for l in ls:
        t = l[5].replace("\t", " ")
        m = re.match(r"^(W|∅|Ø|φ)\s*([\d().,~ ]+?)\s*mm$", t)
        if m:
            below = sorted((x for x in ls if 0 < x[1] - l[1] < 90 and abs(x[0] - l[0]) < 3), key=lambda x: x[1])
            d = next((x[5].replace("\t", " ") for x in below if re.match(r"^D\s*\d", x[5])), None)
            h = next((x[5].replace("\t", " ") for x in below if re.match(r"^H\s*\d", x[5])), None)
            if m.group(1) != "W":
                d = d or f"D {m.group(2)}mm"
            out.append({"x": l[0], "y": l[1], "w": f"W {m.group(2)}mm", "d": d, "h": h, "round": m.group(1) != "W"})
            continue
        m = re.match(r"^W\s*(\d+)\s*[X×]?\s*D\s*(\d+)\s*[X×]?\s*H\s*(\d+)\s*mm$", t.replace(" ", ""), flags=re.I)
        if m and not any(abs(o["y"] - l[1]) < 40 and abs(o["x"] - l[0]) < 200 for o in out):
            out.append({"x": l[0], "y": l[1], "w": f"W {m.group(1)}mm", "d": f"D {m.group(2)}mm", "h": f"H {m.group(3)}mm", "round": False})
    return out


def catalog_entries(pages, cat_title, cat_url):
    """쪽 → 제품 항목 (제목 · 코드 · 치수 원문 · 타공 · 매입깊이 · 높이 조절 · 같은 칸의 색상 코드)."""
    ents = []
    for pi, page in enumerate(pages):
        for ls in halves(page):
            bl = blocks_of(ls)
            for dm in wdh_of(ls):
                cand = [b for b in bl if b["y"] < dm["y"] and b["x"] <= dm["x"] + 5]
                if not cand:
                    continue
                b = max(cand, key=lambda b: b["y"])
                nxt = min([o["y"] for o in bl if o["y"] > b["y"]] + [page["h"]])
                region = [l for l in ls if b["y"] <= l[1] < nxt]
                txt = " ".join(l[5] for l in region)
                e = {"title": b["title"], "code": b["code"], "dims": dm, "page": pi + 1, "catalog": cat_title, "url": cat_url,
                     "text": txt, "variants": [], "cutout": None, "embed": None, "radius": None, "range": None, "alt_w": {},
                     "stars": [l[5] for l in region if l[5].startswith("*") and re.search(r"\d+\s*mm", l[5]) and "모델 사이즈" not in l[5]],
                     "region": region}
                for l in sorted(region, key=lambda l: l[1]):
                    t = l[5].replace("\t", " ")
                    if "따내기" in t:
                        m = re.search(r"W\s*(\d+)\s*[×xX]\s*D\s*(\d+)", t + " " + " ".join(x[5] for x in region if 0 < x[1] - l[1] < 15 and abs(x[0] - l[0]) < 3))
                        if m:
                            e["cutout"] = (int(m.group(1)), int(m.group(2)), m.group(0))
                    if t.startswith("매입깊이"):
                        nx = [x[5] for x in region if 0 < x[1] - l[1] < 15 and abs(x[0] - l[0]) < 3]
                        e["embed"] = (t + " " + (nx[0] if nx else "")).strip()
                    if re.fullmatch(r"R\d+(?:~\d+)?", t) and e["radius"] is None:
                        e["radius"] = t
                    if re.search(r"(?i)min\.?\s*\d+\s*[~-]\s*max\.?\s*\d+", t) and e["range"] is None:
                        e["range"] = t
                    m = re.match(r"^모델 사이즈 W\s*(\d+)\s*mm", t)        # '*NBH-280' 다음 줄 '모델 사이즈 W798mm'
                    if m:
                        star = [x[5] for x in region if 0 < l[1] - x[1] < 15 and x[5].startswith("*")]
                        if star:
                            e["alt_w"][norm(star[0]).lstrip("*")] = int(m.group(1))
                    if l[4] < 9 and CODE_RX.match(norm(t)) and b["code"] and norm(t)[:3] == norm(b["code"])[:3] and not t.startswith("*"):
                        e["variants"] += expand(t)
                ents.append(e)
    return ents


# --------------------------------------------------------------------------- 공식 사이트 목록


def site_products(f):
    """후드 · 쿡탑 목록 (탭 + 필터 합집합) + 아일랜드형 필터 표시."""
    prods, kinds = {}, {}
    for key, val, k in LISTS:
        form = {"view_type": "list", "notice_name": "product", "pagesize": 300, "page": 1, "lantype": 1, "depth1": 43,
                "depth2": "", "fil": "", "keyword": ""}
        form[key] = val
        st, t = f.post_form(AJAX, form)
        j = json.loads(t) if st == 200 else {}
        rows = j.get("msg") if isinstance(j.get("msg"), list) else []
        print(f"[haatz] {key}={val} ({k}): {len(rows)}", file=sys.stderr)
        for s in rows:
            kinds.setdefault(s["uid"], set()).add(k)
            if k != "island":
                prods[s["uid"]] = {"uid": s["uid"], "title": K.F.html.unescape(s.get("title") or "").strip(),
                                   "codes": expand(s.get("field_etc_02") or ""), "code_raw": (s.get("field_etc_02") or "").strip(),
                                   "img": K.F.abs_url(s.get("img_view"), HZ), "url": f"{HZ}/kor/product/kitchen_list?bmain=view&uid={s['uid']}"}
    for uid, p in prods.items():
        p["kinds"] = kinds.get(uid, set())
    return list(prods.values())


def catalogs(f):
    """고객지원 > E-카탈로그 — 제목이 'YYYY년 하츠 카타로그' · 'YYYY년 유통 소매점 카타로그' 인 PDF, 최신순."""
    out = []
    for pg in (1, 2, 3):
        st, h = f.get(f"{HZ}/kor/support/catalog.html?page={pg}")
        if st != 200:
            break
        got = re.findall(r'<p class="text">([^<]{0,80})</p>\s*<div class="btn-bx">\s*<a href="(/upload/catalog/[^"]+\.pdf)"', h)
        if not got:
            break
        for title, href in got:
            m = CAT_TITLE.search(re.sub(r"\s+", " ", title))
            if m:
                out.append((int(m.group(1)), m.group(2) == "유통 소매점", re.sub(r"\s+", " ", title).strip(), HZ + href))
    out.sort(key=lambda x: (-x[0], not x[1]))
    return [(t, u) for _, _, t, u in out[:CATALOGS]]


# --------------------------------------------------------------------------- 행


def kind_of(e):
    """→ (category, subtype, install_type, 원문). 사양에 '풍량(CMH)' 이 있으면 후드, 상판 따내기 · 인덕션 · 가스 n구 는 쿡탑."""
    t, title = e["text"], e["title"]
    if "오븐" in title:                               # 2026 신상품 '빌트인 전기오븐' — 전자레인지 · 그릴 · 콤비 겸용
        return "oven", ("combi" if "전자레인지" in t else "oven"), ("built_in" if "빌트인" in title else None), title
    if "일체형" in t and "인덕션" in t:
        return "cooktop", "induction", "built_in", "후드-인덕션 일체형"
    if e["cutout"] or re.search(r"인덕션|하이라이트|가스 ?\d구|쿡탑|레인지 ?\d구", title):
        gas, hl = "가스" in title or "버너" in t, "하이라이트" in title or "라디언트" in t
        ih = "인덕션" in title or re.search(r"\bIH\b", title) or ("인덕션" in t and not hl and not gas)
        if "하이브리드" in title and gas:
            sub, raw = None, "가스+전기 하이브리드"
        elif ("하이브리드" in title or (ih and hl)) and not gas:
            sub, raw = "hybrid", None
        elif ih:
            sub, raw = "induction", None
        elif hl:
            sub, raw = "highlight", None
        elif gas:
            sub, raw = "gas", None
        else:
            sub, raw = None, None
        inst = "freestanding" if "프리스탠딩" in title else ("built_in" if e["cutout"] else None)
        return "cooktop", sub, inst, raw
    if "풍량" in t:
        sub = ("island" if "아일랜드" in title + t[:200] or "ISLAND" in norm(e["code"]) else "chimney" if "침니" in title
               else "slim" if "슬림" in title else "built_in" if "빌트인" in title else None)
        return "hood", sub, ("built_in" if sub == "built_in" else None), None
    return None, None, None, None


def size_of(w):
    """'W 535(735)mm' → (535, 735)."""
    m = re.match(r"W\s*(\d+)(?:\((\d+)\))?", w)
    return (int(m.group(1)), int(m.group(2)) if m.group(2) else None) if m else (None, None)


def groups_of(e):
    """카타로그 항목 → [(코드들, 가로, 깊이 원문)] · 뺀 코드 메모. W 괄호 값 · '모델 사이즈 W798' · 'Left, Right 482' 는 코드를 나눠 따로."""
    codes = expand(e["code"] or "")
    codes += [c for c in e["variants"] if c not in codes]
    dm = e["dims"]
    w_main, w_alt = size_of(dm["w"])
    d_main = re.sub(r"\(Left.*", "", dm["d"] or "").strip()
    e["dropped"] = []
    if any("타입" in s for s in e["stars"]):              # '*무도어 타입: 284mm' — 괄호 붙은 형 코드(HDH-90S(T1NB))는 치수가 다르다
        e["dropped"] += [c for c in codes if "(" in c]
        codes = [c for c in codes if "(" not in c]
    if w_main and not w_alt and not e["alt_w"]:          # 'G60-AL / BL / G70-BL' + 'W 598mm' — G70 의 가로는 적혀 있지 않다
        cls = round(w_main / 100)
        off = [c for c in codes if width_class(c) and width_class(c) != cls]
        if off and len(off) < len(codes):
            e["dropped"] += off
            codes = [c for c in codes if c not in off]
    groups = [(codes, w_main, d_main)]
    sizes = [int(x) for x in re.findall(r"(?<!\d)(\d{3})(?!\d)", norm(e["code"] or "")) if x in ("600", "700", "800", "900")]
    if w_alt and len(sizes) >= 2:                          # 'SHIRE 600/900' + 'W 898(598)' — 가까운 크기 번호로 나눈다
        near = lambda w: min(sizes, key=lambda s: abs(s - w))
        groups = [([c for c in codes if str(near(w)) in c], w, d_main) for w in (w_main, w_alt)]
    for c, w in e["alt_w"].items():                        # '*NBH-280 · 모델 사이즈 W798mm'
        groups = [([x for x in g if x != c], gw, gd) for g, gw, gd in groups] + [([c], w, d_main)]
    lr = re.search(r"Left,\s*Right\s*(\d+)\s*mm", dm["d"] or "")
    if lr:                                                 # 로빈 'D 500mm (Left, Right 482mm)' — 가운데형 C 와 좌 · 우형 L · R
        side = [c for c in codes if re.search(r"\d(?:L|R)(?:CI)?$", c)]
        groups = [([c for c in g if c not in side], gw, gd) for g, gw, gd in groups] + [(side, w_main, f"D {lr.group(1)}mm")]
    return [g for g in groups if g[0]]


def make_row(e, gcodes, w, d_txt, site, others=()):
    """others = 같은 항목의 다른 묶음 코드 (로빈 L · R 등) — 사이트 코드가 그쪽 것이면 이 행에 넣지 않는다."""
    cat, sub, inst, raw = kind_of(e)
    dm = e["dims"]
    raw_txt = " ".join(x for x in [dm["w"], dm["d"], dm["h"]] if x)
    dmm = re.search(r"(\d+)", re.sub(r"\(\d+\s*(?:mm)?\)", "", d_txt))   # 'D 300(480)mm' — 괄호 = 인출 · 확장 시
    hm = re.search(r"H\s*(\d+)(?:\s*[~,]\s*(\d+))?", (dm["h"] or "").replace(",", ",").replace(" ", ""))
    val = f"{w} x {dmm.group(1) if dmm else ''} x {(hm.group(1) + ('~' + hm.group(2) if hm.group(2) else '')) if hm else ''}"
    d, _ = K.dims_of("(W x D x H)", val, "wdh") if w and dmm and hm else (None, None)
    skip = set(others) | set(e.get("dropped") or [])
    mc = list(gcodes) + [c for p in site for c in p["codes"] if c not in gcodes and not any(related(c, o) for o in skip)]
    sp = site[0] if site else None
    if sp and "island" in sp["kinds"] and cat == "hood":
        sub = "island"
    elica = not re.search(r"\d", "".join(gcodes).replace("600", "").replace("800", "").replace("900", ""))
    row = K.base_row(brand="하츠", category=cat, category_subtype=sub, install_type=inst, model_name=e["title"],
                     model_codes=mc, line="엘리카" if elica else "하츠",
                     source_url=f"{e['url']}#page={e['page']}", page_url=sp["url"] if sp else f"{e['url']}#page={e['page']}",
                     image_source_url=sp["img"] if sp else None,
                     product_type_raw=" / ".join(x for x in [raw, f"카타로그 {e['catalog']} {e['page']}쪽"] if x))
    K.put_dims(row, d, raw_txt + (" · 둥근 후드(∅ = 가로 · 깊이)" if dm["round"] else ""))
    row["tags"].append("매뉴얼")
    notes = []
    m = re.search(r"D\s*\d+\((\d+)\s*(?:mm)?\)", dm["d"] or "")
    if m:
        notes.append(f"깊이 괄호 값 {m.group(1)}mm (인출 · 확장 시, 원문 '{dm['d']}')")
    if hm and hm.group(2) and "," in (dm["h"] or ""):
        notes.append(f"높이 두 가지 {dm['h']} (형별, 낮은 값을 넣음)")
    notes += [s.lstrip("*").strip() + (f" ({', '.join(e['dropped'])})" if e.get("dropped") and "타입" in s else "") for s in e["stars"]]
    if e.get("dropped") and not any("타입" in s for s in e["stars"]):
        notes.append(f"{', '.join(e['dropped'])} 는 가로가 적혀 있지 않아 이 행에서 뺐다")
    if e["range"]:
        notes.append(f"도면 표기 '{e['range']}'")
    if e["embed"]:
        notes.append(e["embed"])
    if e["cutout"] and cat == "cooktop":
        row["cutout_w_mm"], row["cutout_d_mm"] = e["cutout"][0], e["cutout"][1]
        row["cutout_raw"] = f"상판 따내기 사이즈 {e['cutout'][2]}" + (f" · 모서리 {e['radius']} (도면)" if e["radius"] else "")
        if e["radius"] and re.fullmatch(r"R\d+", e["radius"]):
            row["cutout_r_mm"] = int(e["radius"][1:])
    if "일체형" in e["text"] and cat == "cooktop":
        row["tags"].append("후드일체형")
    row["install_notes"] = " · ".join(notes) or None
    if cat == "oven":
        oven_extras(row, e)
    return row


def oven_extras(row, e):
    """빌트인 오븐 — 설치 여유 글 ('오븐 위로 5cm, 뒤로 10cm, 양 옆으로 5cm') 과 도면의 설치 공간 ('560 +8' · '380 +2' · 'min. 500').
    도면 숫자는 PDF 글자이지만 어느 칸인지는 크기로 고른다 (제품 가로에 가까운 값 = 공간 가로, 높이에 가까운 값 = 공간 높이)."""
    t = re.sub(r"\s+", " ", e["text"])
    for key, pat in (("top_gap_mm", r"위로\s*(\d+)\s*cm"), ("back_gap_mm", r"뒤로\s*(\d+)\s*cm"), ("side_gap_mm", r"옆으로\s*(\d+)\s*cm")):
        m = re.search(pat, t)
        if m:
            row[key] = int(m.group(1)) * 10
    note = re.search(r"※\s*공기 배출을 위해[^※]*?필요합니다\.?", t)
    if note:
        row["install_notes"] = "; ".join(x for x in [row["install_notes"], note.group(0)] if x)
    small = [l for l in e["region"] if l[4] < 4]
    pairs = []
    for l in small:
        if re.fullmatch(r"\d{3}", l[5]):
            plus = [x for x in small if re.fullmatch(r"\+\d+", x[5]) and abs(x[0] - l[0]) < 8 and abs(x[1] - l[1]) < 4]
            if plus:
                pairs.append((int(l[5]), int(plus[0][5][1:])))
    deep = next((int(m.group(1)) for l in small for m in [re.fullmatch(r"min\.?\s*(\d{3})", l[5])] if m), None)
    if pairs and row["width_mm"] and row["height_mm"]:
        w = min(pairs, key=lambda p: abs(p[0] - row["width_mm"]))
        h = min(pairs, key=lambda p: abs(p[0] - row["height_mm"]))
        if w != h:
            row["niche_min_w_mm"], row["niche_max_w_mm"] = w[0], w[0] + w[1]
            row["niche_min_h_mm"], row["niche_max_h_mm"] = h[0], h[0] + h[1]
            row["niche_min_d_mm"] = deep
            row["niche_raw"] = f"도면 설치 공간: 가로 {w[0]} +{w[1]} · 높이 {h[0]} +{h[1]}" + (f" · 깊이 min. {deep}" if deep else "")


def title_key(t):
    return re.sub(r"\(.*?\)|\s+", "", t or "")


def same_product(old, new, old_cat, new_cat):
    """같은 권 안에서는 코드가 겹칠 때만. 옛 권은 이름이 같고 코드가 이어지면 같은 제품 (2025 'B60' ↔ 2026 'B60-AL')."""
    if set(old["model_codes"]) & set(new["model_codes"]):
        return True
    if old_cat == new_cat or title_key(old["model_name"]) != title_key(new["model_name"]):
        return False
    return any(related(a, b) for a in old["model_codes"] for b in new["model_codes"])


def collect(f, K_, sample=None):
    global K
    K = K_
    sites = site_products(f)
    cats = catalogs(f)
    print(f"[haatz] 제품 {len(sites)} · 카타로그 {[t for t, _ in cats]}", file=sys.stderr)
    groups = []   # [entry, codes, w, d_txt, sites] — 앞 권(최신) 먼저
    for title, url in cats:
        pages = pdf_lines(f, url)
        ents = catalog_entries(pages, title, url)
        print(f"[haatz] {title}: 쪽 {len(pages)} · 치수 묶음 {len(ents)}", file=sys.stderr)
        for e in ents:
            if kind_of(e)[0] is None or "출시 예정" in e["text"]:
                continue
            gs = groups_of(e)
            for codes, w, d_txt in gs:
                others = [c for g in gs if g[0] is not codes for c in g[0]]
                groups.append([e, codes, w, d_txt, [], others])
    # 사이트 제품 ↔ 카타로그: 코드가 같거나 이어지면 (key_of · related) 그 묶음 (최신 권 먼저).
    #   아니면 이름이 같은 묶음들이 모두 한 제품(코드가 이어짐)일 때만 — '침니' KCH-90S 를 KCH-60S 에 붙이지 않는다
    for p in sites:
        hit = next((g for g in groups if any(related(a, b) for a in p["codes"] for b in g[1])), None)
        if hit is None:
            same = [g for g in groups if title_key(g[0]["title"]) == title_key(p["title"])]
            if same and all(any(related(a, b) for a in same[0][1] for b in g[1]) for g in same):
                hit = same[0]
        if hit:
            hit[4].append(p)
            p["_matched"] = True
    rows, cat_of, per_cat = [], {}, {}
    for e, codes, w, d_txt, site, others in groups:
        r = make_row(e, codes, w, d_txt, site, others)
        old = next((o for o in rows if same_product(o, r, cat_of[id(o)], e["catalog"])), None)
        if old:   # 앞 권(최신)이 우선 — 값이 다르면 비고에 남기고, 앞 권에 치수가 없으면 옛 권 값으로 채운다
            if old["width_mm"] is None and r["width_mm"] is not None:
                for k in ("width_mm", "depth_mm", "height_mm", "size_raw", "tags", "source_url", "product_type_raw"):
                    old[k] = r[k]
            elif (old["width_mm"], old["depth_mm"], old["height_mm"]) != (r["width_mm"], r["depth_mm"], r["height_mm"]):
                old["install_notes"] = "; ".join(x for x in [old["install_notes"], f"{e['catalog']} 값 {r['size_raw']}"] if x)
            old["model_codes"] += [c for c in r["model_codes"] if c not in old["model_codes"]]
            if not old["image_source_url"] and r["image_source_url"]:
                old["image_source_url"], old["page_url"] = r["image_source_url"], r["page_url"]
            continue
        if sample and per_cat.get(r["category"], 0) >= sample:
            continue
        per_cat[r["category"]] = per_cat.get(r["category"], 0) + 1
        cat_of[id(r)] = e["catalog"]
        rows.append(r)
    # 사이트 '아일랜드형' 필터 제품과 코드가 이어지는 후드 (SIH-30S(T2) ↔ 사이트 SIH-30S) 도 아일랜드
    island = [c for p in sites if "island" in p["kinds"] for c in p["codes"]]
    for r in rows:
        if r["category"] == "hood" and r["category_subtype"] is None and any(related(a, b) for a in r["model_codes"] for b in island):
            r["category_subtype"] = "island"
    # 사이트에는 있는데 카타로그에서 치수를 못 찾은 제품 — 행은 남기되 치수 없음 (SQL 에서 빠진다)
    if not sample:
        for p in sites:
            if p.get("_matched"):
                continue
            cat = "cooktop" if "cooktop" in p["kinds"] else "hood"
            row = K.base_row(brand="하츠", category=cat, category_subtype="island" if "island" in p["kinds"] else None,
                             install_type=None, model_name=p["title"], model_codes=p["codes"], line="하츠", source_url=p["url"],
                             page_url=p["url"], image_source_url=p["img"], product_type_raw="카타로그에서 치수를 찾지 못함")
            K.put_dims(row, None, None)
            rows.append(row)
    return rows
