import * as React from 'react';
import { cx } from './cx';

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** 제목 위 골드 대문자 오버라인(`.d-overline`). 예: "Consultation". */
  overline?: React.ReactNode;
  /** 페이지 제목 — Cormorant Garamond 디스플레이 서체로 렌더된다. */
  title: React.ReactNode;
  /** 제목 아래 한 줄 설명(`.d-subtitle`). 480px 로 폭이 제한된다. */
  subtitle?: React.ReactNode;
}

/**
 * 가운데 정렬 페이지 헤더(`.d-page-header`).
 * 오버라인 → 디스플레이 제목 → 서브타이틀 순으로 쌓는다.
 */
export function PageHeader({
  overline,
  title,
  subtitle,
  className,
  children,
  ...rest
}: PageHeaderProps) {
  return (
    <header className={cx('d-page-header', className)} {...rest}>
      {overline !== undefined && <span className="d-overline">{overline}</span>}
      <h1>{title}</h1>
      {subtitle !== undefined && <p className="d-subtitle">{subtitle}</p>}
      {children}
    </header>
  );
}
