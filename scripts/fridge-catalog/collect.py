#!/usr/bin/env python3
"""Korean-market refrigerator dimension collector (prototype, stdlib only).

Brands: Samsung (samsung.com/sec), LG (lge.co.kr), Winia (winia.com, opt-in via --brands),
        Dacor (dacorkorea.com, opt-in), LG SIGNATURE Kitchen Suite (lge.co.kr/kr/business/sks, opt-in),
        Liebherr (liebherr.com/en-kr, opt-in), Midea (midea.com/kr, opt-in), Smeg (j-collection.co.kr, opt-in)
Model list  : manufacturer list APIs (the same JSON the category pages call); Dacor/SKS: brand-site menus;
              Liebherr/Midea: sitemap; Smeg: importer category list (+ 'MORE' POST)
Dimensions  : manufacturer official spec APIs (W x H x D, mm); Winia/Dacor/SKS/Midea/Smeg: static product page;
              Liebherr: __NEXT_DATA__ attributes (H/W/D)
Install gaps: manufacturer installation guides (Samsung buying-guide, LG setup-guide; Winia has none in HTML);
              Smeg: product page install sentences (hinge-side clearance etc.)
Niche       : Dacor '설치공간 (권장)', SKS '설치 치수', Liebherr attr 4491 -> niche_min_* / niche_max_* (built-in units)

Politeness: robots.txt checked per host, >= --delay seconds between network
requests, one request at a time, every raw response cached under cache/.

Usage:
  python collect.py --sample 10            # ~10 list items per brand, writes sample.json/csv
  python collect.py --out fridges          # full run, writes fridges.json/csv
  python collect.py --brands lg --no-guides --out lg_only
  python collect.py --brands winia --out winia   # default brands stay samsung,lg
  python collect.py --brands dacor,sks --out dacor_sks
  python collect.py --brands liebherr,midea,smeg --out lms
"""
import argparse
import csv
import datetime as dt
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "dadam-appliance-db/0.1 (kitchen cabinet maker; appliance dimension reference; low-rate)"

# --------------------------------------------------------------------------- http


class Fetcher:
    def __init__(self, cache_dir, delay=1.2, offline=False, verbose=True):
        self.cache_dir = cache_dir
        self.delay = max(1.0, delay)
        self.offline = offline
        self.verbose = verbose
        self._last = 0.0
        self._robots = {}
        self.net_count = 0
        self.cache_hits = 0

    def _cache_path(self, method, url, body):
        host = urllib.parse.urlparse(url).netloc.replace(":", "_")
        h = hashlib.sha1(f"{method} {url} {body or ''}".encode("utf-8")).hexdigest()[:20]
        d = os.path.join(self.cache_dir, host)
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, h + ".json")

    def _sleep(self):
        wait = self._last + self.delay - time.time()
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()

    def allowed(self, url):
        p = urllib.parse.urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            txt = self._raw(base + "/robots.txt", "GET", None, {}, check_robots=False)
            if txt is None or txt[0] >= 400:
                rp = None  # no robots.txt -> allowed
            else:
                rp.parse(txt[1].splitlines())
            self._robots[base] = rp
        rp = self._robots[base]
        return True if rp is None else rp.can_fetch(UA, url)

    def _raw(self, url, method, body, headers, check_robots=True):
        cp = self._cache_path(method, url, body)
        if os.path.exists(cp):
            with open(cp, encoding="utf-8") as f:
                c = json.load(f)
            self.cache_hits += 1
            return c["status"], c["body"]
        if self.offline:
            return None
        if check_robots and not self.allowed(url):
            raise PermissionError(f"robots.txt disallows {url}")
        self._sleep()
        data = body.encode("utf-8") if body is not None else None
        h = {"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"}
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        self.net_count += 1
        text = raw.decode("utf-8", errors="replace")
        if self.verbose:
            print(f"  [net {status}] {method} {url[:110]}", file=sys.stderr)
        with open(cp, "w", encoding="utf-8") as f:
            json.dump({"url": url, "method": method, "body_sent": body, "status": status,
                       "fetched_at": dt.datetime.now().isoformat(timespec="seconds"), "body": text}, f,
                      ensure_ascii=False)
        return status, text

    def get(self, url, headers=None):
        r = self._raw(url, "GET", None, headers or {})
        if r is None:
            raise RuntimeError(f"offline and not cached: {url}")
        return r

    def post_json(self, url, payload, headers=None):
        h = {"Content-Type": "application/json;charset=UTF-8", "Accept": "application/json"}
        h.update(headers or {})
        r = self._raw(url, "POST", json.dumps(payload, ensure_ascii=False, sort_keys=True), h)
        if r is None:
            raise RuntimeError(f"offline and not cached: {url}")
        return r

    def post_form(self, url, fields, headers=None):
        """application/x-www-form-urlencoded POST (jQuery $.ajax({data: {...}}) 와 같은 모양)."""
        h = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
             "Accept": "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest"}
        h.update(headers or {})
        r = self._raw(url, "POST", urllib.parse.urlencode(fields), h)
        if r is None:
            raise RuntimeError(f"offline and not cached: {url}")
        return r


# --------------------------------------------------------------------------- helpers

NUM = r"(\d{1,2},\d{3}|\d+(?:\.\d+)?)"


def to_num(s):
    if s is None:
        return None
    s = str(s).replace(",", "").strip()
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def parse_dims(value):
    """'595 x 1,858 x 688 mm' -> (595, 1858, 688). Order on both sites is W x H x D."""
    if not value:
        return None
    v = value.replace(",", "")
    nums = re.findall(r"\d+(?:\.\d+)?", v)
    if len(nums) < 3:
        return None
    w, h, d = (float(n) for n in nums[:3])
    if "cm" in v.lower() and "mm" not in v.lower():
        w, h, d = w * 10, h * 10, d * 10
    dims = tuple(int(round(x)) for x in (w, h, d))
    if not all(200 <= x <= 2600 for x in dims):
        return None
    return dims


def first_num(value):
    if not value:
        return None
    m = re.search(NUM, str(value))
    return to_num(m.group(1)) if m else None


def html_to_text(s):
    s = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", s)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"</(li|p|div|h\d|strong)>", "\n", s)
    t = html.unescape(re.sub(r"<[^>]+>", " ", s))
    t = re.sub(r"[ \t ]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def rx(pattern, text, group=1):
    m = re.search(pattern, text)
    return to_num(m.group(group)) if m and m.group(group) else None


def now_iso():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec="seconds")


def pick_sample(items, keyfn, n):
    """Round-robin across groups so the sample spans categories."""
    groups = {}
    for it in items:
        groups.setdefault(keyfn(it), []).append(it)
    out, i = [], 0
    keys = list(groups)
    while len(out) < n and any(groups.values()):
        k = keys[i % len(keys)]
        if groups[k]:
            out.append(groups[k].pop(0))
        i += 1
    return out


# --------------------------------------------------------------------------- Samsung

SS = "https://www.samsung.com"
SS_CATS = {"36010000": "refrigerators", "36020000": "kimchi-refrigerators"}
SS_SKIP_DISP = {"36010600"}  # 업소용(commercial)


def ss_list(f, disp):
    q = urllib.parse.urlencode({"searchFilter": "", "dispClsfNo": disp, "sortType": "", "page": 1, "rows": 400,
                                "soldOutExceptYn": "N", "pfFasterUseYn": "Y", "onlyAiscGoods": "N",
                                "aiscCtgYn": "N"})
    st, body = f.get(f"{SS}/sec/cxhr/pf/goodsList?{q}", {"Accept": "application/json"})
    d = json.loads(body)
    return d.get("count"), d.get("products") or []


def ss_variants(p):
    """goodsOptStr lines: lvl|code|..|..|optName|valueName|chip|Y|mdlCode|goodsId[,goodsId]|type|key|img"""
    out = {}
    for line in (p.get("goodsOptStr") or "").splitlines():
        parts = line.split("|")
        if len(parts) >= 10 and parts[8]:
            gids = [g for g in parts[9].split(",") if g]
            if gids:
                out.setdefault(parts[8], gids[0])
    out.setdefault(p["mdlCode"], p["goodsId"])
    return out  # mdlCode -> goodsId


def ss_spec(f, goods_id):
    st, body = f.get(f"{SS}/sec/xhr/pf/compGoodsSpecList?goodsIds={goods_id}", {"Accept": "application/json"})
    if st != 200:
        return None
    rows = json.loads(body).get("productsSpec") or []
    return {(r.get("dispNm2") or "").strip(): (r.get("specValue1") or "").strip() for r in rows}


def ss_find(spec, *keys, exclude=()):
    for k, v in spec.items():
        if any(x in k for x in keys) and not any(x in k for x in exclude) and v and v != "-":
            return k, v
    return None, None


def ss_line(name):
    n = name.lower()
    if "infinite" in n:
        return "Infinite Line"
    if "셰프컬렉션" in name:
        return "셰프컬렉션"
    if "bespoke" in n:
        return "BESPOKE"
    return "일반"


def ss_tags(name):
    tags = []
    for t in ["키친핏 Max", "키친핏", "패밀리허브", "하이브리드", "김치플러스", "정수기", "오토오픈도어", "오토도어", "빌트인", "프리스탠딩"]:
        if t in name and not (t == "키친핏" and "키친핏 Max" in name):
            tags.append(t)
    return tags


def ss_install(spec_val, name, mdl=""):
    v = (spec_val or "") + " " + name
    if "빌트인" in v or mdl.upper().startswith("BR"):  # BRF/BRR/BRZ/BRB/BRQ = 빌트인 계열
        return "built_in"
    if "키친핏" in v:
        return "kitchen_fit"
    return "freestanding"


def ss_subtype(p, name, cap, install):
    url = p.get("goodsDetailUrl") or ""
    kimchi = "kimchi" in url or "김치" in name
    if kimchi:
        return "kimchi_lid" if ("top-loading" in url or "뚜껑형" in name) else "kimchi_stand"
    if "와인" in name:
        return "wine"
    if install == "built_in":
        return "built_in"
    if "side-by-side" in url or "양문형" in name:
        return "side_by_side"
    if "french-door" in url or "4도어" in name:
        return "french_4door"
    if any(x in url for x in ("top-mount", "bottom-mount", "top-freezer")) or "2도어" in name:
        return "small" if (cap and cap <= 150) else "two_door"
    if "one-door" in url or "1도어" in name:
        return "small" if (cap and cap <= 150) else "one_door"
    if cap and cap <= 150:
        return "small"
    return "two_door"


