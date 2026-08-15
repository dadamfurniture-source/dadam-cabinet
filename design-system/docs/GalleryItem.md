---
category: Data Display
---

# GalleryItem

포트폴리오 썸네일 타일(`.d-gallery-item`). 이미지를 4:3 으로 크롭하고
hover 시 4px 떠오르며 그림자가 커진다. 커서는 pointer 라 **클릭 가능한 항목**에만 쓴다.

```tsx
<Grid columns={3}>
  <GalleryItem src="/app/portfolio/kitchen-01.jpg" alt="화이트 오크 아일랜드 주방" />
</Grid>
```

## 조합

`Grid` 와 함께 쓰는 것이 기본이다. 캡션이 필요하면 children 으로 넣되
카드 자체에는 패딩이 없으므로 캡션 쪽에 `.d-mt-sm` 등을 직접 준다.

## 주의

`alt` 는 필수다 — 포트폴리오 이미지는 검색·접근성 양쪽에서 의미를 가진다.
