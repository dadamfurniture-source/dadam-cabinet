"""Reginox (네덜란드) 싱크볼 — 국내 정식 수입사 리젠스 사이트(lizens.co.kr) 싱크볼 > Reginox 분류 (2026-10-25).

목록 · 사양 읽기는 lizens.py 의 site_rows() 를 그대로 쓴다 (같은 사이트 · 같은 규격표). 브랜드 이름만 '레지녹스'.
자세한 출처 · 정확도는 brands/lizens.md 의 '수입 브랜드' 절.
"""
import importlib.util
import os

BRAND_KEY = "reginox"
BRAND = "레지녹스"


def _shared():
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lizens.py")
    spec = importlib.util.spec_from_file_location("kitchen_brand_lizens_shared", here)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def collect(f, K_, sample=None):
    return _shared().site_rows(f, K_, BRAND, sample)
