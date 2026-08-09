import * as React from 'react';
import { cx } from './cx';

export interface HamburgerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 열림 상태(`.active`) — 세 줄이 X 자로 접힌다. */
  active?: boolean;
}

/**
 * 모바일 메뉴 토글 버튼(`.hamburger`). 24×2px 막대 세 개로 이루어지며
 * **768px 이하에서만 보인다**(그 위에서는 `display: none`).
 * `MobileMenu` 의 열림 상태를 제어하는 짝이다.
 */
export function Hamburger({ active = false, className, ...rest }: HamburgerProps) {
  return (
    <button
      className={cx('hamburger', active && 'active', className)}
      type="button"
      aria-label="메뉴"
      aria-expanded={active}
      {...rest}
    >
      <span />
      <span />
      <span />
    </button>
  );
}
