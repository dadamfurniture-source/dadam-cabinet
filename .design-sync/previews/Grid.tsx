import { Grid, Card } from '@dadam/design-system';

const cell = (n: number) => (
  <Card key={n} style={{ textAlign: 'center' }}>
    {n}
  </Card>
);

export const TwoColumns = () => <Grid columns={2}>{[1, 2].map(cell)}</Grid>;

export const ThreeColumns = () => <Grid columns={3}>{[1, 2, 3].map(cell)}</Grid>;

export const FourColumns = () => <Grid columns={4}>{[1, 2, 3, 4].map(cell)}</Grid>;

export const WithContent = () => (
  <Grid columns={3}>
    <Card>
      <h4 style={{ margin: 0 }}>실측</h4>
      <p className="d-text-secondary d-mt-sm" style={{ margin: 0 }}>
        평균 40분
      </p>
    </Card>
    <Card>
      <h4 style={{ margin: 0 }}>설계</h4>
      <p className="d-text-secondary d-mt-sm" style={{ margin: 0 }}>
        3일 이내 전달
      </p>
    </Card>
    <Card>
      <h4 style={{ margin: 0 }}>시공</h4>
      <p className="d-text-secondary d-mt-sm" style={{ margin: 0 }}>
        4~6주 소요
      </p>
    </Card>
  </Grid>
);
