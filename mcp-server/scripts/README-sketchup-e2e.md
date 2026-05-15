# SketchUp E2E 빌드 검증 가이드

`scripts/e2e-sketchup-build.mjs` 는 **실제 SketchUp + mhyrr/sketchup-mcp 확장**과 종단 통신하여 `CabinetPart → SketchUp 컴포넌트` 빌드 파이프라인이 정상 동작하는지 확인하는 수동 실행 스크립트입니다.

## 언제 사용하나

- W1~W3 의 통합 변경 후 디자이너 PC 에서 실 환경 검증
- mhyrr 프로토콜 변경 가능성 의심될 때
- 새 가구 카테고리 / 머티리얼 톤 추가 시
- `/api/sketchup/build` HTTP 라우트 prod 배포 직전 smoke test

## 환경 가드 (CI 우회)

스크립트는 `SKETCHUP_E2E=1` 환경변수가 설정된 경우에만 실행됩니다.
설정 없이 호출하면 즉시 종료 (exit 0) — CI/일반 환경에서는 항상 skip 되도록.

## 사전 조건

1. **SketchUp 데스크탑** 기동 (Windows / macOS)
2. **mhyrr/sketchup-mcp Ruby 확장** 설치 및 활성화
   - 기본 listen: `127.0.0.1:9876`
   - GitHub: <https://github.com/mhyrr/sketchup-mcp>
3. **mcp-server 빌드**
   ```bash
   cd mcp-server
   npm run build
   ```

## 실행

### 전체 카테고리 (sink → wardrobe → fridge)

```bash
SKETCHUP_E2E=1 node scripts/e2e-sketchup-build.mjs
```

### 단일 카테고리

```bash
SKETCHUP_E2E=1 node scripts/e2e-sketchup-build.mjs --category sink
SKETCHUP_E2E=1 node scripts/e2e-sketchup-build.mjs --category wardrobe
SKETCHUP_E2E=1 node scripts/e2e-sketchup-build.mjs --category fridge
```

### 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--category` | `all` | `sink` / `wardrobe` / `fridge` / `all` / 콤마 구분 다중 |
| `--host` | `127.0.0.1` | mhyrr 호스트 |
| `--port` | `9876` | mhyrr 포트 |
| `--clear` | (off) | 빌드 전 `active_entities.clear!` |
| `--keep` | (기본) | 기존 씬 유지 |
| `--no-transactional` | (off) | `START_OP`/`COMMIT_OP` 미사용 (디버깅) |

## 출력 예 (정상)

```
───────────────────────────────────────────────────
 SketchUp E2E build
───────────────────────────────────────────────────
 host: 127.0.0.1:9876
 category: all
 clearExisting: false  transactional: true

▶ ping mhyrr/sketchup-mcp
  ✓ pong (result: ...)

▶ [sink] build start — 5 parts
  plan: 7 commands, 5 components
  ✓ sent=7  success=7  failures=0  aborted=false  avgRtt=42ms  elapsed=320ms

▶ [wardrobe] build start — 6 parts
  plan: 8 commands, 6 components
  ✓ sent=8  success=8  failures=0  aborted=false  avgRtt=38ms  elapsed=340ms

▶ [fridge] build start — 3 parts
  plan: 5 commands, 3 components
  ✓ sent=5  success=5  failures=0  aborted=false  avgRtt=44ms  elapsed=240ms

───────────────────────────────────────────────────
 ✓ E2E complete
───────────────────────────────────────────────────
```

## SketchUp 측 검증 (수동)

빌드 후 SketchUp Outliner 에서 다음 컴포넌트 이름들이 보여야 합니다:

- sink: `dadam.sink.sink-l-body`, `dadam.sink.sink-c-body`, `dadam.sink.sink-r-body`, `dadam.sink.sink-l-door`, `dadam.sink.sink-r-door`
- wardrobe: `dadam.wardrobe.wd-l-body` 외 5개
- fridge: `dadam.fridge.fr-tower`, `dadam.fridge.fr-top-shelf`, `dadam.fridge.fr-door`

도어는 본체 z+ 방향(앞)에 배치, 머티리얼은 `dadam_{tone}_{colorKey}` 이름 (예: `dadam_cream_body`).

`Ctrl+Z` 한 번으로 전체 빌드가 롤백되어야 합니다 (transactional 모드).

## 종료 코드

| 코드 | 의미 |
|------|------|
| `0` | 모든 카테고리 빌드 성공 또는 SKETCHUP_E2E 미설정 (skip) |
| `1` | 1개 이상 카테고리에서 빌드 실패 (요약 출력 참조) |
| `2` | mhyrr ping 실패 (디자이너 PC 환경 점검 필요) |

## 트러블슈팅

| 증상 | 원인 / 조치 |
|------|-------------|
| `bridge unavailable: ECONNREFUSED` | SketchUp/mhyrr 확장이 안 떠 있음. SketchUp Extension Manager 확인. |
| `bridge timeout after 15000ms` | mhyrr 가 응답 안 함. SketchUp Ruby 콘솔 확인. |
| `aborted=true` | 빌드 도중 실패 — `failures[]` 메시지 확인 (중복 이름, 좌표 NaN 등) |
| `Invalid JSON line from SketchUp bridge` | mhyrr 프로토콜 변경 가능성 — bridge 파서 점검 |

## 관련 코드

- 변환 코어: `mcp-server/src/services/sketchup-builder.service.ts`
- TCP 브릿지: `mcp-server/src/services/sketchup-mcp-bridge.service.ts`
- 상수 (좌표/단위/머티리얼/mhyrr 프로토콜): `mcp-server/src/constants/sketchup.ts`
- HTTP 라우트: `mcp-server/src/routes/sketchup.route.ts`
- MCP 도구: `mcp-server/src/tools/sketchup-build.tool.ts`
