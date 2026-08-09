import { Container, Card } from '@dadam/design-system';

// 최대 폭 차이를 보이려면 배경이 있어야 한다 — 컨테이너 자체는 투명하다.
const bg = { background: 'var(--d-bg-warm)', padding: '16px 0' };

export const Default = () => (
  <div style={bg}>
    <Container>
      <Card>기본 폭 — 1200px. 일반 콘텐츠와 그리드에 쓴다.</Card>
    </Container>
  </div>
);

export const Narrow = () => (
  <div style={bg}>
    <Container width="narrow">
      <Card>
        narrow — 720px. 폼과 읽기 위주 본문에 쓴다. 줄 길이가 짧아져 읽기가 편해진다.
      </Card>
    </Container>
  </div>
);

export const Wide = () => (
  <div style={bg}>
    <Container width="wide">
      <Card>wide — 1400px. 갤러리처럼 넓게 펼치는 화면에 쓴다.</Card>
    </Container>
  </div>
);
