import * as React from 'react';
import { cx } from './cx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 프로스티드 글래스 표면(`.d-card-glass`)을 덧입힌다.
   * 패딩·트랜지션은 `.d-card` 가 계속 담당하므로 두 클래스가 함께 적용된다.
   */
  glass?: boolean;
}

/**
 * 다담 기본 카드 표면(`.d-card`). 흰 배경 + 얇은 테두리 + 22px 라운드이며
 * hover 시 그림자가 한 단계 올라간다.
 */
export function Card({ glass = false, className, children, ...rest }: CardProps) {
  return (
    <div className={cx('d-card', glass && 'd-card-glass', className)} {...rest}>
      {children}
    </div>
  );
}
