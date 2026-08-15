---
category: Forms
---

# Select

드롭다운 선택(`.d-select`). `Input` 과 같은 테두리·포커스 토큰을 공유한다.

```tsx
<Label htmlFor="cat">가구 종류</Label>
<Select id="cat" defaultValue="sink">
  <option value="sink">싱크대</option>
  <option value="wardrobe">붙박이장</option>
  <option value="fridge">냉장고장</option>
</Select>
```

## 주의

네이티브 `<select>` 라 화살표 아이콘은 OS 기본 모양을 따른다.
디자인 시스템에 커스텀 드롭다운은 없다 — 필요하면 새로 만들지 말고 이 컴포넌트를 쓴다.
