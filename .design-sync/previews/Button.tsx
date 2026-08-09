import { Button } from '@dadam/design-system';

const row = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  flexWrap: 'wrap' as const,
};

export const Variants = () => (
  <div style={row}>
    <Button variant="primary">상담 신청</Button>
    <Button variant="gold">무료 견적 받기</Button>
    <Button variant="outline">컬렉션 보기</Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button variant="gold" size="sm">
      자세히
    </Button>
    <Button variant="gold">자세히 보기</Button>
    <Button variant="gold" size="lg">
      지금 상담 신청하기
    </Button>
  </div>
);

export const AsLink = () => (
  <div style={row}>
    <Button href="/collection" variant="outline">
      컬렉션 보기
    </Button>
    <Button href="/consultation" variant="primary">
      상담 페이지로
    </Button>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Button variant="primary" disabled>
      신청 완료됨
    </Button>
    <Button variant="outline" disabled>
      마감된 일정
    </Button>
  </div>
);
