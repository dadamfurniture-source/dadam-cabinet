# 다담AI 가구 설계 스킬

이 스킬은 방 사진을 분석하여 맞춤형 AI 가구 이미지를 생성합니다.

## 사용 가능한 MCP 도구

이 스킬은 `dadam` MCP 서버의 다음 도구들을 사용합니다:

1. **supabase_rag_search** - 설계 규칙 검색
2. **gemini_wall_analysis** - 벽 구조 분석
3. **gemini_generate_image** - AI 이미지 생성

## 워크플로우

### 1. 방 사진 기반 AI 설계 (Room to Design)

사용자가 방 사진과 함께 가구 설계를 요청하면:

```
1. 입력 파싱
   - category: sink(싱크대), wardrobe(붙박이장), fridge(냉장고장) 등
   - style: 스타일 및 자재 정보
   - room_image: Base64 이미지

2. RAG 검색 (supabase_rag_search)
   - 카테고리별 설계 규칙 검색
   - 트리거: ['상부장', '하부장', '도어규격', ...]
   - 결과: 배경, 모듈, 도어, 자재 규칙

3. 벽 분석 (gemini_wall_analysis)
   - 타일 기반 벽 치수 계산
   - 유틸리티 위치 감지:
     - water_supply: 급수 분배기 → 싱크대 위치
     - exhaust_duct: 배기 덕트 → 가스대/후드 위치
     - gas_line: 가스 배관

4. 프롬프트 조립
   - 벽 측정 섹션
   - 유틸리티 배치 섹션
   - 스타일 섹션
   - 자재 색상 섹션
   - 배경/모듈/도어 규칙

5. 닫힌 도어 이미지 생성 (gemini_generate_image)
   - 참조 이미지: 원본 방 사진
   - 프롬프트: 조립된 닫힌 도어 프롬프트

6. 열린 도어 이미지 생성 (gemini_generate_image)
   - 참조 이미지: 닫힌 도어 이미지
   - 프롬프트: 열린 도어 프롬프트 (카테고리별 내용물 포함)

7. 응답 반환
   - closed: 닫힌 도어 이미지 (Base64)
   - open: 열린 도어 이미지 (Base64)
```

## 카테고리

| 카테고리 | 설명 | 트리거 예시 |
|---------|------|------------|
| sink | 싱크대/주방가구 | 상부장, 하부장, 도어규격 |
| wardrobe | 붙박이장 | 붙박이장, 좌대, 서랍 |
| fridge | 냉장고장 | 냉장고장, EL장, 홈카페 |
| vanity | 화장대 | 화장대, 거울, 조명 |
| shoe | 신발장 | 신발장, 환기구 |
| storage | 수납장 | 수납장, 선반 |

## 자재코드 패턴

지원하는 자재코드 형식:
- YPG-xxx: Prestige Glass
- SM-xxx: Supreme PET Matt
- SG-xxx: Supreme PET Glossy
- PW-xxx: Supreme PP Wood
- 등 19개 패턴

## 색상 키워드

지원하는 색상:
- 한글: 화이트, 그레이, 블랙, 오크, 월넛 등
- 영문: white, gray, oak, walnut 등

## 사용 예시

### 예시 1: 싱크대 설계

```
사용자: 이 주방 사진으로 모던한 화이트 싱크대 설계해줘
[사진 첨부]

응답:
1. supabase_rag_search 호출
   - triggers: ["상부장", "하부장", "도어규격", "화이트", "모던"]
   - category: "sink"

2. gemini_wall_analysis 호출
   - 벽 치수 분석
   - 급수/배기 위치 감지

3. gemini_generate_image 호출 (닫힌 도어)
4. gemini_generate_image 호출 (열린 도어)

[생성된 이미지 반환]
```

### 예시 2: 붙박이장 설계

```
사용자: 침실 사진이야. 오크 무광 붙박이장 만들어줘
[사진 첨부]

응답:
1. supabase_rag_search 호출
   - triggers: ["붙박이장", "좌대", "서랍", "오크", "무광"]
   - category: "wardrobe"

2. gemini_wall_analysis 호출
3. gemini_generate_image 호출 (닫힌 도어)
4. gemini_generate_image 호출 (열린 도어 - 옷 수납)

[생성된 이미지 반환]
```

## 프롬프트 구조

### 닫힌 도어 프롬프트

```
[TASK: KOREAN BUILT-IN KITCHEN RENDERING - PHOTOREALISTIC]

[WALL MEASUREMENTS]
- 벽 너비/높이 (타일 분석 기반)

[UTILITY-BASED FURNITURE PLACEMENT]
- 급수 위치 → 싱크대
- 배기 위치 → 가스대/후드

[STYLE: Modern Minimal Korean Kitchen]
- 색상, 마감, 핸들 타입

[MATERIAL COLOR SPECIFICATION]
- RAG에서 가져온 자재 정보

[BACKGROUND/MODULE/DOOR RULES]
- RAG 규칙 적용

[CRITICAL REQUIREMENTS]
- 포토리얼리스틱, 카메라 앵글 유지, 도어 닫힘
```

### 열린 도어 프롬프트

```
[TASK: 도어 열기]

[절대 변경 금지]
- 도어 개수, 위치, 크기, 색상

[변경할 것]
- 여닫이 도어: 90도 열림
- 서랍: 30-40% 당김

[내부 수납물]
- 카테고리별 적절한 내용물
```

## 에러 처리

- API 호출 실패 시 기본값 사용
- 이미지 생성 실패 시 텍스트 응답 반환
- 벽 분석 실패 시 기본 치수(3000x2400mm) 사용

## 참고 파일

- `utils/parse-input.ts` - 입력 파싱 및 트리거 생성
- `utils/color-map.ts` - 색상/자재 매핑
- `prompts/prompt-builder.ts` - 프롬프트 빌더
