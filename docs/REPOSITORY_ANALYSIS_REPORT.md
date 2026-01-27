# 다담가구(DADAM Furniture) 저장소 종합 분석 보고서

**작성일**: 2026-01-26 **저장소**: dadamfurniture-source/dadam-cabinet **분석
브랜치**: claude/analyze-repo-structure-gIE8e

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [디렉토리 구조](#2-디렉토리-구조)
3. [기술 스택](#3-기술-스택)
4. [파일 분류 및 통계](#4-파일-분류-및-통계)
5. [주요 페이지 분석](#5-주요-페이지-분석)
6. [인증 및 권한 시스템](#6-인증-및-권한-시스템)
7. [데이터베이스 스키마](#7-데이터베이스-스키마)
8. [외부 연동 및 API](#8-외부-연동-및-api)
9. [워크플로우 자동화](#9-워크플로우-자동화)
10. [CI/CD 및 배포](#10-cicd-및-배포)
11. [시스템 흐름도](#11-시스템-흐름도)
12. [권장 개선사항](#12-권장-개선사항)

---

## 1. 프로젝트 개요

### 1.1 프로젝트 설명

**다담가구**는 AI 기반 맞춤 가구 설계 플랫폼입니다. 사용자가 공간 사진을
업로드하면 Claude Vision과 DALL-E3를 활용하여 맞춤형 가구 설계안을 자동
생성합니다.

### 1.2 핵심 기능

| 기능                | 설명                                          |
| ------------------- | --------------------------------------------- |
| **AI 설계**         | 이미지 업로드 → 벽 분석 → AI 가구 디자인 생성 |
| **사용자 인증**     | 이메일/비밀번호, Google, Kakao OAuth 지원     |
| **설계 관리**       | 저장, 불러오기, 삭제, 제출 기능               |
| **다국어 지원**     | 한국어/영어 전환                              |
| **회원 등급**       | Standard / Expert / Business 3단계            |
| **관리자 대시보드** | 사용자, 상담, 로그 관리                       |

### 1.3 프로젝트 상태

- **버전**: 1.0.0
- **상태**: Production Ready
- **최근 커밋**: 렌더링 성능 최적화 (debounce 적용)

---

## 2. 디렉토리 구조

```
dadam-cabinet/
├── .git/                          # Git 버전 관리
├── .gitignore                     # Git 제외 설정
├── .env.local.example             # 환경 변수 예제
│
├── package.json                   # npm 패키지 설정
├── tsconfig.json                  # TypeScript 설정
├── next.config.js                 # Next.js 설정
├── tailwind.config.js             # Tailwind CSS 설정
├── postcss.config.js              # PostCSS 설정
│
├── index.html                     # 메인 랜딩 페이지
├── login.html                     # 로그인 페이지
├── signup.html                    # 회원가입 페이지
├── ai-design.html                 # AI 설계 도구
├── detaildesign.html              # 상세 설계 (Expert/Business)
├── my-designs.html                # 내 설계 목록
├── mypage.html                    # 마이페이지
├── consultation.html              # 상담 신청
├── forgot-password.html           # 비밀번호 찾기
├── reset-password.html            # 비밀번호 재설정
│
├── admin/                         # 관리자 페이지 (6개)
│   ├── index.html                 # 대시보드
│   ├── users.html                 # 사용자 관리
│   ├── consultations.html         # 상담 관리
│   ├── expert-requests.html       # 전문가 요청
│   ├── settings.html              # 설정
│   └── logs.html                  # 로그 조회
│
├── app/                           # Next.js 앱 디렉토리
│   ├── layout.tsx                 # 루트 레이아웃
│   ├── globals.css                # 전역 스타일
│   ├── login/page.tsx             # 로그인 (React)
│   ├── signup/page.tsx            # 회원가입 (React)
│   └── portfolio/                 # 포트폴리오 갤러리
│       ├── page.tsx
│       └── [이미지 파일들]        # 34개 (약 37MB)
│
├── js/                            # JavaScript 유틸리티
│   ├── supabase-utils.js          # Supabase 공유 유틸리티
│   ├── translations.js            # 다국어 번역 데이터
│   ├── auth.js                    # 인증 로직
│   ├── i18n.js                    # 국제화 설정
│   └── firebase-config.js         # Firebase 설정
│
├── lib/                           # TypeScript 라이브러리
│   └── supabase.ts                # Supabase 클라이언트
│
├── database/                      # 데이터베이스 스키마
│   ├── schema.sql                 # 메인 스키마
│   ├── profiles-schema.sql        # 사용자 프로필
│   ├── designs-schema.sql         # 설계 테이블
│   ├── admin-schema.sql           # 관리자 관련
│   └── stability-triggers.sql     # 트리거
│
└── docs/                          # 문서
    ├── n8n-setup-guide.md         # n8n 설정 가이드
    └── REPOSITORY_ANALYSIS_REPORT.md  # 이 문서
```

---

## 3. 기술 스택

### 3.1 프론트엔드

| 기술                  | 용도                              |
| --------------------- | --------------------------------- |
| **HTML5/CSS3**        | 정적 페이지 구조                  |
| **JavaScript (ES6+)** | 클라이언트 로직                   |
| **Next.js**           | React 기반 페이지 (app/ 디렉토리) |
| **TypeScript**        | 타입 안전성                       |
| **Tailwind CSS**      | 유틸리티 기반 스타일링            |

### 3.2 백엔드 및 인프라

| 기술                   | 용도                         |
| ---------------------- | ---------------------------- |
| **Supabase**           | 인증, 데이터베이스, 스토리지 |
| **Firebase**           | 추가 인증 (선택적)           |
| **n8n**                | 워크플로우 자동화            |
| **Cloudflare Workers** | CORS 프록시                  |

### 3.3 AI/ML 서비스

| 기술                  | 용도                       |
| --------------------- | -------------------------- |
| **Claude Vision**     | 이미지 분석, 벽 구조 파악  |
| **DALL-E 3**          | AI 가구 디자인 이미지 생성 |
| **OpenAI Embeddings** | RAG 벡터 검색 (선택적)     |

### 3.4 설정 파일 요약

```javascript
// next.config.js - 정적 사이트 내보내기
{
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true }
}

// tailwind.config.js - 브랜드 색상
colors: {
  dadam: {
    white: '#FAFAFA',
    cream: '#F8F7F4',
    gold: '#B8956C',
    charcoal: '#2D2A26'
  }
}

// 폰트
fontFamily: {
  serif: ['Playfair Display', 'Noto Serif KR'],
  sans: ['Pretendard', 'system-ui']
}
```

---

## 4. 파일 분류 및 통계

### 4.1 파일 유형별 통계

| 파일 유형        | 개수 | 총 크기 | 비고             |
| ---------------- | ---- | ------- | ---------------- |
| HTML             | 16개 | ~754KB  | 메인 UI + 관리자 |
| TypeScript/TSX   | 5개  | ~52KB   | Next.js 컴포넌트 |
| JavaScript       | 8개  | ~30KB   | 유틸리티         |
| SQL              | 5개  | ~40KB   | DB 스키마        |
| CSS              | 1개  | ~6KB    | 전역 스타일      |
| 이미지 (PNG/JPG) | 34개 | ~37MB   | 포트폴리오       |
| JSON             | 3개  | ~40KB   | 설정 + 데이터    |
| Markdown         | 2개  | -       | 문서             |

### 4.2 대용량 파일 (상위 5개)

| 파일              | 크기  | 라인 수 |
| ----------------- | ----- | ------- |
| detaildesign.html | 404KB | 9,126   |
| ai-design.html    | 78KB  | 1,479   |
| index.html        | 57KB  | 2,128   |
| mypage.html       | 39KB  | -       |
| signup.html       | 33KB  | -       |

---

## 5. 주요 페이지 분석

### 5.1 사용자 페이지

| 페이지         | 파일              | 주요 기능                             |
| -------------- | ----------------- | ------------------------------------- |
| **메인**       | index.html        | 히어로 슬라이더, 카테고리 소개, CTA   |
| **로그인**     | login.html        | 이메일/OAuth 로그인                   |
| **회원가입**   | signup.html       | 등급 선택, 지역 정보 입력             |
| **AI 설계**    | ai-design.html    | 6가지 카테고리, 4가지 스타일, AI 생성 |
| **상세 설계**  | detaildesign.html | Expert/Business 전용 고급 도구        |
| **내 설계**    | my-designs.html   | 저장된 설계 목록                      |
| **마이페이지** | mypage.html       | 프로필, 통계, 등급 관리               |
| **상담 신청**  | consultation.html | 전문가 상담 요청                      |

### 5.2 관리자 페이지

| 페이지          | 파일                       | 주요 기능            |
| --------------- | -------------------------- | -------------------- |
| **대시보드**    | admin/index.html           | 통계 개요            |
| **사용자 관리** | admin/users.html           | 회원 목록, 권한 관리 |
| **상담 관리**   | admin/consultations.html   | 상담 내역 처리       |
| **전문가 요청** | admin/expert-requests.html | 등급 승인            |
| **설정**        | admin/settings.html        | 시스템 설정          |
| **로그**        | admin/logs.html            | 활동 로그 조회       |

### 5.3 AI 설계 카테고리

| 카테고리 | 코드     | 설명              |
| -------- | -------- | ----------------- |
| 싱크대   | sink     | 주방 상하부장     |
| 붙박이장 | wardrobe | 옷장, 수납 시스템 |
| 냉장고장 | fridge   | 키큰장            |
| 화장대   | vanity   | 드레서            |
| 신발장   | shoe     | 현관 수납         |
| 수납장   | storage  | 다용도            |

### 5.4 스타일 옵션

- **모던 미니멀**: 깔끔한 라인, 미니멀리즘
- **스칸디나비안**: 밝은 우드, 아늑함
- **인더스트리얼**: 원자재, 어두운 톤
- **럭셔리**: 프리미엄 자재, 골드 악센트

---

## 6. 인증 및 권한 시스템

### 6.1 듀얼 인증 아키텍처

```
┌─────────────────────────────────────────┐
│           사용자 인증 요청               │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│   Supabase    │       │   Firebase    │
│     Auth      │       │     Auth      │
│ (주요 인증)   │       │ (선택적)      │
└───────────────┘       └───────────────┘
        │                       │
        ▼                       ▼
┌───────────────┐       ┌───────────────┐
│   profiles    │       │   Firestore   │
│   테이블      │       │   users       │
└───────────────┘       └───────────────┘
```

### 6.2 지원 로그인 방식

| 방식            | 제공자        |
| --------------- | ------------- |
| 이메일/비밀번호 | Supabase Auth |
| Google OAuth    | Supabase Auth |
| Kakao OAuth     | Supabase Auth |
| Naver OAuth     | (계획됨)      |
| Apple OAuth     | (계획됨)      |

### 6.3 회원 등급 체계

| 등급         | 권한           | 특징                 |
| ------------ | -------------- | -------------------- |
| **Standard** | AI 설계 (기본) | 무료 기본 기능       |
| **Expert**   | 상세 설계 도구 | 자재 산출, 고급 편집 |
| **Business** | 팀 협업, API   | 기업용, 별도 문의    |

### 6.4 인증 흐름

```javascript
// 로그인 상태 확인
async function checkAuthState() {
  const { session } = await supabaseClient.auth.getSession();
  if (session) {
    const tier = session.user.user_metadata.tier;
    if (tier === 'expert' || tier === 'business') {
      // 상세 설계 페이지 접근 허용
    }
  }
}
```

---

## 7. 데이터베이스 스키마

### 7.1 테이블 구조

```sql
-- 사용자 프로필
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users,
  email TEXT,
  name TEXT,
  phone TEXT,
  tier TEXT DEFAULT 'standard',  -- standard | expert | business
  sido TEXT,                      -- 시도
  gugun TEXT,                     -- 시군구
  marketing_agreed BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- 설계 메타데이터
CREATE TABLE designs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  name TEXT,
  status TEXT DEFAULT 'draft',   -- draft | submitted | completed
  total_items INTEGER,
  total_modules INTEGER,
  app_version TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ
);

-- 설계 아이템
CREATE TABLE design_items (
  id UUID PRIMARY KEY,
  design_id UUID REFERENCES designs,
  category TEXT,                 -- sink | wardrobe | fridge | vanity | shoe | storage
  name TEXT,
  unique_id INTEGER,
  width NUMERIC,                 -- mm
  height NUMERIC,
  depth NUMERIC,
  specs JSONB,                   -- 이미지URL, 자재 정보 등
  modules JSONB,                 -- 부속품 배열
  item_order INTEGER
);

-- 상담 요청
CREATE TABLE consultations (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  status TEXT DEFAULT 'pending', -- pending | completed
  created_at TIMESTAMPTZ
);
```

### 7.2 스토리지 버킷

| 버킷          | 용도             | 제한        |
| ------------- | ---------------- | ----------- |
| design-images | 설계 이미지 저장 | 계정당 20개 |

### 7.3 Row Level Security (RLS)

```sql
-- 자신의 설계만 조회 가능
CREATE POLICY "Users can view own designs"
  ON designs FOR SELECT
  USING (auth.uid() = user_id);

-- 자신의 설계만 수정 가능
CREATE POLICY "Users can update own designs"
  ON designs FOR UPDATE
  USING (auth.uid() = user_id);
```

---

## 8. 외부 연동 및 API

### 8.1 API 엔드포인트

| 서비스               | URL                                    | 용도              |
| -------------------- | -------------------------------------- | ----------------- |
| **Supabase**         | vvqrvgcgnlfpiqqndsve.supabase.co       | 인증, DB, Storage |
| **N8N Chat**         | dadam.app.n8n.cloud/webhook/chat       | AI 챗봇 상담      |
| **N8N Interior**     | dadam-proxy.dadamfurniture.workers.dev | 벽 분석 + AI 생성 |
| **N8N Wall**         | dadam-proxy.dadamfurniture.workers.dev | 상세 공간 분석    |
| **Cloudflare Proxy** | dadam-proxy.dadamfurniture.workers.dev | CORS 처리         |

### 8.2 JavaScript 유틸리티 함수

#### supabase-utils.js

```javascript
// 초기화
DadamSupabase.init();

// 인증
DadamSupabase.signOut(redirectUrl);

// 프로필
DadamSupabase.loadProfile();

// 이미지 (계정당 20개 제한)
DadamSupabase.uploadImage(file, userId);

// 설계 CRUD
DadamSupabase.saveDesign(designId, name, items, appVersion);
DadamSupabase.loadDesign(designId);
DadamSupabase.getMyDesigns(options);
DadamSupabase.deleteDesign(designId);
DadamSupabase.submitDesign(designId);
```

#### i18n.js

```javascript
// 다국어 전환
i18n.setLanguage('ko'); // 또는 'en'
i18n.getCurrentLanguage();
i18n.translate(key);
```

---

## 9. 워크플로우 자동화

### 9.1 n8n 워크플로우 구성

프로젝트는 **n8n**을 통해 백엔드 자동화를 구현합니다.

#### 기본 Webhook 워크플로우

```
[Webhook 수신] → [데이터 검증] → [Supabase 저장] → [응답 반환]
```

#### AI 설계 생성 워크플로우

```
[이미지 업로드]
      │
      ▼
[Claude Vision] ─── 벽 구조, 장애물, 치수 분석
      │
      ▼
[DALL-E 3] ─── 3가지 렌더링 생성
      │         ├─ 원본
      │         ├─ 도어 닫힘
      │         └─ 도어 열림
      ▼
[결과 반환]
```

#### RAG 임베딩 워크플로우 (고급)

```
[설계 저장]
      │
      ▼
[텍스트 요약 생성]
      │
      ▼
[OpenAI Embeddings]
      │
      ▼
[Supabase 벡터 저장]
      │
      ▼
[유사 설계 검색 가능]
```

#### 알림 워크플로우

```
[이벤트 발생] → [Slack/Email 알림]
```

### 9.2 n8n 보안 권장사항

- Webhook 인증 추가
- CORS 설정
- Rate Limiting 구현
- 환경 변수 관리

---

## 10. CI/CD 및 배포

### 10.1 현재 상태

| 항목            | 상태       |
| --------------- | ---------- |
| GitHub Actions  | **미구성** |
| 워크플로우 파일 | 없음       |
| 자동 배포       | **미구성** |
| 테스트 자동화   | **미구성** |

### 10.2 Git 설정

```gitignore
# .gitignore 주요 항목
node_modules/
.next/
out/
build/
dist/
.env
.env.local
.env.*.local
.vscode/
.idea/
.DS_Store
.vercel
```

### 10.3 최근 커밋 히스토리

```
fcc8110 Merge pull request #20 - 저장소 구조 분석
b9f9ddf refactor: detaildesign.html 최적화 기반 구축
e5451a2 Merge pull request #19 - 코드 성능 개선
de5817a perf: 렌더링 성능 최적화 - debounce 및 포커스 복원 적용
8468207 Merge pull request #18
4884425 chore: 계정당 이미지 제한 15개 → 20개로 변경
e87987c feat: Supabase Storage를 이용한 이미지 저장 구현
```

### 10.4 권장 CI/CD 파이프라인

```yaml
# .github/workflows/deploy.yml (권장 구성)
name: Deploy

on:
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: HTML 검증
        run: npx html-validate "**/*.html"
      - name: 링크 체크
        run: npx linkinator .

  deploy:
    needs: validate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
```

---

## 11. 시스템 흐름도

### 11.1 전체 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DADAM FURNITURE SYSTEM                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   사용자    │     │   관리자    │     │   전문가    │
│  (Standard) │     │   (Admin)   │     │  (Expert)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         프론트엔드 (HTML/JS/React)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  index.html │ login.html │ ai-design.html │ mypage.html │ admin/*       │
└─────────────────────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
│  Supabase Auth  │ │  Supabase   │ │    Supabase     │
│   (인증/권한)   │ │  Database   │ │    Storage      │
└─────────────────┘ └─────────────┘ └─────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        n8n 워크플로우 자동화                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Webhook │ Claude Vision │ DALL-E 3 │ Embeddings │ Notifications        │
└─────────────────────────────────────────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
│  Claude Vision  │ │   DALL-E 3  │ │     OpenAI      │
│   (이미지분석)  │ │ (이미지생성)│ │   Embeddings    │
└─────────────────┘ └─────────────┘ └─────────────────┘
```

### 11.2 사용자 여정 흐름

```
[방문자]
    │
    ▼
[index.html] ─── 메인 페이지 탐색
    │
    ├─→ [로그인 필요] ─→ [login.html]
    │                        │
    │                        ├─→ [signup.html] (신규 가입)
    │                        │
    │                        └─→ [forgot-password.html]
    │
    ▼
[로그인 완료]
    │
    ├─→ Standard ─→ [ai-design.html]
    │                   │
    │                   ├─ 카테고리 선택
    │                   ├─ 이미지 업로드
    │                   ├─ 스타일 선택
    │                   └─ AI 생성 → 결과 확인
    │
    ├─→ Expert/Business ─→ [detaildesign.html]
    │                           │
    │                           └─ 고급 설계 도구
    │
    └─→ [mypage.html]
            │
            ├─ 프로필 관리
            ├─ [my-designs.html] (내 설계)
            └─ 등급 변경
```

### 11.3 AI 설계 생성 흐름

```
[사용자: 이미지 업로드]
         │
         ▼
[Base64 인코딩]
         │
         ▼
[N8N Webhook 호출]
         │
         ▼
┌────────────────────────────────┐
│     1단계: Claude Vision       │
│  ─────────────────────────────│
│  • 벽 구조 분석                │
│  • 장애물 감지                 │
│  • 치수 추정                   │
└────────────────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│     2단계: DALL-E 3 생성       │
│  ─────────────────────────────│
│  • 원본 이미지                 │
│  • 도어 닫힘 렌더링            │
│  • 도어 열림 렌더링            │
└────────────────────────────────┘
         │
         ▼
[결과 반환 → UI 표시]
         │
         ├─→ 다운로드 (PNG)
         ├─→ 공유 (URL)
         └─→ 저장 (Supabase)
```

---

## 12. 권장 개선사항

### 12.1 즉시 개선 (우선순위: 높음)

| 항목      | 현재 상태 | 권장 조치                      |
| --------- | --------- | ------------------------------ |
| CI/CD     | 미구성    | GitHub Actions 워크플로우 추가 |
| HTML 검증 | 없음      | html-validate 자동화           |
| 링크 체크 | 없음      | linkinator 추가                |
| 보안 검사 | 없음      | 환경 변수 누출 방지            |

### 12.2 성능 최적화 (우선순위: 중간)

| 항목              | 현재 상태 | 권장 조치               |
| ----------------- | --------- | ----------------------- |
| detaildesign.html | 404KB     | 코드 분할, 모듈화       |
| 이미지 최적화     | 미적용    | WebP 변환, lazy loading |
| 번들링            | 없음      | Vite 또는 esbuild 도입  |

### 12.3 기능 개선 (우선순위: 낮음)

| 항목          | 현재 상태 | 권장 조치           |
| ------------- | --------- | ------------------- |
| PWA           | 미적용    | Service Worker 추가 |
| 오프라인 지원 | 없음      | IndexedDB 캐싱      |
| 접근성        | 기본      | ARIA 속성 강화      |

### 12.4 보안 강화

```
□ Supabase RLS 정책 검토
□ API 키 순환 정책 수립
□ n8n Webhook 인증 강화
□ Rate Limiting 구현
□ CORS 정책 검토
```

---

## 부록

### A. 환경 변수 목록

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://vvqrvgcgnlfpiqqndsve.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key

# Firebase (선택적)
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_domain
FIREBASE_PROJECT_ID=your_project_id
```

### B. 주요 파일 경로 참조

| 컴포넌트          | 경로                  |
| ----------------- | --------------------- |
| 메인 페이지       | /index.html           |
| AI 설계           | /ai-design.html       |
| 상세 설계         | /detaildesign.html    |
| Supabase 유틸     | /js/supabase-utils.js |
| DB 스키마         | /database/\*.sql      |
| 포트폴리오 이미지 | /app/portfolio/\*.jpg |

### C. 문서 버전 이력

| 버전 | 날짜       | 변경 내용 |
| ---- | ---------- | --------- |
| 1.0  | 2026-01-26 | 최초 작성 |

---

**작성자**: Claude AI Assistant **검토자**: - **승인자**: -
