---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

To test local web applications, write native Python Playwright scripts.

**Helper Scripts Available**:
- `scripts/with_server.py` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is abslutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## Example: Using with_server.py

To start a server, run `--help` first, then use the helper:

**Single server:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Multiple servers (e.g., backend + frontend):**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

To create an automation script, include only Playwright logic (servers are managed automatically):
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True) # Always launch chromium in headless mode
    page = browser.new_page()
    page.goto('http://localhost:5173') # Server already running and ready
    page.wait_for_load_state('networkidle') # CRITICAL: Wait for JS to execute
    # ... your automation logic
    browser.close()
```

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors

## Common Pitfall

❌ **Don't** inspect the DOM before waiting for `networkidle` on dynamic apps
✅ **Do** wait for `page.wait_for_load_state('networkidle')` before inspection

## Best Practices

- **Use bundled scripts as black boxes** - To accomplish a task, consider whether one of the scripts available in `scripts/` can help. These scripts handle common, complex workflows reliably without cluttering the context window. Use `--help` to see usage, then invoke directly. 
- Use `sync_playwright()` for synchronous scripts
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits: `page.wait_for_selector()` or `page.wait_for_timeout()`

## Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.py` - Discovering buttons, links, and inputs on a page
  - `static_html_automation.py` - Using file:// URLs for local HTML
  - `console_logging.py` - Capturing console logs during automation

## 다담 저장소에서 쓸 때 (다담가구 추가분)

- 플래너는 정적 HTML 이다. 실제 플래너는 `mockup-shell.html` ·
  `mockup-structure.html` · `js/planner/*` (레거시 `planner-vite/**` 는 보지
  않는다). 저장소 루트에서 정적 서버를 띄워 연다:
  ```bash
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "python3 -m http.server 3050" --port 3050 -- python3 your_check.py
  ```
  스크립트 안에서는 `page.goto('http://localhost:3050/mockup-shell.html')`.
  `file://` 은 모듈 스크립트가 막혀 쓰지 않는다.
- 클라우드 세션에서는 pip 로 깐 Playwright 가 기대하는 브라우저 빌드와
  `/opt/pw-browsers` 에 있는 빌드가 다를 수 있다. `Executable doesn't exist` 가
  나오면
  `p.chromium.launch(headless=True, executable_path='/opt/pw-browsers/chromium')`
  로 연다. `playwright install` 은 돌리지 않는다.
- 클라우드 세션은 프록시 뒤라 CDN(외부 글꼴·라이브러리) 요청이
  `ERR_TUNNEL_CONNECTION_FAILED` 로 실패할 수 있다. 콘솔 오류를 볼 때 이 줄은
  플래너 버그와 구분한다.
- 스크린샷·결과는 저장소 밖(스크래치패드) 이나 `/mnt/project-files/<주제>/` 에
  둔다. 저장소에 커밋하지 않는다.
- 플래너 점검 절차 자체(무엇을 눌러 보고 무엇을 확인할지)는
  `.claude/skills/planner-qa` 가 정본이다. 이 스킬은 브라우저를 띄우고 조작하는
  도구만 준다.
