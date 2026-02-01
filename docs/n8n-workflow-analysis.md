# 다담AI n8n 워크플로우 분석 보고서

> 작성일: 2026-02-01
> 목적: n8n → Claude Code 스킬/MCP 전환을 위한 기존 워크플로우 분석

---

## 1. 워크플로우 개요

### 1.1 파일 목록

| 파일명 | 용도 |
|--------|------|
| `Dadam Design Data v1 (Fast Generation).json` | 방 사진 기반 AI 가구 렌더링 |
| `Dadam Interior v5 (Wall Analysis).json` | 벽 분석 및 유틸리티 감지 |

### 1.2 웹훅 엔드포인트

| 경로 | 메서드 | 용도 |
|------|--------|------|
| `/webhook/dadam-interior-v4` | POST | 방 사진 → AI 설계 이미지 |
| `/webhook/design-to-image` | POST | 설계 데이터 → AI 이미지 |

---

## 2. 주요 파이프라인 흐름

### 2.1 방 사진 기반 AI 설계 (dadam-interior-v4)

```
입력 (방 사진)
    ↓
[Parse Input] - 카테고리/자재코드/색상 파싱
    ↓
[Supabase RAG Search] - 설계 규칙 검색 (25개)
    ↓
[Wall Analysis] - 타일 기반 벽 치수 계산
    ↓
[Gemini Wall Vision] - 벽 구조 분석 (gemini-2.0-flash)
    ↓
[Parse Wall Data] - 분석 결과 JSON 파싱
    ↓
[Build Prompts] - 최종 프롬프트 조립
    ↓
[Gemini Closed Door] - 닫힌 도어 이미지 생성 (gemini-3-pro-image-preview)
    ↓
[Gemini Open Door] - 열린 도어 이미지 생성 (gemini-3-pro-image-preview)
    ↓
[Format Response] - 최종 JSON 응답
```

### 2.2 설계 데이터 기반 이미지 생성 (design-to-image)

```
입력 (설계 데이터)
    ↓
[Parse Design Data] - cabinet_specs 추출
    ↓
[Has Valid Data?] - 유효성 검사
    ↓
[Gemini Image Generation] - 이미지 생성 (gemini-2.0-flash-exp-image)
    ↓
[Format Response] - 최종 JSON 응답
```

---

## 3. 노드별 상세 분석

### 3.1 Parse Input (입력 파싱)

**기능:**
- 카테고리 분류: `sink` | `wardrobe` | `fridge`
- 자재코드 감지: 정규식 패턴 매칭
- 색상 키워드 추출: 한글/영문

**자재코드 패턴:**
```javascript
const materialPatterns = [
  /YPG-\d+/gi,  // Prestige Glass
  /YPA-\d+/gi,  // Prestige Acryl
  /SM-\d+/gi,   // Supreme PET Matt
  /SG-\d+/gi,   // Supreme PET Glossy
  /CP-\d+/gi,   // Supreme PP Calacatta
  /PW-\d+/gi,   // Supreme PP Wood
  // ... 19개 패턴
];
```

**RAG 트리거 맵:**
```javascript
const triggerMap = {
  sink: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  wardrobe: ['붙박이장', '좌대', '상몰딩', '짧은옷', '긴옷', '서랍', '스마트바', '배경보정', '벽면마감'],
  fridge: ['냉장고장', '상부장', 'EL장', '홈카페', '배경보정', '벽면마감', '천장마감', '바닥마감']
};
```

### 3.2 Supabase RAG Search

**RPC 호출:**
```javascript
POST https://vvqrvgcgnlfpiqqndsve.supabase.co/rest/v1/rpc/quick_trigger_search
Headers:
  - apikey: <Supabase Anon Key>
  - Content-Type: application/json

Body:
{
  "query_triggers": ["상부장", "하부장", ...],
  "filter_category": "sink",
  "limit_count": 25
}
```

**반환 데이터 분류:**
- `background`: 배경 처리 규칙
- `module`: 모듈 구성 규칙
- `door`: 도어 사양
- `material`: 자재 정보
- `material_keyword`: 자재 키워드

### 3.3 Wall Analysis (벽 분석)

**타일 규격 참조:**
```javascript
const tileReference = {
  subway_small: { width: 75, height: 150 },
  subway_medium: { width: 100, height: 200 },
  subway_large: { width: 100, height: 300 },
  standard_wall: { width: 300, height: 600 },  // 한국 주방 표준
  large_wall: { width: 400, height: 800 },
  porcelain_large: { width: 600, height: 1200 },
  porcelain_xl: { width: 800, height: 1600 }
};
```

