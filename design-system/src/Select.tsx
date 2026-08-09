import * as React from 'react';
import { cx } from './cx';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * 드롭다운 선택(`.d-select`). `Input` 과 같은 테두리·포커스 토큰을 공유하므로
 * 폼 안에서 높이와 라운드가 정확히 맞는다.
 */
export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cx('d-select', className)} {...rest}>
      {children}
    </select>
  );
}
