import * as React from 'react';
import { cx } from './cx';

export interface AnimateInProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 등장 지연 단계(1~4). 한 단계마다 0.08s 씩 밀리므로
   * 형제 요소에 1,2,3,4 를 차례로 주면 계단식으로 나타난다.
   */
  delay?: 1 | 2 | 3 | 4;
}

/**
 * 진입 애니메이션 래퍼(`.d-animate-in`). 16px 아래에서 위로 떠오르며
 * 0.5s 동안 페이드인한다. 페이지 첫 화면 요소에 사용한다.
 */
export function AnimateIn({ delay, className, children, ...rest }: AnimateInProps) {
  return (
    <div
      className={cx('d-animate-in', delay !== undefined && `d-delay-${delay}`, className)}
      {...rest}
    >
      {children}
    </div>
  );
}
