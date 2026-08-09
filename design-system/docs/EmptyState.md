---
category: Data Display
---

# EmptyState

빈 목록 자리표시(`.d-empty`). 가운데 정렬로 아이콘 → 제목 → 설명을 쌓고
위아래 60px 여백을 확보한다. 텍스트는 흐린 3차 색이라 **화면을 지배하지 않는다.**

```tsx
<EmptyState
  icon={<SomeIcon />}
  title="저장된 디자인이 없습니다"
  description="상담을 시작하면 여기에 설계안이 쌓입니다."
>
  <Button className="d-mt-md" variant="gold">디자인 시작하기</Button>
</EmptyState>
```

## 조합

다음 행동을 유도하는 버튼은 children 으로 넣는다 — 컴포넌트가 액션 슬롯을 따로 두지 않는다.

## 주의

`icon` 은 48×48 영역에 `opacity: .3` 으로 흐려진다. 색이 있는 일러스트보다 단색 선 아이콘이 맞다.
