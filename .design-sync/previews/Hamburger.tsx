import { Hamburger } from '@dadam/design-system';

// .hamburger 는 768px 초과에서 display:none 이다.
// 이 카드는 cfg.overrides.Hamburger.viewport 로 좁은 폭에서 렌더된다.
//
// 실제로 보이는 맥락(모바일 네비 바 우측)에 그대로 놓아, 닫힘/열림 두 상태를
// 위아래로 비교한다.
const bar = {
  position: 'relative' as const,
  transform: 'translateZ(0)',
  height: 64,
  marginBottom: 12,
};

export const States = () => (
  <div style={{ background: 'var(--d-bg)', padding: 16 }}>
    <div style={bar}>
      <div className="nav nav-solid">
        <span className="nav-logo">
          <span>다담가구</span>
        </span>
        <div className="nav-icons">
          <Hamburger />
        </div>
      </div>
    </div>
    <div style={bar}>
      <div className="nav nav-solid">
        <span className="nav-logo">
          <span>다담가구</span>
        </span>
        <div className="nav-icons">
          <Hamburger active />
        </div>
      </div>
    </div>
  </div>
);
