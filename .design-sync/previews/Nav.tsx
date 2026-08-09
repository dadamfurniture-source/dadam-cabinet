import { Nav, NavUserMenu } from '@dadam/design-system';

const links = [
  { label: '컬렉션', href: '/collection', active: true },
  { label: '상담', href: '/consultation' },
  { label: '내 디자인', href: '/my-designs' },
];

// .nav 은 position:fixed 라 그냥 두면 카드 밖으로 빠져나가 그리드를 덮는다.
// 조상에 transform 을 주면 그 요소가 fixed 의 컨테이닝 블록이 되어
// 네비가 이 상자 안에 갇힌다 — 실제 컴포넌트/실제 CSS 를 그대로 쓰면서
// 카드 안에 담는 방법이다.
const frame = {
  position: 'relative' as const,
  transform: 'translateZ(0)',
  minHeight: 96,
  overflow: 'hidden' as const,
};

const Logo = () => (
  <>
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="6" width="24" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="16" y1="6" x2="16" y2="26" stroke="currentColor" strokeWidth="1.6" />
    </svg>
    <span>다담가구</span>
  </>
);

export const SignedIn = () => (
  <div style={frame}>
    <Nav
      logo={<Logo />}
      links={links}
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
  </div>
);

export const SignedOut = () => (
  <div style={frame}>
    <Nav
      logo={<Logo />}
      links={links}
      actions={
        <a className="login-btn" href="/login">
          로그인
        </a>
      }
    />
  </div>
);

export const OnHeroImage = () => (
  <div
    style={{
      ...frame,
      background: 'linear-gradient(135deg, #2d2a26, #4a4640)',
      minHeight: 160,
    }}
  >
    <Nav logo={<Logo />} links={links} solid={false} />
  </div>
);
