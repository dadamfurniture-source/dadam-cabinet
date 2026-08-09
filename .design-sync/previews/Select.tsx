import { Select, Label } from '@dadam/design-system';

export const WithLabel = () => (
  <div style={{ maxWidth: 420 }}>
    <Label htmlFor="s-cat">가구 종류</Label>
    <Select id="s-cat" defaultValue="sink">
      <option value="sink">싱크대</option>
      <option value="wardrobe">붙박이장</option>
      <option value="fridge">냉장고장</option>
      <option value="homecafe">홈카페장</option>
    </Select>
  </div>
);

export const InForm = () => (
  <div style={{ maxWidth: 420 }}>
    <Label htmlFor="s-region">시공 지역</Label>
    <Select id="s-region" defaultValue="seoul">
      <option value="seoul">서울</option>
      <option value="gyeonggi">경기</option>
      <option value="incheon">인천</option>
    </Select>
    <div className="d-mt-md">
      <Label htmlFor="s-when">희망 시공 시기</Label>
      <Select id="s-when" defaultValue="1m">
        <option value="1m">1개월 이내</option>
        <option value="3m">3개월 이내</option>
        <option value="later">미정</option>
      </Select>
    </div>
  </div>
);