# Samsung buying guide (installation clearances) -------------------------------

class SamsungGuide:
    URL = f"{SS}/sec/buying-guide/"

    def __init__(self, f):
        self.f = f
        self.html = None
        self.anchors = {}

    def load(self):
        if self.html is not None:
            return
        st, self.html = self.f.get(self.URL)
        for m in re.finditer(r"'#([a-z-]*installation-guide[\w-]*)'\s*:\s*\{\s*pc\s*:\s*\{(.*?)\}\s*,\s*mo\s*:",
                             self.html, re.S):
            block = m.group(2)
            cont = re.search(r"kitchen-install-(popup\d+)", block)
            sels = [s for line in block.splitlines() if not line.strip().startswith("//")
                    for s in re.findall(r"'#guide\d-guideList([\d-]+)'", line)]
            idx = re.search(r"slideIndex\s*:\s*(\d+)", block)
            if sels:
                self.anchors[m.group(1)] = (cont.group(1) if cont else None, sels[-1], int(idx.group(1)) if idx else 0)

    def section(self, anchor):
        self.load()
        a = self.anchors.get(anchor)
        if not a:
            return None
        popup, panel, slide = a
        start = 0
        if popup:
            start = max(0, self.html.find(f'class="custom-popup kitchen-install-{popup}"'))
        i = self.html.find(f'id="guidePanel{panel}"', start)
        if i < 0:
            return None
        j = self.html.find('id="guidePanel', i + 20)
        seg = self.html[i:j if j > 0 else i + 60000]
        slides = seg.split('<li class="swiper-slide">')
        body = slides[slide + 1] if len(slides) > slide + 1 else (slides[1] if len(slides) > 1 else seg)
        title = re.search(r'guide-tabs__panel__tit"><strong>([^<]+)', seg)
        stit = re.search(r'guide-tabs__panel__s-tit">([^<]+)', body)
        text = html_to_text(body)
        g = parse_gap_text(text)
        g["install_guide_ref"] = f"{self.URL}#{anchor}"
        g["install_guide_title"] = " / ".join(x.group(1).strip() for x in (title, stit) if x)
        return g


def parse_gap_text(t):
    """Regexes for both Samsung and LG install-guide wording. Values in mm."""
    t1 = re.sub(r"\s+", " ", t)
    g = {
        # side (body <-> wall/cabinet)
        "side_gap_mm": rx(r"측면과 벽 또는 냉장고장 사이의 간격은 최소 " + NUM + r" ?mm", t1)
        or rx(r"본체 측면과 가구장의? 사이의 공간은 " + NUM + r" ?mm", t1)
        or rx(r"제품과 냉장고장 간 최소 " + NUM + r" ?mm", t1),
        "door_side_gap_mm": rx(r"도어 측면 기준 " + NUM + r" ?mm", t1)
        or rx(r"도어 측면과 가구장 사이의? 거리는 " + NUM + r" ?mm", t1),
        "top_gap_mm": rx(r"도어 상단과 가구장 사이의 공간은 " + NUM + r" ?mm", t1),
        "back_gap_mm": rx(r"뒷면과 ?벽 ?사이의 간격은 최소 " + NUM + r" ?mm", t1),
        "niche_min_w_mm": rx(r"냉장고장 內 설치 시 가로 " + NUM + r" ?mm", t1),
        "niche_min_h_mm": rx(r"냉장고장 內 설치 시 (?:가로 [\d,]+ ?mm 이상, )?높이 " + NUM + r" ?mm", t1)
        or rx(r"설치 공간의 높이\(제품\+상단 여유 공간\)는 최소 " + NUM + r" ?mm", t1)
        or rx(r"냉장고 설치 시 높이 " + NUM + r" ?mm", t1),
        "niche_min_d_mm": rx(r"냉장고장 內 설치 시 [^.]*?깊이 " + NUM + r" ?mm", t1)
        or rx(r"깊이\(제품\+후면 여유 ?공간\)는 최소 " + NUM + r" ?mm", t1),
        "niche_recommended_d_mm": rx(NUM + r" ?mm 이상의 냉장고장이 필요합니다", t1.split("콘센트")[1] if "콘센트" in t1 else "")
        or rx(NUM + r" ?mm 설계를 권장", t1),
        "door_open_width_mm": rx(r"도어를 끝까지 열었을 경우 필요한 가로 길이는 " + NUM + r" ?mm", t1),
        "door_swing_side_mm": rx(NUM + r" ?mm ?: ?도어부 측면 최소 필요 거리", t1),
        "pair_gap_mm": None,
    }
    m = re.search(r"제품 간 간격은 ([\d~ ]+) ?mm", t1)
    if m:
        g["pair_gap_mm"] = m.group(1).replace(" ", "")
    notes = [s.strip(" *") for s in re.split(r"\n", t) if re.search(r"\d ?mm", s) and len(s) < 260]
    g["install_notes"] = " | ".join(dict.fromkeys(notes))[:900]
    return g


def samsung_collect(f, sample=None, guides=True):
    items = []
    for disp, cat in SS_CATS.items():
        count, prods = ss_list(f, disp)
        print(f"[samsung] {cat}: count={count} listed={len(prods)}", file=sys.stderr)
        for p in prods:
            if p.get("goodsTpCd") == "20":  # 패키지(묶음/구독 세트) - 단품이 따로 있다
                continue
            if p.get("dispClsfNo") in SS_SKIP_DISP:
                continue
            p["_cat"] = cat
            items.append(p)
    seen, uniq = set(), []
    for p in items:  # same goods can appear under both categories
        if p["goodsId"] not in seen:
            seen.add(p["goodsId"])
            uniq.append(p)
    if sample:
        def skey(p):
            parts = (p.get("goodsDetailUrl") or "").split("/")
            k = re.sub(r"-?[a-z]*\d.*", "", parts[1]) if len(parts) > 1 else ""
            return k or p["dispClsfNo"]
        uniq = pick_sample(uniq, skey, sample)
    guide = SamsungGuide(f) if guides else None
    rows, done_models = [], set()
    for p in uniq:
        name = re.sub(r"\s+", " ", p.get("goodsNm") or "").strip()
        pdp = f"{SS}/sec/{p['goodsDetailUrl']}"
        gap = {}
        if guide:
            try:
                st, ph = f.get(pdp)
                a = re.search(r"buying-guide/#([a-z-]*installation-guide[\w-]*)", ph)
                if a:
                    gap = guide.section(a.group(1)) or {}
            except Exception as e:  # noqa
                print(f"  guide fail {pdp}: {e}", file=sys.stderr)
        for mdl, gid in ss_variants(p).items():
            if mdl in done_models:
                continue
            done_models.add(mdl)
            spec = ss_spec(f, gid)
            if not spec:
                continue
            _, size = ss_find(spec, "크기(", "크기", exclude=("포장", "내부", "박스"))
            dims = parse_dims(size)
            _, capv = ss_find(spec, "전체 용량", "총 용량", "용량")
            cap = first_num(capv) if capv and ("ℓ" in capv or "L" in capv.upper()) else None
            _, inst = ss_find(spec, "설치 타입")
            _, ptype = ss_find(spec, "제품 타입")
            _, bottles = ss_find(spec, "병", "보관 수량")
            install = ss_install(inst, name, mdl)
            row = {
                "brand": "Samsung",
                "category_subtype": ss_subtype(p, name, cap, install),
                "line": ss_line(name),
                "tags": ss_tags(name),
                "model_name": name,
                "model_codes": [mdl],
                "width_mm": dims[0] if dims else None,
                "height_mm": dims[1] if dims else None,
                "depth_mm": dims[2] if dims else None,
                "capacity_l": cap,
                "wine_bottles": first_num(bottles) if bottles else None,
                "install_type": install,
                "product_type_raw": ptype,
                "size_raw": size,
                "source_url": f"{SS}/sec/xhr/pf/compGoodsSpecList?goodsIds={gid}",
                "page_url": pdp,
                "sale_status": p.get("saleStatCd"),
                "collected_at": now_iso(),
            }
            row.update({k: v for k, v in gap.items()})
            rows.append(row)
    return rows


# --------------------------------------------------------------------------- LG

LG_API = "https://apiv2.lge.co.kr"
LG_WWW = "https://www.lge.co.kr"
LG_CATS = {"CT50000065": "refrigerators", "CT50000072": "kimchi-refrigerators", "CT50115000": "winecellar",
           "CT50073000": "convertible-refrigerators"}
LG_HDR = {"Origin": LG_WWW, "Referer": LG_WWW + "/", "Accept": "application/json"}


def lg_list(f, cat):
    out, page, total = [], 1, None
    while True:
        payload = {"sortType": "sort_pick", "mltpModelFilterFlag": "", "tomorrowDeliveryFilterFlag": "",
                   "spaceModelFilterFlag": "", "upApplianceFilterFlag": "", "highEfficiencyFilterFlag": "",
                   "empFilterType": "", "lineupId": "", "subCategoryId": "", "carePromotionBadgeFilterList": [],
                   "subCategoryFilterList": [], "colorFilterList": [], "tagFilterList": [], "brandFilterList": [],
                   "productFilterList": [], "priceFilter": {}, "compSetFilter": {}, "page": page, "b2cYn": "Y"}
        st, body = f.post_json(f"{LG_API}/plpsvc/ajax/v1/plp/category/{cat}/model", payload, LG_HDR)
        d = (json.loads(body) or {}).get("data") or {}
        total = d.get("totalModelCnt") or 0
        ml = d.get("modelList") or []
        out.extend(ml)
        if not ml or page * 30 >= total:
            break
        page += 1
    return total, out


def lg_is_kit(m):
    nm = (m.get("modelDisplayName") or "") + " " + (m.get("subCategoryName") or "")
    if "세트" in (m.get("subCategoryName") or "") or " + " in (m.get("modelDisplayName") or ""):
        return True  # 냉장고+김치냉장고 묶음 상품 - 단품이 따로 목록에 있다
    return "키트" in nm or re.match(r"^(OC|FM)-KIT", (m.get("modelName") or "").upper()) is not None


def lg_spec(f, model_id):
    st, body = f.get(f"{LG_API}/pdpsvc/ajax/v1/models/{model_id}/spec", LG_HDR)
    if st != 200:
        return None
    data = (json.loads(body) or {}).get("data") or []
    return data[0] if data else None


