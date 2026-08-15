import * as React from 'react';
import { cx } from './cx';

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 48px 정사각 영역에 흐리게(opacity .3) 놓이는 아이콘. */
  icon?: React.ReactNode;
  /** 굵은 한 줄 제목(`.d-empty-title`). */
  title: React.ReactNode;
  /** 제목 아래 설명. 보통 다음 행동을 안내한다. */
  description?: React.ReactNode;
}

/**
 * 빈 목록 자리표시(`.d-empty`). 가운데 정렬로 아이콘 → 제목 → 설명을
 * 쌓고, 액션 버튼은 children 으로 덧붙인다.
 */
export function EmptyState({
  icon,
  title,
  description,
  className,
  children,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cx('d-empty', className)} {...rest}>
      {icon !== undefined && <div className="d-empty-icon">{icon}</div>}
      <div className="d-empty-title">{title}</div>
      {description !== undefined && <div>{description}</div>}
      {children}
    </div>
  );
}
