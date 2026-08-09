---
category: Layout
---

# Grid

반응형 그리드(`.d-grid-2` / `.d-grid-3` / `.d-grid-4`). gap 은 20px 고정이다.

```tsx
<Grid columns={3}>
  <Card>…</Card>
  <Card>…</Card>
  <Card>…</Card>
</Grid>
```

## 축소 규칙 (CSS 가 자동 처리)

- ≤768px — 모든 그리드가 1열
- 769~1024px — 3열·4열은 2열로, 2열은 그대로

## 주의

열 수는 2·3·4 만 있다. 5열 이상이 필요하면 새 클래스를 만들지 말고
`Grid` 를 쓰지 않는 별도 레이아웃으로 처리한다.
