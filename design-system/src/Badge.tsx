import * as React from 'react';
import { cx } from './cx';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** gold=연한 골드 배경 위 골드 텍스트, dark=차콜 배경 위 반전 텍스트. */
  tone?: 'gold' | 'dark';
}

/**
 * 상태·분류용 소형 배지(`.d-badge`). 11px 대문자 트래킹 텍스트를
 * 완전 라운드 알약 안에 담는다.
 */
export function Badge({ tone = 'gold', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('d-badge', `d-badge-${tone}`, className)} {...rest}>
      {children}
    </span>
  );
}
