import * as React from 'react';
import { cx } from './cx';

export interface NavLink {
  /** 링크 텍스트. */
  label: string;
  href: string;
  /** 현재 페이지 표시 — 골드 텍스트 + 연한 골드 배경. */
  active?: boolean;
}

export interface NavProps extends React.HTMLAttributes<HTMLElement> {
  /** 로고 영역 내용. 보통 SVG 마크 + 워드마크 `<span>`. */
  logo?: React.ReactNode;
  /** 로고 링크 대상. 기본값 `/`. */
  logoHref?: string;
  /** 가운데 메뉴 링크들. 모바일(≤768px)에서는 숨겨진다. */
  links?: NavLink[];
  /** 우측 영역 — `NavUserMenu`, 로그인 버튼, `Hamburger` 등. */
  actions?: React.ReactNode;
  /**
   * 흰 반투명 배경 + 그림자를 고정한다(`.nav-solid`).
   * 서브페이지 기본값이며, 끄면 투명 배경 위 흰 텍스트(index.html 히어로용).
   */
  solid?: boolean;
  /** 스크롤 상태(`.scrolled`) — solid 와 사실상 같은 표면을 준다. */
  scrolled?: boolean;
}

/**
 * 상단 고정 네비게이션 바(`.nav`). 화면 상단에 `position: fixed` 로 붙고
 * 로고 · 메뉴 · 우측 액션을 좌우 끝으로 분배한다. 높이는 80/72/64/56px 로
 * 뷰포트에 따라 줄어든다.
 */
export function Nav({
  logo,
  logoHref = '/',
  links = [],
  actions,
  solid = true,
  scrolled = false,
  className,
  children,
  ...rest
}: NavProps) {
  return (
    <nav
      className={cx('nav', solid && 'nav-solid', scrolled && 'scrolled', className)}
      {...rest}
    >
      <a className="nav-logo" href={logoHref}>
        {logo}
      </a>
      {links.length > 0 && (
        <div className="nav-menu">
          {links.map((link) => (
            <a
              key={link.href + link.label}
              href={link.href}
              className={cx(link.active && 'active')}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
      {(actions !== undefined || children !== undefined) && (
        <div className="nav-icons">
          {actions}
          {children}
        </div>
      )}
    </nav>
  );
}
