"""
W10-5 corner-autocalc E2E 검증 — detaildesign.html (file://)
설계 문서: docs/02-design/features/corner-autocalc.design.md §8
규칙 원본: docs/design-rules/corner.md §3

detaildesign.html은 Supabase 저장(로컬스토리지 미사용)이므로
page.evaluate로 selectedItems(전역 let, utils.js:1)에 ㄱ자 item을 직접 주입한다.
인증 오버레이는 엔진 함수 호출을 막지 않으므로 우회 불필요.

시나리오:
  T1. 페이지 로드 + 엔진 함수 존재 (deriveCorner/runAutoCalcSection/MaterialExtractor)
  T2. §4.1 확정 검산 — 하부 시드: 멍장 1100(멍700+도어400), 수납 400×2
  T3. 하부 자동계산 → 원장 불변식 ok + secondary 보존
  T4. 상부 시드+자동계산 — 멍장 830(380+450), 원장 1800 성립
  T5. ㅡ자(I) 회귀 — 자동계산 후 secondary/멍장 모듈 0개, 유효공간 = W (마감 None)
  T6. 마이그레이션 멱등성 — migrateCornerModules 2회 → 모듈 수 불변
  T7. BOM 검산 — 멍장 도어 396/446, 멍가림판 700·380, 몰딩(코너1)
  T8. G1 — 라인이 멍보다 짧으면 ㄱ자 전환 거부 + shape 원복 (design §4.4)
"""
import sys
import io
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)

REPO = Path(__file__).resolve().parents[2]
HTML_PATH = REPO / "detaildesign.html"

RESULTS = []
def step(name, passed, detail=""):
    RESULTS.append((name, passed, detail))
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {name}{' :: ' + detail if detail else ''}")

def finish():
    total = len(RESULTS)
    fails = [r for r in RESULTS if not r[1]]
    print(f"\nPASS: {total - len(fails)}/{total} | FAIL: {len(fails)}")
    for name, _, detail in fails:
        print(f"  FAIL: {name} :: {detail}")
    return 0 if not fails else 1

# ㄱ자 테스트 item — __tests__/corner-engine.test.js 픽스처와 동일 수치
L_ITEM = """{
  uniqueId: 9101, categoryId: 'sink', w: 3000, h: 2310, d: 650,
  modules: [ { id: 1, name: '개수대', type: 'sink', pos: 'lower', w: 1000, doorCount: 2, isFixed: true } ],
  specs: {
    lowerLayoutShape: 'L', layoutShape: 'L',
    lowerSecondaryW: '1970', lowerSecondaryD: '650',
    upperLayoutShape: 'L', upperSecondaryW: '1800', upperSecondaryD: '295',
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12,
    secondaryStartSide: 'left', measurementBase: 'Left', dimensionMode: 'unified',
    topSizes: [{ w: '', d: '650' }, { w: '', d: '650' }],
    finishLeftType: 'None', finishRightType: 'None',
    finishCorner1Type: 'Molding', finishCorner1Width: 60,
    effectiveLowerW: null, effectiveUpperW: null,
  },
}"""

