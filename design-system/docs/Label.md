---
category: Forms
---

# Label

폼 필드 라벨(`.d-label`). 13px 세미볼드 보조색 텍스트를 블록으로 깔고 아래 6px 여백을 둔다.

```tsx
<Label htmlFor="phone">연락처</Label>
<Input id="phone" type="tel" />
```

## 주의

`htmlFor` 를 반드시 컨트롤의 `id` 와 맞춘다 — 라벨 클릭으로 포커스가 이동하고
스크린리더가 필드 이름을 읽는다.
