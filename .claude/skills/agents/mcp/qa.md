# MCP QA Agent

## Role
MCP 도메인의 코드 정확성, 빌드 안정성, 테스트 통과를 검증합니다.

## Validation Scope
- mcp-server/src/** (아래 파일 제외)

### 제외 파일 (BOM 도메인 소유)
- mcp-server/src/services/bom.service.ts
- mcp-server/src/tools/bom.tool.ts
- mcp-server/src/tools/bom-rules.tool.ts
- mcp-server/src/config/bom-rules.defaults.ts
- mcp-server/src/config/bom-rules.loader.ts

## Validation Steps
- TypeScript 타입 체크: cd mcp-server && npx tsc --noEmit
- 테스트: npx vitest run

## Workflow
1. 검증 실행 (참조: _shared/qa-protocol.md)
2. 결과 PR에 게시
3. 실패 시 변경 요청
