import { NavUserMenu } from '@dadam/design-system';

const items = [
  { label: '마이페이지', href: '/mypage' },
  { label: '내 디자인', href: '/my-designs' },
  { label: '로그아웃' },
];

// 닫힌 상태 — 실제 네비게이션에서 기본으로 보이는 모습.
export const Collapsed = () => (
  <div className="nav nav-solid" style={{ position: 'static', height: 72 }}>
    <span />
    <NavUserMenu name="홍길동" items={items} />
  </div>
);

// 드롭다운은 CSS :hover 로만 열려서 정지 화면에 잡히지 않는다.
// 실제 컴포넌트/실제 CSS 를 그대로 쓰되 hover 게이트만 무력화해 내용을 보여준다.
export const DropdownOpen = () => (
  <>
    <style>{`.dsforce .user-dropdown{opacity:1;visibility:visible;transform:none}`}</style>
    <div
      className="nav nav-solid dsforce"
      style={{ position: 'static', height: 72, paddingBottom: 180 }}
    >
      <span />
      <NavUserMenu name="홍길동" items={items} />
    </div>
  </>
);
