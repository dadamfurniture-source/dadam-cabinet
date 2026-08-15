---
category: Navigation
---

# Nav

상단 고정 네비게이션 바(`.nav`). 화면 상단에 `position: fixed` 로 붙고
로고 · 메뉴 · 우측 액션을 좌우 끝으로 분배한다.
높이는 80 / 72 / 64 / 56px 로 뷰포트에 따라 줄어든다.

```tsx
<Nav
  logo={<span>다담가구</span>}
  links={[
    { label: '컬렉션', href: '/collection', active: true },
    { label: '상담', href: '/consultation' },
  ]}
  actions={<NavUserMenu name="홍길동" items={[{ label: '마이페이지', href: '/mypage' }]} />}
/>
```

## solid — 반드시 이해할 것

- `solid`(기본 true) — 흰 반투명 배경 + 그림자. **모든 서브페이지에서 이 상태를 쓴다.**
- `solid={false}` — 배경이 투명해지고 **로고·메뉴 글자가 흰색이 된다.**
  히어로 이미지 위에 얹는 랜딩(index.html) 전용이다.
  흰 배경 위에서 끄면 글씨가 보이지 않는다.

## 주의

- 반드시 `Page` 안에서 쓴다 — 고정 배치라 상단 패딩이 없으면 콘텐츠를 덮는다.
- `links` 는 768px 이하에서 숨겨진다. 모바일 대응은 `Hamburger` + `MobileMenu` 조합이다.
