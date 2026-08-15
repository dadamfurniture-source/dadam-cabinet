import { EmptyState, Button } from '@dadam/design-system';

const BoxIcon = () => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="8" y="14" width="32" height="26" rx="2" />
    <line x1="8" y1="22" x2="40" y2="22" />
    <line x1="24" y1="14" x2="24" y2="40" />
  </svg>
);

export const NoDesigns = () => (
  <EmptyState
    icon={<BoxIcon />}
    title="저장된 디자인이 없습니다"
    description="상담을 시작하면 여기에 설계안이 쌓입니다."
  >
    <Button variant="gold" className="d-mt-md">
      디자인 시작하기
    </Button>
  </EmptyState>
);

export const TitleOnly = () => <EmptyState title="검색 결과가 없습니다" />;
