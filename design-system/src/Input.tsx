import * as React from 'react';
import { cx } from './cx';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * 한 줄 텍스트 입력(`.d-input`). 폭 100%, 14px 라운드이며
 * 포커스 시 테두리가 골드로 바뀌고 3px 골드 글로우가 붙는다.
 */
export function Input({ className, ...rest }: InputProps) {
  return <input className={cx('d-input', className)} {...rest} />;
}