def lg_flat(spec):
    out = {}
    for grp in spec.get("techSpecs") or []:
        for s in grp.get("spec") or []:
            if s.get("name"):
                out.setdefault(s["name"].strip(), (s.get("value") or "").strip())
    for s in spec.get("keyFeatures") or []:
        if s.get("name"):
            out.setdefault(s["name"].strip(), (s.get("value") or "").strip())
    return out


def lg_line(name):
    if "오브제컬렉션" in name or "objet" in name.lower():
        return "오브제컬렉션"
    if "디오스" in name or "DIOS" in name.upper():
        return "디오스"
    return "일반"


def lg_tags(name):
    tags = []
    for t, label in [("Fit & Max", "핏앤맥스"), ("STEM", "STEM"), ("모던엣지", "모던엣지"), ("컨버터블", "컨버터블"),
                     ("매직스페이스", "매직스페이스"), ("얼음정수기", "얼음정수기"), ("디오스", "디오스"), ("DIOS", "디오스"),
                     ("빌트인", "빌트인")]:
        if t in name and label not in tags:
            tags.append(label)
    return tags


def lg_install(v, name):
    s = (v or "") + " " + name
    if "Fit & Max" in s or "핏앤맥스" in s or "키친핏" in s:
        return "kitchen_fit"
    if "빌트인" in s:
        return "built_in"
    return "freestanding"


def lg_subtype(m, flat, name, cap, install, cat):
    sub = m.get("subCategoryName") or ""
    doors = flat.get("도어 개수") or ""
    if cat == "winecellar" or "와인" in name:
        return "wine"
    if cat == "kimchi-refrigerators" or "김치" in sub or "김치" in name:
        return "kimchi_lid" if ("뚜껑" in sub or "뚜껑" in name) else "kimchi_stand"
    if "양문형" in sub or "양문형" in (flat.get("타입") or ""):
        return "side_by_side"
    if install == "built_in":
        return "built_in"
    if cap and cap <= 150:
        return "small"
    if "4" in doors or "3" in doors:
        return "french_4door"
    if not doors and "상냉장" in sub:  # 색상 변형 모델은 '도어 개수' 항목이 빠진 경우가 있다
        return "french_4door"
    if "1" in doors or cat == "convertible-refrigerators":
        return "one_door"
    return "two_door"


class LGGuide:
    URL = f"{LG_WWW}/story/setup-guide/refrigerator-installation-guide"

    def __init__(self, f):
        self.f = f
        self.sections = None

    def load(self):
        if self.sections is not None:
            return
        st, h = self.f.get(self.URL)
        t = html_to_text(h)
        self.sections = []
        starts = [m.start() for m in re.finditer(r"도면\(전면\)", t)]
        for k, s in enumerate(starts):
            head = t[max(0, s - 400):s]
            titles = re.findall(r"([^\n(]+?)\s*\((\d{2})년형・([A-Z0-9]+)\)", head)
            if not titles:
                continue
            title, yr, prefix = titles[-1]
            same = re.findall(r"동일 적용 모델 ?: ?([A-Z0-9 ,()년형]+)", head[head.rfind(prefix):])
            prefixes = [prefix] + (re.findall(r"[A-Z]\d{3}", same[0]) if same else [])
            end = starts[k + 1] - 400 if k + 1 < len(starts) else len(t)
            body = t[s:end]
            g = parse_gap_text(body)
            g["install_guide_ref"] = self.URL
            g["install_guide_title"] = f"{title.strip()} ({yr}년형・{prefix})"
            self.sections.append((prefixes, g))

    def match(self, model_name):
        self.load()
        hits = [g for prefixes, g in self.sections if any(model_name.upper().startswith(p) for p in prefixes)]
        # 단독 설치 섹션 우선 ('+', '×' 가 든 제목은 페어/조합 설치 섹션)
        hits.sort(key=lambda g: ("+" in g["install_guide_title"] or "×" in g["install_guide_title"]))
        return hits[0] if hits else None


def lg_collect(f, sample=None, guides=True):
    items = []
    for cat_id, cat in LG_CATS.items():
        total, ml = lg_list(f, cat_id)
        print(f"[lg] {cat}: totalModelCnt={total} listed={len(ml)}", file=sys.stderr)
        for m in ml:
            if lg_is_kit(m):
                continue
            m["_cat"] = cat
            items.append(m)
    seen, uniq = set(), []
    for m in items:
        if m["modelId"] not in seen:
            seen.add(m["modelId"])
            uniq.append(m)
    if sample:
        uniq = pick_sample(uniq, lambda m: (m["_cat"], m.get("subCategoryName")), sample)
    guide = LGGuide(f) if guides else None
    rows, done = [], set()
    for m in uniq:
        vids = [m["modelId"]]
        for og in m.get("optionGroupList") or []:
            for o in og.get("optionList") or []:
                if o.get("modelId") and o["modelId"] not in vids:
                    vids.append(o["modelId"])
        for vid in vids:
            if vid in done:
                continue
            done.add(vid)
            spec = lg_spec(f, vid)
            if not spec:
                continue
            flat = lg_flat(spec)
            name = re.sub(r"\s+", " ", m.get("modelDisplayName") or "").strip()
            size_k = next((k for k in flat if "크기" in k and "포장" not in k), None)
            dims = parse_dims(flat.get(size_k)) if size_k else None
            cap_k = next((k for k in flat if "전체 용량" in k or "총 용량" in k or k.startswith("용량")), None)
            if not cap_k:  # 냉동/냉장 전용고는 '냉동 용량 (L)' 하나만 있다
                cap_k = next((k for k in flat if "용량" in k and "(L)" in k), None)
            cap = first_num(flat.get(cap_k)) if cap_k else None
            bottles_k = next((k for k in flat if "병" in k), None)
            install = lg_install(flat.get("설치타입"), name)
            alt = (spec.get("dimensionMap") or {}).get("altText") or ""
            alt_dims = None
            if alt:
                w, d, h = rx(r"폭 " + NUM, alt), rx(r"깊이 " + NUM, alt), rx(r"높이 " + NUM, alt)
                alt_dims = f"{w}x{h}x{d}" if w and h and d else None
            model_code = spec.get("modelName") or spec.get("salesModelCode")
            row = {
                "brand": "LG",
                "category_subtype": lg_subtype(m, flat, name, cap, install, m["_cat"]),
                "line": lg_line(name),
                "tags": lg_tags(name),
                "model_name": name,
                "model_codes": [model_code],
                "width_mm": dims[0] if dims else None,
                "height_mm": dims[1] if dims else None,
                "depth_mm": dims[2] if dims else None,
                "capacity_l": cap,
                "wine_bottles": first_num(flat.get(bottles_k)) if bottles_k else None,
                "install_type": install,
                "product_type_raw": " / ".join(x for x in [m.get("subCategoryName"), flat.get("타입"),
                                                             flat.get("도어 개수"), flat.get("설치타입")] if x),
                "size_raw": flat.get(size_k) if size_k else None,
                "drawing_dims_raw": alt_dims,
                "source_url": f"{LG_API}/pdpsvc/ajax/v1/models/{vid}/spec",
                "page_url": LG_WWW + (m.get("modelUrlPath") or ""),
                "sale_status": m.get("modelStatusCode"),
                "collected_at": now_iso(),
            }
            if guide and model_code:
                g = guide.match(model_code)
                if g:
                    row.update(g)
            rows.append(row)
    return rows


# --------------------------------------------------------------------------- Winia (위니아 딤채)

WN = "https://www.winia.com"
# list_ajax 의 TYPE / GNB_SEQ (메인 메뉴 '냉장고/와인셀러' · '김치냉장고' 와 같은 값)
WN_CATS = {
    "1": ("refrigerators", "2055_2060_2065_2056_2061_2066_2057_2062_2067_2058_2063_2068_2059_2064_2069"),
    "2": ("kimchi-refrigerators", "2070_2071"),
}
WN_HDR = {"Origin": WN, "Referer": WN + "/product/list"}


def wn_list(f, type_, gnb):
    out, page, total = [], 0, None
    while True:
        st, body = f.post_form(f"{WN}/product/list_ajax", {"pageNo": page, "pageSize": 400, "TYPE": type_,
                                                           "GNB_SEQ": gnb, "PRODUCT_SEQS": "", "PRODUCT_SEQ": ""},
                               WN_HDR)
        ro = (json.loads(body) or {}).get("resultObject") or {}
        total = ro.get("totCnt") or 0
        ml = ro.get("list") or []
        out.extend(ml)
        if not ml or len(out) >= total or (ro.get("pageInfo") or {}).get("lastPage", True):
            break
        page += 1
    return total, out


def wn_spec(h):
    """상세 페이지 '제품사양' 표 → {항목: 값}. <dt class="name">항목</dt><dd class="text">값</dd>"""
    i = h.find('id="productSpec"')
    if i < 0:
        return {}
    j = h.find("제품사양 끝", i)
    seg = h[i:j if j > 0 else len(h)]
    out = {}
    for m in re.finditer(r'<dt class="name">(.*?)</dt>\s*<dd class="text">(.*?)</dd>', seg, re.S):
        k = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(1)))).strip()
        v = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))).strip()
        if k:
            out.setdefault(k, v)
    return out


def wn_line(title, kimchi):
    if kimchi:  # '딤채 스탠드형 551L' · '클라쎄 스탠드형 328L'
        w = title.split(" ")[0]
        return w if w in ("딤채", "클라쎄") else "일반"
    return "보르도" if "보르도" in title else "일반"


def wn_tags(title, p, spec):
    tags = []
    if p.get("MNG_NAME") == "쁘띠형" or "쁘띠" in title:
        tags.append("쁘띠형")
    if "와인셀러" in title or any("와인셀러" in k for k in spec):
        tags.append("와인셀러")
    if p.get("YEAR"):
        tags.append(f"{p['YEAR']}년형")
    return tags


def wn_subtype(p, cat, title, spec, cap, h):
    mng = p.get("MNG_NAME") or ""
    if cat == "kimchi-refrigerators":
        return "kimchi_lid" if ("뚜껑" in mng or "뚜껑" in title) else "kimchi_stand"
    struct = spec.get("냉장/냉동구조") or ""
    if "양문" in mng or "양문" in struct:
        return "side_by_side"
    # '와인 보관형'(보르도) 은 상냉장/하냉동 4도어 몸체 — 크기로는 프렌치 4도어다 (와인셀러 칸은 tags 에 남긴다)
    if "상냉장/하냉동" in mng or "프렌치" in title or "와인" in mng:
        return "french_4door"
    if "냉동고" in mng or "냉동고" in title:  # 세워 쓰는 냉동고 단품 (to_sql.refine_subtype 과 같은 기준)
        return "one_door" if (h or 0) >= 1000 else "small"
    if cap and cap <= 150:  # 삼성 · LG 와 같은 기준 (위니아 '소형냉장고' 메뉴엔 182L 도 있다)
        return "small"
    if not cap and "소형" in mng:
        return "small"
    return "two_door"


