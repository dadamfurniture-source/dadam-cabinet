---
category: Data Display
---

# Stat

수치 요약 타일(`.d-stat`). 따뜻한 톤(`--d-bg-warm`) 배경 위에 라벨 → 값 순으로 쌓는다.
값은 28px 디스플레이 서체(Cormorant Garamond)로 렌더되므로 **숫자 위주**일 때 가장 잘 보인다.

```tsx
<Grid columns={4}>
  <Stat label="누적 시공" value="1,240건" />
  <Stat label="평균 상담 기간" value="4주" />
</Grid>
```

## 조합

`Grid` 안에 3~4개를 나열해 KPI 행을 만드는 것이 표준 사용법이다.
단독으로 쓰면 배경 톤 차이가 잘 드러나지 않는다.

## 주의

`label` 은 11px 대문자로 렌더되니 짧게 유지한다. 긴 설명은 children 으로 아래에 덧붙인다.