**유틸리티 감지 (v11 Enhanced):**
- 급수 분배기 (water_supply): 빨간/파란 배관, 밸브
- 배기 덕트 (exhaust_duct): 알루미늄 덕트, 벽 구멍
- 가스 배관 (gas_line): 노란색 파이프

**Vision API 프롬프트 핵심:**
```
[STEP 1: TILE MEASUREMENT]
- 타일 타입 식별
- 수평/수직 개수 카운트
- 벽 치수 계산

[STEP 2: UTILITY DETECTION]
- EXHAUST DUCT → 후드/가스대 위치
- WATER SUPPLY → 싱크대 위치
- GAS LINE → 가스 연결점

[STEP 3: FURNITURE PLACEMENT LOGIC]
- 싱크대 = 급수 위치 중앙
- 가스대 = 배기 덕트 위치 중앙
```

### 3.4 Build Prompts (프롬프트 조립)

**프롬프트 구성 섹션:**

1. **WALL MEASUREMENTS**
   - 벽 너비/높이 (mm)
   - 타일 타입/크기
   - 분석 신뢰도

2. **UTILITY-BASED FURNITURE PLACEMENT**
   - 급수 위치 → 싱크대
   - 배기 위치 → 가스대 + 후드
   - 레이아웃 방향 결정

3. **STYLE (Modern Minimal Korean Kitchen)**
   - 색상: White, Gray, Wood
   - 마감: Matte/Low-gloss
   - 핸들: 푸시오픈, J핸들, 스마트바

4. **MATERIAL COLOR SPECIFICATION**
   - RAG에서 가져온 자재 정보
   - HEX 코드, 마감 타입

5. **BACKGROUND CORRECTION RULES**
   - 시공 현장 요소 제거
   - 벽/천장 완성 처리

6. **MODULE CONSTRUCTION RULES**
   - 상부장: 300-350mm 깊이, 700-900mm 높이
   - 하부장: 550-600mm 깊이, 850-900mm 높이

7. **DOOR SPECIFICATIONS**
   - 모든 도어 닫힘 상태
   - 히든 힌지
   - 일관된 크기

8. **APPLIANCE RENDERING**
   - 싱크대: 스테인리스 언더마운트
   - 가스대: 빌트인
   - 후드: 슬림 레인지후드

### 3.5 Gemini API 호출

**사용 모델:**

| 용도 | 모델 | 타임아웃 |
|------|------|----------|
| 벽 분석 | gemini-2.0-flash | 60초 |
| 닫힌 도어 이미지 | gemini-3-pro-image-preview | 120초 |
| 열린 도어 이미지 | gemini-3-pro-image-preview | 120초 |
| 설계→이미지 | gemini-2.0-flash-exp-image | 120초 |

**요청 형식:**
```javascript
{
  contents: [{
    parts: [
      { inline_data: { mime_type: "image/jpeg", data: base64Image }},
      { text: prompt }
    ]
  }],
  generationConfig: {
    responseModalities: ["image", "text"],
    temperature: 0.4
  }
}
```

### 3.6 Parse Design Data (설계 데이터 파싱)

**입력 스키마:**
```javascript
{
  "design_data": { ... },
  "items": [{ w, h, d, ... }],
  "cabinet_specs": {
    "total_width_mm": 3000,
    "total_height_mm": 2400,
    "depth_mm": 600,
    "upper_cabinet_height": 720,
    "lower_cabinet_height": 870,
    "leg_height": 150,
    "molding_height": 60,
    "countertop_thickness": 20,
    "door_color_upper": "화이트",
    "door_color_lower": "오크",
    "door_finish_upper": "무광",
    "door_finish_lower": "무광",
    "handle_type": "푸시오픈",
    "sink_type": "언더마운트",
    "sink_position_mm": 800,
    "cooktop_type": "인덕션",
    "cooktop_position_mm": 2200,
    "hood_type": "슬림후드"
  },
  "modules": {
    "upper": [{ width_mm, door_count, ... }],
    "lower": [{ width_mm, is_drawer, has_sink, ... }]
  }
}
```

**색상 매핑:**
```javascript
const colorMap = {
  '화이트': 'pure white (#FFFFFF)',
  '그레이': 'warm gray (#9E9E9E)',
  '블랙': 'matte black (#2D2D2D)',
  '오크': 'natural oak wood grain',
  '월넛': 'dark walnut wood grain'
};
```

---

## 4. 외부 서비스 연동

### 4.1 API 엔드포인트