def winia_collect(f, sample=None, guides=True):
    """위니아 (딤채 · 클라쎄 김치냉장고, 위니아 냉장고 · 냉동고 · 보르도).
    목록: POST /product/list_ajax (form) · 치수: /product/view?PRODUCT_SEQ= 정적 HTML '제품사양' 표.
    목록 한 칸 = 모델 코드 하나 (색상 변형도 따로 올라온다). 설치 여유는 winia.com HTML 에 없다 (매뉴얼 PDF 뿐)
    → guides 는 받기만 하고 쓰지 않는다. 여유 칸은 비워 둔다."""
    items = []
    for type_, (cat, gnb) in WN_CATS.items():
        total, ml = wn_list(f, type_, gnb)
        print(f"[winia] {cat}: totCnt={total} listed={len(ml)}", file=sys.stderr)
        for p in ml:
            p["_cat"] = cat
            items.append(p)
    seen, uniq = set(), []
    for p in items:
        if p["PRODUCT_SEQ"] not in seen:
            seen.add(p["PRODUCT_SEQ"])
            uniq.append(p)
    if sample:
        uniq = pick_sample(uniq, lambda p: (p["_cat"], p.get("MNG_NAME")), sample)
    rows, done_codes = [], set()
    queue = list(uniq)
    while queue:
        p = queue.pop(0)
        code = (p.get("PRODUCT_MODEL_NAME") or "").strip()
        if code in done_codes:
            print(f"  [winia] skip duplicate code {code} (PRODUCT_SEQ={p['PRODUCT_SEQ']})", file=sys.stderr)
            continue
        page = f"{WN}/product/view?PRODUCT_SEQ={p['PRODUCT_SEQ']}"
        st, h = f.get(page)
        spec = wn_spec(h) if st == 200 else {}
        if not spec:  # 목록에는 있는데 상세가 '요청하신 페이지를 찾을 수 없습니다' (200) 인 경우가 있다
            print(f"  [winia] no spec table {code or '?'} {page} (status {st})", file=sys.stderr)
            continue
        m = re.search(r'<p class="title">([^<]+)</p>\s*<p class="code">\s*<span>([^<]+)', h)
        title = re.sub(r"\s+", " ", html.unescape(m.group(1) if m else (p.get("PRODUCT_TITLE") or ""))).strip()
        page_code = html.unescape(m.group(2)).strip() if m else code
        if not code:  # 색상 칩으로만 이어진 상품 (목록에 없다)
            code = page_code
            if not code or code in done_codes:
                continue
        elif page_code != code:
            print(f"  [winia] code mismatch list={code} page={page_code}", file=sys.stderr)
        done_codes.add(code)  # 같은 코드의 다른 PRODUCT_SEQ 는 상세가 없을 때만 다시 시도한다
        if not sample:  # 상세의 색상 칩(fnMoveDetail) 중 목록에 없는 상품도 따라간다 — 같은 분류로 본다
            for s in re.findall(r"fnMoveDetail\((\d+)\)", h):
                if int(s) not in seen:
                    seen.add(int(s))
                    queue.append(dict(p, PRODUCT_SEQ=int(s), PRODUCT_MODEL_NAME=None, PRODUCT_TITLE=None))
                    print(f"  [winia] color chip {s} (from {code}) not in list - following", file=sys.stderr)
        size_k = next((k for k in spec if "WxHxD" in k.replace(" ", "")), None) \
            or next((k for k in spec if ("크기" in k or "사이즈" in k) and "포장" not in k), None)
        size = spec.get(size_k) if size_k else None
        dims = parse_dims(size)
        cap_k = next((k for k in spec if k.replace(" ", "").startswith(("전체용량", "총용량"))), None) \
            or next((k for k in spec if k.replace(" ", "") in ("용량", "용량(L)")), None)
        cap = first_num(spec.get(cap_k)) if cap_k else None
        if cap is None:  # 김치냉장고 사양표엔 용량 칸이 없다 — 제목 '딤채 스탠드형 551L'
            cap = rx(r"(\d+(?:\.\d+)?)\s*L\b", title)
        cat = p["_cat"]
        row = {
            "brand": "Winia",
            "category_subtype": wn_subtype(p, cat, title, spec, cap, dims[1] if dims else None),
            "line": wn_line(title, cat == "kimchi-refrigerators"),
            "tags": wn_tags(title, p, spec),
            "model_name": title,
            "model_codes": [code],
            "width_mm": dims[0] if dims else None,
            "height_mm": dims[1] if dims else None,
            "depth_mm": dims[2] if dims else None,
            "capacity_l": cap,
            "wine_bottles": None,
            "install_type": "built_in" if "빌트인" in title else "freestanding",
            "product_type_raw": " / ".join(x for x in [p.get("TYPE_NAME"), p.get("MNG_NAME"), spec.get("냉장/냉동구조"),
                                                         f"{p['YEAR']}년형" if p.get("YEAR") else None,
                                                         spec.get("패턴 및 색상")] if x),
            "size_raw": f"{size_k}: {size}" if size else None,
            "source_url": page,
            "page_url": page,
            "sale_status": p.get("STATUS"),
            "collected_at": now_iso(),
        }
        rows.append(row)
    return rows


# --------------------------------------------------------------------------- built-in niche (설치 공간)


def parse_niche(value):
    """설치 공간 원문 → niche_min/max_{w,h,d}_mm. W x H x D 순서, 값은 원문 그대로 (지어내지 않는다).
      '610 x 2,135 x 670 mm (권장)'        → min 610 / 2135 / 670
      '457 x 2,135 x 635~655'              → 깊이 min 635 · max 655
      '600 x 820~828 or 836↑ x 600↑'       → 높이는 대안이 둘이라 min 820 만 (max 는 비운다 — 836 이상도 된다)"""
    if not value:
        return {}
    v = re.sub(r"\([^)]*\)", " ", value.replace(",", ""))
    v = re.sub(r"(?i)mm", " ", v).strip()
    parts = re.split(r"\s+[xX×]\s+", v)
    if len(parts) != 3:
        return {}
    out = {}
    for axis, part in zip("whd", parts):
        alts = re.split(r"\bor\b|또는", part)
        nums = [to_num(n) for n in re.findall(r"\d+(?:\.\d+)?", alts[0])]
        nums = [n for n in nums if 200 <= n <= 2600]
        if not nums:
            continue
        out[f"niche_min_{axis}_mm"] = nums[0]
        if "~" in alts[0] and len(nums) >= 2 and len(alts) == 1:
            out[f"niche_max_{axis}_mm"] = nums[1]
    return out


def _text(s, br="\n"):
    """HTML 조각 → 글자. <br> 은 br 로, 줄마다 공백을 접는다."""
    s = re.sub(r"(?s)<!--.*?-->", "", s or "")
    s = re.sub(r"<br\s*/?>", br, s)
    s = html.unescape(re.sub(r"<[^>]+>", " ", s))
    lines = [re.sub(r"[ \t\r\xa0]+", " ", x).strip() for x in s.split("\n")]
    return "\n".join(x for x in lines if x)


PANEL_RE = re.compile(r"(?i)panel ?ready|패널 ?레디|가구 패널")


# --------------------------------------------------------------------------- Dacor (데이코, 삼성 브랜드)

DC = "https://www.dacorkorea.com"


def dc_pages(f):
    """홈 메뉴의 '쿨링' 제품 페이지 (/products/refrigerators/<slug>/). 페이지 하나 = 제품 하나."""
    st, h = f.get(DC + "/")
    out = []
    for p in re.findall(r'href="(/products/refrigerators/[\w-]+)/?"', h):
        if p + "/" not in out:
            out.append(p + "/")
    return out


def dc_spec(h):
    """'제품 상세 스펙표' → {항목: 값}. <th>구분</th><td><ul><li><strong>항목</strong><span>값</span></li>…
    같은 항목 이름이 두 구분에 있으면(와인 '타입') '구분/항목' 키로도 남긴다."""
    i = h.find("<caption>제품 상세 스펙표")
    if i < 0:
        return {}
    seg = re.sub(r"(?s)<!--.*?-->", "", h[i:h.find("</table>", i)])
    out = {}
    for tr in re.findall(r"(?s)<tr>(.*?)</tr>", seg):
        th = re.search(r"(?s)<th[^>]*>(.*?)</th>", tr)
        td = re.search(r"(?s)<td[^>]*>(.*?)</td>", tr)
        if not th or not td:
            continue
        sec = _text(th.group(1), " ").replace("\n", " ")
        lis = re.findall(r"(?s)<li>\s*<strong>(.*?)</strong>\s*<span>(.*?)</span>", td.group(1))
        if not lis:
            out.setdefault(sec, _text(td.group(1)))
        for k, v in lis:
            k = _text(k, " ").replace("\n", " ")
            out.setdefault(k, _text(v))
            out[f"{sec}/{k}"] = _text(v)
    return out


def dc_subtype(kind, panel, combo):
    if "와인" in kind:
        return "wine"  # 유리 도어 — 패널레디 틀이어도 와인셀러로 둔다
    if panel:
        return "built_in"  # 가구 패널을 붙이는 완전 빌트인
    if combo:
        return "french_4door"
    if "김치" in kind:
        return "kimchi_stand"
    return "one_door"


