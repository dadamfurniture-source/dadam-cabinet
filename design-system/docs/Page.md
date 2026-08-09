---
category: Layout
---

# Page

페이지 최상위 셸(`.d-page`). 최소 높이를 뷰포트로 잡고
고정 네비게이션 높이(`--d-nav-height`, 80px)만큼 상단 패딩을 확보한다.

```tsx
<Page>
  <Nav logo={<span>다담가구</span>} links={links} />
  <PageHeader overline="Consultation" title="상담 신청" />
  <Container width="narrow">…</Container>
</Page>
```

## 주의

`Nav` 가 `position: fixed` 라 이 상단 패딩이 없으면 첫 콘텐츠가 네비 아래로 숨는다.
**Nav 를 쓰는 화면은 반드시 Page 로 감싼다.**
