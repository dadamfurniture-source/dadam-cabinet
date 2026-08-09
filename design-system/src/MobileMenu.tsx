import * as React from 'react';
import { cx } from './cx';
import type { NavLink } from './Nav';

export interface MobileMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 메뉴 링크들. `Nav` 의 `links` 와 같은 배열을 그대로 넘긴다. */
  links?: NavLink[];
  /** 열림 상태(`.active`). false 면 `display: none` 이라 아무것도 보이지 않는다. */
  open?: boolean;
}

/**
 * 전체 화면 모바일 메뉴(`.mobile-menu`). 열리면 뷰포트를 덮고
 * 18px 링크를 세로로 쌓는다. `Hamburger` 로 열고 닫는다.
 */
export function MobileMenu({
  links = [],
  open = false,
  className,
  children,
  ...rest
}: MobileMenuProps) {
  return (
    <div className={cx('mobile-menu', open && 'active', className)} {...rest}>
      {links.map((link) => (
        <a
          key={link.href + link.label}
          href={link.href}
          className={cx(link.active && 'active')}
        >
          {link.label}
        </a>
      ))}
      {children}
    </div>
  );
}
