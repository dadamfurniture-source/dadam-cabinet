import { AnimateIn, Card, Grid } from '@dadam/design-system';

// 애니메이션은 `both` 라서 종료 상태가 유지된다 — 정지 캡처에서도 최종 모습이 보인다.
export const Single = () => (
  <AnimateIn>
    <Card style={{ maxWidth: 360 }}>마운트되면 16px 아래에서 떠오릅니다.</Card>
  </AnimateIn>
);

export const Staggered = () => (
  <Grid columns={4}>
    <AnimateIn>
      <Card style={{ textAlign: 'center' }}>1</Card>
    </AnimateIn>
    <AnimateIn delay={1}>
      <Card style={{ textAlign: 'center' }}>2</Card>
    </AnimateIn>
    <AnimateIn delay={2}>
      <Card style={{ textAlign: 'center' }}>3</Card>
    </AnimateIn>
    <AnimateIn delay={3}>
      <Card style={{ textAlign: 'center' }}>4</Card>
    </AnimateIn>
  </Grid>
);
