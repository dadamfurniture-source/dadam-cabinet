# Next.js 트랙 — Archive

## 왜 archive 되었나

이 디렉터리는 다담AI 저장소에 있던 **Next.js 14 기반 React 트랙**의 보존본이다. 2026-05-04 기준으로 다음과 같은 사실이 확인되어 archive 되었다.

### 운영 사이트가 사용하지 않음

`https://dadamfurniture.com`의 다음 URL을 브라우저로 직접 확인한 결과:

| URL | 표시된 콘텐츠 | 결론 |
|---|---|---|
| `/portfolio` | `index.html`의 메인 hero("DADAM KITCHEN") | Next의 `app/portfolio/page.tsx`(292줄, 카테고리 필터 포함)는 배포되지 않음 |
| `/pricing` | 동일 (메인 hero) | Next의 `app/pricing/page.tsx`도 배포되지 않음 |

→ GitHub Pages는 정적 HTML(`index.html`, `detaildesign.html` 등)만 서빙하고 있고, Next 빌드 산출물(`out/`)은 deploy 파이프라인에 포함되어 있지 않다.

### 두 트랙 동기화 부채

`lib/planner.ts`(854줄, 본 archive)와 `planner-vite/src/lib/planner.ts`(1644줄, 운영 트랙)가 같은 도메인 모델을 두 번 보유하며, 일부는 이미 발산되었다(예: sink 카테고리 `defaultDepth` 600 vs 650). 한쪽이 dead path로 확정되었으므로 이 부담을 즉시 청산.

### React 메이저 버전 미스매치

| 트랙 | React | @react-three/fiber | @react-three/drei |
|---|---|---|---|
| 본 archive (Next) | 18.2 | 8.18 | 9.122 |
| 운영 (planner-vite) | 19.0 | 9.5 | 10.7 |

운영은 R3F v9 + drei v10의 신 API를 쓴다. 본 archive의 컴포넌트는 v8 API에 맞춰져 있어 운영으로 코드 단순 이식 시 깨진다.

## 무엇이 들어 있나

```
archive/next-planner/
├── README.md                       (본 문서)
├── app/                            Next.js App Router 트리 전체
│   ├── layout.tsx, page.tsx        루트 레이아웃 + 메인 페이지
│   ├── globals.css
│   ├── account/billing/page.tsx
│   ├── billing/{cancel,success}/page.tsx
│   ├── embed/page.tsx              3D 플래너 임베드 (Vite로 대체됨)
│   ├── login/page.tsx              (정적 login.html이 운영)
│   ├── material/                   (정적 material.html이 운영) + 자재 인증서 jpg
│   ├── planner/page.tsx            3D 플래너 (Vite로 대체됨)
│   ├── portfolio/page.tsx          시공 사례 (운영 미사용) + 사례 이미지 다수
│   ├── pricing/page.tsx            구독 플랜
│   ├── signup/page.tsx             (정적 signup.html이 운영)
│   └── lib/payments.ts             결제 헬퍼
├── components/planner/             R3F 캔버스 컴포넌트
│   ├── DadamPlanner.tsx            (483줄, 풀스크린 뷰어)
│   └── EmbedCanvas.tsx             (880줄, 임베드용)
├── lib/
│   ├── planner.ts                  도메인 모델 (854줄, 운영의 1644줄과 별개)
│   └── supabase.ts                 (운영은 js/supabase-utils.js 사용)
├── next.config.js                  output:'export', assetPrefix:'/planner'
├── tailwind.config.js              Next 트랙 전용 (정적 HTML 미사용)
└── postcss.config.js               동일
```

## 운영 자산 위치 매핑

| 옛 Next 자원 | 운영 위치 |
|---|---|
| `app/page.tsx` | `index.html` |
| `app/login/page.tsx` | `login.html` |
| `app/signup/page.tsx` | `signup.html` |
| `app/material/page.tsx` | `material.html` |
| `app/embed/page.tsx`, `app/planner/page.tsx` | `planner-vite/` → 빌드 결과 `planner/embed/` |
| `lib/planner.ts` 도메인 모델 | `planner-vite/src/lib/planner.ts` |
| `components/planner/*` | `planner-vite/src/App.tsx` |

## 후속 작업 (TODO)

1. **`index.html`의 죽은 링크 정리**
   - `index.html:1405` `<a href="/pricing">구독 플랜</a>` — Next 트랙이 dead이므로 fallback으로 메인 hero가 뜸. 정적 페이지 신설 또는 메뉴 제거 필요.
   - `index.html:1441` `<a href="/account/billing">구독 관리</a>` — 동일.
   - 결제(`/billing/success`, `/billing/cancel`) 흐름은 외부 결제 게이트웨이 콜백 URL일 가능성 — 결제 시스템 설정 확인 후 정리.
2. **`package.json` 정리** (별도 PR 권장)
   - `"dev": "next dev"`, `"build": "next build"` 스크립트 제거 또는 의미 있는 것으로 교체.
   - `next`, `react`, `react-dom`, `@next/eslint-plugin-next`, `tailwindcss`, `postcss`, `@react-three/fiber@8`, `@react-three/drei@9`, `@types/react@18`, `@types/react-dom@18` 등 dead 의존성 제거.
   - `@react-three/*`/`three`는 planner-vite가 자체 의존을 갖고 있으므로 루트에서 제거 가능.
3. **CLAUDE.md 도메인 소유권 표 갱신**
   - 현재: `3D Planner | lib/planner.ts, components/planner/* | agent/planner-*`
   - 변경: `3D Planner | planner-vite/src/** , planner/embed/** | agent/planner-*`

## 복구 방법

만약 archive 결정이 잘못되었음이 후속에 밝혀지면:

```bash
git mv archive/next-planner/app .
git mv archive/next-planner/components .
git mv archive/next-planner/lib/planner.ts lib/
git mv archive/next-planner/lib/supabase.ts lib/
git mv archive/next-planner/next.config.js .
git mv archive/next-planner/tailwind.config.js .
git mv archive/next-planner/postcss.config.js .
```

## 관련 문서

- `docs/04-report/floorplan-migration-M0-decisions.md` — Floorplan 마이그레이션 M0 합의서
- 점검 보고서: detaildesign / planner 점검 보고 (이전 세션 산출물)