def dacor_collect(f, sample=None, guides=True):
    """데이코 (Dacor, 삼성전자 브랜드). samsung.com/sec 목록에는 없다 — 삼성이 운영하는 www.dacorkorea.com 이 정본.
    목록: 홈 메뉴의 /products/refrigerators/* · 치수: 각 페이지 정적 HTML '제품 상세 스펙표'
    (제품크기 · 설치공간(권장) · 색상/재질 · 도어). 설치 가이드 글은 없다 → guides 는 쓰지 않는다."""
    pages = dc_pages(f)
    print(f"[dacor] refrigeration pages={len(pages)}", file=sys.stderr)
    if sample:
        pages = pages[:sample]
    rows = []
    for path in pages:
        page = DC + path
        st, h = f.get(page)
        spec = dc_spec(h) if st == 200 else {}
        if not spec:
            print(f"  [dacor] no spec table {page} (status {st})", file=sys.stderr)
            continue
        kind = spec.get("타입") or ""
        code = (spec.get("모델명") or "").strip().upper()
        codes = [code] if code else []
        for t in re.findall(r"<title>([^<]*)</title>", h):  # 김치: 표는 DRQ24982RAP, 제목은 DRQ24992RAP
            for c in re.findall(r"\bDR[A-Z0-9]{6,}\b", t.upper()):
                if c not in codes:
                    print(f"  [dacor] {path}: title code {c} differs from spec table {code} - kept as 2nd code",
                          file=sys.stderr)
                    codes.append(c)
        size = spec.get("제품크기 (W x H x D)") or ""
        dims = parse_dims(size.split("\n")[0])  # 첫 줄 = Door Panel 제외 (둘째 줄은 패널 · 설치자재 포함)
        niche_raw = spec.get("설치공간 (W x H x D)")
        cap_k = next((k for k in spec if k.replace(" ", "").startswith("총용량")), None)  # '총 용량 (냉장/냉동)' 포함
        capv = spec.get(cap_k) or ""
        cap = first_num(capv) if re.search(r"ℓ|L\b", capv) else None
        bottles = rx(r"(\d+)\s*bottles", capv)
        door = spec.get("도어") or ""
        finish = spec.get("색상 / 재질") or spec.get("도어/타입") or ""
        hinge = spec.get("힌지 방향")
        panel = bool(PANEL_RE.search(finish + " " + door))
        combo = "(냉장/냉동)" in (cap_k or "") or "T-TYPE" in kind.upper()
        tags = ["컬럼"] if "컬럼" in kind else (["T-Type"] if "T-TYPE" in kind.upper() else [])
        tags += ["패널레디"] if panel else []
        row = {
            "brand": "Dacor",
            "category_subtype": dc_subtype(kind, panel, combo),
            "line": "일반",
            "tags": tags,
            "model_name": f"데이코 {kind}" + (f" {cap}L" if cap else (f" {bottles}병" if bottles else "")),
            "model_codes": codes,
            "width_mm": dims[0] if dims else None,
            "height_mm": dims[1] if dims else None,
            "depth_mm": dims[2] if dims else None,
            "capacity_l": cap,
            "wine_bottles": bottles,
            "install_type": "built_in",
            "panel_ready": panel,
            "niche_raw": niche_raw,
            "product_type_raw": " / ".join(x.replace("\n", " ") for x in [
                kind, f"색상·재질: {finish}" if finish else None, f"도어: {door}" if door else None,
                f"힌지: {hinge}" if hinge else None] if x),
            "size_raw": size.replace("\n", " / ") or None,
            "source_url": page,
            "page_url": page,
            "sale_status": None,
            "collected_at": now_iso(),
        }
        row.update(parse_niche(niche_raw))
        rows.append(row)
    return rows


# --------------------------------------------------------------------------- LG SIGNATURE Kitchen Suite (SKS)

SKS = "https://www.lge.co.kr/kr/business/sks"
SKS_CODE = re.compile(r"(\[(?:Professional|Transitional)\])|\b([A-Z][A-Z0-9]{2,})\s*(냉동고|냉장고)?\s*\(([좌우])경첩\)")


def sks_pages(f):
    """SKS 홈 'Products' 슬라이드 중 이름에 냉장 · 냉동 · 와인이 든 페이지 (컬럼 · 얼음정수기 냉장고 · 아일랜드)."""
    st, h = f.get(f"{SKS}/signaturekitchenMain.do")
    out = []
    for path, label in re.findall(r'<a[^>]+href="(/kr/business/sks/[\w-]+\.do)(?:#[^"]*)?"[^>]*>(.*?)</a>', h, re.S):
        if re.search(r"냉장|냉동|와인", _text(label, " ")) and path not in out:
            out.append(path)
    return out


def sks_codes(cat_text, img_items):
    """→ [(code, design, kind_word, hinge)]. 표 머리('[Professional] CF24 냉동고 (좌경첩) / …') 가 있으면 그걸,
    없으면 사진 설명('CW24R(우경첩) / CW24L(좌경첩)', '본체 : U092CN421 / 패널 : …', 'S695RE13BW')."""
    out = []
    if cat_text:
        design = None
        for m in SKS_CODE.finditer(cat_text):
            if m.group(1):
                design = m.group(1).strip("[]")
            else:
                out.append((m.group(2), design, m.group(3), m.group(4)))
        return out
    for title, desc in img_items:
        design = title if title in ("Professional", "Transitional") else None
        found = [(m.group(2), design, m.group(3), m.group(4)) for m in SKS_CODE.finditer(desc) if m.group(2)]
        if not found:
            body = re.search(r"본체\s*:\s*([A-Z][A-Z0-9]{4,})", desc)
            if body:
                found = [(body.group(1), design, None, None)]
            elif re.fullmatch(r"[A-Z][A-Z0-9]{5,}", desc.strip()):
                found = [(desc.strip(), design, None, None)]
        out += found
    return out


def sks_collect(f, sample=None, guides=True):
    """LG SIGNATURE Kitchen Suite (SKS) 냉장 계열. lge.co.kr 일반 목록(plp)에는 없다 — 브랜드관 lge.co.kr/kr/business/sks/*.do
    정적 HTML '제품 스펙' 탭이 정본: 표 머리/사진 설명의 모델 코드 · '제품 치수 (WxHxD, mm)' · '설치 치수 (WxHxD, mm)'.
    세트(CFL1830 = 냉동 CF18 + 냉장 CL30) 는 단품이 따로 있어 건너뛴다. 설치 가이드 글은 PDF 뿐 → guides 는 쓰지 않는다."""
    pages = sks_pages(f)
    print(f"[sks] refrigeration pages={pages}", file=sys.stderr)
    if sample:
        pages = pages[:sample]
    rows = []
    for path in pages:
        page = LG_WWW + path
        st, h = f.get(page)
        h = re.sub(r"(?s)<!--.*?-->", "", h)
        labels = dict(re.findall(r'<a href="#(tab[\d-]+)" class="tab-menu">(.*?)</a>', h, re.S))
        for sec in re.findall(r'(?s)id="productSpec\d+">(.*?)(?=<section |$)', h):
            for tab_id, tab in re.findall(r'(?s)<div class="tabs-content" id="(tab[\d-]+)">(.*?)(?=<div class="tabs-content"|$)',
                                          sec):
                tab_label = re.sub(r"\s*\(.*", "", _text(labels.get(tab_id, ""), " ").replace("선택됨", "")).strip()
                img_items = [(_text(a, " "), _text(b, " / ").replace("\n", " "))
                             for a, b in re.findall(r'(?s)class="item-text">\s*<p class="title">(.*?)</p>\s*'
                                                    r'<span class="desc">(.*?)</span>', tab)]
                summary = _text(" ".join(re.findall(r'(?s)<ul class="bullet-list">(.*?)</ul>', tab)), " ")
                notes = [_text(x, " ") for x in re.findall(r"(?s)<li>(.*?)</li>", " ".join(
                    re.findall(r'(?s)<ul class="(?:noti-list|multiple-list)">(.*?)</ul>', tab)))]
                notes += [_text(x, " ").replace("\n", " ") for x in re.findall(r'(?s)<div class="blind">(.*?)</div>', tab)]
                notes = [n for n in notes if re.search(r"\d ?mm|패널|Gap", n)]
                blocks = re.split(r'<div class="spec-table(?! download)', tab)[1:]
                for blk in blocks:
                    if "list-tit" not in blk:
                        continue
                    cat = re.search(r'(?s)<div class="table-category">(.*?)</div>', blk)
                    cat_text = _text(cat.group(1), " ").replace("\n", " / ") if cat else ""
                    pairs = [(_text(a, " ").replace("\n", " "), _text(b, " / ").replace("\n", " ")) for a, b in
                             re.findall(r'(?s)<p class="list-tit">(.*?)</p>\s*<p class="list-cont">(.*?)</p>', blk)]
                    get = lambda key: next((v for k, v in pairs if k.replace(" ", "").startswith(key)), None)  # noqa
                    size = get("제품치수")
                    if not size:
                        continue
                    if len(re.findall(r"\d+ x [\d,]+ x \d+", size)) > 1 or any("냉동:" in d for _, d in img_items):
                        print(f"  [sks] {path}#{tab_id}: set (냉동+냉장 묶음) - skipped: {size}", file=sys.stderr)
                        continue
                    codes = sks_codes(cat_text, [] if cat else img_items)
                    if not codes:
                        print(f"  [sks] {path}#{tab_id}: no model code - skipped", file=sys.stderr)
                        continue
                    dims = parse_dims(size)
                    niche_raw = get("설치치수")
                    caps = {k: v for k, v in pairs if k in ("용량", "전체용량", "냉동고", "냉장고")}
                    combo = any(k.replace(" ", "") in ("냉동용량", "냉장용량") for k, _ in pairs)
                    img_title = next((t for t, _ in img_items if t not in ("Professional", "Transitional")), "")
                    panel = bool(PANEL_RE.search(" ".join(notes) + " " + summary + " " + blk))
                    for code, design, kind_word, hinge in codes:
                        capv = caps.get(kind_word) or caps.get("전체용량") or caps.get("용량") or ""
                        if kind_word and caps.get(kind_word):  # '(CF24/CL24) 375L' — 괄호 속 코드 묶음이 어긋나 있어 냉동고/냉장고 이름으로 고른다
                            inner = re.findall(r"[A-Z][A-Z0-9]{2,}", capv.split(")")[0])
                            if inner and code not in inner:
                                print(f"  [sks] {code} ({kind_word}): capacity cell '{kind_word} {capv}' lists {inner}"
                                      f" - matched by kind word", file=sys.stderr)
                        cap = rx(r"([\d,]+(?:\.\d+)?)\s*L\b", capv.split(")")[-1])
                        bottles = rx(r"(\d+)\s*병", capv) or rx(r"(\d+)\s*병", summary)
                        kind = img_title or ("컬럼 " + kind_word if kind_word else tab_label)
                        if "와인" in kind + tab_label:
                            sub = "wine"
                        elif panel:
                            sub = "built_in"
                        elif combo:  # LG 코드 관례: S… = 양문형 (일반 목록 28/28), 그 밖은 상냉장 4도어
                            sub = "side_by_side" if code.startswith("S") else "french_4door"
                        else:
                            sub = "one_door"
                        panel_code = re.search(r"패널\s*:\s*([A-Z][A-Z0-9 –-]+)", " ".join(d for _, d in img_items))
                        row = {
                            "brand": "LG",
                            "category_subtype": sub,
                            "line": "SIGNATURE Kitchen Suite",
                            "tags": ["SKS"] + ([design] if design else []) + (["패널레디"] if panel else []),
                            "model_name": f"SKS {kind}" + (f" {cap}L" if cap else (f" {bottles}병" if bottles else "")),
                            "model_codes": [code],
                            "width_mm": dims[0] if dims else None,
                            "height_mm": dims[1] if dims else None,
                            "depth_mm": dims[2] if dims else None,
                            "capacity_l": cap,
                            "wine_bottles": bottles,
                            "install_type": "built_in",
                            "panel_ready": panel,
                            "niche_raw": niche_raw,
                            "install_notes": " | ".join(dict.fromkeys(notes))[:900] or None,
                            "product_type_raw": " / ".join(x for x in [
                                kind, design, f"{hinge}경첩" if hinge else None,
                                f"STS 패널 {panel_code.group(1).strip()} 또는 가구 패널" if panel_code else None,
                                "패널레디(가구 패널 부착)" if panel else "도어 일체형(가구 패널 언급 없음)"] if x),
                            "size_raw": size,
                            "source_url": f"{page}#{tab_id}",
                            "page_url": page,
                            "sale_status": None,
                            "collected_at": now_iso(),
                        }
                        row.update(parse_niche(niche_raw))
                        rows.append(row)
    return rows


