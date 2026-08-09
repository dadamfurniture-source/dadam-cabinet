---
category: Layout
---

# Container

가운데 정렬 콘텐츠 래퍼(`.d-container`). 좌우에 반응형 페이지 여백
(`--d-page-px`, 16~48px)을 넣고 최대 폭을 제한한다.

```tsx
<Container>…</Container>
<Container width="narrow">긴 본문 텍스트</Container>
```

## width

- `default` — 1200px. 일반 콘텐츠·그리드.
- `narrow` — 720px. 폼과 읽기 위주 본문. 줄 길이가 편해진다.
- `wide` — 1400px. 갤러리처럼 넓게 펼치는 화면.

## 주의

중첩해서 쓰지 않는다 — 페이지 여백이 두 번 적용되어 콘텐츠가 과하게 좁아진다.
