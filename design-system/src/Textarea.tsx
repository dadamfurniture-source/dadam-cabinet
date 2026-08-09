import * as React from 'react';
import { cx } from './cx';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * 여러 줄 텍스트 입력(`.d-textarea`). `Input` 과 동일한 테두리·포커스 처리에
 * 최소 높이 100px, 세로 방향 리사이즈만 허용한다.
 */
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cx('d-textarea', className)} {...rest} />;
}
