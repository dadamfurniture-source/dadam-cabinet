"""
검토 페이지(사장님) 기록 → owner_review.json (이 PC 에만 — .gitignore). to_sql.py 가 읽어 반영한다.

  python -I owner_sync.py <내려받은 db 폴더> kitchen.json manual/*.json

  <db 폴더> = ArtifactData list … out_dir 로 받은 폴더 (reviews/<id>.json · notes/<id>.json)
  id 는 검토 페이지와 같은 식 — sha1(브랜드 | 모델 코드 | 이름 | 출처)[:16] (to_sql.row_of 기준)

사장님 메모는 자유 글이라 공개 저장소에 올리지 않는다. 기준은 검토 페이지 저장소 — 언제든 다시 받아 만든다.
메모에서 숫자를 칸으로 옮긴 것(set)은 Claude 가 메모를 읽고 손으로 적는다 — 다시 만들어도 그대로 둔다 (같은 제품 키).
"""
import glob
import hashlib
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "owner_review.json")
_spec = importlib.util.spec_from_file_location("kitchen_to_sql", os.path.join(HERE, "to_sql.py"))
T = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(T)


def item_id(row):
    key = (row["brand"] or "") + "|" + ",".join(row["model_codes"]) + "|" + (row["model_name"] or "") + "|" + (row["source_url"] or "")
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def product_key(row):
    """제품 키 — 브랜드 + 첫 모델 코드 (수집을 다시 해도 같다)."""
    return f"{row['brand']}|{row['model_codes'][0] if row['model_codes'] else row['model_name']}"


def main(db_dir, paths):
    raw = []
    for p in paths:
        d = json.load(open(p, encoding="utf-8"))
        raw += d if isinstance(d, list) else d.get("rows", [])
    by_id = {}
    for r in raw:
        row = T.row_of(r)
        by_id[item_id(row)] = row
    prev = {}
    if os.path.exists(OUT):
        for e in json.load(open(OUT, encoding="utf-8")).get("reviews", []):
            prev[e["key"]] = e
    out, missing = {}, []
    for kind in ("reviews", "notes"):
        for f in glob.glob(os.path.join(db_dir, kind, "*.json")):
            i = os.path.splitext(os.path.basename(f))[0]
            doc = json.load(open(f, encoding="utf-8"))
            row = by_id.get(i)
            if not row:
                missing.append((kind, i))
                continue
            k = product_key(row)
            e = out.setdefault(k, {"key": k, "brand": row["brand"], "codes": row["model_codes"], "name": row["model_name"],
                                   "set": (prev.get(k) or {}).get("set", {})})
            if kind == "reviews":
                for fk in ("verdict", "w", "h", "d", "memo", "at"):
                    if doc.get(fk) not in (None, ""):
                        e[fk if fk != "at" else "review_at"] = doc[fk]
            else:
                if doc.get("text"):
                    e["note"] = doc["text"]
                    e["note_at"] = doc.get("at")
    for k, e in prev.items():   # 페이지에서 지워진 기록은 빠진다 — 손으로 적은 set 만 있는 항목은 남긴다
        if k not in out and e.get("set"):
            out[k] = {"key": k, "brand": e["brand"], "codes": e["codes"], "name": e["name"], "set": e["set"]}
    json.dump({"reviews": sorted(out.values(), key=lambda e: e["key"])}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{OUT}: 제품 {len(out)} · 못 찾은 기록 {len(missing)} {missing[:5]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:] or ["kitchen.json"])