# --------------------------------------------------------------------------- Liebherr (리페르, 수입사 코스모앤컴퍼니)

LH = "https://www.liebherr.com"
LH_LOCALE = "en-kr"  # 한국 사이트. ko-kr 사이트맵엔 건설장비뿐이다 (가전 /p/ 0개)
# 속성 ID (__NEXT_DATA__ product.attributeGroups[*].attributes[*].attributeId)
LH_A = {"ext_mm": "5739", "ext": "4431", "niche": "4491", "door_mount": "4518", "install": "4582", "hinge": "4524",
        "model_type": "4557", "series": "5998", "net": "4424", "gross": "4626", "gross_wine": "4634",
        "bottles": "4492", "item_no": "4040"}
# 4518 도어 방식 — 통합형은 가구 도어를 붙이는 방식이 둘이다
LH_DOOR = {"festtür": "고정 도어(Festtür)", "fixed door": "고정 도어(Fixed door)",
           "schlepptür": "슬라이딩 도어(Schlepptür)", "sliding door": "슬라이딩 도어(Sliding door)"}


def lh_product(h):
    """제품 페이지 HTML → __NEXT_DATA__ 의 product 객체 (없으면 None)."""
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not m:
        return None
    pm = (json.loads(m.group(1)).get("props") or {}).get("pageProps", {}).get("pageModel") or {}
    for c in (pm.get("components") or {}).get("additionalContent") or []:
        if isinstance(c, dict) and isinstance(c.get("product"), dict):
            return c["product"]
    return None


def lh_attrs(node):
    """node.attributeGroups (하위 children 포함) → {attributeId: (값, 단위)}. 조합 제품의 components 는 따로 부른다."""
    out = {}

    def walk(groups):
        for g in groups or []:
            for a in g.get("attributes") or []:
                if a.get("attributeId") and a.get("formattedValue") not in (None, "", "—"):
                    out.setdefault(str(a["attributeId"]), (str(a["formattedValue"]).strip(), a.get("unitOfMeasurement")))
            walk(g.get("children"))
    walk(node.get("attributeGroups"))
    return out


def lh_mm(s, unit):
    """'185.5' cm · '1,855' mm · '177,2' cm(독일어 소수점) → mm."""
    s = s.strip()
    if unit == "mm":
        s = s.replace(",", "")
    elif "," in s and "." not in s:
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return round(v * (10 if unit == "cm" else 1), 1)


def lh_hwd(value, unit):
    """'185.5 / 59.7 / 67.5' (높이/너비/깊이) → [[h…], [w…], [d…]] mm. 니치는 '177,2 - 178,8 / 56 - 57 / 55,0' 처럼 범위."""
    parts = [p.strip() for p in (value or "").split("/")]
    if len(parts) != 3:
        return None
    out = []
    for p in parts:
        nums = [lh_mm(x, unit) for x in re.split(r"\s+-\s+|\s*–\s*", p) if x.strip()]
        nums = [int(round(n)) if float(n).is_integer() else n for n in nums if n]
        if not nums:
            return None
        out.append(nums)
    return out


def lh_subtype(ptype, mtype, panel, cap, h):
    t = f"{ptype} {mtype}".lower()
    if "side-by-side" in t:
        return "side_by_side"
    if "wine" in t and "freezer" not in t and "combination" not in t:  # 'Wine storage fridge'
        return "wine"
    if panel:
        return "built_in"  # 가구 도어를 붙이는 통합형(Integrierbar)만
    if cap and cap <= 150:
        return "small"
    if "fridge-freezer" in t or "combination" in t or "kühl-gefrier" in t:  # 냉장+냉동(또는 와인칸) 두 문
        return "two_door"
    return "one_door" if (h or 0) >= 1000 else "small"


def lh_household_pages(f):
    """en-kr 사이트맵의 /p/ 중 가정용. 슬러그 끝 숫자(목록 템플릿 ID) 묶음마다 한 쪽만 열어
    hierarchyLevels 2단계가 'Haushalt' · customerSegment 'Consumer' 인 묶음만 남긴다 (업무용 · 의료용 · 건설장비 제외)."""
    st, xml = f.get(f"{LH}/sitemap-{LH_LOCALE}.xml")
    groups = {}
    for u in re.findall(rf"<loc>({re.escape(LH)}/{LH_LOCALE}/p/[^<?]+)</loc>", xml):
        slug = u.rsplit("/p/", 1)[1]
        if re.match(r"[a-z]+-\d{3,4}-", slug):  # 모델 이름 꼴 (srbsdh-5260-…). 숫자뿐인 부품 · 장비 슬러그는 뺀다
            groups.setdefault(slug.rsplit("-", 1)[1], []).append(u)
    out = []
    for gid, urls in groups.items():
        st, h = f.get(urls[0])
        p = lh_product(h) if st == 200 else None
        levels = {lv.get("level"): lv.get("name") for lv in (p or {}).get("hierarchyLevels") or []}
        if not p or levels.get(2) != "Haushalt" or p.get("customerSegment") != "Consumer":
            print(f"  [liebherr] group {gid} ({len(urls)}) skipped: {levels.get(2)} / {(p or {}).get('customerSegment')}",
                  file=sys.stderr)
            continue
        out += urls
    return out


def liebherr_collect(f, sample=None, guides=True):
    """리페르 (Liebherr). 한국 수입 · 판매는 코스모앤컴퍼니. 정본은 liebherr.com/en-kr (한국 마이크로사이트 · 매장 목록이 있는 국가 사이트).
    목록: sitemap-en-kr.xml 의 가정용 /p/ · 치수: 제품 페이지 __NEXT_DATA__ 속성 (외형 4431/5739, 니치 4491,
    도어 방식 4518, 설치 방식 4582). en-kr 가정용은 전부 프리스탠딩이라 니치 · 도어 방식은 비어 있다 (통합형은 KR 공식 0).
    설치 가이드 글은 PDF 뿐 → guides 는 쓰지 않는다."""
    pages = lh_household_pages(f)
    print(f"[liebherr] household product pages={len(pages)}", file=sys.stderr)
    if sample:
        pages = pages[:sample]
    found = {}  # code -> row (경첩 좌 · 우만 다른 같은 모델은 한 행으로 모은다)
    for page in pages:
        st, h = f.get(page)
        p = lh_product(h) if st == 200 else None
        if not p:
            print(f"  [liebherr] no product data {page} (status {st})", file=sys.stderr)
            continue
        if "KR" not in (p.get("countries") or []):
            print(f"  [liebherr] {page}: countries has no KR - skipped", file=sys.stderr)
            continue
        a = lh_attrs(p)
        comps = p.get("components") or []
        ca = [lh_attrs(c) for c in comps]
        name = re.sub(r"\s+", " ", p.get("displayName") or "").strip()
        # productSetName 'SCNsdh 5253_126620' — 밑줄 뒤는 경첩 · 판매 변형 번호 (슬러그에도 있다). 모델 코드는 앞부분만
        code = re.sub(r"_\d+$", "", (p.get("productSetName") or " ".join(name.split()[:2])).strip())
        ext = a.get(LH_A["ext_mm"]) or a.get(LH_A["ext"])
        hwd = lh_hwd(*ext) if ext else None
        dims = (hwd[1][0], hwd[0][0], hwd[2][0]) if hwd else None  # → W, H, D
        nets = [x[LH_A["net"]][0] for x in ca if LH_A["net"] in x] if comps else \
            ([a[LH_A["net"]][0]] if LH_A["net"] in a else [])
        cap_basis = "순용량(Net)"
        if comps and len(nets) != len(comps):  # 조합 중 한 칸이라도 용량이 없으면 합이 틀린다 → 비운다
            cap, cap_basis = None, "없음(구성 칸 용량 누락)"
        elif nets:
            cap = sum(to_num(n) or 0 for n in nets) or None
        else:  # 와인셀러는 순용량이 없다 → 총용량(Gross)
            gv = a.get(LH_A["gross"]) or a.get(LH_A["gross_wine"])
            cap, cap_basis = (to_num(gv[0]), "총용량(Gross)") if gv else (None, "없음")
        bottles = to_num((a.get(LH_A["bottles"]) or ("",))[0])
        mtype = (a.get(LH_A["model_type"]) or ("",))[0]
        ptype = p.get("type") or ""
        install_raw = (a.get(LH_A["install"]) or ("",))[0]
        panel = bool(re.search(r"(?i)integrierbar|integrable|fully integrated|vollintegriert", install_raw))
        door_raw = (a.get(LH_A["door_mount"]) or ("",))[0]
        door = LH_DOOR.get(door_raw.lower(), door_raw) if door_raw else None
        hinges = [x[LH_A["hinge"]][0] for x in ([a] + ca) if LH_A["hinge"] in x]
        niche_v = a.get(LH_A["niche"])
        niche = {}
        if niche_v:
            nh = lh_hwd(*niche_v)
            if nh:
                for axis, vals in zip("hwd", nh):
                    niche[f"niche_min_{axis}_mm"] = vals[0]
                    if len(vals) > 1:
                        niche[f"niche_max_{axis}_mm"] = vals[1]
        if code in found:  # 같은 모델의 경첩 반대 판 (scnsdh-5253-126620 / -126625)
            r = found[code]
            r["_hinges"] += [x for x in hinges if x not in r["_hinges"]]
            r["_item_nos"] += [a[LH_A["item_no"]][0]] if LH_A["item_no"] in a else []
            r["_pages"].append(page)
            continue
        tags = [t for t in ("BioFresh", "NoFrost", "DuoCooling") if t in name]
        if "wine tempering" in f"{ptype} {mtype}".lower():  # 냉동 + 와인칸 조합 (SWNsdh · XRCsdh)
            tags.append("와인칸")
        tags += ["패널레디"] if panel else []
        found[code] = {
            "brand": "Liebherr",
            "category_subtype": lh_subtype(ptype, mtype, panel, cap, dims[1] if dims else None),
            "line": (a.get(LH_A["series"]) or ("",))[0] or next(iter({x[LH_A["series"]][0] for x in ca if LH_A["series"] in x}
                                                                    if len({x.get(LH_A["series"]) for x in ca}) == 1 else []),
                                                                   "일반"),
            "tags": tags,
            "model_name": name,
            "model_codes": [code],
            "width_mm": dims[0] if dims else None,
            "height_mm": dims[1] if dims else None,
            "depth_mm": dims[2] if dims else None,
            "capacity_l": cap,
            "wine_bottles": bottles,
            "install_type": "built_in" if panel else "freestanding",
            "panel_ready": panel,
            "niche_raw": f"H/W/D {niche_v[0]} {niche_v[1] or ''}".strip() if niche_v else None,
            "size_raw": f"H/W/D {ext[0]} {ext[1] or ''}".strip() if ext else None,
            "source_url": page,
            "page_url": page,
            "sale_status": None,
            "collected_at": now_iso(),
            "_ptype": ptype, "_mtype": mtype, "_door": door, "_install": install_raw, "_cap_basis": cap_basis,
            "_comps": [re.sub(r"\s+", " ", c.get("displayName") or "").strip() for c in comps],
            "_hinges": hinges, "_item_nos": [a[LH_A["item_no"]][0]] if LH_A["item_no"] in a else [], "_pages": [page],
        }
        found[code].update(niche)
    rows = []
    for r in found.values():
        r["product_type_raw"] = " / ".join(x for x in [
            r["_ptype"], r["_mtype"] if r["_mtype"] != r["_ptype"] else None,
            f"구성: {' + '.join(r['_comps'])}" if r["_comps"] else None,
            f"도어 방식: {r['_door']}" if r["_door"] else None,
            f"설치: {r['_install']}" if r["_install"] else None,
            f"경첩: {'/'.join(dict.fromkeys(r['_hinges']))}" if r["_hinges"] else None,
            f"용량 {r['_cap_basis']}", f"판매번호 {', '.join(r['_item_nos'])}" if r["_item_nos"] else None] if x)
        rows.append({k: v for k, v in r.items() if not k.startswith("_")})
    return rows


