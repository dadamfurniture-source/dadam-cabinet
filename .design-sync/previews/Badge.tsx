import { Badge } from '@dadam/design-system';

const row = { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' as const };

export const Tones = () => (
  <div style={row}>
    <Badge tone="gold">신규</Badge>
    <Badge tone="dark">시공 완료</Badge>
  </div>
);

export const InContext = () => (
  <div style={row}>
    <Badge tone="gold">주방</Badge>
    <Badge tone="gold">붙박이장</Badge>
    <Badge tone="gold">냉장고장</Badge>
    <Badge tone="dark">상담중</Badge>
  </div>
);
