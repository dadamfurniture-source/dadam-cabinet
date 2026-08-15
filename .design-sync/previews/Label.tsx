import { Label, Input } from '@dadam/design-system';

export const Default = () => (
  <div style={{ maxWidth: 420 }}>
    <Label htmlFor="l-a">연락처</Label>
    <Input id="l-a" type="tel" placeholder="010-0000-0000" />
  </div>
);

export const Alone = () => (
  <div style={{ maxWidth: 420 }}>
    <Label>시공 예정일</Label>
  </div>
);
