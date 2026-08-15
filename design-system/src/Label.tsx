import * as React from 'react';
import { cx } from './cx';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

/**
 * 폼 필드 라벨(`.d-label`). 13px 세미볼드 보조색 텍스트를
 * 블록으로 깔고 아래 6px 여백을 둔다.
 */
export function Label({ className, children, ...rest }: LabelProps) {
  return (
    <label className={cx('d-label', className)} {...rest}>
      {children}
    </label>
  );
}
