# 프론트엔드 연동 가이드

## HTTP API 서버 정보

| 항목 | 값 |
|------|-----|
| 기본 URL | `http://localhost:3200` |
| n8n 대체 | `https://dadam.app.n8n.cloud` → `http://localhost:3200` |

---

## 엔드포인트

### 1. 헬스 체크

```
GET /health
```

**응답:**
```json
{
  "status": "ok",
  "server": "dadam-api",
  "timestamp": "2026-02-01T08:20:59.706Z"
}
```

---

### 2. 방 사진 → AI 가구 설계

```
POST /webhook/dadam-interior-v4
```

**요청:**
```json
{
  "category": "sink",
  "style": "modern",
  "room_image": "<base64 이미지>",
  "image_type": "image/jpeg"
}
```

**응답:**
```json
{
  "success": true,
  "message": "이미지 생성 완료",
  "category": "sink",
  "style": "modern",
  "rag_rules_count": 12,
  "generated_image": {
    "closed": {
      "base64": "<base64 이미지>",
      "mime_type": "image/png"
    },
    "open": {
      "base64": "<base64 이미지>",
      "mime_type": "image/png"
    }
  }
}
```

---

### 3. 설계 데이터 → 이미지

```
POST /webhook/design-to-image
```

**요청:**
```json
{
  "category": "sink",
  "style": "modern minimal",
  "cabinet_specs": {
    "total_width_mm": 3000,
    "total_height_mm": 2400
  },
  "items": []
}
```

**응답:**
```json
{
  "success": true,
  "message": "이미지 생성 완료",
  "category": "sink",
  "style": "modern minimal",
  "generated_image": {
    "base64": "<base64 이미지>",
    "mime_type": "image/png"
  }
}
```

---

## 프론트엔드 수정 방법

### ai-design.html 수정

**기존 코드:**
```javascript
fetch('https://dadam.app.n8n.cloud/webhook/dadam-interior-v4', {
  method: 'POST',
  body: JSON.stringify({
    category: 'sink',
    style: 'modern',
    room_image: base64String,
    image_type: 'image/jpeg'
  })
})
```

**수정 후:**
```javascript
// API 서버 URL (환경에 따라 변경)
const API_URL = 'http://localhost:3200';  // 개발
// const API_URL = 'https://api.dadamfurniture.com';  // 프로덕션

fetch(`${API_URL}/webhook/dadam-interior-v4`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    category: 'sink',
    style: 'modern',
    room_image: base64String,
    image_type: 'image/jpeg'
  })
})
```

---

### detaildesign.html 수정

동일한 방식으로 n8n URL을 새 API 서버 URL로 변경합니다.

---

## 설정 파일 사용 (권장)

`js/config.js`에 API URL을 중앙 관리:

```javascript
// js/config.js
const CONFIG = {
  // 개발 환경
  API_URL: 'http://localhost:3200',

  // 프로덕션 (배포 시 변경)
  // API_URL: 'https://api.dadamfurniture.com',

  // n8n (기존 - 비활성화)
  // API_URL: 'https://dadam.app.n8n.cloud',
};

export default CONFIG;
```

사용:
```javascript
import CONFIG from './config.js';

fetch(`${CONFIG.API_URL}/webhook/dadam-interior-v4`, ...);
```

---

## 서버 실행

### 개발 모드 (핫 리로드)

```bash
cd mcp-server
npm run dev:http
```

### 프로덕션 모드

```bash
cd mcp-server
npm run build
npm run start:http
```

---

## CORS 설정

현재 CORS가 모든 출처를 허용하도록 설정되어 있습니다.
프로덕션에서는 특정 도메인만 허용하도록 수정하세요:

```typescript
// src/http-server.ts
app.use(cors({
  origin: [
    'https://dadamfurniture.com',
    'https://www.dadamfurniture.com',
    'http://localhost:3000'  // 개발용
  ]
}));
```

---

## 환경 변수

`.env` 파일에서 포트 변경 가능:

```bash
HTTP_PORT=3200
```

---

## 테스트

### curl로 테스트

```bash
# 헬스 체크
curl http://localhost:3200/health

# 간단한 API 테스트 (이미지 없이)
curl -X POST http://localhost:3200/webhook/dadam-interior-v4 \
  -H "Content-Type: application/json" \
  -d '{"category": "sink", "style": "modern"}'
```

### 브라우저에서 테스트

```javascript
// 개발자 도구 콘솔에서 실행
fetch('http://localhost:3200/health')
  .then(r => r.json())
  .then(console.log);
```

---

## 에러 처리

### 에러 응답 형식

```json
{
  "success": false,
  "error": "에러 메시지"
}
```

### HTTP 상태 코드

| 코드 | 설명 |
|------|------|
| 200 | 성공 |
| 400 | 잘못된 요청 (room_image 누락 등) |
| 500 | 서버 에러 (이미지 생성 실패 등) |

---

## 마이그레이션 체크리스트

- [ ] ai-design.html의 n8n URL을 새 API URL로 변경
- [ ] detaildesign.html의 n8n URL을 새 API URL로 변경
- [ ] js/config.js에 API_URL 설정 추가
- [ ] CORS 설정 검토
- [ ] 프로덕션 배포 시 HTTPS 설정
- [ ] 테스트 완료 후 n8n 워크플로우 비활성화
