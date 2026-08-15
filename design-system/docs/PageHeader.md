---
category: Layout
---

# PageHeader

가운데 정렬 페이지 헤더(`.d-page-header`). 오버라인 → 디스플레이 제목 → 서브타이틀 순으로 쌓는다.
제목은 Cormorant Garamond 로 `clamp(28px, 5vw, 48px)` 크기다.

```tsx
<PageHeader
  overline="Consultation"
  title="맞춤 상담"
  subtitle="공간 사진 한 장이면 설계안을 만들어 드립니다."
/>
```

## 주의

- `overline` 은 골드 대문자 트래킹이라 **영문 한 단어**가 가장 잘 어울린다.
- `subtitle` 은 480px 로 폭이 제한되고 가운데 정렬된다 — 두 문장을 넘기지 않는다.
- 페이지당 하나만 쓴다(`<h1>` 을 렌더한다).
