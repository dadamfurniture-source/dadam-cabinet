import { Divider } from '@dadam/design-system';

export const BetweenSections = () => (
  <div style={{ maxWidth: 520 }}>
    <h3 style={{ margin: 0 }}>상담 안내</h3>
    <p className="d-text-secondary" style={{ margin: '8px 0 0' }}>
      실측은 평균 40분이 걸립니다.
    </p>
    <Divider />
    <h3 style={{ margin: 0 }}>시공 일정</h3>
    <p className="d-text-secondary" style={{ margin: '8px 0 0' }}>
      설계 확정 후 4~6주 소요됩니다.
    </p>
  </div>
);
