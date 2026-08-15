import * as React from 'react';
import { cx } from './cx';

export interface NavUserMenuItem {
  label: string;
  /** 주면 `<a>`, 없으면 `<button>` 으로 렌더된다. */
  href?: string;
  /** 18px 로 정규화되는 선행 아이콘. */
  icon?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export interface NavUserMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 표시 이름. 80px 를 넘으면 말줄임 처리된다. */
  name: string;
  /** 아바타 원 안의 내용. 생략하면 이름 첫 글자를 쓴다. */
  avatar?: React.ReactNode;
  /** 드롭다운 항목들. 마지막 `<button>` 은 구분선이 붙어 로그아웃 자리로 쓰인다. */
  items?: NavUserMenuItem[];
}

/**
 * 네비게이션 우측 사용자 메뉴(`.user-menu`). 골드 원형 아바타 + 이름 버튼이며
 * **드롭다운은 CSS `:hover` 로만 열린다** — JS 상태가 없다.
 * `Nav` 의 `actions` 안에 넣어 사용한다.
 */
export function NavUserMenu({
  name,
  avatar,
  items = [],
  className,
  children,
  ...rest
}: NavUserMenuProps) {
  return (
    <div className={cx('user-menu', className)} {...rest}>
      <button className="user-btn" type="button">
        <span className="user-avatar">{avatar ?? name.slice(0, 1)}</span>
        <span className="user-name">{name}</span>
      </button>
      {items.length > 0 && (
        <div className="user-dropdown">
          {items.map((item) =>
            item.href !== undefined ? (
              <a key={item.label} href={item.href}>
                {item.icon}
                {item.label}
              </a>
            ) : (
              <button key={item.label} type="button" onClick={item.onClick}>
                {item.icon}
                {item.label}
              </button>
            )
          )}
          {children}
        </div>
      )}
    </div>
  );
}
