# QA Protocol — 에이전트 품질 검증 공통 절차

## 검증 단계

### 1. 문법 검증
- **JavaScript**: `node -c {파일}` (각 파일별)
- **TypeScript**: `cd mcp-server && npx tsc --noEmit`
- **HTML**: 브라우저 로드 에러 없는지 확인

### 2. 빌드 검증
- **Next.js**: `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build`
- **MCP Server**: `cd mcp-server && npm run build`

### 3. 테스트 검증
- **Unit**: `cd mcp-server && npx vitest run`
- **결과**: 전체 PASS 확인

### 4. PR 검증 결과 게시

```
gh pr comment {PR번호} --body "## QA 검증 결과

### 문법 검증
- [x] JavaScript 문법 통과
- [x] TypeScript 타입 통과

### 빌드 검증
- [x] Next.js 빌드 성공
- [x] MCP Server 빌드 성공

### 테스트
- [x] Unit Test 152/152 통과

**결과: ✅ PASS / ❌ FAIL**
"
```

## 실패 시 처리

1. FAIL → PR에 실패 상세 코멘트
2. CRITICAL 오류 → `gh pr review {PR번호} --request-changes --body "{실패 내용}"`
3. 경미한 경고 → 코멘트만 (머지 차단 안 함)

## 검증 범위 (도메인별)

| 도메인 | 필수 검증 |
|--------|----------|
| 3D Planner | tsc --noEmit + Next.js build |
| Image Gen | HTML 문법 + JS 문법 |
| BOM | node -c + vitest (bom 테스트) |
| Design UI | node -c (3파일) |
| Collection | HTML 문법 + JS 문법 |
| MCP Server | tsc --noEmit + vitest run |
