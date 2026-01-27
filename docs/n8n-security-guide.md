# n8n Webhook 보안 강화 가이드

다담가구 n8n 워크플로우의 보안을 강화하기 위한 상세 가이드입니다.

## 목차

1. [인증 방식](#1-인증-방식)
2. [CORS 설정](#2-cors-설정)
3. [Rate Limiting](#3-rate-limiting)
4. [입력 검증](#4-입력-검증)
5. [로깅 및 모니터링](#5-로깅-및-모니터링)
6. [환경 변수 관리](#6-환경-변수-관리)
7. [클라이언트 구현](#7-클라이언트-구현)

---

## 1. 인증 방식

### 1.1 Header Auth (권장)

n8n Webhook에서 가장 권장되는 인증 방식입니다.

#### n8n 설정

```
Webhook 노드 > Authentication > Header Auth
- Name: X-API-Key
- Value: (생성한 API 키)
```

#### 클라이언트 호출

```javascript
const response = await fetch(N8N_WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-secret-api-key-here',
  },
  body: JSON.stringify(data),
});
```

### 1.2 Bearer Token

OAuth 스타일 인증입니다.

#### n8n 설정

```
Webhook 노드 > Authentication > Header Auth
- Name: Authorization
- Value: Bearer your-jwt-token-here
```

#### 클라이언트 호출

```javascript
const token = await getAuthToken(); // JWT 토큰 획득
const response = await fetch(N8N_WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(data),
});
```

### 1.3 Basic Auth

간단한 사용자명/비밀번호 인증입니다.

#### n8n 설정

```
Webhook 노드 > Authentication > Basic Auth
- User: dadam-webhook
- Password: (강력한 비밀번호)
```

#### 클라이언트 호출

```javascript
const credentials = btoa('dadam-webhook:your-password');
const response = await fetch(N8N_WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Basic ${credentials}`,
  },
  body: JSON.stringify(data),
});
```

### 1.4 HMAC 서명 검증 (고급)

요청 무결성을 보장하는 가장 안전한 방식입니다.

#### 클라이언트 (서명 생성)

```javascript
async function signRequest(payload, secretKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

const payload = {
  /* your data */
};
const signature = await signRequest(payload, 'your-secret-key');

const response = await fetch(N8N_WEBHOOK_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': Date.now().toString(),
  },
  body: JSON.stringify(payload),
});
```

#### n8n (서명 검증 - Code 노드)

```javascript
const crypto = require('crypto');

const receivedSignature = $input.first().headers['x-signature'];
const timestamp = $input.first().headers['x-timestamp'];
const payload = JSON.stringify($input.first().json);
const secretKey = $env.WEBHOOK_SECRET_KEY;

// 타임스탬프 검증 (5분 이내)
const now = Date.now();
const requestTime = parseInt(timestamp);
if (Math.abs(now - requestTime) > 5 * 60 * 1000) {
  throw new Error('Request expired');
}

// 서명 검증
const expectedSignature = crypto
  .createHmac('sha256', secretKey)
  .update(payload)
  .digest('base64');

if (receivedSignature !== expectedSignature) {
  throw new Error('Invalid signature');
}

return $input.all();
```

---

## 2. CORS 설정

### 2.1 Cloudflare Workers 프록시 (권장)

CORS를 처리하는 프록시 워커를 사용합니다.

```javascript
// Cloudflare Worker (dadam-proxy)
export default {
  async fetch(request, env) {
    const ALLOWED_ORIGINS = [
      'https://dadamfurniture.com',
      'https://www.dadamfurniture.com',
      'http://localhost:3000',
    ];

    const origin = request.headers.get('Origin');

    // Origin 검증
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    // Preflight 요청 처리
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, X-API-Key, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 실제 요청을 n8n으로 프록시
    const n8nUrl = env.N8N_WEBHOOK_URL + new URL(request.url).pathname;
    const response = await fetch(n8nUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.N8N_API_KEY,
      },
      body: await request.text(),
    });

    // 응답에 CORS 헤더 추가
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', origin);
    return newResponse;
  },
};
```

### 2.2 n8n 직접 CORS 설정

n8n 환경 변수에 추가:

```bash
N8N_CORS_ORIGIN=https://dadamfurniture.com,https://www.dadamfurniture.com
```

---

## 3. Rate Limiting

### 3.1 Cloudflare Rate Limiting

Cloudflare 대시보드에서 설정:

```
Rules > Rate Limiting Rules
- Rule name: Dadam Webhook Rate Limit
- If incoming requests match:
  - URL path: /webhook/*
- Then:
  - Rate limit: 100 requests per minute per IP
  - Block duration: 10 minutes
```

### 3.2 n8n 내부 Rate Limiting (Code 노드)

```javascript
// Rate Limit 검사 (Redis 또는 메모리 사용)
const clientIP =
  $input.first().headers['cf-connecting-ip'] ||
  $input.first().headers['x-forwarded-for'];
const cacheKey = `ratelimit:${clientIP}`;

// 간단한 구현 (프로덕션에서는 Redis 권장)
const rateLimits =
  globalThis._rateLimits || (globalThis._rateLimits = new Map());
const now = Date.now();
const windowMs = 60000; // 1분
const maxRequests = 30;

const requests = rateLimits.get(cacheKey) || [];
const recentRequests = requests.filter((t) => t > now - windowMs);

if (recentRequests.length >= maxRequests) {
  throw new Error('Rate limit exceeded. Please try again later.');
}

recentRequests.push(now);
rateLimits.set(cacheKey, recentRequests);

return $input.all();
```

### 3.3 사용자별 Rate Limiting

```javascript
const userId = $input.first().json.userId;
const userTier = await getUserTier(userId); // Standard, Expert, Business

const limits = {
  standard: { requests: 10, window: 60000 },
  expert: { requests: 50, window: 60000 },
  business: { requests: 200, window: 60000 },
};

const limit = limits[userTier] || limits.standard;
// 위 Rate Limiting 코드에 적용
```

---

## 4. 입력 검증

### 4.1 스키마 검증 (Code 노드)

```javascript
// 필수 필드 검증
function validateDesignPayload(payload) {
  const errors = [];

  // 필수 필드 확인
  if (!payload.userId) errors.push('userId is required');
  if (!payload.designId) errors.push('designId is required');
  if (!payload.data) errors.push('data is required');
  if (!Array.isArray(payload.data?.items))
    errors.push('data.items must be an array');

  // UUID 형식 검증
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (payload.userId && !uuidRegex.test(payload.userId)) {
    errors.push('userId must be a valid UUID');
  }

  // 아이템 검증
  if (payload.data?.items) {
    payload.data.items.forEach((item, index) => {
      if (!item.category) errors.push(`items[${index}].category is required`);
      if (!item.uniqueId) errors.push(`items[${index}].uniqueId is required`);

      // 카테고리 유효성
      const validCategories = [
        'sink',
        'wardrobe',
        'fridge',
        'vanity',
        'shoe',
        'storage',
      ];
      if (!validCategories.includes(item.category)) {
        errors.push(
          `items[${index}].category must be one of: ${validCategories.join(', ')}`
        );
      }

      // 크기 범위 검증
      if (item.w && (item.w < 100 || item.w > 10000)) {
        errors.push(`items[${index}].w must be between 100 and 10000mm`);
      }
    });
  }

  return errors;
}

const payload = $input.first().json;
const validationErrors = validateDesignPayload(payload);

if (validationErrors.length > 0) {
  throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
}

return $input.all();
```

### 4.2 XSS 방지

```javascript
// HTML 태그 제거
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]*>/g, '').trim();
}

function sanitizeObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  return sanitizeString(obj);
}

const sanitizedPayload = sanitizeObject($input.first().json);
return [{ json: sanitizedPayload }];
```

### 4.3 SQL Injection 방지

Supabase 노드 사용 시 파라미터화된 쿼리를 자동으로 사용합니다. 직접 SQL을 작성할
경우:

```javascript
// 잘못된 예 (취약)
const query = `SELECT * FROM designs WHERE name = '${userInput}'`;

// 올바른 예 (안전)
const { data, error } = await supabase
  .from('designs')
  .select('*')
  .eq('name', userInput);
```

---

## 5. 로깅 및 모니터링

### 5.1 요청 로깅 (Code 노드)

```javascript
const logEntry = {
  timestamp: new Date().toISOString(),
  method: $input.first().method,
  path: $input.first().headers.host,
  clientIP: $input.first().headers['cf-connecting-ip'] || 'unknown',
  userAgent: $input.first().headers['user-agent'],
  userId: $input.first().json.userId || 'anonymous',
  action: $input.first().json.action || 'unknown',
  success: true,
};

console.log(JSON.stringify(logEntry));

// Supabase 로그 테이블에 저장 (선택사항)
// await supabase.from('webhook_logs').insert(logEntry);

return $input.all();
```

### 5.2 에러 로깅

```javascript
// 에러 발생 시 로깅
try {
  // 작업 수행
} catch (error) {
  const errorLog = {
    timestamp: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    userId: $input.first().json.userId,
    payload: JSON.stringify($input.first().json).substring(0, 1000), // 처음 1000자만
  };

  console.error(JSON.stringify(errorLog));

  // Slack/Discord 알림 (선택사항)
  // await sendSlackAlert(errorLog);

  throw error;
}
```

### 5.3 Slack 알림 설정

```javascript
// 보안 이벤트 알림
async function sendSecurityAlert(event) {
  const webhookUrl = $env.SLACK_WEBHOOK_URL;

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `:warning: 보안 알림`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*이벤트:* ${event.type}\n*IP:* ${event.ip}\n*시간:* ${event.timestamp}\n*상세:* ${event.details}`,
          },
        },
      ],
    }),
  });
}
```

---

## 6. 환경 변수 관리

### 6.1 필수 환경 변수

```bash
# n8n 환경 변수 (.env)

# 인증
WEBHOOK_SECRET_KEY=your-256-bit-secret-key-here
N8N_API_KEY=your-n8n-api-key

# Supabase
SUPABASE_URL=https://vvqrvgcgnlfpiqqndsve.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# 외부 서비스
OPENAI_API_KEY=sk-your-openai-key
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx

# 보안 설정
ALLOWED_ORIGINS=https://dadamfurniture.com,https://www.dadamfurniture.com
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
```

### 6.2 키 로테이션 정책

| 키 유형          | 로테이션 주기 | 방법                                            |
| ---------------- | ------------- | ----------------------------------------------- |
| API Key          | 90일          | 새 키 생성 → 클라이언트 업데이트 → 이전 키 폐기 |
| HMAC Secret      | 180일         | 양방향 동시 업데이트                            |
| Service Role Key | 365일         | Supabase 대시보드에서 재생성                    |

---

## 7. 클라이언트 구현

### 7.1 보안 API 클라이언트

```javascript
// js/modules/services/n8n-service.js

class N8NService {
  constructor(config = {}) {
    this.baseUrl =
      config.baseUrl || 'https://dadam-proxy.dadamfurniture.workers.dev';
    this.apiKey = config.apiKey || null;
    this.timeout = config.timeout || 30000;
  }

  async request(endpoint, data, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const timestamp = Date.now().toString();

    const headers = {
      'Content-Type': 'application/json',
      'X-Timestamp': timestamp,
    };

    // API Key 인증
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    // Supabase 토큰 (로그인된 경우)
    const session = await supabaseService.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  // AI 설계 요청
  async generateAIDesign(imageData, options = {}) {
    return this.request('/webhook/interior-design', {
      image: imageData,
      category: options.category,
      style: options.style,
      userId: options.userId,
    });
  }

  // 채팅 메시지 전송
  async sendChatMessage(message, context = {}) {
    return this.request('/webhook/chat', {
      message,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  // 설계 저장
  async saveDesign(designData) {
    return this.request('/webhook/design-save', designData);
  }
}

// 싱글톤 인스턴스
const n8nService = new N8NService({
  baseUrl: 'https://dadam-proxy.dadamfurniture.workers.dev',
});

export { N8NService, n8nService };
```

### 7.2 에러 처리

```javascript
async function callN8NWithRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable =
        error.message.includes('timeout') ||
        error.message.includes('network') ||
        error.message.includes('503');

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // 지수 백오프
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// 사용 예시
try {
  const result = await callN8NWithRetry(() =>
    n8nService.generateAIDesign(imageData, options)
  );
} catch (error) {
  showToast('요청 처리 중 오류가 발생했습니다.', 'error');
  console.error('N8N request failed:', error);
}
```

---

## 체크리스트

### 배포 전 보안 점검

- [ ] 모든 Webhook에 인증 적용 (Header Auth 또는 HMAC)
- [ ] CORS 설정 완료 (허용 도메인만)
- [ ] Rate Limiting 활성화
- [ ] 입력 검증 로직 추가
- [ ] 에러 로깅 설정
- [ ] 보안 알림 설정 (Slack/Email)
- [ ] 환경 변수 검토 (하드코딩된 시크릿 없음)
- [ ] HTTPS 강제 사용
- [ ] 프로덕션 환경에서 디버그 모드 비활성화

### 정기 점검 (월간)

- [ ] API 키 만료 확인
- [ ] 로그 검토 (비정상 패턴)
- [ ] Rate Limit 임계값 검토
- [ ] 의존성 업데이트
- [ ] 보안 취약점 스캔

---

## 문서 버전

| 버전 | 날짜       | 변경 내용 |
| ---- | ---------- | --------- |
| 1.0  | 2026-01-26 | 최초 작성 |
