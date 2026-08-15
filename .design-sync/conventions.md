# 다담가구 디자인 시스템 — 사용 규칙

한국어 가구 맞춤제작 서비스(다담가구)의 디자인 시스템입니다.
따뜻한 크림 배경 + 차콜 텍스트 + 골드 강조가 브랜드의 기본 축입니다.

## 설정 — 프로바이더 없음

React 컨텍스트 프로바이더가 **없습니다.** 컴포넌트를 그냥 렌더하면 됩니다.
스타일은 전적으로 `styles.css` 가 담당하므로 그것만 로드되면 끝입니다.

화면을 짤 때 지켜야 하는 구조는 하나뿐입니다:

```tsx
<Page>                      {/* .d-page — 고정 Nav 높이(80px)만큼 상단 패딩 확보 */}
  <Nav logo={<span>다담가구</span>} links={links} />
  <PageHeader overline="Consultation" title="맞춤 상담" subtitle="…" />
  <Container width="narrow">…</Container>
</Page>
```

`Nav` 는 `position: fixed` 입니다. **`Page` 로 감싸지 않으면 첫 콘텐츠가 네비 아래로 숨습니다.**

## 스타일 표기법 — 클래스 유틸리티

CSS-in-JS 도, 스타일 prop 도 아닙니다. **클래스 이름**으로 씁니다.
아래는 `styles.css` 에 실제로 존재하는 이름 전부입니다. 여기 없는 이름은 만들지 마세요.

| 용도 | 클래스 |
|---|---|
| 간격 | `d-mt-sm` `d-mt-md` `d-mt-lg` `d-mb-sm` `d-mb-md` `d-mb-lg` `d-gap-sm` `d-gap-md` `d-gap-lg` |
| 레이아웃 | `d-flex` `d-flex-col` `d-items-center` `d-justify-between` `d-hidden` |
| 텍스트 | `d-text-gold` `d-text-secondary` `d-text-center` `d-overline` `d-subtitle` |
| 모션 | `d-animate-in` + `d-delay-1`…`d-delay-4` |

컴포넌트가 이미 있는 것(버튼·카드·배지·입력·그리드…)은 **클래스 대신 컴포넌트를 쓰세요.**
`<Button variant="gold">` 이 `class="d-btn d-btn-gold"` 보다 항상 낫습니다.

## 토큰

직접 색을 쓰지 말고 `var(--d-*)` 를 쓰세요. 실제 정의된 이름:

- 배경 — `--d-bg` `--d-bg-warm` `--d-bg-cool` `--d-surface` `--d-surface-dim` `--d-surface-glass`
- 브랜드 — `--d-gold` `--d-gold-light` `--d-gold-dim` `--d-charcoal` `--d-charcoal-soft` `--d-cream`
- 텍스트 — `--d-text` `--d-text-secondary` `--d-text-tertiary` `--d-text-inverse`
- 상태 — `--d-success` `--d-error` `--d-info`
- 경계/라운드 — `--d-border` `--d-border-subtle` `--d-radius-sm|md|lg|xl|full`
- 그림자 — `--d-shadow-sm|md|lg|glass`
- 서체 — `--d-font-display`(Cormorant Garamond → Noto Serif KR) `--d-font-body`(Pretendard) `--d-font-mono`
- 치수 — `--d-page-px` `--d-nav-height`

## 주의 — 같이 실려 있지만 쓰면 안 되는 것

`styles.css` 안에는 레거시 Next.js 페이지용 Tailwind 클래스도 함께 들어 있습니다:
`btn-primary` `btn-outline` `btn-ghost` `card-hover` `gradient-text` `section-padding`
`grid-pattern` `animate-fade-in` `animate-slide-in`, 그리고 `bg-dadam-*` / `text-dadam-*` / `border-dadam-*` 팔레트.

**새 화면에는 쓰지 마세요.** `d-btn` 계열과 시각적으로 충돌합니다.
`detaildesign` 내부 툴 클래스(`wm-*` `mp-*` `module-*` 등)도 마찬가지로 상세설계 화면 전용입니다.

## 정본 위치

- 스타일 — `_ds/<folder>/styles.css` (→ `_ds_bundle.css` 를 `@import` 합니다)
- 컴포넌트별 API·사용법 — 각 `components/<group>/<Name>/<Name>.prompt.md`

요약보다 실제 파일이 항상 정확합니다. 스타일을 만지기 전에 위 두 곳을 읽으세요.

## 예시

```tsx
<Container width="narrow">
  <PageHeader overline="Consultation" title="맞춤 상담"
    subtitle="공간 사진 한 장이면 설계안을 만들어 드립니다." />

  <Card className="d-mt-lg">
    <Badge tone="gold">주방</Badge>
    <h3 className="d-mt-sm" style={{ margin: 0 }}>화이트 오크 아일랜드</h3>
    <p className="d-text-secondary d-mt-sm" style={{ margin: 0 }}>
      3.6m 일자형 상부장 + 아일랜드 구성.
    </p>
    <Button variant="gold" className="d-mt-md">무료 견적 받기</Button>
  </Card>
</Container>
```
