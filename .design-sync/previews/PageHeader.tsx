import { PageHeader } from '@dadam/design-system';

export const Default = () => (
  <PageHeader
    overline="Consultation"
    title="맞춤 상담"
    subtitle="공간 사진 한 장이면 설계안을 만들어 드립니다."
  />
);

export const TitleOnly = () => <PageHeader title="내 디자인" />;

export const LongSubtitle = () => (
  <PageHeader
    overline="Collection"
    title="다담 컬렉션"
    subtitle="주방부터 붙박이장까지, 실제 시공된 공간을 그대로 담았습니다. 마음에 드는 구성을 고르면 그대로 견적으로 이어집니다."
  />
);
