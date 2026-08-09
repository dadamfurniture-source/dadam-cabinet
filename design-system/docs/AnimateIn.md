---
category: Motion
---

# AnimateIn

진입 애니메이션 래퍼(`.d-animate-in`). 16px 아래에서 위로 떠오르며 0.5s 동안 페이드인한다.

```tsx
<AnimateIn>
  <PageHeader overline="Consultation" title="맞춤 상담" />
</AnimateIn>
<AnimateIn delay={1}><Card>…</Card></AnimateIn>
<AnimateIn delay={2}><Card>…</Card></AnimateIn>
```

## delay

1~4 단계이며 한 단계마다 0.08s 씩 밀린다. 형제 요소에 1, 2, 3, 4 를 차례로 주면
계단식으로 나타난다. **첫 요소에는 delay 를 주지 않는다.**

## 주의

페이지 첫 화면(above the fold) 요소에만 쓴다. 스크롤 트리거가 아니라
마운트 즉시 재생되므로 아래쪽 콘텐츠에 걸면 사용자가 애니메이션을 놓친다.