# --------------------------------------------------------------------------- Midea (마이디어)

MD = "https://www.midea.com"


def md_pages(f):
    """/kr/sitemap.xml 의 냉장고 상품 경로 ('…-479l.mdrf648fgf46'). robots.txt 가 쿼리 URL(/*?*)을 막아 경로형만 쓴다.
    (파이썬 robotparser 는 와일드카드를 못 읽으니 '?' 든 URL 은 여기서 직접 뺀다.)"""
    st, xml = f.get(f"{MD}/kr/sitemap.xml")
    out = []
    for u in re.findall(r"<loc>([^<]+)</loc>", xml):
        if "/kr/refrigerator/" in u and "?" not in u and re.search(r"/[^/]+\.[a-z0-9]+$", u) and u not in out:
            out.append(u)
    return out


def md_dims(size):
    """'833x1775x740mm' · '562x595x1778mm' — 페이지마다 순서가 다르다 (W×H×D 와 W×D×H 가 섞여 있다).
    첫 값은 늘 너비, 나머지 둘 중 큰 값이 높이 (마이디어 KR 냉장고는 모두 세워 쓰는 형태)."""
    if not size:
        return None
    nums = [to_num(n) for n in re.findall(r"\d+(?:\.\d+)?", size.replace(",", ""))]
    if len(nums) < 3:
        return None
    w, a, b = nums[:3]
    return w, max(a, b), min(a, b)


def md_subtype(cat, name, cap):
    s = f"{cat} {name}"
    if "양문형" in s:
        return "side_by_side"
    if "4도어" in s or "3도어" in s:  # LG 와 같은 기준 (3·4도어 → french_4door)
        return "french_4door"
    if cap and cap <= 150:
        return "small"
    if "냉동고" in s or "1도어" in s or "스탠드" in s or "스탠딩" in s:  # 글라스도어 스탠딩 냉장고 = 문 하나
        return "one_door"
    return "two_door"


def midea_collect(f, sample=None, guides=True):
    """마이디어 (Midea Korea). 목록: midea.com/kr/sitemap.xml 의 /kr/refrigerator/… 상품 경로 · 치수: 상품 페이지 정적 HTML
    '전체 사양' (spec-label '크기' → '833x1775x740mm'). 모델 코드는 JSON-LD Product.model —
    sku-map 의 skuTitle 은 다른 페이지에서 복사된 값인 경우가 있다 (예: 3도어 233L 페이지 = MDRD86FGO30 미니바 코드).
    설치 여유는 HTML 에 없다 → guides 는 쓰지 않는다."""
    pages = md_pages(f)
    print(f"[midea] refrigerator product pages={len(pages)}", file=sys.stderr)
    if sample:
        pages = pick_sample(pages, lambda u: u.split("/kr/refrigerator/")[1].split("/")[0], sample)
    rows = []
    for page in pages:
        st, h = f.get(page)
        ld = None
        for blk in re.findall(r'(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', h):
            try:
                d = json.loads(blk)
            except ValueError:
                continue
            if isinstance(d, dict) and d.get("@type") == "Product":
                ld = d
                break
        if st != 200 or not ld:
            print(f"  [midea] no Product JSON-LD {page} (status {st})", file=sys.stderr)
            continue
        spec = {}
        for k, v in re.findall(r'<span class="spec-label">([^<]*)</span>\s*<a class="spec-val">([^<]*)</a>', h):
            spec.setdefault(html.unescape(k).strip(), html.unescape(v).strip())
        sm = re.search(r'name="sku-map" value="(.*?)"/>', h, re.S)
        try:
            skus = json.loads(html.unescape(sm.group(1))) if sm else []
        except ValueError:
            skus = []
        sku = skus[0] if skus else {}
        name = re.sub(r"\s+", " ", ld.get("name") or "").strip()
        code = (ld.get("model") or sku.get("skuTitle") or "").strip().upper()
        if sku.get("skuTitle") and sku["skuTitle"].upper() != code:
            print(f"  [midea] {page.rsplit('/', 1)[1]}: JSON-LD model {code} != sku-map {sku['skuTitle']} - JSON-LD kept",
                  file=sys.stderr)
        size = spec.get("크기")
        if not size:  # sku-map 'Color:Capacity:Size' 의 크기 칸
            types = (sku.get("variantsType") or "").split(":")
            vals = (sku.get("variantsName") or "").split(":")
            size = next((v for t, v in zip(types, vals) if t == "Size"), None)
        dims = md_dims(size)
        cap_name = rx(r"(\d+(?:\.\d+)?)\s*L\b", name)
        cap_spec = first_num(spec.get("용량"))
        if cap_name and cap_spec and cap_name != cap_spec:
            print(f"  [midea] {code}: capacity name {cap_name}L != spec {cap_spec}L - name kept", file=sys.stderr)
        cap = cap_name or cap_spec
        cat = spec.get("카테고리") or sku.get("subCategory") or ""
        tags = [t for t in ("레트로", "글라스도어", "인버터", "김치 프레쉬", "저소음", "미니") if t in name]
        row = {
            "brand": "Midea",
            "category_subtype": md_subtype(cat, name, cap),
            "line": "일반",
            "tags": tags,
            "model_name": name,
            "model_codes": [code] if code else [],
            "width_mm": dims[0] if dims else None,
            "height_mm": dims[1] if dims else None,
            "depth_mm": dims[2] if dims else None,
            "capacity_l": cap,
            "wine_bottles": None,
            "install_type": "freestanding",
            "product_type_raw": " / ".join(x for x in [cat, sku.get("subCategory") if sku.get("subCategory") != cat else None,
                                                     spec.get("색상"),
                                                     f"sku-map {sku['skuTitle']}" if sku.get("skuTitle")
                                                     and sku["skuTitle"].upper() != code else None] if x),
            "size_raw": f"크기: {size} (원문 순서 — 첫 값 너비, 큰 값 높이로 읽음)" if size else None,
            "source_url": page,
            "page_url": page,
            "sale_status": ((ld.get("offers") or {}).get("availability") or "").rsplit("/", 1)[-1] or None,
            "collected_at": now_iso(),
        }
        if dims and dims[2] > 900:  # 세워 쓰는 냉장고 깊이로 맞지 않는 값 (양문형 698L '910x1130x1810') — 비우고 원문만 남긴다
            print(f"  [midea] {code}: depth {dims[2]} from '{size}' looks wrong - depth left empty", file=sys.stderr)
            row["depth_mm"] = None
            row["tags"] = tags + ["치수확인필요"]
        rows.append(row)
    return rows


# --------------------------------------------------------------------------- Smeg (스메그, 공식 수입사 제이컬렉션)

SM = "https://www.j-collection.co.kr"
SM_CATS = {"15": "refrigerators", "629": "winecellar"}
# 페이지에 도어 수가 적혀 있지 않은 시리즈. FAB28 은 냉동칸이 안에 든 1도어, FAB30(상냉동) · FAB32(하냉동) 은 2도어
# (스메그 제품군 구성 — FAB32 · 콜로니얼 · 클래식은 KR 페이지에도 '투도어' 가 있다). 목록에 없는 시리즈는 '투도어' 글자로 본다.
SM_DOORS = {"FAB28": 1, "FAB30": 2, "FAB32": 2, "FA8005": 2, "FA3905": 2}


