---
category: Navigation
---

# Hamburger

모바일 메뉴 토글 버튼(`.hamburger`). 24×2px 막대 세 개로 이루어지며
`active` 일 때 X 자로 접힌다.

```tsx
const [open, setOpen] = React.useState(false);

<Nav actions={<Hamburger active={open} onClick={() => setOpen(!open)} />} />
<MobileMenu open={open} links={links} />
```

## 768px 이하에서만 보인다

CSS 가 `display: none` → `flex` 로 전환한다. 데스크톱 미리보기에서 보이지 않는 것이 정상이다.

## 주의

`MobileMenu` 와 같은 상태를 공유해야 한다. 둘 중 하나만 쓰면 열고 닫을 수 없다.
