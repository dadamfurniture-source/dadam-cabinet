---
category: Navigation
---

# MobileMenu

전체 화면 모바일 메뉴(`.mobile-menu`). 열리면 뷰포트를 덮고 18px 링크를 세로로 쌓는다.
상단 100px 패딩이 있어 고정된 `Nav` 를 가리지 않는다.

```tsx
<MobileMenu
  open={open}
  links={[
    { label: '컬렉션', href: '/collection', active: true },
    { label: '상담', href: '/consultation' },
  ]}
/>
```

## 주의

- `open={false}` 면 `display: none` 이라 **아무것도 보이지 않는다** — 빈 화면이 아니라 닫힌 상태다.
- `Nav` 와 같은 `links` 배열을 그대로 넘기면 데스크톱/모바일 메뉴가 자동으로 일치한다.
- `Hamburger` 와 상태를 공유한다.
