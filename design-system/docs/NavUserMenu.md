---
category: Navigation
---

# NavUserMenu

네비게이션 우측 사용자 메뉴(`.user-menu`). 골드 원형 아바타 + 이름 버튼이며,
`Nav` 의 `actions` 안에 넣어 쓴다.

```tsx
<Nav
  logo={<span>다담가구</span>}
  actions={
    <NavUserMenu
      name="홍길동"
      items={[
        { label: '마이페이지', href: '/mypage' },
        { label: '내 디자인', href: '/my-designs' },
        { label: '로그아웃' },
      ]}
    />
  }
/>
```

## 드롭다운은 CSS hover 로만 열린다

상태 prop 이 없다. `.user-menu:hover .user-dropdown` 규칙이 전부라
**정지 화면에서는 닫힌 상태만 보인다** — 정상이다.

`href` 가 있는 항목은 `<a>`, 없으면 `<button>` 으로 렌더된다.
CSS 가 마지막 `<button>` 에 구분선을 그어 주므로 **로그아웃을 맨 끝에 두고 href 를 비운다.**

## 주의

`name` 은 80px 를 넘으면 말줄임된다. `avatar` 를 생략하면 이름 첫 글자가 들어간다.
