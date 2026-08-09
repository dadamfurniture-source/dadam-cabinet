import { Textarea, Label } from '@dadam/design-system';

export const WithLabel = () => (
  <div style={{ maxWidth: 460 }}>
    <Label htmlFor="t-req">요청 사항</Label>
    <Textarea id="t-req" rows={5} placeholder="원하시는 구성이나 예산을 적어주세요" />
  </div>
);

export const Filled = () => (
  <div style={{ maxWidth: 460 }}>
    <Label htmlFor="t-memo">현장 메모</Label>
    <Textarea
      id="t-memo"
      rows={5}
      defaultValue={
        '주방 3.6m 일자형, 좌측 배관 있음.\n상부장은 개방형 선반 2칸 요청.\n입주 예정일 4월 12일.'
      }
    />
  </div>
);
