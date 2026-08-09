import { GalleryItem, Grid } from '@dadam/design-system';

// 실제 파일에 의존하지 않도록 인라인 SVG 데이터 URI 를 쓴다 —
// 카드가 네트워크 상태와 무관하게 항상 같은 그림을 보여준다.
const shot = (label: string, from: string, to: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
       </linearGradient></defs>
       <rect width="400" height="300" fill="url(#g)"/>
       <text x="24" y="272" font-family="serif" font-size="22" fill="#fff">${label}</text>
     </svg>`
  );

export const InGrid = () => (
  <Grid columns={3}>
    <GalleryItem src={shot('주방', '#d9cfc0', '#8b7d68')} alt="화이트 오크 아일랜드 주방" />
    <GalleryItem src={shot('붙박이장', '#cfd6d9', '#6c7a85')} alt="침실 붙박이장 전면" />
    <GalleryItem src={shot('냉장고장', '#e0d5c8', '#a8927a')} alt="냉장고장 키큰장 구성" />
  </Grid>
);

export const WithCaption = () => (
  <div style={{ maxWidth: 320 }}>
    <GalleryItem src={shot('주방', '#d9cfc0', '#8b7d68')} alt="화이트 오크 아일랜드 주방" />
    <div className="d-mt-sm d-text-secondary" style={{ fontSize: 13 }}>
      화이트 오크 아일랜드 · 3.6m
    </div>
  </div>
);
