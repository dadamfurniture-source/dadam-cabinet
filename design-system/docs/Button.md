---
category: Actions
---

# Button

다담 알약형 버튼(`.d-btn`). 모든 페이지의 기본 액션 컨트롤이다.
아이콘과 텍스트를 8px gap 으로 가로 정렬하므로 아이콘은 children 앞에 그냥 넣으면 된다.

```tsx
<Button variant="gold" size="lg">무료 상담 신청</Button>
<Button variant="outline" href="/collection">컬렉션 보기</Button>
```

## variant

- `primary` (기본) — 차콜 채움. 화면당 한 개의 주요 액션에만 쓴다.
- `gold` — 브랜드 골드 그라디언트. 전환(상담·구매) 유도용.
- `outline` — 흰 배경 + 얇은 테두리. 보조 액션.

## 주의

- `href` 를 주면 `<button>` 대신 `<a>` 로 렌더된다. 스타일은 같다.
- 비활성 상태는 별도 클래스가 없다 — `disabled` 속성만 주면 브라우저 기본 처리를 따른다.
