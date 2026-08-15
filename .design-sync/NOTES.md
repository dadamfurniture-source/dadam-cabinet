# design-sync NOTES — 다담가구 Design System

## 이 저장소의 특수 사정

- **원래 컴포넌트 라이브러리가 없다.** 이 저장소는 정적 HTML + Vanilla JS 사이트 +
  Next.js 앱이 섞여 있고, 디자인 시스템은 `css/dadam-system.css` 의 CSS 클래스로만 존재했다.
  `design-system/` 패키지(`@dadam/design-system`)는 그 클래스를 React 로 감싸기 위해
  이 동기화 과정에서 새로 만든 것이다. **스타일은 여전히 `css/` 가 정본이고,
  패키지는 마크업/클래스 조합만 고정한다.**
- **`d-*` 컴포넌트 클래스는 프로덕션에서 거의 안 쓰인다.** 토큰(`var(--d-*)`)은 5개 페이지에서
  109회 쓰이지만, 컴포넌트 클래스는 `consultation.html` 의 `d-animate-in`/`d-overline` 뿐이었다.
  즉 이 동기화는 "쓰이지 않던 디자인 시스템"을 실제 사용 가능한 형태로 만든 셈이다.
  → 프리뷰를 저장소 사용례에서 가져올 수 없어 CSS + 컴포넌트 소스에서 작성했다.

## 빌드

- `npm run build --prefix design-system` = Tailwind 컴파일 → CSS 병합 → tsc.
- `design-system/scripts/build-css.mjs` 가 배포용 `dist/dadam-ds.css` 를 만든다(cfg.cssEntry).
  원본 CSS 를 복사해 두지 않고 **매 빌드마다 `css/` 에서 다시 읽는다** — 원본이 바뀌면 자동 반영.
- Tailwind 는 `design-system/tailwind.ds.cjs` 로 **preflight 를 끄고** 컴파일한다.
  preflight 를 켜면 dadam-system.css 의 리셋/`body` 기준선과 충돌해 배경·폰트가 뒤집힌다.

## 환경 (Windows)

- **npm 스크립트 안에서 `cd .. && node_modules/.bin/xxx` 를 쓰면 안 된다.** npm 이 cmd.exe 로
  실행해서 슬래시 경로를 못 찾는다. 대신 실행 파일 이름만 쓰고(`tailwindcss …` — npm 이
  상위 `node_modules/.bin` 을 PATH 에 넣어 준다) 경로 의존은 설정 파일 쪽에서 절대경로로 푼다
  (`tailwind.ds.cjs` 가 content 글롭을 저장소 루트 기준 절대경로로 바꾼다).
  이걸 안 고치면 `resync.mjs` 의 build 스테이지만 exit 1 로 죽는다(직접 실행은 bash 라 통과).
- **playwright 는 1.62.1 을 쓴다** — 이 머신 캐시에 chromium 1234 가 있고 1.62.1 이 그걸 핀한다
  (`~/.cache/ms-playwright`). 버전이 어긋나면 `Executable doesn't exist` 로 렌더 체크가 죽는다.
  새로 받을 필요 없다.

## CSS 병합 시 반드시 지켜야 하는 것

- **`css/detaildesign/*.css` 는 전역 요소 규칙을 걷어내고 실어야 한다.**
  원본에 `* { font-family: -apple-system }`, `body {}`, `h1 {}`, `label {}`,
  `input[type=...], select {}` 가 있다. 그대로 실으면 이 DS 로 만든 **모든** 화면의
  브랜드 폰트와 폼 컨트롤이 조용히 뒤집힌다.
  `build-css.mjs` 의 `isScopedSelector` 가 클래스/아이디로 한정되지 않은 규칙을 버린다
  (`:root` 토큰 블록만 예외로 유지 — `--d-*` 와 이름이 겹치지 않는다).
- **링크 기준선 `a { text-decoration:none; color:inherit; }` 를 반드시 넣는다.**
  공유 CSS 어디에도 없고 각 페이지 인라인 `<style>` 에만 있다. 빠지면 `.login-btn` 처럼
  color 를 직접 지정하지 않는 링크가 브라우저 기본 파란색으로 렌더된다
  (`border: 1px solid currentColor` 라 테두리까지 파래진다). 실제로 첫 캡처에서 발견됐다.

## 폰트