def sm_list(f, cate):
    """카테고리 목록: GET product_list.php?cate= 로 전체 개수(total_row)를 읽고, 'MORE' 버튼이 부르는
    POST product_proc.php (reg_state=list) 로 상품 칸을 받는다. 한 칸 = 색상 하나 = 모델 코드 하나."""
    st, h = f.get(f"{SM}/product/product_list.php?cate={cate}")
    total = to_num(rx(r'var total_row = Number\("(\d+)"\)', h) or 0) or 0
    seqs, page = [], 1
    while page <= 10:
        st, body = f.post_form(f"{SM}/product/product_proc.php",
                               {"reg_state": "list", "cate": cate, "pstyle": "", "pcolor": "", "page": str(page),
                                "page_size": "60", "membership_division": ""},
                               {"Referer": f"{SM}/product/product_list.php?cate={cate}", "Origin": SM})
        new = [int(s) for s in re.findall(r"product_view\.php\?pseq=(\d+)", body)]
        new = [s for s in dict.fromkeys(new) if s not in seqs]
        seqs += new
        if not new or len(seqs) >= total:
            break
        page += 1
    return total, seqs


def sm_gaps(notes):
    """설치 안내 문장 중 숫자가 분명한 여유만 칸으로. 나머지(… 75mm 이하 등)는 install_notes 에만 남긴다."""
    t = " ".join(notes)
    cm = lambda p: (lambda v: int(round(v * 10)) if v is not None else None)(rx(p, t))  # noqa
    return {
        "door_swing_side_mm": cm(r"경첩 방향으로 약 (\d+(?:\.\d+)?) ?cm"),  # 도어를 열기 위한 경첩 쪽 여유
        "top_gap_mm": cm(r"(?:제품 위쪽에|상단) (\d+(?:\.\d+)?) ?cm"),
        "side_gap_mm": cm(r"좌/우 (\d+(?:\.\d+)?) ?cm"),
        "back_gap_mm": cm(r"후면과 벽면 사이에 최소 (\d+(?:\.\d+)?) ?cm"),
    }


def smeg_collect(f, sample=None, guides=True):
    """스메그 (Smeg). 공식 수입사 (주)제이컬렉션 = 스메그코리아 www.j-collection.co.kr (robots.txt 없음 → 허용).
    목록: 냉장고(cate=15) · 와인셀러(cate=629) · 치수: 상세 product_view.php?pseq= 정적 HTML '상품 정보 고시'
    '크기, 용량, 형태' = '(가로x세로x높이)601x728x1530mm' — 순서가 W×D×H 다. 설치 안내 문장(경첩 쪽 여유 등)은 install_notes."""
    items = []
    for cate, cat in SM_CATS.items():
        total, seqs = sm_list(f, cate)
        print(f"[smeg] {cat}: total_row={total} listed={len(seqs)}", file=sys.stderr)
        items += [(cat, s) for s in seqs]
    if sample:
        items = pick_sample(items, lambda it: it[0], sample)
    rows = []
    for cat, seq in items:
        page = f"{SM}/product/product_view.php?pseq={seq}"
        st, h = f.get(page)
        h = re.sub(r"(?s)<!--.*?-->", "", h)  # 위쪽 '사이즈' 칸은 주석 처리돼 있다 — 고시 정보가 정본
        t = re.search(r"<title>\s*스메그\s+(.*?)\s*\|", h)
        notice = {html.unescape(k).strip(): re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", v))).strip()
                  for k, v in re.findall(r'(?s)<li class="pro_info_li">\s*<div class="title">(.*?)</div>\s*'
                                         r'<div class="text">(.*?)</div>', h)}
        if st != 200 or not t or not notice:
            print(f"  [smeg] no title/notice {page} (status {st})", file=sys.stderr)
            continue
        title = re.sub(r"\s+", " ", html.unescape(t.group(1))).strip()
        code = title.split(" ")[-1].upper()
        name = title[:-len(code)].strip()
        nmodel = notice.get("품명 및 모델명") or ""
        if code not in nmodel.upper():
            print(f"  [smeg] {code}: notice model '{nmodel}' differs - title code kept", file=sys.stderr)
        size = next((v for k, v in notice.items() if "크기" in k or "규격" in k), "")
        m = re.search(r"(\d[\d,]*)\s*[xX×]\s*(\d[\d,]*)\s*[xX×]\s*(\d[\d,]*)\s*mm", size)
        dims = None
        if m:
            a, b, c = (to_num(x) for x in m.groups())
            dims = (a, b, c) if "WxHxD" in size.replace(" ", "") else (a, c, b)  # 기본 W×D×H → W, H, D
        cap = rx(r"(\d+(?:\.\d+)?)\s*(?:L|ℓ|리터)", size)
        bottles = rx(r"(\d+)\s*병", title) if cat == "winecellar" else None
        text = html.unescape(re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", h))
        lines = [re.sub(r"\s+", " ", x).strip() for x in re.sub(r"<[^>]+>", "\n", text).split("\n")]
        notes = list(dict.fromkeys(x for x in lines if re.search(r"\d ?(cm|mm)", x) and re.search(r"여유|간격|거리|공간", x)
                                   and len(x) < 200))
        sm_series = re.match(r"(FAB\d+|FA\d{4}|SCV\d+|SMEG\d+)", code)
        series = sm_series.group(1) if sm_series else None
        doors = SM_DOORS.get(series) or (2 if "투도어" in " ".join(lines) else None)
        if cat == "winecellar" or "와인" in name:
            sub = "wine"
        elif cap and cap <= 150:
            sub = "small"
        elif doors == 1:
            sub = "one_door"
        else:
            sub = "two_door"
        line = "50's Style" if (series or "").startswith("FAB") else \
            next((w for w in ("콜로니얼", "클래식") if w in name), "일반")
        row = {
            "brand": "Smeg",
            "category_subtype": sub,
            "line": line,
            "tags": [x for x in [series, "세미빌트인 겸용" if "세미 빌트인" in size else None] if x],
            "model_name": f"스메그 {name}",
            "model_codes": [code],
            "width_mm": dims[0] if dims else None,
            "height_mm": dims[1] if dims else None,
            "depth_mm": dims[2] if dims else None,
            "capacity_l": cap,
            "wine_bottles": bottles,
            "install_type": "freestanding",
            "install_notes": " | ".join(notes)[:900] or None,
            "install_guide_ref": page if notes else None,
            "product_type_raw": " / ".join(x for x in [
                cat, f"{doors}도어" if doors else None, f"출시 {notice.get('동일모델의 출시년월')}"
                if notice.get("동일모델의 출시년월") else None] if x),
            "size_raw": size or None,
            "source_url": page,
            "page_url": page,
            "sale_status": None,
            "collected_at": now_iso(),
        }
        row.update({k: v for k, v in sm_gaps(notes).items() if v is not None})
        rows.append(row)
    return rows


# --------------------------------------------------------------------------- merge / output

GAP_KEYS = ["side_gap_mm", "door_side_gap_mm", "top_gap_mm", "back_gap_mm", "niche_min_w_mm", "niche_min_h_mm",
            "niche_min_d_mm", "niche_max_w_mm", "niche_max_h_mm", "niche_max_d_mm", "niche_recommended_d_mm",
            "niche_raw", "door_open_width_mm", "door_swing_side_mm", "pair_gap_mm",
            "install_guide_title", "install_guide_ref", "install_notes"]
COLS = ["brand", "category_subtype", "line", "tags", "model_name", "model_codes", "width_mm", "height_mm", "depth_mm",
        "capacity_l", "wine_bottles", "install_type", "panel_ready"] + GAP_KEYS + [
           "product_type_raw", "size_raw", "drawing_dims_raw", "source_url", "page_url", "source_urls",
           "sale_status", "collected_at"]


def merge(rows):
    out = {}
    for r in rows:
        if r.get("width_mm") is None:
            key = ("nodims",) + tuple(r["model_codes"])
        else:
            key = (r["brand"], r["category_subtype"], r["line"], r["width_mm"], r["height_mm"], r["depth_mm"],
                   r["capacity_l"], r["install_type"])
        if key not in out:
            r = dict(r)
            r["source_urls"] = [r["source_url"]]
            out[key] = r
        else:
            o = out[key]
            for c in r["model_codes"]:
                if c not in o["model_codes"]:
                    o["model_codes"].append(c)
            o["source_urls"].append(r["source_url"])
            for k in GAP_KEYS:
                if o.get(k) in (None, "") and r.get(k) not in (None, ""):
                    o[k] = r[k]
    return list(out.values())


def write(rows, base):
    with open(base + ".json", "w", encoding="utf-8") as fp:
        json.dump(rows, fp, ensure_ascii=False, indent=1)
    with open(base + ".csv", "w", encoding="utf-8-sig", newline="") as fp:
        w = csv.DictWriter(fp, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            rr = dict(r)
            for k in ("model_codes", "tags", "source_urls"):
                if isinstance(rr.get(k), list):
                    rr[k] = ";".join(str(x) for x in rr[k])
            w.writerow(rr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brands", default="samsung,lg")
    ap.add_argument("--sample", type=int, default=0, help="list items per brand (0 = all)")
    ap.add_argument("--out", default=None, help="output basename (default: sample or fridges)")
    ap.add_argument("--delay", type=float, default=1.2)
    ap.add_argument("--cache", default=os.path.join(HERE, "cache"))
    ap.add_argument("--no-guides", action="store_true")
    ap.add_argument("--offline", action="store_true", help="cache only")
    a = ap.parse_args()
    f = Fetcher(a.cache, a.delay, a.offline)
    rows = []
    brands = [b.strip().lower() for b in a.brands.split(",")]
    if "samsung" in brands:
        rows += samsung_collect(f, a.sample or None, not a.no_guides)
    if "lg" in brands:
        rows += lg_collect(f, a.sample or None, not a.no_guides)
    if "winia" in brands:
        rows += winia_collect(f, a.sample or None, not a.no_guides)
    if "dacor" in brands:
        rows += dacor_collect(f, a.sample or None, not a.no_guides)
    if "sks" in brands:
        rows += sks_collect(f, a.sample or None, not a.no_guides)
    if "liebherr" in brands:
        rows += liebherr_collect(f, a.sample or None, not a.no_guides)
    if "midea" in brands:
        rows += midea_collect(f, a.sample or None, not a.no_guides)
    if "smeg" in brands:
        rows += smeg_collect(f, a.sample or None, not a.no_guides)
    merged = merge(rows)
    base = os.path.join(HERE, a.out or ("sample" if a.sample else "fridges"))
    write(merged, base)
    print(f"variants={len(rows)} merged_rows={len(merged)} net_requests={f.net_count} cache_hits={f.cache_hits}"
          f" -> {base}.json/.csv", file=sys.stderr)


if __name__ == "__main__":
    main()
