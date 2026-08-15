---
category: Forms
---

# Textarea

여러 줄 텍스트 입력(`.d-textarea`). `Input` 과 동일한 테두리·포커스 처리에
최소 높이 100px, **세로 방향 리사이즈만** 허용한다(가로로 늘려 레이아웃을 깨뜨릴 수 없다).

```tsx
<Label htmlFor="req">요청 사항</Label>
<Textarea id="req" rows={5} placeholder="원하시는 구성이나 예산을 적어주세요" />
```

## 주의

`rows` 를 주면 최소 높이보다 커진다. 상담 요청처럼 긴 입력에는 `rows={5}` 이상을 권한다.
