#!/usr/bin/env python3
"""품목 하나를 사용자처럼 처음부터 BOM 까지 만들어 보고 숫자를 뽑는다.

  품목 ▾ → (빠른 배치 또는 장 버튼) → 구조 단계 → 전체 자동계산 → BOM 산출

먼저 serve.py 를 띄운다 (webapp-testing 의 with_server.py 로 묶어도 된다):

    python3 .claude/skills/planner-qa/scripts/serve.py &
    python3 .claude/skills/planner-qa/scripts/planner_flow.py --category sink --preset L --shots /tmp/qa
    python3 .claude/skills/planner-qa/scripts/planner_flow.py --category shoerack --place tall

출력: 클릭 수, 배치 사각형(섹션 W×D H 회전), BOM 총 부품 수·가구 유형·전체 크기, 본체 표의 측판 줄, 경고.
로그인·Supabase·워커는 이 스크립트가 다루지 않는다 (작업지시서 발행·견적은 서버 키가 필요하다).
"""
import argparse
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'


def route_externals(context):
    """CDN 은 이 컨테이너에서 막혀 있다 — three·supabase-js 는 node_modules 로 돌리고 나머지는 끊는다."""
    def handler(route):
        url = route.request.url
        m = re.search(r'cdn\.jsdelivr\.net/npm/three@[^/]+/(.*)$', url)
        if m:
            return route.fulfill(path=os.path.join(REPO, 'node_modules/three', m.group(1).split('?')[0]),
                                 content_type='application/javascript')
        if 'supabase-js' in url:
            return route.fulfill(path=os.path.join(REPO, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),
                                 content_type='application/javascript')
        if re.search(r'fonts\.(googleapis|gstatic)', url):
            return route.fulfill(status=200, body='')
        return route.abort()
    context.route(re.compile(r'^https?://(?!127\.0\.0\.1)'), handler)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--category', required=True, help='품목 id: sink island wardrobe fridge shoerack vanity storage warehouse tvcabinet door custom')
    ap.add_argument('--preset', choices=['I', 'L', 'U'], help='빠른 배치 모양')
    ap.add_argument('--place', default='', help='장 버튼으로 놓을 섹션들, 쉼표로 (예: lower,upper)')
    ap.add_argument('--base', default='http://127.0.0.1:8765/')
    ap.add_argument('--shots', help='스크린샷 폴더')
    ap.add_argument('--headed', action='store_true')
    args = ap.parse_args()
    if not args.preset and not args.place:
        sys.exit('--preset 또는 --place 중 하나는 있어야 한다')

    clicks = 0
    out = {'category': args.category}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=not args.headed,
                                    args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        context = browser.new_context(viewport={'width': 1600, 'height': 900}, locale='ko-KR')
        route_externals(context)
        page = context.new_page()
        logs = []
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        page.on('dialog', lambda d: d.accept())

        def shot(name):
            if args.shots:
                os.makedirs(args.shots, exist_ok=True)
                page.screenshot(path=os.path.join(args.shots, f'{args.category}-{name}.png'))

        def frame(pat=r'mockup-(shell|structure)'):
            return next(f for f in page.frames if re.search(pat, f.url))

        page.goto(args.base + 'detaildesign.html')
        page.wait_for_timeout(2500)
        # 점검 전용: 로그인 막을 걷는다 (실제 사용자는 로그인한다)
        page.evaluate("() => { try { localStorage.clear(); } catch (e) {} "
                      "document.getElementById('authOverlay')?.classList.add('hidden'); }")

        f = frame()
        f.locator('#catPickerBtn').click(); clicks += 1
        f.locator(f'#catBtn-{args.category}').click(); clicks += 1
        page.wait_for_timeout(2500)
        f = frame()
        if args.preset:
            f.locator(f'.preset-btn[data-preset={args.preset}]').click(); clicks += 1
            page.wait_for_timeout(600)
        for sec in [s for s in args.place.split(',') if s]:
            f.locator(f'.rect-btn[data-section={sec}]').first.click(); clicks += 1
            page.wait_for_timeout(400)
        out['layout'] = f.evaluate(
            "() => { const k = Object.keys(localStorage).find((x) => x.startsWith('dadam_layout_v1'));"
            " return k ? JSON.parse(localStorage.getItem(k)).modules.map((m) => `${m.section} ${m.w}x${m.h} H${m.moduleH} rot${m.rotation}`) : null; }")
        shot('1-plan')

        f.locator('#nextStepBtn').click(); clicks += 1
        page.wait_for_timeout(3500)
        frame(r'mockup-structure').get_by_text('전체 자동계산').first.click(); clicks += 1
        page.wait_for_timeout(2000)
        shot('2-struct')

        page.get_by_text('BOM 산출 →').first.click(); clicks += 1
        page.wait_for_timeout(3500)
        text = page.evaluate('() => document.body.innerText')

        def pick(rx):
            m = re.search(rx, text)
            return m.group(1) if m else None
        out['bom'] = {
            'parts': pick(r'총 부품 수:\s*(\d+)'),
            'type': pick(r'가구 유형:\s*(\S+)'),
            'size': pick(r'전체 크기:\s*([\d ×]+)'),
            'alerts': re.findall(r'(⚠[^\n]*)', text)[:10],
        }
        page.get_by_role('button', name='🪵 본체').click()
        page.wait_for_timeout(400)
        body = page.evaluate('() => document.body.innerText')
        out['sideRows'] = [l for l in body.split('\n') if '\t측판\t' in l][:4]
        shot('3-bom')
        out['clicks'] = clicks
        out['pageErrors'] = logs[:10]
        browser.close()
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
