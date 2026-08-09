import * as React from 'react';
import { cx } from './cx';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 채움 스타일. primary=차콜, gold=브랜드 그라디언트, outline=테두리형. */
  variant?: 'primary' | 'gold' | 'outline';
  /** 크기 단계. 생략하면 기본(12/24 패딩). */
  size?: 'sm' | 'lg';
  /** 값을 주면 button 대신 a 로 렌더한다. 알약 스타일은 동일. */
  href?: string;
}

/**
 * 다담 알약형 버튼(`.d-btn`). 모든 페이지의 기본 액션 컨트롤이며
 * 아이콘+텍스트를 8px gap 으로 가로 정렬한다.
 */
export function Button({
  variant = 'primary',
  size,
  href,
  className,
  children,
  ...rest
}: ButtonProps) {
  const cls = cx('d-btn', `d-btn-${variant}`, size && `d-btn-${size}`, className);

  if (href !== undefined) {
    const anchorProps = rest as unknown as React.AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a className={cls} href={href} {...anchorProps}>
        {children}
      </a>
    );
  }

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
