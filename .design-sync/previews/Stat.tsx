import { Stat, Grid } from '@dadam/design-system';

export const KpiRow = () => (
  <Grid columns={4}>
    <Stat label="누적 시공" value="1,240건" />
    <Stat label="평균 상담" value="4주" />
    <Stat label="재구매율" value="38%" />
    <Stat label="시공 지역" value="17개" />
  </Grid>
);

export const Single = () => (
  <div style={{ maxWidth: 240 }}>
    <Stat label="이번 달 상담" value="86건" />
  </div>
);