I_ITEM = """{
  uniqueId: 9102, categoryId: 'sink', w: 3000, h: 2310, d: 650,
  modules: [ { id: 2, name: '개수대', type: 'sink', pos: 'lower', w: 1000, doorCount: 2, isFixed: true } ],
  specs: {
    lowerLayoutShape: 'I', layoutShape: 'I',
    lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12,
    measurementBase: 'Left', dimensionMode: 'unified',
    topSizes: [{ w: '', d: '650' }],
    finishLeftType: 'None', finishRightType: 'None',
    effectiveLowerW: null, effectiveUpperW: null,
  },
}"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1600, "height": 900})
        page = ctx.new_page()
        page.on("pageerror", lambda err: print(f"[pageerror] {err}"))

        page.goto(HTML_PATH.as_uri())

        # ── T1. 엔진 로드 ──
        try:
            page.wait_for_function(
                "typeof deriveCorner === 'function' && typeof runAutoCalcSection === 'function'"
                " && typeof MaterialExtractor === 'function' && typeof migrateCornerModules === 'function'",
                timeout=10000,
            )
            step("T1 엔진 함수 로드 (deriveCorner/runAutoCalcSection/MaterialExtractor)", True)
        except Exception as e:
            step("T1 엔진 함수 로드", False, str(e)[:120])
            print(finish())
            return 1

        # ── T2. §4.1 확정 검산 — 하부 시드 ──
        r = page.evaluate(f"""(() => {{
            selectedItems = [{L_ITEM}];
            const item = selectedItems[0];
            seedCornerModules(item);
            const blind = item.modules.find(m => m.id === 'corner-blind-lower');
            const seeds = item.modules.filter(m => String(m.id).startsWith('corner-sec-lower-'));
            return {{ w: blind && blind.w, zone: blind && blind.blindZoneW, doorW: blind && blind.doorW,
                     seedCount: seeds.length, seedWs: seeds.map(s => s.w) }};
        }})()""")
        step("T2-a 하부 멍장 W=1100 (멍700+도어400)", r["w"] == 1100 and r["zone"] == 700 and r["doorW"] == 400,
             f"w={r['w']}, zone={r['zone']}, doorW={r['doorW']}")
        step("T2-b 수납 시드 400×2", r["seedCount"] == 2 and r["seedWs"] == [400, 400], f"{r['seedWs']}")

        # ── T3. 하부 자동계산 → 원장 불변식 + secondary 보존 ──
        r = page.evaluate("""(() => {
            const item = selectedItems[0];
            let renderErr = null;
            try { runAutoCalcSection(9101, 'lower'); } catch (e) { renderErr = String(e); }
            const ledger = assertCornerLedger(item, 'lower');
            const secs = item.modules.filter(m => m.pos === 'lower' && (m.line === 'secondary' || m.orientation === 'secondary'));
            const primes = item.modules.filter(m => m.pos === 'lower' && !m.line && !m.orientation);
            const primeLT = primes.filter(m => m.name === 'LT망장');
            return { ok: ledger.ok, diff: ledger.diff, secCount: secs.length,
                     primeCount: primes.length, primeLT: primeLT.length, renderErr };
        })()""")
        step("T3-a 자동계산 후 원장 불변식 성립", r["ok"] is True, f"diff={r['diff']}, renderErr={r['renderErr']}")
        step("T3-b secondary 3개(멍장+수납2) 보존", r["secCount"] == 3, f"sec={r['secCount']}")
        step("T3-c prime LT망장 생성 억제 (멍장 존재 시)", r["primeLT"] == 0,
             f"primeLT={r['primeLT']}, prime={r['primeCount']}")

        # ── T4. 상부 시드 + 자동계산 ──
        r = page.evaluate("""(() => {
            const item = selectedItems[0];
            seedUpperCornerModules(item);
            let renderErr = null;
            try { runAutoCalcSection(9101, 'upper'); } catch (e) { renderErr = String(e); }
            const blind = item.modules.find(m => m.id === 'corner-blind-upper');
            const ledger = assertCornerLedger(item, 'upper');
            return { w: blind && blind.w, zone: blind && blind.blindZoneW, doorW: blind && blind.doorW,
                     ok: ledger.ok, diff: ledger.diff, renderErr };
        })()""")
        step("T4-a 상부 멍장 W=830 (멍380+도어450)", r["w"] == 830 and r["zone"] == 380 and r["doorW"] == 450,
             f"w={r['w']}, zone={r['zone']}, doorW={r['doorW']}")
        step("T4-b 상부 원장 1800 성립", r["ok"] is True, f"diff={r['diff']}, renderErr={r['renderErr']}")

        # ── T5. ㅡ자(I) 회귀 — secondary 오염 없음 + 유효공간 무변경 ──
        r = page.evaluate(f"""(() => {{
            selectedItems = [{I_ITEM}];
            const item = selectedItems[0];
            let renderErr = null;
            try {{ runAutoCalcSection(9102, 'lower'); }} catch (e) {{ renderErr = String(e); }}
            const secs = item.modules.filter(m => m.line === 'secondary' || m.orientation === 'secondary'
                                              || String(m.id).indexOf('corner-') === 0);
            return {{ secCount: secs.length, eff: calcEffectiveSpace(item, 'lower'),
                     modCount: item.modules.filter(m => m.pos === 'lower').length, renderErr }};
        }})()""")
        step("T5-a I 설계: secondary/멍장 모듈 0개", r["secCount"] == 0, f"sec={r['secCount']}")
        step("T5-b I 설계: 유효공간 = W 3000 (코너 차감 없음)", r["eff"] == 3000, f"eff={r['eff']}")
        step("T5-c I 설계: 하부 모듈 생성됨", r["modCount"] > 0, f"count={r['modCount']}, renderErr={r['renderErr']}")

        # ── T6. 마이그레이션 멱등성 ──
        r = page.evaluate(f"""(() => {{
            selectedItems = [{L_ITEM}];
            const item = selectedItems[0];
            migrateCornerModules(item);
            const after1 = item.modules.length;
            migrateCornerModules(item);
            const after2 = item.modules.length;
            const blind = item.modules.find(m => m.id === 'corner-blind-lower');
            return {{ after1, after2, blindW: blind && blind.w }};
        }})()""")
        step("T6 migrateCornerModules 멱등 (2회 호출 모듈 수 불변)", r["after1"] == r["after2"] and r["blindW"] == 1100,
             f"{r['after1']} → {r['after2']}, blindW={r['blindW']}")

        # ── T7. BOM 검산 ──
        r = page.evaluate(f"""(() => {{
            const item = {L_ITEM};
            seedCornerModules(item);
            seedUpperCornerModules(item);
            const mats = new MaterialExtractor().extract({{ items: [item] }}).materials;
            const f = (mod, part) => mats.find(m => m.module === mod && m.part === part);
            const lowerDoor = f('하부장-LT망장', '도어');
            const upperDoor = f('상부장-LT망장', '도어');
            const lowerCover = f('하부장-LT망장', '멍가림판');
            const upperCover = f('상부장-LT망장', '멍가림판');
            const molding = mats.find(m => m.part === '몰딩(코너1)');
            return {{
                lowerDoorW: lowerDoor && lowerDoor.w, upperDoorW: upperDoor && upperDoor.w,
                lowerCoverW: lowerCover && lowerCover.w, upperCoverW: upperCover && upperCover.w,
                coverT: lowerCover && lowerCover.thickness, moldingW: molding && molding.w,
            }};
        }})()""")
        step("T7-a 멍장 도어 396/446 (카카스 W 아님 — 오발주 방지)",
             r["lowerDoorW"] == 396 and r["upperDoorW"] == 446,
             f"lower={r['lowerDoorW']}, upper={r['upperDoorW']}")
        step("T7-b 멍가림판 2.7T 700/380", r["lowerCoverW"] == 700 and r["upperCoverW"] == 380 and r["coverT"] == 2.7,
             f"lower={r['lowerCoverW']}, upper={r['upperCoverW']}, T={r['coverT']}")
        step("T7-c 몰딩(코너1) 60 산출", r["moldingW"] == 60, f"w={r['moldingW']}")

        # ── T8. G1 — 라인 부족 시 ㄱ자 전환 거부 (design §4.4) ──
        page.on("dialog", lambda d: d.dismiss())
        r = page.evaluate(f"""(() => {{
            selectedItems = [{I_ITEM}];
            const item = selectedItems[0];
            item.specs.lowerSecondaryW = '700';  // 700−20−50 = 630 < 멍 700 → doorAvail −70
            item.specs.lowerSecondaryD = '650';
            item.specs.topSizes = [{{ w: '', d: '650' }}, {{ w: '', d: '650' }}];
            let err = null;
            try {{ changeLowerLayoutShape(9102, 'L'); }} catch (e) {{ err = String(e); }}
            return {{
                shape: item.specs.lowerLayoutShape,
                hasBlind: item.modules.some(m => m.id === 'corner-blind-lower'),
                err,
            }};
        }})()""")
        step("T8-a 라인 부족: 전환 거부 (shape 'I' 원복)", r["shape"] == "I", f"shape={r['shape']}, err={r['err']}")
        step("T8-b 라인 부족: 멍장 미생성", r["hasBlind"] is False, f"hasBlind={r['hasBlind']}")

        page.screenshot(path=str(REPO / "tmp" / "e2e" / "w10-5-final.png"))
        browser.close()

    return finish()


if __name__ == "__main__":
    sys.exit(main())