Google Fonts 원격 `@import` 로 해결한다(Playfair Display / Noto Serif KR /
Cormorant Garamond / Pretendard). URL 정본은 `collection.html` 의 `<link>`.
validate 의 `[FONT_REMOTE]` 는 이 구성에서 정상이다.
한글 제목은 Cormorant 에 글리프가 없어 Noto Serif KR 로 폴백된다 — `--d-font-display` 스택 그대로의 의도된 동작.

## 프리뷰 작성 요령 (이 DS 특유)

- **`position: fixed` 컴포넌트(`Nav`, `MobileMenu`)는 조상에 `transform: translateZ(0)` 을 준
  상자로 감싼다.** 그래야 fixed 의 컨테이닝 블록이 그 상자가 되어 카드 안에 갇힌다.
  안 하면 카드 밖으로 빠져나가거나(Nav) 상단 100px 패딩 때문에 내용이 잘린다(MobileMenu).
- **폭에 반응하는 컴포넌트는 viewport 를 넓혀야 변형이 구분된다.**
  `Grid` 는 1240px 이상(그 아래면 3·4열이 태블릿 규칙으로 2열이 된다),
  `Container` 는 1500px 이상(아니면 default 1200 과 wide 1400 이 똑같이 보인다).
- **`Hamburger` 는 768px 이하에서만 보인다** — viewport 를 420px 로 좁혀야 렌더된다.
- **`NavUserMenu` 드롭다운은 CSS `:hover` 전용이라 정지 캡처로 못 잡는다.**
  프리뷰에서 `.dsforce .user-dropdown{opacity:1;visibility:visible;transform:none}` 로
  hover 게이트만 무력화해 실제 드롭다운을 노출했다. 컴포넌트에 `open` prop 을 넣지 않았다 —
  원본 CSS 에 그런 상태가 없기 때문.

## Known render warns (재동기화 시 새 경고가 아님)

- `[FONT_REMOTE]` — 위 폰트 구성상 정상.
- `[GRID_OVERFLOW] Nav … (fixed/portal) escape` — **오탐.** transform 컨테이닝으로 실제로는
  카드 안에 잘 들어간다(`cardMode: column` 로 3개 스토리 모두 전폭 표시, 스크린샷 확인함).
  검출기가 computed `position: fixed` 만 보고 판정한다. `bad: false` 이고 비차단.
  도구가 권하는 `cardMode: single` 로 바꾸면 스토리 3개 중 2개를 잃으므로 채택하지 않았다.
- `AnimateIn` 의 계단식 등장은 정지 캡처로 확인 불가(모두 종료 상태로 찍힌다).

## 정적으로 확인 못 한 것

- hover/focus 상태 전반(버튼 hover 상승, 카드 그림자 증가, 입력 포커스 골드 글로우).
- `Nav` 의 `scrolled` 상태, `MobileMenu` 여닫는 전환.
- 반응형 축소(768/1024px 분기)는 `Grid`/`Container`/`Hamburger` 에서 간접 확인만.

## Re-sync risks — 다음 실행이 지켜볼 것

- **`css/` 원본이 바뀌면 그대로 딸려 온다.** 특히 `css/detaildesign/*.css` 에 새 전역 요소
  규칙(`a {}`, `button {}` 등)이 추가되면 `isScopedSelector` 가 걸러 주지만,
  **클래스로 한정된 채 브랜드를 깨는 규칙**은 못 거른다. 재동기화 때 `_ds_bundle.css` 의
  `*`/`body`/요소 선택자를 한 번 훑어볼 것.
- **Tailwind 트리셰이킹에 의존한다.** `app/globals.css` 의 `@layer components` 중
  실제로 안 쓰이는 것(`input-field`, `input-label`)은 컴파일 결과에 **없다.**
  conventions.md 는 실재하는 이름만 적었으니, 사용처가 생기면 목록이 달라진다.
- **웹폰트가 원격이다.** Google Fonts 가 막히거나 URL 이 바뀌면 모든 카드가 시스템 폰트로 렌더된다.
  로컬로 옮기려면 `cfg.extraFonts` 를 쓴다.
- `design-system/` 은 `private: true` 라 배포되지 않는다. 저장소 안에서만 쓰는 바인딩 패키지다.
- 이 저장소는 CLAUDE.md 상 **main 직접 커밋 금지** — 브랜치 + PR 로만 반영한다.
