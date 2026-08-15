import { MobileMenu } from '@dadam/design-system';

// open={false} 는 display:none 이라 렌더할 그림이 없다 — 열린 상태만 카드로 만든다.
//
// .mobile-menu 는 position:fixed 라 그냥 두면 카드 밖으로 빠져나가
// 상단 100px 패딩 때문에 링크가 잘려 보인다.
// 조상에 transform 을 주면 그 요소가 fixed 의 컨테이닝 블록이 되어
// 오버레이가 이 상자 안에 갇힌다 — 실제 컴포넌트/실제 CSS 를 그대로 쓰면서
// 휴대폰 화면을 흉내 내는 방법이다.
const phone = {
  position: 'relative' as const,
  width: 360,
  height: 520,
  transform: 'translateZ(0)',
  overflow: 'hidden' as const,
  border: '1px solid var(--d-border)',
  borderRadius: 'var(--d-radius-md)',
};

export const Open = () => (
  <div style={phone}>
    <MobileMenu
      open
      links={[
        { label: '컬렉션', href: '/collection', active: true },
        { label: '상담', href: '/consultation' },
        { label: '내 디자인', href: '/my-designs' },
        { label: '마이페이지', href: '/mypage' },
      ]}
    />
  </div>
);
