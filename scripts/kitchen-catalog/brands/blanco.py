"""Blanco (독일) 싱크볼 — 국내 공식 유통사 백조씽크 사이트(baekjosink.com) Brand > Blanco 분류 (2026-10-25).

목록 · 사양 읽기는 baekjo.py 의 site_rows() 를 그대로 쓴다 (같은 사이트 · 같은 칸). 브랜드 이름만 '블랑코'.
자세한 출처 · 정확도는 brands/baekjo.md 의 '수입 브랜드' 절.
"""
import os
import importlib.util

BRAND_KEY = "blanco"
BRAND = "블랑코"


def _shared():
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baekjo.py")
    spec = importlib.util.spec_from_file_location("kitchen_brand_baekjo_shared", here)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def collect(f, K_, sample=None):
    return _shared().site_rows(f, K_, BRAND, sample)
