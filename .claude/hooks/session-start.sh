#!/bin/bash
# 클라우드 세션 시작 시 webapp-testing 스킬이 쓰는 Python Playwright 를 준비한다.
# 브라우저는 /opt/pw-browsers 에 이미 있어 내려받지 않는다.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! python3 -c "import playwright" >/dev/null 2>&1; then
  python3 -m pip install -q playwright >/dev/null 2>&1 || echo "playwright 설치 실패 — webapp-testing 스킬은 수동 설치 후 사용" >&2
fi
