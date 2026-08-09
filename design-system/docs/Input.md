---
category: Forms
---

# Input

한 줄 텍스트 입력(`.d-input`). 폭 100%, 14px 라운드이며
포커스 시 테두리가 골드로 바뀌고 3px 골드 글로우가 붙는다.

```tsx
<Label htmlFor="name">이름</Label>
<Input id="name" placeholder="홍길동" />
```

## 조합

`Label` → `Input` 순서로 쌓는 것이 표준이다. Label 이 아래 6px 여백을 이미 갖고 있어
둘 사이에 별도 간격을 줄 필요가 없다. 필드 사이 간격은 `.d-mt-md` 로 잡는다.

## 주의

`Input` · `Textarea` · `Select` 는 같은 테두리·포커스 토큰을 공유하므로
한 폼 안에서 높이와 라운드가 정확히 맞는다. 셋을 섞어 써도 어긋나지 않는다.
