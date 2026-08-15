import * as React from 'react';
import { cx } from './cx';

export type DividerProps = React.HTMLAttributes<HTMLHRElement>;

/**
 * 섹션 구분선(`.d-divider`). 1px 연한 경계선에 위아래 32px 여백이 붙는다.
 */
export function Divider({ className, ...rest }: DividerProps) {
  return <hr className={cx('d-divider', className)} {...rest} />;
}
