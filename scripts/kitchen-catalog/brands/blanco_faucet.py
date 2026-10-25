"""Blanco (독일) 주방 수전 — 국내 공식 유통사 백조씽크 사이트(baekjosink.com) 'Brand > Blanco' + '수전' 분류 (2026-10-25).

목록 · 사양 · 도면 판독값은 baekjo_faucet.py 의 faucet_rows() 를 그대로 쓴다 (같은 사이트 · 같은 칸). 브랜드 이름만 '블랑코'.
도면은 Blanco 원 도면(바닥 ø · 토수 길이 · 높이)이라 W 는 바닥 지름이다. 자세한 것은 brands/blanco_faucet.md.
"""
import os
import importlib.util

BRAND_KEY = "blanco_faucet"
BRAND = "블랑코"


def _shared():
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "baekjo_faucet.py")
    spec = importlib.util.spec_from_file_location("kitchen_brand_baekjo_faucet_shared", here)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def collect(f, K_, sample=None):
    return _shared().faucet_rows(f, K_, BRAND, sample)
