---
category: Surfaces
---

# Card

기본 카드 표면(`.d-card`). 흰 배경 + 얇은 테두리 + 22px 라운드이며
hover 시 그림자가 한 단계 올라간다. 패딩은 `clamp(20px, 3vw, 32px)` 로 반응형이다.

```tsx
<Card>
  <h3>주방 리모델링</h3>
  <p className="d-text-secondary">상담부터 시공까지 4~6주</p>
</Card>
```

## glass

`glass` 를 주면 `.d-card-glass` 가 함께 적용되어 반투명 + blur(20px) 표면이 된다.
사진이나 컬러 배경 **위에 얹을 때만** 쓴다 — 흰 배경 위에서는 차이가 보이지 않는다.

## 주의

카드 안의 간격은 `.d-mt-*` / `.d-mb-*` 유틸리티로 잡는다. Card 자체는 레이아웃을 강제하지 않는다.
