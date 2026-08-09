import * as React from 'react';
import { cx } from './cx';

export interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 최대 폭. narrow=720px(읽기용), 기본=1200px, wide=1400px. */
  width?: 'narrow' | 'default' | 'wide';
}

/**
 * 가운데 정렬 콘텐츠 래퍼(`.d-container`). 좌우에 반응형 페이지 여백
 * (`--d-page-px`)을 넣고 최대 폭을 제한한다.
 */
export function Container({
  width = 'default',
  className,
  children,
  ...rest
}: ContainerProps) {
  return (
    <div
      className={cx(
        'd-container',
        width === 'narrow' && 'd-container-narrow',
        width === 'wide' && 'd-container-wide',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
