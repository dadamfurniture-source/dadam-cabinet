import { Card, Badge, Button } from '@dadam/design-system';

export const Default = () => (
  <Card style={{ maxWidth: 360 }}>
    <Badge tone="gold">주방</Badge>
    <h3 className="d-mt-sm" style={{ margin: 0 }}>
      화이트 오크 아일랜드
    </h3>
    <p className="d-text-secondary d-mt-sm" style={{ margin: 0 }}>
      3.6m 일자형 상부장 + 아일랜드 구성. 상판은 세라믹.
    </p>
  </Card>
);

export const WithAction = () => (
  <Card style={{ maxWidth: 360 }}>
    <h3 style={{ margin: 0 }}>상담 예약</h3>
    <p className="d-text-secondary d-mt-sm" style={{ margin: 0 }}>
      실측은 평균 40분, 설계안은 3일 안에 전달됩니다.
    </p>
    <Button variant="gold" className="d-mt-md">
      날짜 고르기
    </Button>
  </Card>
);

export const Glass = () => (
  <div
    style={{
      background: 'linear-gradient(135deg, #b8956c, #2d2a26)',
      padding: 32,
    }}
  >
    <Card glass style={{ maxWidth: 360 }}>
      <h3 style={{ margin: 0 }}>시공 사진 위에 얹기</h3>
      <p className="d-text-secondary d-mt-sm" style={{ margin: 0 }}>
        glass 는 컬러·사진 배경 위에서만 의미가 있습니다.
      </p>
    </Card>
  </div>
);
