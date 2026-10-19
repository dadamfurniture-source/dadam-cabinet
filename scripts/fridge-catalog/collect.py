#!/usr/bin/env python3
"""Korean-market refrigerator dimension collector (prototype, stdlib only).

Brands: Samsung (samsung.com/sec), LG (lge.co.kr), Winia (winia.com, opt-in via --brands)
Model list  : manufacturer list APIs (the same JSON the category pages call)
Dimensions  : manufacturer official spec APIs (W x H x D, mm); Winia: static product page spec table
Install gaps: manufacturer installation guides (Samsung buying-guide, LG setup-guide; Winia has none in HTML)

Politeness: robots.txt checked per host, >= --delay seconds between network
requests, one request at a time, every raw response cached under cache/.

Usage:
  python collect.py --sample 10            # ~10 list items per brand, writes sample.json/csv
  python collect.py --out fridges          # full run, writes fridges.json/csv
  python collect.py --brands lg --no-guides --out lg_only
  python collect.py --brands winia --out winia   # default brands stay samsung,lg
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


# --------------------------------------------------------------------------- merge / output

GAP_KEYS = ["side_gap_mm", "door_side_gap_mm", "top_gap_mm", "back_gap_mm", "niche_min_w_mm", "niche_min_h_mm",
            "niche_min_d_mm", "niche_recommended_d_mm", "door_open_width_mm", "door_swing_side_mm", "pair_gap_mm",
            "install_guide_title", "install_guide_ref", "install_notes"]
COLS = ["brand", "category_subtype", "line", "tags", "model_name", "model_codes", "width_mm", "height_mm", "depth_mm",
        "capacity_l", "wine_bottles", "install_type"] + GAP_KEYS + [
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
    merged = merge(rows)
    base = os.path.join(HERE, a.out or ("sample" if a.sample else "fridges"))
    write(merged, base)
    print(f"variants={len(rows)} merged_rows={len(merged)} net_requests={f.net_count} cache_hits={f.cache_hits}"
          f" -> {base}.json/.csv", file=sys.stderr)


if __name__ == "__main__":
    main()
