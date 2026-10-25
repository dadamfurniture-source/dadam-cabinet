"""대림바스 주방 수전 — daelimbath.com 제품 목록 API + 제품마다 공식 '시공도면' PDF (2026-10-25).

  목록   POST /product/getProductList {page, order_by:'', cate, bigcate} — 사이트 제품 목록 화면이 부르는 것과 같은 요청
         수전금구 > 주방수전 (bigcate 95 · cate 132) · BLACK > 주방수전 (bigcate 186 · cate 194, RADICE)
         robots.txt 없음 (404). 칸: pro_nm · pro_no(품번) · pro_spec(1홀 주방 수전 · 벽붙이 …) · pro_key(시리즈) · const_down(시공도면)
  사진   /upload/product/<img_down> (제품 페이지 큰 사진과 같은 파일)
  도면   /upload/product/<const_down> — 'DL K8015-CR1' 같은 CAD 도면 PDF. 치수 숫자가 PDF 글자 층에 있다
         ('설치구멍 Ø38' · '시공홀 Ø35' · '설치구멍 Ø42~Ø43' · 'MinØ38 MaxØ40' · 높이 · 토수 길이).

도면 숫자가 어느 치수인지(높이 · 토수구 높이 · 토수 길이 · 호스)는 그림을 보고 정했다 → DRAWINGS (2026-10-25, 32장 전부 글자 층
숫자와 대조 — brands/daelim_faucet.md). 숫자 자체는 PDF 글자라 '매뉴얼' 태그 (검증으로 친다).
앞모습 폭(본체 · 바닥 지름)은 도면 6장에만 있다 (Ø53 · Ø52.5 · Ø52 · Ø54 · 정면 폭 51). 나머지는 K.put_dims(None) —
'치수확인필요' 로 SQL 에서 빠지고 높이 · 토수는 size_raw 에만 남는다. 수전 구멍(faucet_hole_mm)은 폭과 관계없이 넣는다.
벽붙이(벽부형) 3종은 상판 수전 구멍이 없다 — faucet_hole_mm 비움, 배관 간격은 install_notes.

이 파일은 PDF 를 내려받지 않는다 (HTML · JSON 만 Fetcher). PDF 는 2026-10-25 에 robots.txt 확인 뒤 한 장씩 받아 읽었다.
"""
import json
import re
import sys
import urllib.parse

BRAND_KEY = "daelim_faucet"
K = None   # collect.py 가 넘긴다

SITE = "https://www.daelimbath.com"
LISTS = [("95", "132", "수전금구 > 주방수전"), ("186", "194", "BLACK > 주방수전")]

