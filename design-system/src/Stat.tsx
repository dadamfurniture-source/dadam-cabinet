import * as React from 'react';
import { cx } from './cx';

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 지표 이름(`.d-stat-label`). 11px 대문자 트래킹으로 렌더된다. */
  label: React.ReactNode;
  /** 지표 값(`.d-stat-value`). 28px 디스플레이 서체로 렌더된다. */
  value: React.ReactNode;
}

/**
 * 수치 요약 타일(`.d-stat`). 따뜻한 톤 배경 위에
 * 라벨 → 값 순으로 쌓는다. `Grid` 안에 나열해 KPI 행을 만든다.
 */
export function Stat({ label, value, className, children, ...rest }: StatProps) {
  return (
    <div className={cx('d-stat', className)} {...rest}>
      <div className="d-stat-label">{label}</div>
      <div className="d-stat-value">{value}</div>
      {children}
    </div>
  );
}
