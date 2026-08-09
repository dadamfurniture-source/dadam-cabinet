---
category: Data Display
---

# Badge

상태·분류 표시용 소형 배지(`.d-badge`). 11px 대문자 트래킹 텍스트를 완전 라운드 알약에 담는다.
**짧은 라벨 전용** — 한 단어에서 두 단어까지가 적당하다.

```tsx
<Badge tone="gold">신규</Badge>
<Badge tone="dark">시공 완료</Badge>
```

## tone

- `gold` (기본) — 연한 골드 배경 위 골드 텍스트. 정보성·중립 상태.
- `dark` — 차콜 배경 위 반전 텍스트. 강조하거나 확정된 상태.

## 주의

CSS 에 `text-transform: uppercase` 가 걸려 있어 라틴 문자는 자동으로 대문자가 된다.
한글은 영향을 받지 않는다.
