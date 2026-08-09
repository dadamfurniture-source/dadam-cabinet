import * as React from 'react';
import { cx } from './cx';

export type PageProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * 페이지 최상위 셸(`.d-page`). 최소 높이를 뷰포트로 잡고
 * 고정 네비게이션 높이(`--d-nav-height`, 80px)만큼 상단 패딩을 확보한다.
 * `Nav` 와 함께 쓰는 것을 전제로 한다.
 */
export function Page({ className, children, ...rest }: PageProps) {
  return (
    <div className={cx('d-page', className)} {...rest}>
      {children}
    </div>
  );
}
