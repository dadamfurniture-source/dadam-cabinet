# n8n 워크플로우 설정 가이드

다담 캐비넷 설계 데이터를 n8n으로 연동하는 방법입니다.

## 1. 기본 Webhook 워크플로우

### 설계 데이터 수신 워크플로우

```
[Webhook] → [데이터 검증] → [Supabase 저장] → [응답 반환]
```

#### 1.1 Webhook 노드 설정

1. n8n에서 새 워크플로우 생성
2. "Webhook" 노드 추가
3. 설정:
   - HTTP Method: `POST`
   - Path: `design-save`
   - Authentication: None (또는 Header Auth 권장)

4. Webhook URL 복사 후 `detaildesign.html`에 설정:
```javascript
const N8N_WEBHOOK_URL = 'https://your-n8n-domain.com/webhook/design-save';
```

#### 1.2 수신 데이터 구조

```json
{
  "timestamp": "2026-01-20T10:30:00.000Z",
  "userId": "user-uuid",
  "userEmail": "user@example.com",
  "designId": "design-uuid",
  "appVersion": "33.0",
  "data": {
    "appVersion": "33.0",
    "exportDate": "2026-01-20T10:30:00.000Z",
    "items": [
      {
        "uniqueId": 1234567890,
        "category": "sink",
        "name": "싱크대",
        "w": 2400,
        "h": 2300,
        "d": 650,
        "specs": { ... },
        "modules": [ ... ]
      }
    ]
  }
}
```

---

## 2. Supabase 연동 워크플로우

### 2.1 설계 저장 워크플로우

```
[Webhook] → [Code: 데이터 변환] → [Supabase: designs 저장] → [Loop: items] → [Supabase: design_items 저장]
```

#### Supabase 노드 설정

1. **Supabase 자격증명 추가**
   - Project URL: `https://vvqrvgcgnlfpiqqndsve.supabase.co`
   - Service Role Key: (Supabase 대시보드 → Settings → API)

2. **designs 테이블 Insert 노드**
   ```
   Operation: Insert
   Table: designs
   Fields:
     - user_id: {{ $json.userId }}
     - name: {{ $json.data.items[0].name + ' 외' }}
     - status: 'draft'
     - total_items: {{ $json.data.items.length }}
     - app_version: {{ $json.appVersion }}
   ```

3. **design_items 테이블 Insert 노드**
   - Loop 노드로 items 배열 순회
   - 각 item을 design_items에 저장

---

## 3. RAG 임베딩 워크플로우 (고급)

### 3.1 설계 요약 → 임베딩 생성

```
[Trigger: 새 설계] → [Code: 요약 생성] → [OpenAI: 임베딩] → [Supabase: 벡터 저장]
```

#### 요약 텍스트 생성 코드

```javascript
// Code 노드
const items = $input.all();
const design = items[0].json;

// 설계 요약 텍스트 생성
let summary = `설계 유형: `;
const categories = design.data.items.map(i => i.name).join(', ');
summary += categories + '. ';

design.data.items.forEach(item => {
  summary += `${item.name}: ${item.w}x${item.h}x${item.d}mm. `;
  if (item.modules && item.modules.length > 0) {
    summary += `모듈 ${item.modules.length}개. `;
  }
});

return [{ json: {
  designId: design.designId,
  summary: summary
}}];
```

#### OpenAI 임베딩 노드

```
Model: text-embedding-ada-002
Input: {{ $json.summary }}
```

#### Supabase 벡터 저장

```
Table: design_embeddings
Fields:
  - design_id: {{ $json.designId }}
  - searchable_text: {{ $json.summary }}
  - embedding_json: {{ $json.embedding }}
```

---

## 4. 유사 설계 검색 워크플로우

### 4.1 검색 API

```
[Webhook: search] → [OpenAI: 쿼리 임베딩] → [Supabase: 벡터 검색] → [응답]
```

#### Supabase 벡터 검색 (RPC 호출)

먼저 Supabase에 함수 생성:

```sql
CREATE OR REPLACE FUNCTION search_similar_designs(
  query_embedding JSONB,
  match_threshold FLOAT DEFAULT 0.8,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  design_id UUID,
  similarity FLOAT,
  searchable_text TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- 임베딩 JSON을 벡터로 변환하여 검색
  -- pgvector 확장 필요
  RETURN QUERY
  SELECT
    de.design_id,
    0.9 as similarity,  -- 실제로는 벡터 유사도 계산
    de.searchable_text
  FROM design_embeddings de
  LIMIT match_count;
END;
$$;
```

---

## 5. 알림 워크플로우

### 5.1 설계 제출 알림

```
[Webhook: action=submit] → [IF: 제출인지 확인] → [Slack/Email 알림]
```

#### Slack 알림 예시

```
새 설계가 제출되었습니다!

👤 사용자: {{ $json.userEmail }}
📐 설계 ID: {{ $json.designId }}
🪑 가구 수: {{ $json.data.items.length }}개
📅 제출 시간: {{ $json.timestamp }}
```

---

## 6. 전체 워크플로우 JSON 내보내기

### 기본 설계 저장 워크플로우

```json
{
  "name": "다담 설계 저장",
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "httpMethod": "POST",
        "path": "design-save",
        "responseMode": "responseNode"
      }
    },
    {
      "name": "데이터 검증",
      "type": "n8n-nodes-base.if",
      "parameters": {
        "conditions": {
          "boolean": [
            {
              "value1": "={{ $json.data.items.length > 0 }}",
              "value2": true
            }
          ]
        }
      }
    },
    {
      "name": "응답",
      "type": "n8n-nodes-base.respondToWebhook",
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ { success: true, message: '저장 완료' } }}"
      }
    }
  ]
}
```

---

## 7. 환경 변수 설정

n8n 환경 변수에 추가 권장:

```
SUPABASE_URL=https://vvqrvgcgnlfpiqqndsve.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
OPENAI_API_KEY=your-openai-key (RAG용)
```

---

## 8. 보안 권장사항

1. **Webhook 인증**: Header Auth 또는 Basic Auth 사용
2. **CORS 설정**: 필요한 도메인만 허용
3. **Rate Limiting**: 과도한 요청 방지
4. **데이터 검증**: 모든 입력 데이터 유효성 검사

---

## 다음 단계

1. n8n 인스턴스 설정 (셀프호스팅 또는 클라우드)
2. 기본 Webhook 워크플로우 생성
3. `detaildesign.html`에 Webhook URL 설정
4. 테스트 설계 저장 확인
5. RAG 워크플로우 확장 (선택사항)
