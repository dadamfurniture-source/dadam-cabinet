import * as React from 'react';
import { cx } from './cx';

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 데스크톱 열 수. 태블릿(≤1024px)에서 3·4열은 2열로,
   * 모바일(≤768px)에서는 모두 1열로 자동 축소된다.
   */
  columns?: 2 | 3 | 4;
}

/**
 * 반응형 그리드(`.d-grid-2` / `.d-grid-3` / `.d-grid-4`). 20px gap 고정.
 */
export function Grid({ columns = 3, className, children, ...rest }: GridProps) {
  return (
    <div className={cx(`d-grid-${columns}`, className)} {...rest}>
      {children}
    </div>
  );
}
