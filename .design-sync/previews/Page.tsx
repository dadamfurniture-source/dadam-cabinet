import { Page, Nav, PageHeader, Container, Grid, Card } from '@dadam/design-system';

const links = [
  { label: '컬렉션', href: '/collection' },
  { label: '상담', href: '/consultation', active: true },
];

export const WithNavAndHeader = () => (
  <Page>
    <Nav logo={<span>다담가구</span>} links={links} />
    <PageHeader
      overline="Consultation"
      title="맞춤 상담"
      subtitle="공간 사진 한 장이면 설계안을 만들어 드립니다."
    />
    <Container width="narrow">
      <Grid columns={2}>
        <Card>실측 · 평균 40분</Card>
        <Card>설계안 · 3일 이내</Card>
      </Grid>
    </Container>
  </Page>
);
