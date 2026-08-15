import { Input, Label } from '@dadam/design-system';

export const WithLabel = () => (
  <div style={{ maxWidth: 420 }}>
    <Label htmlFor="p-name">이름</Label>
    <Input id="p-name" placeholder="홍길동" />
  </div>
);

export const Filled = () => (
  <div style={{ maxWidth: 420 }}>
    <Label htmlFor="p-phone">연락처</Label>
    <Input id="p-phone" type="tel" defaultValue="010-2345-6789" />
  </div>
);

export const Stacked = () => (
  <div style={{ maxWidth: 420 }}>
    <Label htmlFor="p-a">이름</Label>
    <Input id="p-a" placeholder="홍길동" />
    <div className="d-mt-md">
      <Label htmlFor="p-b">시공 예정 주소</Label>
      <Input id="p-b" placeholder="서울시 강남구" />
    </div>
  </div>
);
