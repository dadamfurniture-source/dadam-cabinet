#!/bin/bash
# 다담 CAD 베타 — 클라우드 환경 셋업 스크립트
# 클라우드 환경 "dadam-cad" 의 Setup script 칸에 이 파일 내용을 그대로 붙여넣는다 (README 2단계).
#
# 클라우드 스레드는 Ubuntu 24.04 에서 root 로 이 스크립트를 먼저 돌린다 (Claude Code 가 뜨기 전).
#   - 0 으로 끝나야 스레드가 시작된다 → 꼭 필요하지 않은 단계는 모두 실패해도 넘어간다
#   - 약 5분 안에 끝나야 캐시된다 (캐시는 약 7일)
# 네트워크: Custom + "Also include default list of common package managers" 체크, 추가 도메인 `*.astral.sh`
#   (nodejs.org · registry.npmjs.org · pypi.org · files.pythonhosted.org · github.com 은 기본 목록에 있다)
set -uo pipefail

log() { echo "[dadam-setup] $*"; }

# 1) Node 24 — CI(.github/workflows/ci.yml NODE_VERSION '24')와 같게. 이미지는 node 22 가 기본이다.
#    /opt/node24 에 풀어 두고, 스레드는 `export PATH=/opt/node24/bin:$PATH` 로 쓴다 (프로젝트 지침).
if [ ! -x /opt/node24/bin/node ]; then
  V=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | grep -o 'node-v24[0-9.]*-linux-x64.tar.xz' | head -1)
  { [ -n "$V" ] && mkdir -p /opt/node24 && curl -fsSL "https://nodejs.org/dist/latest-v24.x/$V" | tar -xJ -C /opt/node24 --strip-components=1; } \
    || log "node 24 설치 실패 — 기본 node 로 계속"
fi
/opt/node24/bin/node -v 2>/dev/null || node -v || true

# 2) uv + Python 3.13 + build123d — CAD 검산기용. 실패해도 웹 작업은 된다
if ! command -v uv >/dev/null 2>&1; then
  log "uv 설치"
  (curl -LsSf https://astral.sh/uv/install.sh | sh) || log "uv 설치 실패"
  export PATH="$HOME/.local/bin:$PATH"
fi
if command -v uv >/dev/null 2>&1; then
  uv python install 3.13 || log "python 3.13 설치 실패"
  # build123d·OCP 미리 받아 캐시 (약 300MB). 시간 안에 못 끝나면 스레드가 처음 쓸 때 받는다
  timeout 150 uv run --no-project --python 3.13 \
    --with build123d==0.11.1 --with cadquery-ocp-novtk==7.9.3.1.1 \
    python -c "import build123d; print('build123d', build123d.__version__)" || log "build123d 미리 받기 생략"
fi

# 3) npm 캐시 데우기 — 작업 폴더가 저장소일 때만. 스레드는 `npm ci --prefer-offline` 으로 다시 깐다
if [ -f package-lock.json ] && grep -q '"dadam' package.json 2>/dev/null; then
  log "npm 캐시 데우기 (루트)"
  PATH="/opt/node24/bin:$PATH" npm ci --no-audit --no-fund || log "루트 npm ci 실패 — 스레드에서 다시"
else
  log "저장소 폴더가 아님 ($(pwd)) — npm 은 스레드가 깐다"
fi

log "완료"
exit 0