# 시공도면 파일 → 도면 값. h 높이 · d 토수 길이(몸통 중심 ~ 토수구) · w 앞모습 폭 · out 토수구 높이 · hole 수전 구멍 원문
#   wall: 벽붙이 (상판 구멍 없음) · note: 그 밖에 도면에 적힌 것
DRAWINGS = {
    "DL-BFK432_do.pdf": dict(wall="배관 간격 150~200 (도면 120 · 150~200) · 벽 ~ 토수구 245 · 벽 ~ 몸통 171 · 손잡이 높이 99 · 벽 덮개 Ø65"),
    "BFK-435_do.pdf": dict(h=326.5, d=217, out=268, hole="설치구멍Ø38", note="헤드 폭 53 · 손잡이 높이 67.5 · M36x1.5"),
    "DL-BFK535_do.pdf": dict(h=326.5, d=217, out=268, hole="설치구멍Ø38", note="헤드 폭 53 · 손잡이 높이 67.5"),
    "DL-BFK537_do.pdf": dict(h=228, d=207, w=54, out=167, hole="설치구멍 Ø38", note="바닥 Ø54"),
    "DL-BFK635_do.pdf": dict(h=331, d=217, w=51, out=272, note="정면 몸통 폭 51 · 위에서 본 길이 265 × 폭 109 · 손잡이 높이 87 — 수전 구멍 표기 없음"),
    "DL-K1015-CA1_do.pdf": dict(h=287, d=225, out=227, hole="설치구멍 Ø38", note="호스 540"),
    "DL-K1110-CR1_do.pdf": dict(wall="배관 간격 150~210 (도면 120 · 150~210) · 토수 227 + 몸통 81 + 벽 14(14~18) · 토수구 높이 52 · 벽 덮개 Ø60"),
    "DL-K1119-CR1_do.pdf": dict(h=348, d=182, out=182, hole="설치구멍 Ø38", note="손잡이 높이 123 · 호스 560"),
    "DL-K1417-CR1H_do.pdf": dict(h=209, d=235, out=139, hole="설치구멍 Ø38",
                                 note="높이 209 는 앞모습 헤드 끝까지 — 위로 올라간 손잡이 끝은 치수 없음 · 호스 490"),
    "DL-K1612_do.pdf": dict(wall="벽붙이 코브라싱크 — 배관 간격 150~210 (도면 110 · 150~210) · 벽 ~ 몸통 67 · 47.2 · 손잡이 81.1 · 헤드 64.9 · 벽 덮개 Ø58"),
    "DL-K1615_do.pdf": dict(h=289, d=236, out=229, hole="설치구멍 Ø38", note="손잡이 높이 68 · 호스 222"),
    "DL-K2115SN_do.pdf": dict(h=382, d=265, w=53, out=242, hole="Ø38 시공 홀", note="바닥 Ø53 · 위 치수 265"),
    "DL-K2119SNCR1_do.pdf": dict(h=400.7, d=220, w=52.5, out=185.5, hole="시공홀 Ø38",
                                 note="바닥 Ø52.5 · 목 Ø28 · 토수 220 은 토수구 끝 ~ 몸통 중심 · 손잡이 112 / 79.2 / 59"),
    "DL-YK4A19SNCR1_do.pdf": dict(h=400.7, d=220, w=52.5, out=185.5, hole="시공홀 Ø38",
                                  note="바닥 Ø52.5 · 목 Ø28 · 토수 220 은 토수구 끝 ~ 몸통 중심 · 손잡이 112 / 79.2 / 59"),
    "DL-K3015-CA1_do.pdf": dict(h=289, d=236.5, out=229, hole="설치구멍 Ø38", note="손잡이 높이 68 · 호스 550"),
    "DL-K3215_do.pdf": dict(h=289, d=236, out=229, hole="설치구멍 Ø38", note="손잡이 높이 68 · 호스 550"),
    "DL-K3217_do.pdf": dict(h=331, d=226, out=267, hole="Ø38 설치구멍", note="손잡이 높이 145 · 상판 두께 MAX15 · M35xP1.5"),
    "DL-K5115-CR1_do.pdf": dict(h=302, d=231, out=239, hole="설치구멍 Ø38", note="호스 560"),
    "DL-K5415_do.pdf": dict(h=313, d=233, out=256, hole="설치구멍 Ø38", note="손잡이 높이 135 · 호스 525"),
    "DL-K5515-CR1_do.pdf": dict(h=300, d=232, out=240, hole="설치구멍 Ø38", note="호스 535"),
    "DL-K5619-CR1_do.pdf": dict(h=433.5, d=214, w=52, out=229, hole="설치구멍 Ø38", note="바닥 Ø52 · 목 Ø30 · 손잡이 73 / 91 · 호스 555"),
    "DL-K6215-CR1_do.pdf": dict(h=283, d=232, out=223, hole="설치구멍 Ø38", note="호스 535"),
    "DL-K6217-CR1_do.pdf": dict(h=199, d=235, out=139, hole="설치구멍 Ø38",
                                note="높이 199 는 앞모습 헤드 끝까지 — 위로 올라간 손잡이 끝은 치수 없음 · 호스 490"),
    "DL-K6219_do.pdf": dict(h=410, d=205, out=227, hole="설치구멍 Ø38", note="호스 570 · 무게추 550g"),
    "DL-K7215-CR1_do.pdf": dict(h=310, d=259, out=257, hole="설치구멍 Ø38", note="호스 545"),
    "DL-K8015_do.pdf": dict(h=370, d=253, out=259, hole="설치구멍 Ø38", note="호스 570"),
    "DL-K9015_do.pdf": dict(h=355, d=244, out=338, hole="설치구멍 Ø42~Ø43", note="손잡이 90 / 187 · 터치센서식(전기)"),
    "DL-K9115_do.pdf": dict(h=335, d=244, out=286, hole="설치구멍 MinØ38 MaxØ40",
                            note="손잡이 88.5 / 180 · 상판 아래 500 이하 · 풀아웃 호스 1300 · 터치센서식(전기)"),
    "DL-K9315_do.pdf": dict(h=401, d=212, out=226, hole="설치구멍 Ø42~Ø43", note="손잡이 높이 90 · 터치센서식(전기)"),
    "DL-HFK A19_do.pdf": dict(h=497, d=225, out=240, hole="설치구멍 ∅35"),
    "DL-HFK A49_do.pdf": dict(h=370, d=201, out=227, hole="시공홀 Ø35", note="위 치수 239 · 목 Ø24 · 옆모습 바닥 + 손잡이 109 · 손잡이 83 / 94"),
    "HFK K15_do.pdf": dict(h=250, d=240, hole="시공홀 Ø35",
                           note="폭포수 헤드 폭 283 (안쪽 244) · 목 Ø24 · 싱크볼까지 MAX 55 · 손잡이 85 / 25 / 44"),
}


def num(x):
    return int(x) if float(x).is_integer() else x