| 서비스 | URL | 용도 |
|--------|-----|------|
| Supabase | vvqrvgcgnlfpiqqndsve.supabase.co | RAG 검색, 데이터 저장 |
| Gemini | generativelanguage.googleapis.com | Vision 분석, 이미지 생성 |
| n8n Cloud | dadam.app.n8n.cloud | 워크플로우 호스팅 |

### 4.2 인증

- **Supabase**: Anon Key (JWT)
- **Gemini**: API Key (쿼리 파라미터)

---

## 5. 응답 형식

### 5.1 성공 응답 (Both Images)

```javascript
{
  "success": true,
  "message": "이미지 생성 완료",
  "category": "sink",
  "style": "modern",
  "rag_rules_count": 12,
  "generated_image": {
    "closed": {
      "base64": "iVBORw0KGgo...",
      "mime_type": "image/png"
    },
    "open": {
      "base64": "iVBORw0KGgo...",
      "mime_type": "image/png"
    }
  }
}
```

### 5.2 성공 응답 (Closed Only)

```javascript
{
  "success": true,
  "message": "이미지 생성 완료 (닫힌 도어만)",
  "category": "sink",
  "style": "modern",
  "rag_rules_count": 12,
  "generated_image": {
    "closed": {
      "base64": "...",
      "mime_type": "image/png"
    },
    "open": null
  }
}
```

---

## 6. MCP/Claude Code 전환 매핑

### 6.1 노드 → 스킬/도구 매핑

| n8n 노드 | Claude Code 대체 |
|----------|------------------|
| Webhook | MCP Server HTTP 엔드포인트 |
| Code (JavaScript) | TypeScript 스킬 함수 |
| HTTP Request (Supabase) | MCP Tool: `supabase_rpc` |
| HTTP Request (Gemini) | MCP Tool: `gemini_vision`, `gemini_image` |
| If/Switch | 스킬 내 조건 분기 |
| Respond to Webhook | MCP 응답 반환 |

### 6.2 제안 MCP 구조

```
dadam-mcp-server/
├── src/
│   ├── index.ts              # MCP 서버 진입점
│   ├── tools/
│   │   ├── supabase-rag.ts   # RAG 검색 도구
│   │   ├── gemini-vision.ts  # 벽 분석 도구
│   │   └── gemini-image.ts   # 이미지 생성 도구
│   ├── prompts/
│   │   ├── wall-analysis.ts  # 벽 분석 프롬프트
│   │   └── furniture.ts      # 가구 렌더링 프롬프트
│   └── utils/
│       ├── parse-input.ts    # 입력 파싱
│       ├── material-codes.ts # 자재코드 감지
│       └── color-map.ts      # 색상 매핑
├── package.json
└── tsconfig.json
```

### 6.3 스킬 구조

```
.claude/skills/
├── dadam-design/
│   ├── skill.json           # 스킬 메타데이터
│   ├── index.ts             # 메인 진입점
│   ├── parse-input.ts       # 입력 파싱
│   ├── rag-search.ts        # Supabase RAG
│   ├── wall-analysis.ts     # 벽 분석
│   ├── build-prompts.ts     # 프롬프트 조립
│   └── generate-image.ts    # 이미지 생성
```

---

## 7. 주요 고려사항

### 7.1 전환 시 유지해야 할 것

1. **RAG 검색 로직**: Supabase RPC 호출 유지
2. **프롬프트 구조**: 섹션별 프롬프트 조립
3. **유틸리티 기반 배치**: 급수/배기 위치 감지
4. **자재코드 감지**: 정규식 패턴 매칭
5. **응답 형식**: Base64 이미지 + 메타데이터

### 7.2 개선 가능 영역

1. **에러 핸들링**: 더 세분화된 에러 처리
2. **캐싱**: RAG 결과 캐싱
3. **스트리밍**: 이미지 생성 진행률 표시
4. **타입 안전성**: TypeScript 전환으로 강화

### 7.3 API 키 관리

현재 n8n JSON에 하드코딩된 키:
- Supabase Anon Key (JWT)
- Gemini API Key

전환 시 환경 변수로 분리 필요.

---

## 8. 다음 단계

1. [ ] MCP 서버 기본 구조 설계
2. [ ] Supabase RAG 도구 구현
3. [ ] Gemini Vision/Image 도구 구현
4. [ ] 프롬프트 템플릿 모듈화
5. [ ] Claude Code 스킬 래퍼 구현
6. [ ] 테스트 및 검증
7. [ ] 프론트엔드 연동 수정

---

*이 문서는 다담AI 프로젝트의 n8n 워크플로우 분석을 기반으로 작성되었습니다.*
