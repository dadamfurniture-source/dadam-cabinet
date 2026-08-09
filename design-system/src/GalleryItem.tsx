import * as React from 'react';
import { cx } from './cx';

export interface GalleryItemProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 썸네일 경로. 4:3 으로 크롭(`object-fit: cover`)된다. */
  src: string;
  /** 대체 텍스트. 포트폴리오 이미지이므로 항상 채운다. */
  alt: string;
}

/**
 * 포트폴리오 썸네일 타일(`.d-gallery-item`). 4:3 이미지를 라운드로 자르고
 * hover 시 4px 떠오르며 그림자가 커진다. 캡션은 children 으로 넣는다.
 */
export function GalleryItem({
  src,
  alt,
  className,
  children,
  ...rest
}: GalleryItemProps) {
  return (
    <div className={cx('d-gallery-item', className)} {...rest}>
      <img src={src} alt={alt} />
      {children}
    </div>
  );
}