def rnd(x):
    """도면 소수(326.5 · 400.7 · 52.5) → 정수 mm (반올림, .5 는 올림)"""
    return int(float(x) + 0.5)


def hole_of(raw):
    """'설치구멍 Ø38' → (38, False) · 'Ø42~Ø43' · 'MinØ38 MaxØ40' → (42 · 38, True)"""
    ns = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", raw or "")]
    if not ns:
        return None, False
    if len(ns) >= 2:
        return num(min(ns[:2])), True
    return num(ns[0]), False


def products(f):
    out = []
    for big, cate, menu in LISTS:
        for page in range(1, 20):
            st, x = f.post_form(f"{SITE}/product/getProductList",
                                {"page": str(page), "order_by": "", "cate": cate, "bigcate": big})
            if st != 200:
                break
            j = json.loads(x)
            for p in j.get("list") or []:
                out.append((menu, p))
            if not j.get("list") or page >= (j.get("pageNum") or 0):
                break
    return out


def base_name(p):
    """'RADICE A19 주방 수전 I 크롬' → ('RADICE A19 주방 수전', '크롬')"""
    nm = re.sub(r"\s+", " ", p.get("pro_nm") or "").strip()
    m = re.match(r"(.+?)\s+I\s+(.+)$", nm)
    return (m.group(1), m.group(2)) if m else (nm, None)


def line_of(p, name):
    k = re.sub(r"_?시리즈$", "", (p.get("pro_key") or "").strip())
    if k:
        return k
    return name.split()[0] if name else None


def collect(f, K_, sample=None):
    global K
    K = K_
    groups = {}
    for menu, p in products(f):
        name, color = base_name(p)
        key = (p.get("const_down") or f"idx{p['idx']}", name)
        groups.setdefault(key, []).append((menu, p, color))
    print(f"[daelim faucet] products={sum(len(v) for v in groups.values())} rows={len(groups)}", file=sys.stderr)
    rows = []
    for (const, name), items in groups.items():
        menu, p, _ = items[0]
        codes = [re.sub(r"\s+", " ", q.get("pro_no") or "").strip() for _, q, _ in items]
        if " " not in name and name not in codes:      # 'DL-YK4A19SN' (품번 칸은 'DL-YK4A19')
            codes.append(name)
        colors = [c for _, _, c in items if c]
        spec = [s.strip() for s in (p.get("pro_spec") or "").split("\x1f") if s.strip()]
        page = f"{SITE}/product/product_view?idx={p['idx']}"
        pdf = f"{SITE}/upload/product/{urllib.parse.quote(const)}" if p.get("const_down") else None
        img = p.get("img_down") or p.get("pro_img")
        row = K.base_row(brand="대림바스", category="faucet", category_subtype=None, install_type=None,
                         model_name=name, model_codes=[c for c in codes if c], line=line_of(p, name),
                         source_url=pdf or page, page_url=page,
                         image_source_url=(f"{SITE}/upload/product/{urllib.parse.quote(img)}" if img else None),
                         product_type_raw=" · ".join([menu] + spec))
        notes = []
        dw = DRAWINGS.get(const)
        if dw and dw.get("wall"):
            notes.append("벽붙이 — 상판 수전 구멍 없음 · " + dw["wall"])
            K.put_dims(row, None, None)
        elif dw:
            hole, ranged = hole_of(dw.get("hole"))
            if hole:
                row["faucet_hole_mm"] = hole
                row["cutout_raw"] = f"시공도면 {dw['hole']}"
                if ranged:
                    row["tags"].append("치수범위")
            size_txt = " · ".join(x for x in [f"높이 {dw['h']}", f"토수(D) {dw['d']}",
                                              f"토수구 높이 {dw['out']}" if dw.get("out") else None,
                                              f"폭(W) {dw['w']}" if dw.get("w") else "폭(W) 도면에 없음"] if x)
            if dw.get("w"):
                d = {k: (rnd(dw[k]), rnd(dw[k])) for k in ("w", "h", "d")}
                K.put_dims(row, d, size_txt)
            else:
                K.put_dims(row, None, size_txt)
            row["tags"].append("매뉴얼")
            if dw.get("note"):
                notes.append("도면: " + dw["note"])
        else:
            notes.append("시공도면 없음 — 치수 · 수전 구멍 모름")
            K.put_dims(row, None, None)
        if pdf:
            notes.append(f"시공도면 {pdf}")
        if const == "DL-K8015_do.pdf" and "KV805A" in name:
            notes.append("사이트가 DL-K8015 시공도면을 같이 건다 (벨벳 시리즈)")
        if colors:
            notes.append("색상 " + " · ".join(colors))
        if p.get("pro_ks"):
            notes.append(f"KS {p['pro_ks']}")
        row["install_notes"] = " · ".join(notes) or None
        rows.append(row)
        if sample and len(rows) >= sample:
            break
    return rows
