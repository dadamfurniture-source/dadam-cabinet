// ============================================================
// D3: 렌더 스냅샷 — planner-capture.js (구조 페이지 · 디테일 모드 전용)
//
// 3D 씬을 **오프스크린 렌더타깃**에 찍어 PNG 로 만든다 (계획 §4.4 R2 · §5 D3).
// 화면 캔버스는 건드리지 않는다 — preserveDrawingBuffer 를 켜지 않고, 크기·pixelRatio 도 바꾸지 않는다.
// 렌더타깃은 제 크기(2048 / 4096 긴 변)를 갖고, 카메라는 찍을 때만 새로 만든다 (화면 카메라·OrbitControls 불변).
//
// 두 패스다. three 는 렌더타깃에 그릴 때 톤매핑·sRGB 출력을 **하지 않는다**
// (WebGLPrograms: currentRenderTarget !== null → NoToneMapping · LinearSRGB). 그래서
//   ① 씬 → rtA (HalfFloat, MSAA 4)                       linear
//   ② OutputPass(rtA → rtB, UnsignedByte)                 renderer.toneMapping · outputColorSpace 를 그대로 적용
//   ③ readRenderTargetPixels(rtB) → 위아래 뒤집기 → canvas 2D → toBlob('image/png')
// OutputPass 는 importmap 모듈 스크립트가 window.OutputPass 로 올린다 (RoomEnvironment 와 같은 패턴).
// 없으면 ①을 UnsignedByte 로 찍고 CPU 에서 sRGB 곡선만 입힌다 (톤매핑은 없다 — 폴백, 표시한다).
//
// 룩: 구조 모드에서 눌러도 **디테일 룩**(sRGB·ACES·환경광·PBR 재질)으로 찍는다. 켜고 끄는 것은
//   PlannerDetail.pushLook / popLook — enter/exit 와 같은 applyScene · paintScene 을 타므로 두 벌이 아니다.
//   디테일 모드면 pushLook 은 아무것도 하지 않는 토큰을 준다. 캡처 한 장은 동기(픽셀 읽기까지)라
//   animate 루프가 그 사이에 화면을 그릴 일이 없다 — 구조 모드 화면은 바이트 하나 달라지지 않는다 (I2).
//
// 카메라 프리셋 (plannerCaptureFrame, 순수):
//   front  정면 입면 — 씬 경계 중심을 −Z 로 보는 원근 카메라, fov 12° (직교에 가깝다). 종횡비 = 경계 W/H.
//   iso    3/4 — fitCameraToBounds 와 같은 (0.7, 0.5, 1)·1.4 배 거리, fov 45°. 종횡비 = 화면 캔버스.
//   plan   평면 — 위에서 −Y, up = −Z (뒷벽이 위). fov 12°. 종횡비 = 경계 W/D.
//   module:<id>  그 모듈 하나의 경계로 iso.
//   massing 실내 3/4 — 눈높이 1500mm, 경계 중심을 향해 앞(+Z)에서 오른쪽으로 30° 비껴, 가로 화각 40°, 16:9.
//          옆면과 상판 앞코가 보이는 사람 눈 시점. 거리는 경계 여덟 꼭짓점이 여백 8% 안에 들어오는 가장 가까운 값.
//   경계는 mesh 만 센다 — 배치 공간 상자(area)·선택 테두리(pick)·원점 마커(선)는 뺀다.
//
// 2026-10-08: clean 캡처 (docs/01-plan/planner-render-realize.plan.md §5 · §9 P1).
//   capture({ kind, longEdge, clean: true }) — 이미지 모델에 줄 "참고 그림" 용. **찍는 순간에만**
//   ① 흰 배경 — 배경을 비우고 알파 0 으로 지운 뒤, 읽은 픽셀을 흰색 위에 얹는다 (plannerCaptureOverWhite).
//      흰색을 배경색으로 넣으면 OutputPass 의 ACES 가 회색(#e7e7e7 근처)으로 눌러 버린다.
//   ② 숨김 — 씬 바로 아래의 조명·moduleGroup 이 아닌 것(그리드·바닥 판), moduleGroup 바로 아래의 모듈이 아닌 것
//      (배치 상자·그 윤곽선·선택 테두리·원점 마커). plannerCaptureCleanTargets 가 고른다.
//   ③ 가전 대역 — 반투명 마커(entityKind 'marker') 대신 불투명 단순 형태 (plannerCaptureStandInSpec).
//      마커가 있는 가전만 만든다. 지금 마커 섹션은 sink·hood 둘뿐 (PLANNER_MARKER_SECTIONS).
//   ④ 그림자 — castShadow 방향광의 그림자 카메라를 경계(mm)에 맞추고 (plannerCaptureShadowFrustum),
//      바닥에 그림자만 받는 판(ShadowMaterial)을 깐다. 평소 화면에는 켜지 않는다 (계획서 §11-⑥).
//   전부 finally 에서 되돌린다 — 캡처 뒤 작업 화면(배경·그리드·마커·그림자·재질)은 그대로다. 예외가 나도.
//
// 2026-10-18: clean 프레이밍·그림자 빛 보강.
//   ⑤ 프레임 (plannerCaptureCleanFrame) — massing·front 는 경계 상자 여덟 꼭짓점이 아니라 **보이는 부재 mesh 하나하나의
//      꼭짓점**(plannerCapturePointsOf)에 맞추고, 투영된 가구가 화면 가운데 오도록 타깃을 옮긴다. 묶이는 축(가로든 세로든)
//      에서 가구가 PLANNER_CAPTURE_CLEAN_FILL 만큼 찬다 (massing 0.9 · front 0.94). 여백은 위아래·좌우가 같다.
//      종횡비·화각·눈높이·방위각은 그대로 — massing 16:9, front 경계 W/H · FOV 12°. clean 이 아니면 예전 프레임 그대로.
//      ⚠ massing 16:9 에서 상부장까지 있는 주방은 세로가 묶인다 (투영 실루엣이 거의 정사각형). 그때 가로는 약 50% 다.
//   ⑥ 그림자 빛 (plannerCaptureCleanLight) — castShadow 방향광을 앞·왼쪽 위(방위 −35° · 고도 50°)로 옮겨
//      바닥 그림자가 가구 오른쪽 옆으로 보이게 한다. 받는 판은 옅게 (PLANNER_CAPTURE_SHADOW_OPACITY). finally 에서 원위치.
//
// 2026-10-18: ⑦ 상몰딩 재질 (plannerCaptureMoldingMaterial) — 상몰딩은 디테일 팔레트에 슬롯이 없어 자리표시 색
//      (세이지 그린)으로 찍혔다. clean 동안에만 같은 모듈 도어 → 같은 섹션 도어 → 같은 모듈 몸통 재질을 빌려 입힌다.
//      finally 에서 원래 재질로. 디테일이 이미 칠한 몰딩은 건드리지 않는다.
//
// 2026-10-19: ⑧ 칠하지 않은 몸통·걸레받이 (plannerCaptureBorrowMaterial) — 도어만 칠한 도면을 찍으면 몸통 앞면이
//      갈색 자리표시로 도어 둘레에 보였고 모델이 모든 장에 갈색 테두리를 그렸다 (잡 e4dc4435). 측판은 세이지 그린,
//      걸레받이는 베이지 나무색 자리표시다. clean 동안에만 디테일 룩이 칠하지 않은(_origMaterial 없음) 몸통·선반·
//      처짐방지목·걸레받이·좌대에 같은 모듈 도어 → 같은 섹션 도어 재질을 입힌다. 상판은 그대로. finally 에서 원래 재질로.
//
// 2026-10-19: ⑨ 도어 테두리·갭 뒷판·목찬넬 (plannerCaptureNeutralKind · plannerCaptureDoorEdgeThickness) — ⑧ 뒤에도
//      front 렌더에 갈색이 남았다: 도어 테두리 막대(doorEdge, 작업 화면 줌에 맞춰 15.5mm 로 굵어진 갈색)·목찬넬 판·
//      갭 뒷판(reveal, 상부는 초록). clean 동안에만 막대 두께를 찍는 카메라·출력 높이로 다시 잡고
//      (max(갭/2, 1.25px)) 막대·뒷판은 짙은 회색 틈 그림자, 칠 안 한 목찬넬은 중간 회색으로. 사람이 칠한 부재는 그대로.
//      finally 에서 scale·position·재질 원래대로, 잠깐 만든 재질은 버린다.
//
// 2026-10-19: ⑩ 번호·치수선 (annotate) — capture({ kind:'front', …, annotate: plan }).
//      그림의 장과 프롬프트 글의 번호(L1·U1·T1·W1)가 같은 것임을 모델이 짐작하지 않게, 정면 입면 위에 2D 로 얹는다.
//      plan 은 부르는 쪽(사진으로 만들기 패널)이 design_spec 에서 만든다 — 번호의 정본은 design_spec 이다:
//        { rows: [{ key:'lower', widthMm, heightMm, items: [{ id:'L1', moduleId:'lower-0', from:0, to:1, widthMm:800 }] }] }
//        from·to 는 그 모듈 폭 안에서 이 칸이 차지하는 몫 (칸마다 쪼갠 모듈은 0~0.5 · 0.5~1 처럼).
//      이 파일은 번호를 매기지 않는다 — 받은 plan 의 모듈을 3D 에서 찾아 찍는 카메라로 투영하고(plannerCaptureScreenBox),
//      표시 목록(plannerCaptureAnnotationLayout)을 만들어 렌더 픽셀 위에 canvas 2D 로 그린다(plannerCaptureDrawAnnotation).
//        라벨  칸의 앞면 가운데 작게 (흰 반투명 바탕)
//        치수  하부·키큰장 줄은 아래, 상부 줄은 위 — 첫 단 칸 폭 mm, 둘째 단 줄 전체 mm. 줄 높이 mm 는 옆에 세로로 하나
//        무채색 짙은 회색 얇은 선·작은 글자 — 모델이 따라 그리지 않게 굵거나 진하지 않게
//      글자 둘레 여백이 있도록 front 프레임을 PLANNER_CAPTURE_ANNOTATE_FILL 로 채운다 (clean 0.94 대신).
//      front 가 아니거나 plan 에 그릴 칸이 없으면 무시한다 — annotate 가 없으면 예전과 바이트 같다.
//      2026-10-19: 칸에 moduleIds 가 있으면(쌓인 단 한 통 — 키큰장 단들, 냉장고 본체 + 위 박스) 그 모듈들 상자를 합친다.
//
// 저장 (PlannerStore.saveRender, planner-store.js): 버킷 renders 의 {design}/{item}/{kind}-{yyyymmddHHMMss}.png
//   + design_renders 행 (kind · path · width/height · camera · detail_hash). 스코프가 없으면(design=local ·
//   로그인 전) <a download> 로 이 브라우저에 내려받는다 — 이 페이지는 앱 페이지라 다운로드가 된다.
//   detail_hash 는 마감 모델 JSON(키 정렬)의 sha-256 — 렌더가 어느 마감 상태였는지 맞춰 본다.
//
// 페이지가 넘기는 것 (PlannerCapture.mount(o)):
//   three()          { renderer, scene, camera, controls, moduleGroup } — init3D 전이면 null
//   toast(text)      알림
//   ids()            선택 — 스코프 {designId, itemId}. 기본 plannerScopeIds()
//   activeModuleId() 선택 — "이 모듈" 메뉴가 찍을 모듈
//   moduleLabel(id)  선택 — 토스트·파일명용 모듈 이름
//   detail()         선택 — 해시할 마감 모델. 기본 PlannerDetail.detail
//   sectionOf(id)    선택 — 모듈 id → 섹션 (clean 상몰딩 재질용). 기본 PlannerDetail.moduleOf(id).section
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_CAPTURE_ / plannerCapture / PlannerCapture 접두.
//   three 는 전역 window.THREE. 없으면 capture 가 { ok:false, reason:'no-three' } 를 돌려준다.
// ============================================================

/** Storage 버킷. database/design-renders.sql 과 같은 이름이어야 한다. */
const PLANNER_CAPTURE_BUCKET = 'renders';
/** "렌더 저장" 한 번에 찍는 프리셋 순서 */
const PLANNER_CAPTURE_KINDS = ['front', 'iso', 'plan'];
const PLANNER_CAPTURE_KIND_LABEL = { front: '정면', iso: '3/4', plan: '평면', module: '모듈', massing: '실내 3/4' };
const PLANNER_CAPTURE_LONG_EDGE = 2048;
const PLANNER_CAPTURE_LONG_EDGE_HI = 4096;
/** 경계 둘레 여백 (8%) */
const PLANNER_CAPTURE_MARGIN = 1.08;
/**
 * 2026-10-08: massing 프리셋 — 실내 눈높이 3/4 (계획서 §5).
 *   eyeY  눈높이 (mm, 바닥 y=0 기준)   yawDeg  앞(+Z)에서 오른쪽(+X)으로 비끼는 각
 *   hfov  가로 화각 (°)               aspect  16:9 고정 — 방 사진(16:9)과 같은 틀
 */
const PLANNER_CAPTURE_MASSING = { eyeY: 1500, yawDeg: 30, hfov: 40, aspect: 16 / 9 };
/** 가로 화각 → three 가 받는 세로 화각 (°) */
function plannerCaptureVfov(hfovDeg, aspect) {
  const h = (hfovDeg / 2) * Math.PI / 180;
  return 2 * Math.atan(Math.tan(h) / aspect) * 180 / Math.PI;
}
/** 프리셋별 **세로** 화각 (three PerspectiveCamera.fov). massing 은 가로 40° 에서 나온 값 (약 23.1°). */
const PLANNER_CAPTURE_FOV = {
  front: 12, plan: 12, iso: 45, module: 45,
  massing: plannerCaptureVfov(PLANNER_CAPTURE_MASSING.hfov, PLANNER_CAPTURE_MASSING.aspect),
};
/**
 * 2026-10-18: clean 캡처에서 묶이는 축(가로나 세로)을 가구가 채우는 몫. 나머지가 양쪽 같은 여백이다.
 * massing 0.9 → 위아래(또는 좌우) 5% 씩. front 0.94 → 3% 씩 (입면이라 더 꽉 채운다).
 */
const PLANNER_CAPTURE_CLEAN_FILL = { massing: 0.9, front: 0.94 };
/**
 * 2026-10-19: annotate front 에서 가구가 채우는 몫 — 나머지 위아래·좌우 10% 씩에 치수선 두 단과 높이 치수가 들어간다.
 */
const PLANNER_CAPTURE_ANNOTATE_FILL = 0.8;
/**
 * 2026-10-19: 번호·치수선의 모양. 크기는 긴 변 1536px 기준이고 긴 변에 비례한다 (plannerCaptureAnnotationLayout).
 *   color 짙은 회색 · line 선 굵기 px · font 글자 px · labelBg 라벨 바탕(흰 반투명) · dimBg 치수 글자 바탕(배경과 같은 흰색)
 */
const PLANNER_CAPTURE_ANNOTATE_STYLE = {
  baseEdge: 1536,
  color: '#4a4a4a',
  line: 1.2,
  font: 15,
  labelBg: 'rgba(255,255,255,0.78)',
  dimBg: '#ffffff',
  fontFamily: 'Arial, Helvetica, sans-serif',
};
/**
 * 2026-10-18: clean 캡처 동안 그림자 빛 — 앞(+Z)에서 왼쪽(−X)으로 35° 비낀 방위, 고도 50°.
 * massing 카메라(앞·오른쪽 30°)와 같은 앞쪽이라 보이는 면이 밝고, 바닥 그림자는 가구 오른쪽 뒤로 길게 떨어져 옆에서 보인다.
 */
const PLANNER_CAPTURE_CLEAN_LIGHT = { azimuthDeg: -35, elevationDeg: 50 };
/** 그림자만 받는 바닥 판의 불투명도 — 진하면 오려 붙인 듯 보인다. 접지감만. */
const PLANNER_CAPTURE_SHADOW_OPACITY = 0.16;
/** 경계 계산에서 빼는 entityKind — 부재가 아니다 */
const PLANNER_CAPTURE_BOUNDS_SKIP = { area: true, pick: true };
/** 종횡비 한계 — 아주 납작하거나 긴 씬도 화면에 들어오게 */
const PLANNER_CAPTURE_ASPECT_MIN = 0.5;
const PLANNER_CAPTURE_ASPECT_MAX = 3;

/** 우측 "최근 렌더" 띠의 CSS. 메뉴는 planner-drawing-menu.js 의 .pdm-* 를 그대로 쓴다. */
const PLANNER_CAPTURE_CSS = `
.pc-head{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10.5px;font-weight:600;color:var(--text-dim,#7a7062);margin-bottom:6px}
.pc-head .pc-refresh{border:1px solid var(--line,#e5e0d4);background:#fff;color:var(--text-dim,#7a7062);border-radius:999px;padding:1px 7px;font-size:11px;cursor:pointer;font-family:inherit}
.pc-hint{font-size:10px;color:var(--text-faint,#a89c84);line-height:1.5}
.pc-thumbs{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.pc-thumb{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line,#e5e0d4);border-radius:6px;background:#fff;padding:3px;text-decoration:none;color:var(--text,#2b2620);min-width:0}
.pc-thumb img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:4px;background:#f4efe7}
.pc-thumb .pc-cap{font-size:9.5px;color:var(--text-dim,#7a7062);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc-thumb .pc-nourl{display:block;aspect-ratio:3/2;font-size:10px;color:var(--text-faint,#a89c84);text-align:center;line-height:60px}
a.pc-thumb:hover{border-color:var(--brand-mid,#b8956c)}
`;

function plannerCaptureInjectCss() {
  if (typeof document === 'undefined' || document.getElementById('planner-capture-css')) return;
  const st = document.createElement('style');
  st.id = 'planner-capture-css';
  st.textContent = PLANNER_CAPTURE_CSS;
  document.head.appendChild(st);
}

// ── 순수 함수 ────────────────────────────────────────────

/** 'module:lower-0' → {kind:'module', moduleId:'lower-0'}. 나머지는 그대로. */
function plannerCaptureParseKind(kind, moduleId) {
  const k = String(kind || 'iso');
  if (k.indexOf('module:') === 0) return { kind: 'module', moduleId: k.slice(7) };
  if (k === 'module') return { kind: 'module', moduleId: moduleId == null ? null : String(moduleId) };
  return { kind: PLANNER_CAPTURE_FOV[k] ? k : 'iso', moduleId: null };
}

/** yyyymmddHHMMss — 파일명용 (지역 시각). */
function plannerCaptureStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/** 파일명·경로에 들어갈 수 있는 글자만 */
function plannerCaptureSafeId(s) {
  return String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/** 파일 이름 — {kind}-{stamp}.png / module-{id}-{stamp}.png */
function plannerCaptureFileName(kind, moduleId, date) {
  const k = plannerCaptureParseKind(kind, moduleId);
  const stamp = plannerCaptureStamp(date);
  return k.kind === 'module'
    ? 'module-' + plannerCaptureSafeId(k.moduleId) + '-' + stamp + '.png'
    : k.kind + '-' + stamp + '.png';
}

/**
 * 버킷 안의 객체 키 — {designId}/{itemId}/{fileName}. 첫 폴더가 design_id 라 Storage 정책이 소유자를 판정한다.
 * 스코프가 없으면 null (올릴 곳이 없다).
 */
function plannerCapturePath(ids, kind, moduleId, date) {
  if (!ids || !ids.designId || ids.itemId == null) return null;
  return String(ids.designId) + '/' + String(ids.itemId) + '/' + plannerCaptureFileName(kind, moduleId, date);
}

/** 키를 정렬한 JSON — 같은 지정이면 같은 문자열. */
function plannerCaptureStableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(plannerCaptureStableJson).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + plannerCaptureStableJson(v[k])).join(',') + '}';
}

/**
 * sha-256 (동기, 순수 JS). crypto.subtle 은 비동기라 jsdom·워커에서 다르게 굴고, 여기 입력은 몇 KB 라 이게 낫다.
 * 입력은 UTF-8 로 바꿔 해시한다. 결과는 64자 소문자 hex.
 */
function plannerCaptureSha256(text) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  // UTF-8
  const s = String(text == null ? '' : text);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => ('00000000' + x.toString(16)).slice(-8)).join('');
}

/** 마감 모델 → detail_hash. 모델이 없으면 null 의 해시 (빈 지정도 값이 있어야 "그때 아무것도 없었다" 를 안다). */
function plannerCaptureDetailHash(detail) {
  return plannerCaptureSha256(plannerCaptureStableJson(detail == null ? null : detail));
}

/** 긴 변·종횡비 → 정수 픽셀 크기. 둘 다 ≥ 1. */
function plannerCaptureSizeFor(longEdge, aspect) {
  const L = Math.max(1, Math.round(Number(longEdge) || PLANNER_CAPTURE_LONG_EDGE));
  const a = (typeof aspect === 'number' && aspect > 0 && Number.isFinite(aspect)) ? aspect : 1.5;
  if (a >= 1) return { width: L, height: Math.max(1, Math.round(L / a)) };
  return { width: Math.max(1, Math.round(L * a)), height: L };
}

function plannerCaptureClampAspect(a) {
  if (!(typeof a === 'number') || !Number.isFinite(a) || a <= 0) return 1.5;
  return Math.min(PLANNER_CAPTURE_ASPECT_MAX, Math.max(PLANNER_CAPTURE_ASPECT_MIN, a));
}

/** 프리셋별 종횡비 — front 는 경계 W/H, plan 은 W/D, massing 은 16:9 고정, iso·module 은 화면 캔버스(없으면 3:2). */
function plannerCaptureAspectFor(kind, bounds, canvasAspect) {
  const k = plannerCaptureParseKind(kind).kind;
  if (k === 'massing') return PLANNER_CAPTURE_MASSING.aspect;
  if (bounds && (k === 'front' || k === 'plan')) {
    const W = bounds.max.x - bounds.min.x, H = bounds.max.y - bounds.min.y, D = bounds.max.z - bounds.min.z;
    const den = k === 'front' ? H : D;
    if (W > 0 && den > 0) return plannerCaptureClampAspect(W / den);
  }
  return plannerCaptureClampAspect(canvasAspect);
}

/**
 * 경계 → 카메라. 순수 — three 없이 시험한다.
 * @param {string} kind front | iso | plan | module
 * @param {{min:{x,y,z}, max:{x,y,z}}} bounds
 * @param {number} aspect 가로/세로
 * @returns {{kind, fov, aspect, position:number[], target:number[], up:number[], near, far, dist}|null}
 */
function plannerCaptureFrame(kind, bounds, aspect) {
  if (!bounds || !bounds.min || !bounds.max) return null;
  const k = plannerCaptureParseKind(kind).kind;
  const W = Math.max(1, bounds.max.x - bounds.min.x);
  const H = Math.max(1, bounds.max.y - bounds.min.y);
  const D = Math.max(1, bounds.max.z - bounds.min.z);
  const c = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
  // massing 은 화각이 16:9 에서 나온 값이라 종횡비도 16:9 로 묶는다
  const a = k === 'massing' ? PLANNER_CAPTURE_MASSING.aspect : plannerCaptureClampAspect(aspect);
  const M = PLANNER_CAPTURE_MARGIN;
  const fov = PLANNER_CAPTURE_FOV[k] || 45;
  const t = Math.tan((fov / 2) * Math.PI / 180);
  let dist, position, up;
  if (k === 'front') {
    // 앞면(max.z)에서 H·W 가 다 들어오는 거리 + 중심까지 D/2
    dist = Math.max((H * M) / (2 * t), (W * M) / (2 * t * a)) + D / 2;
    position = [c.x, c.y, c.z + dist];
    up = [0, 1, 0];
  } else if (k === 'plan') {
    // 윗면(max.y)에서 D·W 가 다 들어오는 거리 + H/2. up = −Z 라 뒷벽이 그림 위쪽.
    dist = Math.max((D * M) / (2 * t), (W * M) / (2 * t * a)) + H / 2;
    position = [c.x, c.y + dist, c.z];
    up = [0, 0, -1];
  } else if (k === 'massing') {
    // 실내 3/4 — 눈높이 고정, 경계 중심을 향해 30° 비껴 선다. 거리는 꼭짓점이 다 들어오는 가장 가까운 값.
    const P = PLANNER_CAPTURE_MASSING;
    const yaw = P.yawDeg * Math.PI / 180;
    const dir = [Math.sin(yaw), Math.cos(yaw)];   // 수평 (x, z)
    up = [0, 1, 0];
    const at = (d) => [c.x + dir[0] * d, P.eyeY, c.z + dir[1] * d];
    const corners = plannerCaptureCorners(bounds);
    const target = [c.x, c.y, c.z];
    const fits = (d) => plannerCaptureFits(at(d), target, up, fov, a, corners, M, 10);
    let lo = 0, hi = Math.max(W, H, D, 1000);
    for (let i = 0; i < 40 && !fits(hi); i++) hi *= 2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    dist = hi;   // 수평 거리 (경계 중심 → 카메라)
    position = at(dist);
  } else {
    // iso — mockup-structure.html fitCameraToBounds 와 같은 비율
    const size = Math.max(W, H, D);
    dist = size * 1.4;
    position = [c.x + dist * 0.7, c.y + dist * 0.5, c.z + dist];
    up = [0, 1, 0];
  }
  const diag = Math.sqrt(W * W + H * H + D * D);
  return {
    kind: k,
    fov,
    aspect: a,
    position,
    target: [c.x, c.y, c.z],
    up,
    near: 10,
    far: Math.ceil(dist * 4 + diag + 20000),
    dist,
  };
}

/** 경계의 여덟 꼭짓점 [[x,y,z], …] */
function plannerCaptureCorners(bounds) {
  const out = [];
  [bounds.min.x, bounds.max.x].forEach((x) => [bounds.min.y, bounds.max.y].forEach((y) => [bounds.min.z, bounds.max.z].forEach((z) => out.push([x, y, z]))));
  return out;
}

/**
 * eye → target 을 보는 카메라의 축 (x 오른쪽, y 위, z 뒤 = eye − target). three Matrix4.lookAt 과 같은 규칙 —
 * 위 벡터와 나란하면 z 를 조금 틀어 축을 만든다. 그림자 카메라도 이 규칙으로 선다 (LightShadow.updateMatrices).
 */
function plannerCaptureLookBasis(eye, target, up) {
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const len2 = (p) => p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  const norm = (p) => { const l = Math.sqrt(len2(p)) || 1; return [p[0] / l, p[1] / l, p[2] / l]; };
  let z = sub(eye, target);
  if (len2(z) === 0) z = [0, 0, 1];
  z = norm(z);
  let x = cross(up, z);
  if (len2(x) === 0) {
    if (Math.abs(up[2]) === 1) z[0] += 0.0001; else z[2] += 0.0001;
    z = norm(z);
    x = cross(up, z);
  }
  x = norm(x);
  const y = cross(z, x);
  return { x, y, z };
}

/**
 * 원근 카메라에 점들이 다 들어오는가 — 화면 가장자리에서 여백(margin) 안쪽으로. 순수.
 * @param {number[]} eye @param {number[]} target @param {number[]} up
 * @param {number} vfovDeg 세로 화각 @param {number} aspect 가로/세로
 * @param {number[][]} points @param {number} margin 1.08 이면 화면의 1/1.08 안 @param {number} near
 */
function plannerCaptureFits(eye, target, up, vfovDeg, aspect, points, margin, near) {
  const B = plannerCaptureLookBasis(eye, target, up);
  const tv = Math.tan((vfovDeg / 2) * Math.PI / 180);
  const th = tv * aspect;
  const lim = 1 / (margin || 1);
  for (let i = 0; i < points.length; i++) {
    const v = [points[i][0] - eye[0], points[i][1] - eye[1], points[i][2] - eye[2]];
    const depth = -(v[0] * B.z[0] + v[1] * B.z[1] + v[2] * B.z[2]);
    if (!(depth > (near || 0))) return false;
    const vx = v[0] * B.x[0] + v[1] * B.x[1] + v[2] * B.x[2];
    const vy = v[0] * B.y[0] + v[1] * B.y[1] + v[2] * B.y[2];
    if (Math.abs(vx / (depth * th)) > lim || Math.abs(vy / (depth * tv)) > lim) return false;
  }
  return true;
}

/**
 * 점들의 투영 범위 — 화면 좌표(NDC, −1~1). three 의 project 와 같은 값. 순수.
 * 한 점이라도 near 앞(카메라 뒤)이면 null.
 * @returns {{minX:number, maxX:number, minY:number, maxY:number}|null}
 */
function plannerCaptureProjectExtent(eye, target, up, vfovDeg, aspect, points, near) {
  if (!points || !points.length) return null;
  const B = plannerCaptureLookBasis(eye, target, up);
  const tv = Math.tan((vfovDeg / 2) * Math.PI / 180);
  const th = tv * aspect;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const v = [points[i][0] - eye[0], points[i][1] - eye[1], points[i][2] - eye[2]];
    const depth = -(v[0] * B.z[0] + v[1] * B.z[1] + v[2] * B.z[2]);
    if (!(depth > (near || 0))) return null;
    const x = (v[0] * B.x[0] + v[1] * B.x[1] + v[2] * B.x[2]) / (depth * th);
    const y = (v[0] * B.y[0] + v[1] * B.y[1] + v[2] * B.y[2]) / (depth * tv);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * clean 캡처 프레임 (2026-10-18). 순수 — 머리 주석 ⑤.
 *   massing·front 만 다르다. 나머지 프리셋은 plannerCaptureFrame 그대로.
 *   points 는 보이는 부재 꼭짓점 (plannerCapturePointsOf). 없으면 경계 여덟 꼭짓점.
 *   ① 투영 폭·높이가 fill 안에 드는 가장 가까운 거리 ② 투영 가운데로 타깃을 옮긴다 — 몇 번 되풀이하면 가운데에 선다
 *   ③ 마지막으로 옮긴 타깃에서 "모든 점이 화면 가장자리에서 fill 안쪽" 인 가장 가까운 거리 (plannerCaptureFits) — 넘침 없음 보장.
 *   massing: 눈은 경계 중심에서 방위 30° · 눈높이 1500 선 위에 그대로 둔다 (타깃만 옮긴다).
 *   front: 정면(−Z) 시선을 유지한 채 눈과 타깃을 함께 옆·위로 옮긴다 — 입면이 기울지 않는다.
 * @param {string} kind @param {{min,max}} bounds @param {number} aspect @param {number[][]} [points]
 * @param {number} [fill] 묶이는 축을 채우는 몫. 기본 PLANNER_CAPTURE_CLEAN_FILL[kind]
 */
function plannerCaptureCleanFrame(kind, bounds, aspect, points, fill) {
  const base = plannerCaptureFrame(kind, bounds, aspect);
  if (!base || (base.kind !== 'massing' && base.kind !== 'front')) return base;
  const k = base.kind;
  const F = Math.min(0.99, Math.max(0.3, Number(fill) || PLANNER_CAPTURE_CLEAN_FILL[k]));
  const pts = (Array.isArray(points) && points.length) ? points : plannerCaptureCorners(bounds);
  const fov = base.fov, a = base.aspect, up = base.up, near = base.near;
  const c = base.target.slice();
  const tv = Math.tan((fov / 2) * Math.PI / 180), th = tv * a;
  const P = PLANNER_CAPTURE_MASSING;
  const yaw = P.yawDeg * Math.PI / 180;
  let tgt = c.slice();
  // 거리 d 에서의 눈. massing 은 경계 중심 기준 선 위, front 는 타깃 바로 앞.
  const eyeAt = (d) => (k === 'massing'
    ? [c[0] + Math.sin(yaw) * d, P.eyeY, c[2] + Math.cos(yaw) * d]
    : [tgt[0], tgt[1], tgt[2] + d]);
  const W = bounds.max.x - bounds.min.x, H = bounds.max.y - bounds.min.y, D = bounds.max.z - bounds.min.z;
  const span = Math.max(W, H, D, 1000);
  const search = (ok) => {
    let lo = 0, hi = span;
    for (let i = 0; i < 40 && !ok(hi); i++) hi *= 2;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
    return hi;
  };
  const spanFits = (d) => {
    const e = plannerCaptureProjectExtent(eyeAt(d), tgt, up, fov, a, pts, near);
    return !!e && (e.maxX - e.minX) / 2 <= F && (e.maxY - e.minY) / 2 <= F;
  };
  for (let iter = 0; iter < 8; iter++) {
    const d = search(spanFits);
    const eye = eyeAt(d);
    const e = plannerCaptureProjectExtent(eye, tgt, up, fov, a, pts, near);
    if (!e) break;
    const ox = (e.minX + e.maxX) / 2, oy = (e.minY + e.maxY) / 2;
    if (Math.abs(ox) < 1e-5 && Math.abs(oy) < 1e-5) break;
    const B = plannerCaptureLookBasis(eye, tgt, up);
    const dep = Math.sqrt((eye[0] - tgt[0]) ** 2 + (eye[1] - tgt[1]) ** 2 + (eye[2] - tgt[2]) ** 2);
    const sx = ox * dep * th, sy = oy * dep * tv;
    tgt = [tgt[0] + B.x[0] * sx + B.y[0] * sy, tgt[1] + B.x[1] * sx + B.y[1] * sy, tgt[2] + B.x[2] * sx + B.y[2] * sy];
  }
  const dist = search((d) => plannerCaptureFits(eyeAt(d), tgt, up, fov, a, pts, 1 / F, near));
  const position = eyeAt(dist);
  const diag = Math.sqrt(W * W + H * H + D * D);
  return {
    kind: k,
    fov,
    aspect: a,
    position,
    target: tgt,
    up,
    near,
    far: Math.ceil(dist * 4 + diag + 20000),
    dist,
  };
}

/**
 * clean 캡처 동안의 그림자 빛 자리 (2026-10-18). 순수 — 머리 주석 ⑥.
 * 타깃은 경계 바닥 가운데, 조명은 거기서 방위·고도 방향으로 충분히 먼 곳 (방향광이라 방향만 뜻이 있다).
 * @param {{min,max}} bounds
 * @returns {{position:number[], target:number[], dir:number[]}|null} dir = 타깃 → 조명 (단위 벡터)
 */
function plannerCaptureCleanLight(bounds) {
  if (!bounds || !bounds.min || !bounds.max) return null;
  const L = PLANNER_CAPTURE_CLEAN_LIGHT;
  const az = L.azimuthDeg * Math.PI / 180, el = L.elevationDeg * Math.PI / 180;
  const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const W = bounds.max.x - bounds.min.x, H = bounds.max.y - bounds.min.y, D = bounds.max.z - bounds.min.z;
  const R = Math.max(5000, 2 * Math.sqrt(W * W + H * H + D * D));
  const target = [(bounds.min.x + bounds.max.x) / 2, Math.min(0, bounds.min.y), (bounds.min.z + bounds.max.z) / 2];
  return { position: [target[0] + dir[0] * R, target[1] + dir[1] * R, target[2] + dir[2] * R], target, dir };
}

/**
 * 방향광 그림자 카메라(직교)를 경계에 맞춘다. 순수 — docs/02-design/features/shadow-frustum.md 의 수정 방향.
 * 기본 프러스텀(±5 · near 0.5 · far 500)은 mm 씬에서 10mm 상자라 그림자가 한 픽셀도 안 그려진다.
 * 그림자 카메라는 조명 자리에서 타깃을 본다. 꼭짓점을 그 축에 투영해 좌우·상하·깊이를 잰다.
 * 바닥(floorY)에 떨어지는 그림자도 받도록, 꼭짓점을 빛 방향으로 바닥까지 민 점도 깊이에 넣는다.
 * @param {number[]} lightPos 조명 세계 좌표 @param {number[]} targetPos 조명 타깃 세계 좌표
 * @param {{min,max}} bounds @param {number} [pad=50] mm @param {number} [floorY=0]
 * @returns {{left,right,top,bottom,near,far}|null}
 */
function plannerCaptureShadowFrustum(lightPos, targetPos, bounds, pad, floorY) {
  if (!bounds || !bounds.min || !bounds.max || !lightPos || !targetPos) return null;
  const P = pad == null ? 50 : pad;
  const fy = floorY == null ? 0 : floorY;
  const B = plannerCaptureLookBasis(lightPos, targetPos, [0, 1, 0]);
  const pts = plannerCaptureCorners(bounds);
  // 빛이 가는 방향 = −z. 아래로 가면 꼭짓점을 바닥까지 민다.
  const d = [-B.z[0], -B.z[1], -B.z[2]];
  if (d[1] < -1e-9) {
    plannerCaptureCorners(bounds).forEach((p) => {
      const t = (fy - p[1]) / d[1];
      if (t > 0) pts.push([p[0] + d[0] * t, fy, p[2] + d[2] * t]);
    });
  }
  let l = Infinity, r = -Infinity, b = Infinity, tp = -Infinity, n = Infinity, f = -Infinity;
  pts.forEach((p) => {
    const v = [p[0] - lightPos[0], p[1] - lightPos[1], p[2] - lightPos[2]];
    const x = v[0] * B.x[0] + v[1] * B.x[1] + v[2] * B.x[2];
    const y = v[0] * B.y[0] + v[1] * B.y[1] + v[2] * B.y[2];
    const depth = -(v[0] * B.z[0] + v[1] * B.z[1] + v[2] * B.z[2]);
    l = Math.min(l, x); r = Math.max(r, x); b = Math.min(b, y); tp = Math.max(tp, y);
    n = Math.min(n, depth); f = Math.max(f, depth);
  });
  return {
    left: l - P, right: r + P, bottom: b - P, top: tp + P,
    near: Math.max(1, n - P), far: Math.max(2, f + P),
  };
}

/**
 * clean 캡처에서 숨길 것과 가전 대역으로 바꿀 마커를 고른다. 순수 — 읽기만 한다.
 *   씬 바로 아래: 조명·카메라·moduleGroup 이 아닌 보이는 것 → 숨김 (그리드·바닥 판)
 *   moduleGroup 바로 아래: entityKind 'module' 이 아닌 보이는 것 → 숨김
 *     (배치 상자 area · 그 윤곽선 edge · 배치 선택 테두리 · 모듈 선택 테두리 pick · 원점 마커 선)
 *   모듈 그룹 안에 entityKind 'marker' 가 있으면 가전 자리 표시 — 그 그룹의 보이는 자식을 다 숨기고 markers 에 넣는다.
 *   나머지(모듈 그룹 안의 부재·부재 테두리)는 가구라 그대로 둔다.
 * @returns {{hide:object[], markers:{group:object, marker:object, section:string|null, moduleId:string|null}[]}}
 */
function plannerCaptureCleanTargets(scene, moduleGroup) {
  const hide = [];
  const markers = [];
  const kids = (o) => (o && Array.isArray(o.children) ? o.children : []);
  kids(scene).forEach((ch) => {
    if (!ch || ch === moduleGroup || ch.isLight || ch.isCamera) return;
    if (ch.visible !== false) hide.push(ch);
  });
  kids(moduleGroup).forEach((ch) => {
    if (!ch) return;
    const ud = ch.userData || {};
    if (ud.entityKind === 'module') {
      const marker = kids(ch).find((c) => c && c.userData && c.userData.entityKind === 'marker');
      if (!marker) return;
      kids(ch).forEach((c) => { if (c && c.visible !== false) hide.push(c); });
      markers.push({ group: ch, marker, section: marker.userData.section || null, moduleId: ud.moduleId != null ? ud.moduleId : null });
      return;
    }
    if (ch.visible !== false) hide.push(ch);
  });
  return { hide, markers };
}

/** 2026-10-18: 도어 mesh 인가 — renderAll3D 의 도어 판은 carcass · side 'front' · areaType 'door' (planner-finish.js 슬롯 'door'). */
function plannerCaptureIsDoor(ud) {
  if (!ud) return false;
  if (ud.entityKind === 'door') return true;
  return ud.entityKind === 'carcass' && ud.side === 'front' && ud.areaType === 'door';
}

/** 2026-10-18: 몸통 판인가 — carcass 중 앞판(front)·마감판(finish)·목찬넬 판이 아닌 것 (planner-finish.js 슬롯 'body'). */
function plannerCaptureIsBody(ud) {
  if (!ud || ud.entityKind !== 'carcass') return false;
  return ['front', 'finish', 'channelBase', 'channelFace'].indexOf(ud.side) < 0;
}

/** mesh 의 모듈 id — 자신에 없으면 부모 쪽 모듈 그룹에서 (renderAll3D 는 부재마다 moduleId 를 붙이지만 만일을 위해). */
function plannerCaptureMeshModuleId(o) {
  for (let cur = o; cur; cur = cur.parent) {
    if (cur.userData && cur.userData.moduleId != null) return String(cur.userData.moduleId);
  }
  return null;
}

/** 섹션 → 마감 섹션 묶음. planner-finish.js plannerFinishSectionGroup 과 같은 규칙 (상부·후드 → upper, 나머지 → lower). */
function plannerCaptureSectionGroup(section) {
  if (!section) return null;
  return (section === 'upper' || section === 'hood') ? 'upper' : 'lower';
}

/**
 * 2026-10-18: clean 캡처에서 상몰딩이 빌려 입을 재질. 순수 — 고르기만 하고 바꾸지 않는다.
 *   상몰딩(entityKind 'molding')은 디테일 마감 팔레트에 슬롯이 없어 칠해지지 않고 구조 단계의 자리표시 색
 *   (세이지 그린 #708d81)으로 찍힌다. 그 그림이 이미지 모델에 가면 초록 몰딩으로 그려질 수 있다.
 *   실무에서 상부 몰딩은 도어와 같은 마감이다. 고르는 순서:
 *     ① 같은 모듈의 도어 재질
 *     ② 같은 섹션 묶음(상부·후드 / 하부)의 아무 도어 재질 — sectionOf 가 섹션을 알려 줄 때만
 *     ③ 같은 모듈의 몸통 재질
 *     ④ 없으면 null — 그대로 둔다
 *   디테일 룩이 이미 칠한 몰딩(userData._origMaterial 있음 — 사람이 마감을 정했다)은 null — 그 마감을 존중한다.
 *   먹장(blank)·서랍 앞판은 도어로 보지 않는다. 안 보이는(visible false) mesh 는 빌리지 않는다.
 * @param {object} molding   몰딩 mesh
 * @param {object[]} meshes  후보 mesh 목록 (moduleGroup 을 훑은 것)
 * @param {(moduleId:string)=>string|null} [sectionOf]  모듈 id → 섹션 ('upper' 등). 모르면 null
 * @returns {object|null} material
 */
function plannerCaptureMoldingMaterial(molding, meshes, sectionOf) {
  const ud = molding && molding.userData;
  if (!ud || ud.entityKind !== 'molding') return null;
  return plannerCaptureBorrowMaterial(molding, meshes, sectionOf);
}

/**
 * 2026-10-19: clean 캡처에서 도어 재질을 빌려 입는 부재의 갈래. 순수.
 *   'molding' 상몰딩 (⑦)
 *   'body'    몸통 — carcass 중 도어·서랍 앞판(side 'front')·마감판(finish)·목찬넬 판이 아닌 것(측판·뒤판·지판·천판·
 *             칸막이·ㄱ자 목대) + 선반(shelf)·처짐방지목(brace). planner-finish.js 슬롯 'body' 와 같은 묶음이다.
 *   'kick'    걸레받이(toe-kick)·좌대(pedestal) — planner-finish.js 슬롯 'kick'.
 *   그 밖(도어·서랍 앞판·먹장·상판·손잡이·마감재·다리발·표시용)은 null — 빌리지 않는다.
 * @param {object} ud mesh.userData
 * @returns {'molding'|'body'|'kick'|null}
 */
function plannerCaptureBorrowKind(ud) {
  if (!ud) return null;
  if (ud.entityKind === 'molding') return 'molding';
  if (ud.entityKind === 'toe-kick' || ud.entityKind === 'pedestal') return 'kick';
  if (ud.entityKind === 'shelf' || ud.entityKind === 'brace') return 'body';
  return plannerCaptureIsBody(ud) ? 'body' : null;
}

/**
 * 2026-10-19: clean 캡처에서 **칠하지 않은** 상몰딩·몸통·걸레받이(좌대)가 빌려 입을 재질. 순수 — 고르기만 한다.
 *   2026-10-18 실제 생성(잡 e4dc4435)에서 도어만 칠하고 몸통을 안 칠한 도면을 보냈더니, 정면 렌더에 도어 둘레로
 *   몸통 앞면의 갈색 자리표시 색이 보였고 모델이 모든 장에 갈색 테두리를 그렸다. 측판은 세이지 그린, 걸레받이는
 *   베이지 나무색 자리표시로 찍힌다. 실무에서 몸통이 보이는 면은 도어와 같은 마감이라 그 자리표시를 도어 마감으로 덮는다.
 *   "칠하지 않음" = userData._origMaterial 이 없다 — 디테일 룩(PlannerDetail.paintScene)은 칠한 mesh 에만 원래 재질을
 *   그 이름으로 적는다. 있으면 사람이 마감을 정한 것이라 null (그대로).
 *   고르는 순서 (도어는 칠한 것 먼저):
 *     ① 같은 모듈의 도어 재질
 *     ② 같은 섹션 묶음(상부·후드 / 그 밖)의 아무 도어 재질 — sectionOf 가 섹션을 알려 줄 때만
 *     ③ 상몰딩만 — 같은 모듈의 몸통 재질 (몸통·걸레받이는 여기서 null)
 *     ④ 없으면 null — 그대로 둔다
 *   상판(top-panel)은 갈래가 없어 늘 null — 상판은 도어와 자재가 다르다(인조대리석 등). 도어색으로 덮으면 없는 마감을
 *   지어낸다. 먹장(blank)·서랍 앞판은 도어로 보지 않는다. 안 보이는(visible false) mesh 는 빌리지 않는다.
 * @param {object} mesh      바꿀 후보 mesh
 * @param {object[]} meshes  빌려 올 후보 mesh 목록 (moduleGroup 을 훑은 것)
 * @param {(moduleId:string)=>string|null} [sectionOf]  모듈 id → 섹션 ('upper' 등). 모르면 null
 * @returns {object|null} material
 */
function plannerCaptureBorrowMaterial(mesh, meshes, sectionOf) {
  const ud = mesh && mesh.userData;
  if (!ud || ud._origMaterial) return null;
  const kind = plannerCaptureBorrowKind(ud);
  if (!kind) return null;
  const mid = plannerCaptureMeshModuleId(mesh);
  if (mid == null) return null;
  const secOf = (id) => {
    if (typeof sectionOf !== 'function' || id == null) return null;
    try { return plannerCaptureSectionGroup(sectionOf(id)); } catch (e) { return null; }
  };
  const list = (meshes || []).filter((o) => o && o !== mesh && o.isMesh && o.material && o.visible !== false && o.userData);
  const doorsAll = list.filter((o) => plannerCaptureIsDoor(o.userData));
  // 칠한 도어 먼저 — 같은 단계에 칠 안 한 도어(자리표시 색)도 있으면 사람이 고른 마감을 빌린다
  const doors = doorsAll.filter((o) => o.userData._origMaterial).concat(doorsAll.filter((o) => !o.userData._origMaterial));
  const same = doors.find((o) => plannerCaptureMeshModuleId(o) === mid);
  if (same) return same.material;
  const g = secOf(mid);
  if (g) {
    const near = doors.find((o) => secOf(plannerCaptureMeshModuleId(o)) === g);
    if (near) return near.material;
  }
  if (kind !== 'molding') return null;
  const body = list.find((o) => plannerCaptureIsBody(o.userData) && plannerCaptureMeshModuleId(o) === mid);
  return body ? body.material : null;
}

/**
 * 2026-10-19: 도어 사이 갭 (mm). 정본은 planner-engine.js MASTER_RULES.DOOR_GAP (도어 W = 칸 W − 4) —
 * 그 전역이 있으면 그 값을 쓴다 (plannerCaptureDoorGap). 이 상수는 전역이 없을 때(단위 시험)만.
 */
const PLANNER_CAPTURE_DOOR_GAP = 4;
/**
 * 2026-10-19: clean 캡처에서 도어 테두리 막대(doorEdge)가 출력 그림에서 지킬 최소 폭 (px).
 * 그보다 가늘면 안티에일리어싱에 묻혀 도어 경계가 사라지고, 도어 개수가 읽히지 않는다 (이 렌더의 핵심 목적).
 */
const PLANNER_CAPTURE_DOOR_EDGE_MIN_PX = 1.25;
/**
 * 2026-10-19: clean 캡처에서 칠하지 않은 틈·손잡이 부재가 입는 무채색 재질.
 *   gap      도어 테두리 막대(doorEdge)·갭 뒷판(reveal) — 도어 사이 그림자 틈. 짙은 회색.
 *   channel  목찬넬 판(channelBase·channelFace) — 손 넣는 홈. 알루미늄 J찬넬 같은 중간 회색.
 */
const PLANNER_CAPTURE_NEUTRAL = {
  gap: { color: 0x2a2a2a, roughness: 0.9, metalness: 0 },
  channel: { color: 0x8c8c8c, roughness: 0.45, metalness: 0.3 },
};

/** 2026-10-19: 도어 갭 — MASTER_RULES.DOOR_GAP 이 있으면 그 값, 없으면 4. */
function plannerCaptureDoorGap() {
  const R = (typeof MASTER_RULES !== 'undefined' && MASTER_RULES) ? MASTER_RULES : null;
  const g = R ? Number(R.DOOR_GAP) : NaN;
  return g > 0 ? g : PLANNER_CAPTURE_DOOR_GAP;
}

/**
 * 2026-10-19: clean 캡처에서 무채색으로 바꿀 부재의 갈래. 순수.
 *   2026-10-18 잡 e4dc4435 의 front 렌더(도어만 칠함)에 남은 갈색 약 10만 픽셀 가운데 도어 테두리 막대 약 6.2만,
 *   목찬넬 판 약 2.5만, 갭 뒷판·다리발 약 1.2천, 상부 갭 뒷판 초록 약 2.4천. 모델이 모든 장에 갈색 테두리를 그렸다.
 *   'gap'     entityKind 'doorEdge'·'reveal' — 섹션 자리표시 색을 어둡게 한 막대·뒷판(하부 #3e3021, 상부는 초록 기운).
 *             PLANNER_FINISH_PAINT_SKIP 이라 디테일 룩이 칠하지 않는다. 실물은 도어 사이 그림자 틈이라 무채색이 맞다.
 *   'channel' carcass side 'channelBase'·'channelFace' — 목찬넬 지면판·전면판. 자리표시 #7a6a45 (진한 우드 톤).
 *             손잡이 슬롯이라 사람이 칠할 수 있다 — 칠했으면(_origMaterial) 그 마감 그대로 (null).
 *             칠하지 않았을 때 도어 재질을 빌리지 않는 까닭: 목찬넬은 도어 위 30mm 틈 안쪽으로 물러난 홈이다.
 *             도어색이면 도어가 위로 30mm 늘어난 것처럼 읽히고, 갈색이면 다시 갈색 띠가 된다. 무채색 중간 회색은
 *             "손잡이 홈(알루미늄 J찬넬 톤)" 으로 읽히고 없는 나무 마감을 지어내지 않는다.
 *   그 밖(도어·몸통·상판·다리발·손잡이 막대 등)은 null. 다리발은 걸레받이 뒤라 거의 안 보인다 — 손대지 않는다.
 * @param {object} ud mesh.userData
 * @returns {'gap'|'channel'|null}
 */
function plannerCaptureNeutralKind(ud) {
  if (!ud || ud._origMaterial) return null;
  if (ud.entityKind === 'doorEdge' || ud.entityKind === 'reveal') return 'gap';
  if (ud.entityKind === 'carcass' && (ud.side === 'channelBase' || ud.side === 'channelFace')) return 'channel';
  return null;
}

/**
 * 2026-10-19: 원근 카메라에서 시선 깊이 depth(mm)의 한 픽셀이 몇 mm 인가. 순수.
 * 세로 화각 fovDeg · 출력 높이 heightPx 기준. 값이 맞지 않으면 null.
 */
function plannerCaptureMmPerPixel(depth, fovDeg, heightPx) {
  if (!(depth > 0) || !(fovDeg > 0) || !(heightPx > 0)) return null;
  return 2 * depth * Math.tan((fovDeg / 2) * Math.PI / 180) / heightPx;
}

/**
 * 2026-10-19: clean 캡처의 도어 테두리 막대 두께 (mm). 순수.
 *   작업 화면의 keepDoorEdgesVisible 은 max(갭/2, 1.6px × 화면 mm/px) 로 **작업 화면 줌**에 맞춰 키운다 —
 *   멀리서 보던 화면 그대로 찍으면 15mm 넘는 갈색 띠가 된다. 캡처에서는 같은 규칙을 **찍는 카메라·출력 해상도**로
 *   다시 잰다: max(갭/2, PLANNER_CAPTURE_DOOR_EDGE_MIN_PX × 출력 mm/px). 갭/2 = 도어마다 갭의 반쪽 —
 *   맞닿은 두 도어의 막대와 그 사이 갭(뒷판)이 함께 한 줄의 그림자 틈이 된다. 화면 줌과 무관하다.
 * @param {number|null} mmPerPx 출력 그림의 mm/px. 모르면 갭 기준
 * @param {number} [gap] 도어 갭 (기본 plannerCaptureDoorGap())
 * @param {number} [minPx] 최소 폭 px (기본 PLANNER_CAPTURE_DOOR_EDGE_MIN_PX)
 */
function plannerCaptureDoorEdgeThickness(mmPerPx, gap, minPx) {
  const g = gap > 0 ? gap : plannerCaptureDoorGap();
  const px = minPx > 0 ? minPx : PLANNER_CAPTURE_DOOR_EDGE_MIN_PX;
  const base = g / 2;
  if (!(mmPerPx > 0) || !Number.isFinite(mmPerPx)) return base;
  return Math.max(base, px * mmPerPx);
}

/**
 * 2026-10-19: 테두리 막대 하나의 scale·position (부모 로컬). mockup-structure.html keepDoorEdgesVisible 과 같은 식 —
 * 막대 바깥선은 도어 윤곽에 붙고 두께 t 만큼 안쪽으로 든다. 막대는 1×1×1 상자를 scale 로 늘린 것이다. 순수.
 * @param {object} ud doorEdge userData {axis, baseW, baseH, cx, cy, z}
 * @param {number} t 두께 mm
 * @returns {{scale:number[], position:number[]}|null}
 */
function plannerCaptureDoorEdgeLayout(ud, t) {
  if (!ud || !(t > 0)) return null;
  const { axis, baseW, baseH, cx, cy, z } = ud;
  if (!(baseW > 0) || !(baseH > 0) || ![cx, cy, z].every(Number.isFinite)) return null;
  if (axis === 'left' || axis === 'right') {
    return { scale: [t, baseH, 1], position: [cx + (axis === 'left' ? -1 : 1) * (baseW / 2 - t / 2), cy, z] };
  }
  if (axis === 'top' || axis === 'bottom') {
    return { scale: [baseW, t, 1], position: [cx, cy + (axis === 'top' ? 1 : -1) * (baseH / 2 - t / 2), z] };
  }
  return null;
}

/** 대역이 상판 높이를 못 찾을 때 — 하부장 기본 높이 (PLANNER_SECTIONS.lower.moduleH) */
const PLANNER_CAPTURE_COUNTER_TOP = 870;
/** 상판을 찾을 때 이보다 높이 올라가는 부재는 하부가 아니다 (상부장·키큰장) */
const PLANNER_CAPTURE_LOWER_MAX_Y = 1200;
/** 가전 대역 색 — 불투명, 무채색. 모델이 "가전 자리" 로 읽되 가구 마감과 헷갈리지 않게. */
const PLANNER_CAPTURE_STANDIN_COLOR = {
  bowl: 0x2e3134, faucet: 0xa3a9ae, cooktop: 0x141516, hood: 0x8d949a, refrigerator: 0xd8dcdf, dishwasher: 0x8e959b,
};
/**
 * 2026-10-19: 후드 대역 모양 — 슬림 캐노피 + 덕트 커버 (스테인리스 톤).
 *   canopyH 캐노피 두께 mm · ductW/ductD 덕트 커버 폭·깊이 비율(후드 폭·깊이 대비) · ductMinW/ductMinD 최소 mm
 */
const PLANNER_CAPTURE_HOOD = { canopyH: 90, ductW: 0.45, ductD: 0.55, ductMinW: 200, ductMinD: 180, metalness: 0.45, roughness: 0.38 };

/**
 * 가전 대역의 상자 목록. 순수. 좌표는 **마커 그룹의 로컬** — 원점이 마커 바닥 가운데, +Z 앞, mm.
 *   sink         상판 위 어두운 사각 볼(얇은 판) + 뒤쪽 수전 기둥 + 앞으로 나온 토수구
 *   hood         스테인리스 슬림 캐노피(마커 바닥) + 뒤쪽 가운데 좁은 덕트 커버(마커 윗면 = 천장까지) — 2026-10-19 (PLANNER_CAPTURE_HOOD)
 *   refrigerator 마커 자리 그대로 연회색 몸체
 *   dishwasher   마커 자리 그대로 회색 몸체 (앞면이 회색 판으로 읽힌다)
 *   cooktop      상판 위 검은 얇은 판 — 지금은 쿡탑 섹션이 없어 만들어지지 않는다 (마커가 있는 가전만 만든다)
 * @param {string} section
 * @param {{W:number, H:number, D:number, baseY?:number}} dims 마커 상자 크기 · 마커 그룹의 세계 y
 * @param {{top:number, zMin:number, zMax:number}|null} support 밑에 받친 하부 부재의 윗면·앞뒤 (로컬). 없으면 870 · 마커 깊이
 * @returns {{part:string, size:number[], pos:number[], color:number, metalness:number, roughness:number}[]}
 */
function plannerCaptureStandInSpec(section, dims, support) {
  if (!dims) return [];
  const W = Math.max(1, Number(dims.W) || 0), H = Math.max(1, Number(dims.H) || 0), D = Math.max(1, Number(dims.D) || 0);
  const C = PLANNER_CAPTURE_STANDIN_COLOR;
  const box = (part, size, pos, color, metalness, roughness) => ({ part, size, pos, color, metalness: metalness || 0, roughness: roughness == null ? 0.6 : roughness });
  const top = support && Number.isFinite(support.top) ? support.top : PLANNER_CAPTURE_COUNTER_TOP - (Number(dims.baseY) || 0);
  const zMin = support && Number.isFinite(support.zMin) ? support.zMin : -D / 2;
  const zMax = support && Number.isFinite(support.zMax) ? support.zMax : D / 2;
  const depth = Math.max(1, zMax - zMin);
  const zc = (zMin + zMax) / 2;
  if (section === 'sink') {
    const bw = Math.max(300, W - 80);
    const bd = Math.min(480, Math.max(300, depth * 0.7));
    const postZ = Math.max(zMin + 30, zc - bd / 2 - 45);
    return [
      box('bowl', [bw, 6, bd], [0, top + 3, zc], C.bowl, 0, 0.5),
      box('faucet', [36, 300, 36], [0, top + 150, postZ], C.faucet, 0.3, 0.35),
      box('spout', [32, 32, 210], [0, top + 300 - 16, postZ + 105], C.faucet, 0.3, 0.35),
    ];
  }
  if (section === 'cooktop') {
    return [box('cooktop', [Math.min(600, Math.max(300, W - 40)), 8, Math.min(520, Math.max(300, depth * 0.8))], [0, top + 4, zc], C.cooktop, 0, 0.3)];
  }
  if (section === 'hood') {
    // 2026-10-19: 회색 상자 한 덩이는 정면 입면에서 상부장처럼 읽혔다(실측 GPT — 상부장을 빈칸 없이 이어 붙임).
    //   스테인리스 슬림 캐노피(마커 바닥) + 뒤쪽 가운데로 좁은 덕트 커버(마커 윗면 = 천장까지) — 양옆으로 벽이 보이게.
    const canopyH = Math.min(H, PLANNER_CAPTURE_HOOD.canopyH);
    const out = [box('hood', [W, canopyH, D], [0, canopyH / 2, 0], C.hood, PLANNER_CAPTURE_HOOD.metalness, PLANNER_CAPTURE_HOOD.roughness)];
    const ductH = H - canopyH;
    if (ductH > 1) {
      const dw = Math.min(W, Math.max(PLANNER_CAPTURE_HOOD.ductMinW, Math.round(W * PLANNER_CAPTURE_HOOD.ductW)));
      const dd = Math.min(D, Math.max(PLANNER_CAPTURE_HOOD.ductMinD, Math.round(D * PLANNER_CAPTURE_HOOD.ductD)));
      out.push(box('hood-duct', [dw, ductH, dd], [0, canopyH + ductH / 2, -D / 2 + dd / 2], C.hood, PLANNER_CAPTURE_HOOD.metalness, PLANNER_CAPTURE_HOOD.roughness));
    }
    return out;
  }
  if (section === 'refrigerator') return [box('refrigerator', [W, H, D], [0, H / 2, 0], C.refrigerator, 0, 0.5)];
  if (section === 'dishwasher') return [box('dishwasher', [W, H, D], [0, H / 2, 0], C.dishwasher, 0.1, 0.5)];
  return [];
}

/**
 * clean 캡처 — 알파 0 으로 지운 배경을 흰색으로. rgb 는 덮인 만큼(알파) 이미 곱해져 있다(검정 위에 그렸다)
 * 고 보고 rgb + (1 − a)·255. 끝나면 알파 255. 바닥 그림자(검정 · 알파 0.2)는 옅은 회색이 된다.
 * @param {Uint8ClampedArray} px RGBA
 */
function plannerCaptureOverWhite(px) {
  for (let i = 0; i < px.length; i += 4) {
    const k = 255 - px[i + 3];
    if (k) { px[i] += k; px[i + 1] += k; px[i + 2] += k; px[i + 3] = 255; }
  }
  return px;
}

/** design_renders.camera 에 넣을 모양 — 좌표는 정수 mm 로 줄인다. clean 이면 clean:true 를 남긴다. */
function plannerCaptureCameraJson(frame, longEdge, moduleId, clean) {
  if (!frame) return null;
  const r = (v) => Math.round(v);
  const out = {
    kind: frame.kind,
    fov: Math.round(frame.fov * 100) / 100,
    aspect: Math.round(frame.aspect * 1000) / 1000,
    position: frame.position.map(r),
    target: frame.target.map(r),
    up: frame.up,
    longEdge: longEdge,
  };
  if (moduleId != null) out.moduleId = String(moduleId);
  if (clean) out.clean = true;
  return out;
}

// ── 2026-10-19: 번호·치수선 (annotate, 머리 주석 ⑩) — 순수 ─────────────

/**
 * annotate 옵션 → 그릴 수 있는 plan. 칸이 하나도 없으면 null (그때는 annotate 가 없는 것과 같다).
 * 칸: id(문자열) · moduleId 가 있어야 한다. from·to 는 0~1 로 자르고, 없으면 모듈 전체(0~1).
 * @returns {{rows:{key:string, widthMm:number|null, heightMm:number|null, items:object[]}[]}|null}
 */
function plannerCaptureAnnotatePlan(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.rows)) return null;
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
  const clamp01 = (x, d) => { const n = num(x); return n === null ? d : Math.min(1, Math.max(0, n)); };
  const rows = [];
  v.rows.forEach((r) => {
    if (!r || !Array.isArray(r.items)) return;
    const items = [];
    r.items.forEach((it) => {
      if (!it || it.id == null || it.moduleId == null || String(it.id) === '') return;
      const from = clamp01(it.from, 0), to = clamp01(it.to, 1);
      if (!(to > from)) return;
      const w = num(it.widthMm);
      const item = { id: String(it.id), moduleId: String(it.moduleId), from, to, widthMm: w !== null && w > 0 ? w : null };
      // 2026-10-19: 쌓인 단 한 통 — 칸 상자는 이 모듈들 상자를 합친 것 (없으면 moduleId 하나)
      if (Array.isArray(it.moduleIds)) {
        const ids = it.moduleIds.filter((x) => x != null && String(x) !== '').map(String);
        if (ids.length) item.moduleIds = ids;
      }
      items.push(item);
    });
    if (!items.length) return;
    const W = num(r.widthMm), H = num(r.heightMm);
    rows.push({ key: String(r.key || ''), widthMm: W !== null && W > 0 ? W : null, heightMm: H !== null && H > 0 ? H : null, items });
  });
  return rows.length ? { rows } : null;
}

/**
 * 세계 좌표 한 점 → 출력 그림의 픽셀 [x, y] (왼쪽 위 0,0). 카메라 뒤면 null. 순수 — three 의 project 와 같은 값.
 * 종횡비는 찍는 카메라처럼 width/height 다 (frame.aspect 는 정수 픽셀로 반올림하기 전 값이라 조금 다르다).
 * @param {{position:number[], target:number[], up:number[], fov:number, near?:number}} frame
 */
function plannerCaptureProjectPoint(frame, width, height, p) {
  if (!frame || !p || !(width > 0) || !(height > 0)) return null;
  const B = plannerCaptureLookBasis(frame.position, frame.target, frame.up);
  const tv = Math.tan((frame.fov / 2) * Math.PI / 180);
  const th = tv * (width / height);
  const v = [p[0] - frame.position[0], p[1] - frame.position[1], p[2] - frame.position[2]];
  const depth = -(v[0] * B.z[0] + v[1] * B.z[1] + v[2] * B.z[2]);
  if (!(depth > (frame.near || 0))) return null;
  const x = (v[0] * B.x[0] + v[1] * B.x[1] + v[2] * B.x[2]) / (depth * th);
  const y = (v[0] * B.y[0] + v[1] * B.y[1] + v[2] * B.y[2]) / (depth * tv);
  return [(x + 1) / 2 * width, (1 - y) / 2 * height];
}

/**
 * 모듈 경계 → 출력 그림의 픽셀 상자. 앞면(max.z)의 네 꼭짓점을 투영한다 — 원근이라 뒷면까지 넣으면 상자가 부푼다.
 * @returns {{x0:number, x1:number, y0:number, y1:number}|null} y0 위 · y1 아래
 */
function plannerCaptureScreenBox(frame, width, height, bounds) {
  if (!bounds || !bounds.min || !bounds.max) return null;
  const z = bounds.max.z;
  const pts = [[bounds.min.x, bounds.min.y, z], [bounds.max.x, bounds.min.y, z], [bounds.min.x, bounds.max.y, z], [bounds.max.x, bounds.max.y, z]]
    .map((p) => plannerCaptureProjectPoint(frame, width, height, p));
  if (pts.some((q) => !q)) return null;
  return {
    x0: Math.min.apply(null, pts.map((q) => q[0])), x1: Math.max.apply(null, pts.map((q) => q[0])),
    y0: Math.min.apply(null, pts.map((q) => q[1])), y1: Math.max.apply(null, pts.map((q) => q[1])),
  };
}

/** 2026-10-19: 픽셀 상자 여럿 → 합친 상자. 없는 것(null·undefined)은 건너뛰고, 하나도 없으면 null. */
function plannerCaptureUnionBox(list) {
  const bs = (list || []).filter(Boolean);
  if (!bs.length) return null;
  return {
    x0: Math.min.apply(null, bs.map((b) => b.x0)), x1: Math.max.apply(null, bs.map((b) => b.x1)),
    y0: Math.min.apply(null, bs.map((b) => b.y0)), y1: Math.max.apply(null, bs.map((b) => b.y1)),
  };
}

/** 치수 글자 — 정수 mm, 단위 없이 (도면 관례). 모르면 ''. */
function plannerCaptureDimText(mm) {
  const n = Number(mm);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
}

/**
 * plan + 모듈별 픽셀 상자 → 표시 목록. 순수 — canvas 를 모른다.
 *   라벨: 칸 상자(모듈 상자를 from~to 로 가로로 자른 것)의 가운데. 바탕 labelBg.
 *   치수: 줄(key 'upper')은 위로, 나머지는 아래로. 첫 단 = 칸 폭, 둘째 단 = 줄 전체. 양 끝에 짧은 눈금.
 *         글자는 선 가운데에 dimBg 바탕으로 얹는다 (선이 글자 뒤에서 끊겨 보인다).
 *   높이: 줄 상자 옆 세로선 + 글자. 가구 전체의 왼쪽 끝에 닿은 줄은 왼쪽, 오른쪽 끝에 닿은 줄은 오른쪽, 아니면 왼쪽.
 * @param {{rows:object[]}} plan  plannerCaptureAnnotatePlan 결과
 * @param {Object<string,{x0,x1,y0,y1}>} boxes  moduleId → 픽셀 상자 (없는 모듈의 칸은 건너뛴다)
 * @param {number} width @param {number} height 출력 크기
 * @returns {{style:object, lines:number[][], texts:{x:number,y:number,text:string,kind:'label'|'dim',bg:string}[], items:object[]}}
 *   items = 그린 칸 {id, moduleId, cx, cy, box} (시험·확인용)
 */
function plannerCaptureAnnotationLayout(plan, boxes, width, height) {
  const S = PLANNER_CAPTURE_ANNOTATE_STYLE;
  const k = Math.max(width, height) / S.baseEdge;
  const font = Math.max(10, Math.round(S.font * k));
  const style = { color: S.color, line: Math.max(1, Math.round(S.line * k * 10) / 10), font, fontFamily: S.fontFamily, labelBg: S.labelBg, dimBg: S.dimBg };
  const out = { style, lines: [], texts: [], items: [] };
  if (!plan || !Array.isArray(plan.rows) || !boxes) return out;
  const tick = Math.round(font * 0.45);
  const gap = Math.round(font * 1.2);
  const step = Math.round(font * 2);
  const clampY = (y) => Math.min(height - font, Math.max(font, y));
  const clampX = (x) => Math.min(width - font, Math.max(font, x));
  const hLine = (x0, x1, y) => {
    out.lines.push([x0, y, x1, y], [x0, y - tick, x0, y + tick], [x1, y - tick, x1, y + tick]);
  };
  const rowsDrawn = [];
  plan.rows.forEach((row) => {
    const cells = [];
    row.items.forEach((it) => {
      // 2026-10-19: moduleIds 가 있으면 찾은 상자들을 합친다 (쌓인 단 한 통)
      const b = it.moduleIds ? plannerCaptureUnionBox(it.moduleIds.map((id) => boxes[id])) : boxes[it.moduleId];
      if (!b) return;
      const w = b.x1 - b.x0;
      const box = { x0: b.x0 + w * it.from, x1: b.x0 + w * it.to, y0: b.y0, y1: b.y1 };
      cells.push({ it, box });
    });
    if (cells.length) rowsDrawn.push({ row, cells });
  });
  if (!rowsDrawn.length) return out;
  const allX0 = Math.min.apply(null, rowsDrawn.map((r) => Math.min.apply(null, r.cells.map((c) => c.box.x0))));
  const allX1 = Math.max.apply(null, rowsDrawn.map((r) => Math.max.apply(null, r.cells.map((c) => c.box.x1))));
  rowsDrawn.forEach(({ row, cells }) => {
    const rb = {
      x0: Math.min.apply(null, cells.map((c) => c.box.x0)), x1: Math.max.apply(null, cells.map((c) => c.box.x1)),
      y0: Math.min.apply(null, cells.map((c) => c.box.y0)), y1: Math.max.apply(null, cells.map((c) => c.box.y1)),
    };
    // 라벨
    cells.forEach(({ it, box }) => {
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      out.texts.push({ x: cx, y: cy, text: it.id, kind: 'label', bg: style.labelBg });
      out.items.push({ id: it.id, moduleId: it.moduleId, cx, cy, box });
    });
    // 치수 — 첫 단 칸 폭, 둘째 단 줄 전체
    const up = row.key === 'upper';
    const y1 = clampY(up ? rb.y0 - gap : rb.y1 + gap);
    const y2 = clampY(up ? y1 - step : y1 + step);
    cells.forEach(({ it, box }) => {
      const t = plannerCaptureDimText(it.widthMm);
      if (!t) return;
      hLine(box.x0, box.x1, y1);
      out.texts.push({ x: (box.x0 + box.x1) / 2, y: y1, text: t, kind: 'dim', bg: style.dimBg });
    });
    const total = plannerCaptureDimText(row.widthMm);
    if (total) {
      hLine(rb.x0, rb.x1, y2);
      // 줄 양 끝 보조선 — 가구 가장자리에서 둘째 단까지 (가구에 닿지 않게 조금 띄운다)
      const from = up ? rb.y0 - 3 : rb.y1 + 3;
      out.lines.push([rb.x0, from, rb.x0, y2], [rb.x1, from, rb.x1, y2]);
      out.texts.push({ x: (rb.x0 + rb.x1) / 2, y: y2, text: total, kind: 'dim', bg: style.dimBg });
    }
    // 높이 — 옆에 세로로 하나
    const h = plannerCaptureDimText(row.heightMm);
    if (h) {
      const left = rb.x0 <= allX0 + 1 || rb.x1 < allX1 - 1;
      const x = clampX(left ? rb.x0 - gap : rb.x1 + gap);
      out.lines.push([x, rb.y0, x, rb.y1], [x - tick, rb.y0, x + tick, rb.y0], [x - tick, rb.y1, x + tick, rb.y1]);
      out.texts.push({ x, y: (rb.y0 + rb.y1) / 2, text: h, kind: 'dim', bg: style.dimBg });
    }
  });
  return out;
}

/**
 * 표시 목록을 canvas 2D 문맥에 그린다. 선을 먼저, 글자는 바탕 상자 → 글자 순서로 (글자가 선 위에 온다).
 * @param {CanvasRenderingContext2D} ctx @param {object} list plannerCaptureAnnotationLayout 결과
 */
function plannerCaptureDrawAnnotation(ctx, list) {
  if (!ctx || !list || !list.style) return 0;
  const st = list.style;
  ctx.save();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = st.line;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  list.lines.forEach((l) => { ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); });
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  list.texts.forEach((t) => {
    ctx.font = (t.kind === 'label' ? '600 ' : '') + st.font + 'px ' + st.fontFamily;
    const w = (typeof ctx.measureText === 'function' ? ctx.measureText(t.text).width : 0) || t.text.length * st.font * 0.6;
    const padX = Math.round(st.font * 0.3), padY = Math.round(st.font * 0.15);
    const bw = w + padX * 2, bh = st.font + padY * 2;
    if (t.bg) { ctx.fillStyle = t.bg; ctx.fillRect(t.x - bw / 2, t.y - bh / 2, bw, bh); }
    ctx.fillStyle = st.color;
    ctx.fillText(t.text, t.x, t.y);
  });
  ctx.restore();
  return list.lines.length + list.texts.length;
}

/**
 * mesh 만 모아 세계 좌표 경계를 잰다. area·pick 은 뺀다 (부재가 아니다). 선(LineSegments)도 뺀다 — 원점 마커.
 * @param {object} root three Object3D (moduleGroup 또는 모듈 그룹)
 * @param {object} T three 네임스페이스
 * @param {{visibleOnly?:boolean, skip?:Object<string,boolean>}} [opt] visibleOnly: 숨긴 것(과 그 아래)은 세지 않는다 — clean 캡처가 쓴다.
 *   skip: 더 뺄 entityKind (2026-10-19 annotate — 런 전체에 걸친 상판·걸레받이)
 * @returns {{min:{x,y,z}, max:{x,y,z}}|null} mesh 가 없으면 null
 */
function plannerCaptureBoundsOf(root, T, opt) {
  if (!root || !T || typeof root.traverse !== 'function') return null;
  try { root.updateWorldMatrix(true, true); } catch (e) { /* 순수 객체면 없다 */ }
  const box = new T.Box3();
  const tmp = new T.Box3();
  let any = false;
  const walk = (opt && opt.visibleOnly && typeof root.traverseVisible === 'function') ? 'traverseVisible' : 'traverse';
  root[walk]((obj) => {
    if (!obj || !obj.isMesh || !obj.geometry) return;
    const ud = obj.userData || {};
    if (ud.entityKind && PLANNER_CAPTURE_BOUNDS_SKIP[ud.entityKind]) return;
    if (ud.entityKind && opt && opt.skip && opt.skip[ud.entityKind]) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    if (!obj.geometry.boundingBox) return;
    tmp.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
    if (tmp.isEmpty()) return;
    box.union(tmp);
    any = true;
  });
  if (!any) return null;
  return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
}

/**
 * 2026-10-19: annotate 에서 모듈 가로 범위를 잴 때 빼는 부재 — 런 전체에 걸쳐 첫 모듈 그룹에 붙는 상판·걸레받이·좌대·상몰딩.
 * (브라우저 확인: 하부 첫 모듈 그룹의 상판·걸레받이가 x 0~2200 이라 L1 이 줄 가운데로 갔다.)
 */
const PLANNER_CAPTURE_ANNOTATE_SPAN_SKIP = { 'top-panel': true, 'toe-kick': true, pedestal: true, molding: true };

/**
 * 2026-10-19: annotate 용 모듈 경계 — 가로(x)는 런에 걸친 부재(PLANNER_CAPTURE_ANNOTATE_SPAN_SKIP)를 뺀 몸통·도어로,
 * 세로·깊이는 모듈 전체로 (줄 높이 치수선이 바닥~상판 윗면이 되게). 몸통이 없으면 전체 경계 그대로.
 */
function plannerCaptureModuleBounds(obj, T, visibleOnly) {
  const all = plannerCaptureBoundsOf(obj, T, visibleOnly ? { visibleOnly: true } : null);
  if (!all) return null;
  const core = plannerCaptureBoundsOf(obj, T, { visibleOnly: !!visibleOnly, skip: PLANNER_CAPTURE_ANNOTATE_SPAN_SKIP });
  if (!core) return all;
  return { min: { x: core.min.x, y: all.min.y, z: all.min.z }, max: { x: core.max.x, y: all.max.y, z: all.max.z } };
}

/**
 * 2026-10-18: clean 프레임이 맞출 점 — **보이는** 부재 mesh 하나하나의 세계 경계 꼭짓점 (1mm 로 묶어 중복 제거).
 * 경계 상자 하나의 꼭짓점과 달리 빈 허공의 모서리(상판 앞코 위 · 상부장 앞의 빈 공간)가 들어가지 않는다.
 * 고르는 규칙은 plannerCaptureBoundsOf(visibleOnly) 와 같다 — 숨긴 것과 그 아래, area·pick, 선(원점 마커)은 뺀다.
 * @returns {number[][]} [[x,y,z], …] — mesh 가 없으면 []
 */
function plannerCapturePointsOf(root, T) {
  if (!root || !T || typeof root.traverse !== 'function') return [];
  try { root.updateWorldMatrix(true, true); } catch (e) { /* 순수 객체면 없다 */ }
  const tmp = new T.Box3();
  const seen = new Set();
  const out = [];
  const walk = typeof root.traverseVisible === 'function' ? 'traverseVisible' : 'traverse';
  root[walk]((obj) => {
    if (!obj || !obj.isMesh || !obj.geometry || obj.visible === false) return;
    const ud = obj.userData || {};
    if (ud.entityKind && PLANNER_CAPTURE_BOUNDS_SKIP[ud.entityKind]) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    if (!obj.geometry.boundingBox) return;
    tmp.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
    if (tmp.isEmpty()) return;
    plannerCaptureCorners(tmp).forEach((p) => {
      const key = Math.round(p[0]) + ',' + Math.round(p[1]) + ',' + Math.round(p[2]);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(p);
    });
  });
  return out;
}

/** moduleGroup 안에서 그 모듈의 그룹 (createModuleMesh 가 userData.entityKind='module' 을 붙인다). */
function plannerCaptureModuleObject(group, moduleId) {
  if (!group || moduleId == null || typeof group.traverse !== 'function') return null;
  let found = null;
  group.traverse((obj) => {
    if (found || !obj || !obj.userData) return;
    if (obj.userData.entityKind === 'module' && String(obj.userData.moduleId) === String(moduleId)) found = obj;
  });
  return found;
}

/**
 * readRenderTargetPixels 는 아래 줄부터 준다 — 위아래를 뒤집고 알파는 255 로 (배경은 불투명하다).
 * keepAlpha 면 알파를 그대로 둔다 — clean 캡처가 plannerCaptureOverWhite 로 흰색에 얹는다.
 * @param {Uint8Array|Uint8ClampedArray} src RGBA, 아래→위
 * @returns {Uint8ClampedArray} RGBA, 위→아래
 */
function plannerCaptureFlipRows(src, width, height, keepAlpha) {
  const out = new Uint8ClampedArray(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * row;
    out.set(src.subarray(from, from + row), y * row);
  }
  if (!keepAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

/**
 * 마커 밑에 받친 하부 부재의 윗면·앞뒤를 **마커 그룹 로컬**로 잰다 — 싱크 볼이 앉을 상판.
 * 마커와 가로(로컬 x)가 겹치고 세계 높이 PLANNER_CAPTURE_LOWER_MAX_Y 아래에서 끝나는 부재 mesh 만 센다
 * (상부장·키큰장은 빠진다). 마커 모듈끼리는 서로 받치지 않는다. 없으면 null.
 */
function plannerCaptureSupportOf(markerGroup, markerW, moduleGroup, T) {
  if (!markerGroup || !moduleGroup || !T || !T.Matrix4 || !T.Box3) return null;
  try { moduleGroup.updateWorldMatrix(true, true); } catch (e) { /* 순수 객체면 없다 */ }
  const inv = new T.Matrix4().copy(markerGroup.matrixWorld).invert();
  const wb = new T.Box3(), lb = new T.Box3();
  const half = Math.max(1, Number(markerW) || 0) / 2;
  let top = -Infinity, zMin = Infinity, zMax = -Infinity;
  (moduleGroup.children || []).forEach((mod) => {
    if (!mod || mod === markerGroup || !mod.userData || mod.userData.entityKind !== 'module') return;
    if ((mod.children || []).some((c) => c && c.userData && c.userData.entityKind === 'marker')) return;
    mod.traverse((o) => {
      if (!o || !o.isMesh || !o.geometry) return;
      const ud = o.userData || {};
      if (ud.entityKind && (PLANNER_CAPTURE_BOUNDS_SKIP[ud.entityKind] || ud.entityKind === 'standin')) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      wb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (wb.isEmpty() || wb.max.y > PLANNER_CAPTURE_LOWER_MAX_Y) return;
      lb.copy(wb).applyMatrix4(inv);
      if (lb.max.x <= -half || lb.min.x >= half) return;
      top = Math.max(top, lb.max.y);
      zMin = Math.min(zMin, lb.min.z);
      zMax = Math.max(zMax, lb.max.z);
    });
  });
  return Number.isFinite(top) ? { top, zMin, zMax } : null;
}

/** linear → sRGB (8비트 LUT). OutputPass 가 없을 때의 폴백. */
let PLANNER_CAPTURE_SRGB_LUT = null;
function plannerCaptureSrgbLut() {
  if (PLANNER_CAPTURE_SRGB_LUT) return PLANNER_CAPTURE_SRGB_LUT;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    lut[i] = Math.round(s * 255);
  }
  PLANNER_CAPTURE_SRGB_LUT = lut;
  return lut;
}
function plannerCaptureApplySrgb(px) {
  const lut = plannerCaptureSrgbLut();
  for (let i = 0; i < px.length; i += 4) { px[i] = lut[px[i]]; px[i + 1] = lut[px[i + 1]]; px[i + 2] = lut[px[i + 2]]; }
  return px;
}

// ── 캡처 ────────────────────────────────────────────────

const PlannerCapture = {
  BUCKET: PLANNER_CAPTURE_BUCKET,
  KINDS: PLANNER_CAPTURE_KINDS,
  LONG_EDGE: PLANNER_CAPTURE_LONG_EDGE,
  LONG_EDGE_HI: PLANNER_CAPTURE_LONG_EDGE_HI,
  frame: plannerCaptureFrame,
  path: plannerCapturePath,
  fileName: plannerCaptureFileName,
  detailHash: plannerCaptureDetailHash,
  _o: null,
  /** PNG 인코더 — 시험이 갈아 끼운다. 기본은 canvas 2D toBlob. */
  _encode: null,
  _outputPass: null,
  /** 캡처 중인가 (메뉴가 버튼을 잠근다) */
  busy: false,

  mount(o) {
    this._o = o || {};
    return this;
  },

  three() {
    if (!this._o || typeof this._o.three !== 'function') return null;
    try { return this._o.three() || null; } catch (e) { return null; }
  },

  T() {
    return (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
  },

  toast(text) {
    if (this._o && typeof this._o.toast === 'function') { try { this._o.toast(text); } catch (e) { /* 무해 */ } }
  },

  ids() {
    if (this._o && typeof this._o.ids === 'function') { try { return this._o.ids() || {}; } catch (e) { return {}; } }
    return (typeof plannerScopeIds === 'function') ? plannerScopeIds() : {};
  },

  /** 해시할 마감 모델 — 기본은 PlannerDetail.detail */
  detailModel() {
    if (this._o && typeof this._o.detail === 'function') { try { return this._o.detail(); } catch (e) { return null; } }
    return (typeof PlannerDetail !== 'undefined' && PlannerDetail) ? (PlannerDetail.detail || null) : null;
  },

  /** 화면 캔버스 종횡비 — iso 프리셋용. renderer.getSize 가 없으면 3:2. */
  canvasAspect() {
    const t = this.three();
    const T = this.T();
    try {
      if (t && t.renderer && typeof t.renderer.getSize === 'function' && T && T.Vector2) {
        const v = t.renderer.getSize(new T.Vector2());
        if (v.x > 0 && v.y > 0) return v.x / v.y;
      }
    } catch (e) { /* 아래 폴백 */ }
    return 1.5;
  },

  /** OutputPass 하나를 재사용한다 (셰이더 컴파일은 한 번). 없으면 null → 폴백 경로. */
  outputPass() {
    if (this._outputPass) return this._outputPass;
    const OP = (typeof window !== 'undefined') ? window.OutputPass : null;
    if (!OP) return null;
    try { this._outputPass = new OP(); } catch (e) { this._outputPass = null; }
    return this._outputPass;
  },

  // ── clean 캡처 (2026-10-08, 계획서 §5) ──────────────────
  // 세 단계로 나눈다: begin(숨김·가전 대역·배경) → 경계 → shadows(경계로 그림자 맞춤·바닥 그림자 받이) → … → end.
  // 상태 주머니(st)를 먼저 만들고 바꿀 때마다 거기 적는다 — 중간에 던져도 end 가 바꾼 만큼만 되돌린다.

  _cleanState() {
    return { hidden: [], added: [], mats: [], own: [], edges: [], bg: null, clear: null, lights: [], shadowMap: null };
  },

  /** 모듈 id → 섹션. mount 의 sectionOf → PlannerDetail.moduleOf → 모르면 null. */
  sectionOf(moduleId) {
    if (this._o && typeof this._o.sectionOf === 'function') { try { return this._o.sectionOf(moduleId) || null; } catch (e) { return null; } }
    const PD = (typeof PlannerDetail !== 'undefined' && PlannerDetail && typeof PlannerDetail.moduleOf === 'function') ? PlannerDetail : null;
    if (!PD) return null;
    try { const m = PD.moduleOf(moduleId); return (m && m.section) || null; } catch (e) { return null; }
  },

  /**
   * 2026-10-18: 상몰딩에 도어 재질을 잠깐 입힌다 (plannerCaptureMoldingMaterial). 바꾸기 전에 st.mats 에 적는다 —
   * _cleanEnd 가 거꾸로 원래 재질을 끼운다. 빌린 재질은 도어의 것이라 버리지(dispose) 않는다.
   * 2026-10-19: 칠하지 않은 몸통·걸레받이(좌대)까지 (plannerCaptureBorrowMaterial). 고르기를 먼저 다 끝내고 바꾼다 —
   * 바꾸는 도중의 재질을 다른 부재가 다시 빌리지 않게.
   */
  _cleanMoldings(t, st) {
    const g = t.moduleGroup;
    if (!g || typeof g.traverse !== 'function') return;
    const meshes = [];
    g.traverse((o) => { if (o && o.isMesh) meshes.push(o); });
    const sectionOf = (id) => this.sectionOf(id);
    const swaps = [];
    meshes.forEach((o) => {
      if (!o.userData || !plannerCaptureBorrowKind(o.userData)) return;
      const mat = plannerCaptureBorrowMaterial(o, meshes, sectionOf);
      if (!mat || mat === o.material) return;
      swaps.push([o, mat]);
    });
    swaps.forEach(([o, mat]) => {
      st.mats.push({ mesh: o, material: o.material });
      o.material = mat;
    });
  },

  /**
   * 2026-10-19: 칠하지 않은 도어 테두리 막대·갭 뒷판·목찬넬 판에 무채색 재질을 잠깐 입힌다 (plannerCaptureNeutralKind).
   * 재질은 갈래마다 한 벌 새로 만들어 st.own 에 적는다 — _cleanEnd 가 원래 재질을 끼운 뒤 버린다(dispose).
   * makeBox 재질의 polygonOffset(테두리 선과 z-fighting 막기)·side 는 첫 mesh 에서 옮겨 받는다.
   */
  _cleanNeutral(t, T, st) {
    const g = t.moduleGroup;
    if (!g || typeof g.traverse !== 'function' || !T || !T.MeshStandardMaterial) return;
    const meshes = [];
    g.traverse((o) => { if (o && o.isMesh && o.material) meshes.push(o); });
    const made = {};
    meshes.forEach((o) => {
      const kind = plannerCaptureNeutralKind(o.userData);
      if (!kind) return;
      let mat = made[kind];
      if (!mat) {
        const spec = PLANNER_CAPTURE_NEUTRAL[kind];
        mat = new T.MeshStandardMaterial({ color: spec.color, roughness: spec.roughness, metalness: spec.metalness });
        const base = o.material;
        ['polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'side'].forEach((k) => {
          if (base && base[k] !== undefined) mat[k] = base[k];
        });
        made[kind] = mat;
        st.own.push(mat);
      }
      st.mats.push({ mesh: o, material: o.material });
      o.material = mat;
    });
  },

  /**
   * 2026-10-19: 도어 테두리 막대 두께를 **찍는 카메라·출력 높이** 기준으로 다시 잡는다 (plannerCaptureDoorEdgeThickness).
   * 작업 화면 keepDoorEdgesVisible 이 화면 줌에 맞춰 키운 두께(멀리서 보면 15mm 넘게)를 그대로 찍지 않는다.
   * 막대마다 제 자리의 시선 깊이로 mm/px 를 잰다 (massing 은 앞뒤 깊이가 다르다). 바꾸기 전에 scale·position·
   * visible·geometry 를 st.edges 에 적는다 — _cleanEnd 가 되돌린다. keepDoorEdgesVisible 은 animate 루프(rAF)에서만
   * 불리고 캡처는 동기라 그 사이에 끼어들지 못한다. 다음 프레임에서 그것이 다시 잡아도 작업 화면 값과 같다.
   */
  _cleanDoorEdges(t, T, cam, heightPx, st) {
    const g = t.moduleGroup;
    if (!g || typeof g.traverse !== 'function' || !cam || !T || !T.Vector3) return;
    const gap = plannerCaptureDoorGap();
    const eye = cam.position.clone();
    const fwd = new T.Vector3();
    cam.getWorldDirection(fwd);
    const p = new T.Vector3();
    const bars = [];
    g.traverse((o) => { if (o && o.isMesh && o.userData && o.userData.entityKind === 'doorEdge' && o.parent) bars.push(o); });
    bars.forEach((o) => {
      const ud = o.userData;
      try { o.parent.updateWorldMatrix(true, false); } catch (e) { /* 무해 */ }
      p.set(ud.cx, ud.cy, ud.z);
      o.parent.localToWorld(p);
      const depth = p.sub(eye).dot(fwd);
      const tmm = plannerCaptureDoorEdgeThickness(plannerCaptureMmPerPixel(depth, cam.fov, heightPx), gap);
      const lay = plannerCaptureDoorEdgeLayout(ud, tmm);
      if (!lay) return;
      st.edges.push({ mesh: o, scale: o.scale.toArray(), position: o.position.toArray(), visible: o.visible, geometry: o.geometry });
      o.scale.set(lay.scale[0], lay.scale[1], lay.scale[2]);
      o.position.set(lay.position[0], lay.position[1], lay.position[2]);
    });
  },

  /**
   * 숨김 · 가전 대역 · 흰 배경(알파 0 으로 지우기) · 상몰딩·칠 안 한 몸통·걸레받이 재질 ·
   * 칠 안 한 테두리 막대·갭 뒷판·목찬넬 무채색. 바꾼 것은 전부 st 에 적는다.
   * (테두리 막대 두께는 카메라가 정해진 뒤 capturePixels 가 _cleanDoorEdges 로 따로 잡는다.)
   */
  _cleanBegin(t, T, st) {
    const sel = plannerCaptureCleanTargets(t.scene, t.moduleGroup);
    sel.hide.forEach((o) => { st.hidden.push(o); o.visible = false; });
    this._cleanMoldings(t, st);
    this._cleanNeutral(t, T, st);
    sel.markers.forEach((mk) => {
      // buildMarkerMesh 는 마커 상자를 그룹 로컬 (0, H/2, 0) 에 W×H×D 로 둔다
      const geo = mk.marker.geometry;
      const p = (geo && geo.parameters) || {};
      let W = p.width, H = p.height, D = p.depth;
      if (!(W > 0 && H > 0 && D > 0) && geo) {
        if (!geo.boundingBox && typeof geo.computeBoundingBox === 'function') geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (bb) { W = bb.max.x - bb.min.x; H = bb.max.y - bb.min.y; D = bb.max.z - bb.min.z; }
      }
      if (!(W > 0 && H > 0 && D > 0)) return;
      try { mk.group.updateWorldMatrix(true, false); } catch (e) { /* 무해 */ }
      const baseY = mk.group.matrixWorld ? mk.group.matrixWorld.elements[13] : 0;
      const needsTop = mk.section === 'sink' || mk.section === 'cooktop';
      const support = needsTop ? plannerCaptureSupportOf(mk.group, W, t.moduleGroup, T) : null;
      const spec = plannerCaptureStandInSpec(mk.section, { W, H, D, baseY }, support);
      if (!spec.length) return;
      const g = new T.Group();
      g.userData = { entityKind: 'standin', section: mk.section, moduleId: mk.moduleId };
      spec.forEach((s) => {
        const mat = new T.MeshStandardMaterial({ color: s.color, metalness: s.metalness, roughness: s.roughness });
        const mesh = new T.Mesh(new T.BoxGeometry(s.size[0], s.size[1], s.size[2]), mat);
        mesh.position.set(s.pos[0], s.pos[1], s.pos[2]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { entityKind: 'standin', part: s.part, moduleId: mk.moduleId };
        g.add(mesh);
      });
      mk.group.add(g);
      st.added.push(g);
    });
    // 배경 — 비우고 알파 0 으로 지운다. 흰색은 픽셀을 읽은 뒤 plannerCaptureOverWhite 가 얹는다.
    st.bg = { value: t.scene.background };
    t.scene.background = null;
    const r = t.renderer;
    if (r && typeof r.getClearColor === 'function' && typeof r.setClearColor === 'function' && T.Color) {
      st.clear = { color: r.getClearColor(new T.Color()), alpha: typeof r.getClearAlpha === 'function' ? r.getClearAlpha() : 1 };
      r.setClearColor(0x000000, 0);
    }
  },

  /**
   * 그림자 — castShadow 방향광의 그림자 카메라를 경계에 맞추고, 바닥(y=0)에 그림자만 받는 판을 깐다.
   * 바닥 판은 숨겼으니 이것이 없으면 가구가 바닥에 떨어뜨리는 그림자가 갈 곳이 없다.
   */
  _cleanShadows(t, T, bounds, st) {
    const r = t.renderer;
    if (r && r.shadowMap) {
      st.shadowMap = { enabled: r.shadowMap.enabled, needsUpdate: r.shadowMap.needsUpdate };
      r.shadowMap.enabled = true;
      r.shadowMap.needsUpdate = true;
    }
    const floorY = Math.min(0, bounds.min.y);
    const cl = plannerCaptureCleanLight(bounds);
    (t.scene.children || []).forEach((L) => {
      if (!L || !L.isDirectionalLight || !L.castShadow || !L.shadow || !L.shadow.camera) return;
      const cam = L.shadow.camera;
      // 바꾸기 전에 적는다 — 아래에서 던져도 _cleanEnd 가 자리·그림자 카메라를 되돌린다
      const tgt = L.target || null;
      const s = {
        light: L,
        cam: { left: cam.left, right: cam.right, top: cam.top, bottom: cam.bottom, near: cam.near, far: cam.far },
        bias: L.shadow.bias,
        normalBias: L.shadow.normalBias,
        pos: L.position ? [L.position.x, L.position.y, L.position.z] : null,
        tpos: (tgt && tgt.position) ? [tgt.position.x, tgt.position.y, tgt.position.z] : null,
      };
      st.lights.push(s);
      // ⑥ 그림자 빛 — 앞·왼쪽 위로. 타깃이 씬 그래프 밖(부모 없음)일 때만 — 로컬 좌표가 곧 세계 좌표다.
      if (cl && s.pos && s.tpos && !tgt.parent && (!L.parent || L.parent === t.scene)) {
        L.position.set(cl.position[0], cl.position[1], cl.position[2]);
        tgt.position.set(cl.target[0], cl.target[1], cl.target[2]);
        s.moved = true;
        try { tgt.updateMatrixWorld(true); } catch (e) { /* 무해 */ }
      }
      try { L.updateWorldMatrix(true, false); } catch (e) { /* 무해 */ }
      const le = L.matrixWorld.elements;
      const te = (L.target && L.target.matrixWorld) ? L.target.matrixWorld.elements : null;
      const fr = plannerCaptureShadowFrustum([le[12], le[13], le[14]], te ? [te[12], te[13], te[14]] : [0, 0, 0], bounds, 50, floorY);
      if (!fr) return;
      Object.assign(cam, fr);
      cam.updateProjectionMatrix();
      // 깊이 지도 한 칸 크기만큼 법선 쪽으로 민다 — 그림자 여드름(acne) 막기. mm 단위.
      const mapW = (L.shadow.mapSize && L.shadow.mapSize.x) || 1024;
      L.shadow.bias = -0.0005;
      L.shadow.normalBias = Math.max(fr.right - fr.left, fr.top - fr.bottom) / mapW;
      L.shadow.needsUpdate = true;
    });
    if (st.lights.length && T.ShadowMaterial && T.PlaneGeometry) {
      const W = (bounds.max.x - bounds.min.x) + 4000, D = (bounds.max.z - bounds.min.z) + 4000;
      const plane = new T.Mesh(new T.PlaneGeometry(W, D), new T.ShadowMaterial({ opacity: PLANNER_CAPTURE_SHADOW_OPACITY }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((bounds.min.x + bounds.max.x) / 2, floorY, (bounds.min.z + bounds.max.z) / 2);
      plane.receiveShadow = true;
      plane.userData = { entityKind: 'standin', part: 'shadow-catcher' };
      t.scene.add(plane);
      st.added.push(plane);
    }
  },

  /** begin·shadows 가 바꾼 것을 거꾸로 되돌린다. 단계마다 따로 try — 하나가 던져도 나머지는 돌아간다. */
  _cleanEnd(t, st) {
    if (!st) return;
    st.added.splice(0).reverse().forEach((o) => {
      try { if (o.parent) o.parent.remove(o); } catch (e) { /* 무해 */ }
      try {
        o.traverse((x) => {
          if (x.geometry && typeof x.geometry.dispose === 'function') x.geometry.dispose();
          if (x.material && typeof x.material.dispose === 'function') x.material.dispose();
        });
      } catch (e) { /* 무해 */ }
    });
    st.hidden.splice(0).forEach((o) => { try { o.visible = true; } catch (e) { /* 무해 */ } });
    st.mats.splice(0).reverse().forEach((s) => { try { s.mesh.material = s.material; } catch (e) { /* 무해 */ } });
    // 2026-10-19: 잠깐 만든 무채색 재질 — 원래 재질을 다 끼운 뒤에 버린다
    st.own.splice(0).forEach((m) => { try { m.dispose(); } catch (e) { /* 무해 */ } });
    st.edges.splice(0).reverse().forEach((s) => {
      try {
        s.mesh.scale.set(s.scale[0], s.scale[1], s.scale[2]);
        s.mesh.position.set(s.position[0], s.position[1], s.position[2]);
        s.mesh.visible = s.visible;
        if (s.mesh.geometry !== s.geometry) s.mesh.geometry = s.geometry;
      } catch (e) { /* 무해 */ }
    });
    if (st.bg) { try { t.scene.background = st.bg.value; } catch (e) { /* 무해 */ } st.bg = null; }
    if (st.clear) { try { t.renderer.setClearColor(st.clear.color, st.clear.alpha); } catch (e) { /* 무해 */ } st.clear = null; }
    st.lights.splice(0).forEach((s) => {
      if (s.moved) {
        try {
          s.light.position.set(s.pos[0], s.pos[1], s.pos[2]);
          s.light.target.position.set(s.tpos[0], s.tpos[1], s.tpos[2]);
          s.light.target.updateMatrixWorld(true);
          s.light.updateMatrixWorld(true);
        } catch (e) { /* 무해 */ }
      }
      try {
        Object.assign(s.light.shadow.camera, s.cam);
        s.light.shadow.camera.updateProjectionMatrix();
        s.light.shadow.bias = s.bias;
        s.light.shadow.normalBias = s.normalBias;
        s.light.shadow.needsUpdate = true;
      } catch (e) { /* 무해 */ }
    });
    if (st.shadowMap) {
      try { t.renderer.shadowMap.enabled = st.shadowMap.enabled; t.renderer.shadowMap.needsUpdate = st.shadowMap.needsUpdate; } catch (e) { /* 무해 */ }
      st.shadowMap = null;
    }
  },

  /**
   * 한 장을 픽셀까지 **동기로** 찍는다. 렌더타깃·카메라는 여기서 만들고 여기서 놓는다.
   * 룩(pushLook/popLook)도 이 안에서 켜고 끈다 — 돌아올 때 씬·renderer 는 들어올 때 값이다.
   * clean 이면 흰 배경·작업용 표시 숨김·가전 대역·그림자로 찍고, finally 에서 전부 되돌린다 (머리 주석).
   * @param {{kind:string, moduleId?:string, longEdge?:number, clean?:boolean}} opt
   * @returns {{ok:true, kind, moduleId, width, height, camera, frame, pixels:Uint8ClampedArray, toneMapped:boolean, clean:boolean}
   *         | {ok:false, reason:string, message:string}}
   */
  capturePixels(opt) {
    opt = opt || {};
    const t = this.three();
    const T = this.T();
    if (!t || !t.renderer || !t.scene || !T) return { ok: false, reason: 'no-three', message: '3D 가 아직 준비되지 않았습니다' };
    const k = plannerCaptureParseKind(opt.kind, opt.moduleId);
    const r = t.renderer;
    const clean = !!opt.clean;
    // 2026-10-19: 번호·치수선 — front 에서 그릴 칸이 있을 때만 (머리 주석 ⑩)
    const annotate = k.kind === 'front' ? plannerCaptureAnnotatePlan(opt.annotate) : null;
    let longEdge = Number(opt.longEdge) || PLANNER_CAPTURE_LONG_EDGE;
    const cap = r.capabilities && r.capabilities.maxTextureSize;
    if (cap && longEdge > cap) longEdge = cap;

    const PD = (typeof PlannerDetail !== 'undefined' && PlannerDetail && typeof PlannerDetail.pushLook === 'function') ? PlannerDetail : null;
    const look = PD ? PD.pushLook() : null;
    const prevRT = (typeof r.getRenderTarget === 'function') ? r.getRenderTarget() : null;
    let rtA = null, rtB = null;
    const cleanSt = clean ? this._cleanState() : null;
    try {
      if (clean) this._cleanBegin(t, T, cleanSt);
      // 경계 — 룩을 켠 뒤에 잰다 (mesh 는 그대로지만 순서를 한 곳에 둔다). clean 이면 숨긴 것은 빼고 대역은 센다.
      const root = k.kind === 'module' ? plannerCaptureModuleObject(t.moduleGroup, k.moduleId) : t.moduleGroup;
      const bounds = plannerCaptureBoundsOf(root, T, clean ? { visibleOnly: true } : null);
      if (!bounds) {
        return { ok: false, reason: 'empty', message: k.kind === 'module' ? '그 모듈이 3D 에 없습니다' : '3D 에 찍을 모듈이 없습니다' };
      }
      if (clean) this._cleanShadows(t, T, bounds, cleanSt);
      const aspect = plannerCaptureAspectFor(k.kind, bounds, this.canvasAspect());
      // clean 이면 보이는 부재 꼭짓점에 맞춰 가운데 세운다 (massing·front). 아니면 예전 그대로.
      // 2026-10-19: annotate front 는 글자 자리가 남도록 덜 채운다 (머리 주석 ⑩).
      const frame = annotate
        ? plannerCaptureCleanFrame(k.kind, bounds, aspect, plannerCapturePointsOf(root, T), PLANNER_CAPTURE_ANNOTATE_FILL)
        : clean
          ? plannerCaptureCleanFrame(k.kind, bounds, aspect, plannerCapturePointsOf(root, T))
          : plannerCaptureFrame(k.kind, bounds, aspect);
      const size = plannerCaptureSizeFor(longEdge, frame.aspect);
      const width = size.width, height = size.height;

      const cam = new T.PerspectiveCamera(frame.fov, width / height, frame.near, frame.far);
      cam.position.set(frame.position[0], frame.position[1], frame.position[2]);
      cam.up.set(frame.up[0], frame.up[1], frame.up[2]);
      cam.lookAt(frame.target[0], frame.target[1], frame.target[2]);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      // 2026-10-19: 도어 테두리 막대 — 이 카메라·출력 높이 기준 두께 (작업 화면 줌과 무관)
      if (clean) this._cleanDoorEdges(t, T, cam, height, cleanSt);

      const out = this.outputPass();
      rtA = new T.WebGLRenderTarget(width, height, {
        type: out && T.HalfFloatType !== undefined ? T.HalfFloatType : T.UnsignedByteType,
        samples: 4,
        depthBuffer: true,
      });
      r.setRenderTarget(rtA);
      r.render(t.scene, cam);
      let src = rtA;
      if (out) {
        rtB = new T.WebGLRenderTarget(width, height, { type: T.UnsignedByteType, depthBuffer: false });
        out.render(r, rtB, rtA);   // renderer.toneMapping · outputColorSpace 를 그대로 입힌다
        src = rtB;
      }
      const raw = new Uint8Array(width * height * 4);
      r.readRenderTargetPixels(src, 0, 0, width, height, raw);
      const pixels = plannerCaptureFlipRows(raw, width, height, clean);
      if (!out) plannerCaptureApplySrgb(pixels);   // 폴백: 톤매핑 없이 sRGB 곡선만
      if (clean) plannerCaptureOverWhite(pixels);  // 알파 0 배경 → 흰색
      const shot = {
        ok: true,
        kind: k.kind,
        moduleId: k.moduleId,
        width,
        height,
        frame,
        camera: plannerCaptureCameraJson(frame, longEdge, k.moduleId, clean),
        pixels,
        toneMapped: !!out,
        clean,
      };
      if (annotate) {
        // 2026-10-19: 모듈마다 경계를 재서(clean 이면 숨긴 것 빼고) 이 프레임으로 투영 → 표시 목록. 그리기는 capture 가.
        const boxes = {};
        annotate.rows.forEach((row) => row.items.forEach((it) => {
          (it.moduleIds || [it.moduleId]).forEach((id) => {   // 2026-10-19: 쌓인 단 한 통은 단마다
            if (boxes[id] !== undefined) return;
            const obj = plannerCaptureModuleObject(t.moduleGroup, id);
            const b = obj ? plannerCaptureModuleBounds(obj, T, clean) : null;
            boxes[id] = b ? plannerCaptureScreenBox(frame, width, height, b) : null;
          });
        }));
        Object.keys(boxes).forEach((id) => { if (!boxes[id]) delete boxes[id]; });
        shot.annotation = plannerCaptureAnnotationLayout(annotate, boxes, width, height);
        shot.camera.annotate = true;
      }
      return shot;
    } catch (e) {
      return { ok: false, reason: 'error', message: (e && e.message) || String(e) };
    } finally {
      try { r.setRenderTarget(prevRT); } catch (e) { /* 무해 */ }
      if (rtA) { try { rtA.dispose(); } catch (e) { /* 무해 */ } }
      if (rtB) { try { rtB.dispose(); } catch (e) { /* 무해 */ } }
      if (cleanSt) this._cleanEnd(t, cleanSt);   // 룩보다 먼저 — 들어온 순서의 거꾸로
      if (PD && look) PD.popLook(look);
    }
  },

  /** RGBA 픽셀 → PNG Blob. 시험은 _encode 로 갈아 끼운다. */
  encode(pixels, width, height) {
    if (typeof this._encode === 'function') return Promise.resolve(this._encode(pixels, width, height));
    return new Promise((resolve, reject) => {
      try {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('canvas 2D 를 만들 수 없습니다')); return; }
        ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 인코딩 실패'))), 'image/png');
      } catch (e) { reject(e); }
    });
  },

  /**
   * 한 장 — 찍고 PNG 로. { ok, kind, moduleId, width, height, camera, blob, fileName, toneMapped, clean } | { ok:false, reason, message }
   * @param {{kind:string, moduleId?:string, longEdge?:number, clean?:boolean, date?:Date}} opt
   *   clean: 이미지 모델 참고 그림용 — 흰 배경·작업용 표시 숨김·가전 대역·그림자 (2026-10-08, 계획서 §5)
   *   annotate: front 에 번호·치수선 plan (2026-10-19, 머리 주석 ⑩). 주면 결과에 annotated(그렸나)·labels({id, moduleId, x, y} 픽셀)가 붙는다
   */
  async capture(opt) {
    opt = opt || {};
    const shot = this.capturePixels(opt);
    if (!shot.ok) return shot;
    // 2026-10-19: 번호·치수선 — 못 그리면(canvas 없음 등) 번호 없는 입면 그대로 간다. annotated 로 알린다.
    let pixels = shot.pixels;
    let annotated = null;
    if (shot.annotation) {
      annotated = false;
      try {
        const drawn = await this.overlay(shot.pixels, shot.width, shot.height, shot.annotation);
        if (drawn && drawn.length === shot.pixels.length) { pixels = drawn; annotated = true; }
      } catch (e) { annotated = false; }
    }
    let blob;
    try { blob = await this.encode(pixels, shot.width, shot.height); }
    catch (e) { return { ok: false, reason: 'encode', message: (e && e.message) || String(e) }; }
    const res = {
      ok: true,
      kind: shot.kind,
      moduleId: shot.moduleId,
      width: shot.width,
      height: shot.height,
      camera: shot.camera,
      toneMapped: shot.toneMapped,
      clean: shot.clean,
      blob,
      fileName: plannerCaptureFileName(shot.kind, shot.moduleId, opt.date),
    };
    if (annotated !== null) {
      res.annotated = annotated;
      res.labels = shot.annotation.items.map((x) => ({ id: x.id, moduleId: x.moduleId, x: Math.round(x.cx), y: Math.round(x.cy) }));
    }
    return res;
  },

  /** 시험이 갈아 끼운다 — (pixels, width, height, list) → 그린 RGBA. 기본은 canvas 2D. */
  _overlay: null,

  /**
   * 2026-10-19: 렌더 픽셀 위에 번호·치수선을 그린 새 RGBA. canvas 2D 가 없으면 null.
   * @returns {Uint8ClampedArray|null}
   */
  overlay(pixels, width, height, list) {
    if (typeof this._overlay === 'function') return this._overlay(pixels, width, height, list);
    if (typeof document === 'undefined' || typeof ImageData === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext && c.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    plannerCaptureDrawAnnotation(ctx, list);
    return ctx.getImageData(0, 0, width, height).data;
  },

  /**
   * 정면·3/4·평면 (+ 모듈들). 한 장씩 차례로 — 픽셀 버퍼를 겹쳐 들지 않는다.
   * @param {{longEdge?:number, modules?:string[], kinds?:string[], onProgress?:(i,n,kind)=>void}} [opt]
   * @returns {Promise<{shots:object[], failed:object[]}>}
   */
  async captureAll(opt) {
    opt = opt || {};
    const date = opt.date || new Date();
    const jobs = (opt.kinds || PLANNER_CAPTURE_KINDS).map((kind) => ({ kind }));
    (opt.modules || []).forEach((id) => jobs.push({ kind: 'module', moduleId: id }));
    const shots = [], failed = [];
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      if (typeof opt.onProgress === 'function') { try { opt.onProgress(i, jobs.length, j.kind); } catch (e) { /* 무해 */ } }
      const s = await this.capture({ kind: j.kind, moduleId: j.moduleId, longEdge: opt.longEdge, date });
      if (s.ok) shots.push(s);
      else failed.push(Object.assign({ kind: j.kind, moduleId: j.moduleId }, s));
    }
    return { shots, failed };
  },

  // ── 저장 흐름 (📷 렌더 저장) ────────────────────────────

  /** <a download> — 앱 페이지라 된다 (아티팩트 샌드박스가 아니다). 시험은 이 메서드를 스파이한다. */
  download(blob, name) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'render.png';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* 무해 */ } }, 10000);
      return true;
    } catch (e) { return false; }
  },

  /** 계정에 못 올리는 이유를 사람 말로. 이유마다 할 일이 다르다. */
  excuse(reason) {
    if (reason === 'no-scope') return '설계를 아직 저장하지 않아 이 브라우저에 내려받았습니다 — 설계를 저장한 뒤 다시 누르면 계정에 올라갑니다';
    if (reason === 'no-item') return "품목이 아직 없어 이 브라우저에 내려받았습니다 — 좌측 '품목' 아이콘으로 품목을 먼저 추가하세요";
    if (reason === 'no-session') return '로그인하지 않아 이 브라우저에 내려받았습니다 — 로그인하면 계정에 저장됩니다';
    if (reason === 'no-sdk') return '이 화면에서는 계정 저장을 쓸 수 없어 이 브라우저에 내려받았습니다';
    if (reason === 'no-bucket') return 'Storage 버킷 renders 가 없습니다 — Supabase 에서 비공개 버킷 renders 를 만들고 database/design-renders.sql 을 실행하세요';
    if (reason === 'empty') return '3D 에 찍을 모듈이 없습니다';
    if (reason === 'no-three') return '3D 가 아직 준비되지 않았습니다';
    if (reason === 'busy') return '렌더가 진행 중입니다';
    return '';
  },

  /**
   * 찍고 올린다. 스코프가 없으면(설계 미저장·로그인 전) 내려받는다.
   * @param {{longEdge?:number, modules?:string[], kinds?:string[]}} [opt]
   * @returns {Promise<{ok:boolean, mode:'upload'|'download'|null, saved:number, total:number, failed:object[], reason?:string}>}
   */
  async saveAll(opt) {
    opt = opt || {};
    if (this.busy) return { ok: false, reason: 'busy', mode: null, saved: 0, total: 0, failed: [] };
    this.busy = true;
    const date = new Date();
    const longEdge = Number(opt.longEdge) || PLANNER_CAPTURE_LONG_EDGE;
    this._setBusy(true, '📷 렌더 중…');
    try {
      const ready = (typeof PlannerStore !== 'undefined' && PlannerStore)
        ? await PlannerStore.ready(this.ids())
        : { ok: false, reason: 'no-sdk' };
      const res = await this.captureAll({
        longEdge, date, kinds: opt.kinds, modules: opt.modules,
        onProgress: (i, n, kind) => this._setBusy(true, `📷 ${PLANNER_CAPTURE_KIND_LABEL[plannerCaptureParseKind(kind).kind] || kind} ${i + 1}/${n}`),
      });
      const total = res.shots.length + res.failed.length;
      if (!res.shots.length) {
        const why = res.failed[0] || {};
        this.toast('⚠ 렌더 실패: ' + (why.message || this.excuse(why.reason) || why.reason || '알 수 없음'));
        return { ok: false, reason: why.reason || 'error', mode: null, saved: 0, total, failed: res.failed };
      }
      if (!ready.ok) {
        // 올릴 곳이 없다 — 이 브라우저에 내려받는다
        let n = 0;
        res.shots.forEach((s) => { if (this.download(s.blob, s.fileName)) n++; });
        this.toast(`📷 렌더 ${n}장 — ${this.excuse(ready.reason) || ready.reason}`);
        return { ok: n > 0, reason: ready.reason, mode: 'download', saved: n, total, failed: res.failed };
      }
      const detailHash = plannerCaptureDetailHash(this.detailModel());
      let saved = 0;
      const failed = res.failed.slice();
      for (let i = 0; i < res.shots.length; i++) {
        const s = res.shots[i];
        this._setBusy(true, `☁ 올리는 중 ${i + 1}/${res.shots.length}`);
        const path = plannerCapturePath(ready.ids, s.kind, s.moduleId, date);
        const r = await PlannerStore.saveRender({
          ids: ready.ids, blob: s.blob, path, kind: s.kind, moduleId: s.moduleId,
          width: s.width, height: s.height, camera: s.camera, detailHash,
        });
        if (r.ok) { saved++; continue; }
        failed.push(Object.assign({ kind: s.kind, moduleId: s.moduleId }, r));
        if (r.reason === 'no-bucket') break;   // 나머지도 같은 이유로 실패한다
      }
      const bucketMissing = failed.some((f) => f.reason === 'no-bucket');
      if (bucketMissing) {
        // 계정에 못 올렸으니 최소한 내려받게 한다
        res.shots.forEach((s) => this.download(s.blob, s.fileName));
        this.toast('⚠ ' + this.excuse('no-bucket') + ' (렌더는 이 브라우저에 내려받았습니다)');
      } else if (failed.length) {
        this.toast(`📷 렌더 ${saved}/${total}장 저장 — 실패: ${failed.map((f) => f.message || f.reason).join(', ')}`);
      } else {
        this.toast(`📷 렌더 ${saved}장을 계정에 저장했습니다 (${longEdge}px${res.shots.some((s) => !s.toneMapped) ? ' · 톤매핑 없음' : ''})`);
      }
      if (saved && typeof this.refreshStrip === 'function') { try { this.refreshStrip(); } catch (e) { /* 무해 */ } }
      if (saved && this._o && typeof this._o.onSaved === 'function') { try { this._o.onSaved(saved); } catch (e) { /* 무해 */ } }
      return { ok: saved > 0, reason: bucketMissing ? 'no-bucket' : undefined, mode: 'upload', saved, total, failed };
    } finally {
      this.busy = false;
      this._setBusy(false);
    }
  },

  // ── 최근 렌더 띠 (우측 패널 #detailRendersBody) ────────────

  /** 디테일 모드에 들어올 때 PlannerDetail.enter 가 부른다. */
  onDetailEnter() {
    plannerCaptureInjectCss();
    return this.refreshStrip();
  },

  /**
   * 이 품목의 최근 렌더를 서명 URL 썸네일로. 스코프가 없으면 그 이유를 한 줄로.
   * @returns {Promise<{ok:boolean, rows:object[]}>}
   */
  async refreshStrip() {
    const host = (typeof document !== 'undefined') ? document.getElementById('detailRendersBody') : null;
    if (!host) return { ok: false, rows: [] };
    plannerCaptureInjectCss();
    if (typeof PlannerStore === 'undefined' || !PlannerStore) {
      host.innerHTML = '<div class="empty-msg">이 화면에서는 계정 렌더를 볼 수 없습니다</div>';
      return { ok: false, rows: [] };
    }
    const seq = (this._stripSeq = (this._stripSeq || 0) + 1);
    const r = await PlannerStore.listRenders(this.ids(), { limit: 12 });
    if (seq !== this._stripSeq) return r;   // 나중에 시작한 갱신이 이긴다
    this.renderStrip(host, r);
    return r;
  },

  renderStrip(host, r) {
    const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!r || !r.ok) {
      const why = r && r.reason;
      const text = why === 'no-scope' ? '설계를 저장하면 계정의 렌더가 여기 보입니다'
        : why === 'no-session' ? '로그인하면 계정의 렌더가 여기 보입니다'
        : why === 'no-item' ? '품목을 먼저 추가하세요'
        : why === 'no-sdk' ? '이 화면에서는 계정 렌더를 볼 수 없습니다'
        : '렌더 목록을 읽지 못했습니다' + (r && r.message ? ' — ' + r.message : '');
      host.innerHTML = `<div class="empty-msg">${esc(text)}</div>`;
      return;
    }
    const rows = r.rows || [];
    const parts = [`<div class="pc-head"><span>${rows.length ? `최근 ${rows.length}장` : '아직 없음'}</span><button type="button" class="pc-refresh" title="다시 읽기">↻</button></div>`];
    if (!rows.length) {
      parts.push('<div class="pc-hint">📷 렌더 저장을 누르면 정면·3/4·평면이 계정에 저장됩니다</div>');
    } else {
      parts.push('<div class="pc-thumbs">');
      rows.forEach((row) => {
        const when = (typeof plannerSnapshotWhen === 'function') ? plannerSnapshotWhen(row.created_at) : '';
        const label = (PLANNER_CAPTURE_KIND_LABEL[row.kind] || row.kind) + (row.kind === 'module' && row.module_id ? ' ' + row.module_id : '');
        const size = (row.width && row.height) ? `${row.width}×${row.height}` : '';
        const inner = row.url
          ? `<img src="${esc(row.url)}" alt="${esc(label)}" loading="lazy">`
          : '<span class="pc-nourl">URL 없음</span>';
        parts.push(row.url
          ? `<a class="pc-thumb" href="${esc(row.url)}" target="_blank" rel="noopener" title="${esc(label)} · ${esc(when)} · ${esc(size)}">${inner}<span class="pc-cap">${esc(label)} · ${esc(when)}</span></a>`
          : `<div class="pc-thumb" title="${esc(label)}">${inner}<span class="pc-cap">${esc(label)} · ${esc(when)}</span></div>`);
      });
      parts.push('</div>');
    }
    host.innerHTML = parts.join('');
    const btn = host.querySelector('.pc-refresh');
    if (btn) btn.onclick = () => this.refreshStrip();
  },

  _menu: null,

  /** 버튼 잠금·진행 표시. mountMenu 전이면 아무것도 안 한다. */
  _setBusy(on, text) {
    const m = this._menu;
    if (!m) return;
    if (m.btn) {
      if (on && m._label == null) m._label = m.btn.textContent;
      m.btn.disabled = !!on;
      m.btn.textContent = on ? (text || '📷 렌더 중…') : (m._label != null ? m._label : m.btn.textContent);
      if (!on) m._label = null;
    }
    if (m.menuBtn) m.menuBtn.disabled = !!on;
  },

  /**
   * 📷 렌더 저장 버튼 + 📷▾ 옵션 메뉴. CSS 는 planner-drawing-menu.js 의 .pdm-* 를 그대로 쓴다.
   * @param {{btn:Element, menuBtn?:Element, menu?:Element}} o
   */
  mountMenu(o) {
    o = o || {};
    this._menu = { btn: o.btn || null, menuBtn: o.menuBtn || null, menu: o.menu || null, _label: null };
    const m = this._menu;
    if (m.btn) m.btn.onclick = () => { this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE }); };
    if (m.menuBtn && m.menu) {
      const close = () => { m.menu.hidden = true; };
      const render = () => {
        const activeId = (this._o && typeof this._o.activeModuleId === 'function') ? this._o.activeModuleId() : null;
        const label = (id) => (this._o && typeof this._o.moduleLabel === 'function') ? this._o.moduleLabel(id) : String(id);
        const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        m.menu.innerHTML = [
          '<div class="pdm-stage"><span>렌더 저장</span></div>',
          `<button type="button" class="pdm-row" data-render="std">정면 · 3/4 · 평면 — ${PLANNER_CAPTURE_LONG_EDGE}px<span class="pdm-meta">기본. 버튼과 같다</span></button>`,
          `<button type="button" class="pdm-row" data-render="hi">정면 · 3/4 · 평면 — ${PLANNER_CAPTURE_LONG_EDGE_HI}px<span class="pdm-meta">인쇄용. 시간이 더 걸린다</span></button>`,
          `<button type="button" class="pdm-row" data-render="module"${activeId == null ? ' disabled' : ''}>이 모듈 — ${PLANNER_CAPTURE_LONG_EDGE}px<span class="pdm-meta">${activeId == null ? '좌측 목록에서 모듈을 고르세요' : esc(label(activeId))}</span></button>`,
          '<div class="pdm-sep"></div>',
          '<div class="pdm-note">디테일 룩(마감·광택·환경광)으로 찍습니다. 설계를 저장했고 로그인했으면 계정(Storage renders)에, 아니면 이 브라우저에 내려받습니다.</div>',
        ].join('');
        m.menu.querySelectorAll('[data-render]').forEach((el) => {
          el.onclick = (e) => {
            e.stopPropagation();
            close();
            const what = el.dataset.render;
            if (what === 'hi') this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE_HI });
            else if (what === 'module') { if (activeId != null) this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE, kinds: [], modules: [activeId] }); }
            else this.saveAll({ longEdge: PLANNER_CAPTURE_LONG_EDGE });
          };
        });
      };
      m.menuBtn.onclick = (e) => {
        e.stopPropagation();
        m.menu.hidden = !m.menu.hidden;
        if (!m.menu.hidden) render();
      };
      try {
        document.addEventListener('click', (e) => {
          if (m.menu.hidden) return;
          if (m.menu.contains(e.target) || m.menuBtn.contains(e.target)) return;
          close();
        });
      } catch (e) { /* DOM 없음 */ }
      m.render = render;
      m.close = close;
    }
    return m;
  },
};

if (typeof window !== 'undefined') {
  window.PlannerCapture = PlannerCapture;
  window.plannerCaptureFrame = plannerCaptureFrame;
  window.plannerCapturePath = plannerCapturePath;
  window.plannerCaptureDetailHash = plannerCaptureDetailHash;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_CAPTURE_BUCKET,
    PLANNER_CAPTURE_KINDS,
    PLANNER_CAPTURE_KIND_LABEL,
    PLANNER_CAPTURE_LONG_EDGE,
    PLANNER_CAPTURE_LONG_EDGE_HI,
    PLANNER_CAPTURE_MARGIN,
    PLANNER_CAPTURE_FOV,
    PLANNER_CAPTURE_MASSING,
    PLANNER_CAPTURE_COUNTER_TOP,
    PLANNER_CAPTURE_STANDIN_COLOR,
    plannerCaptureVfov,
    plannerCaptureCorners,
    plannerCaptureLookBasis,
    plannerCaptureFits,
    PLANNER_CAPTURE_CLEAN_FILL,
    PLANNER_CAPTURE_CLEAN_LIGHT,
    PLANNER_CAPTURE_SHADOW_OPACITY,
    plannerCaptureProjectExtent,
    plannerCaptureCleanFrame,
    plannerCaptureCleanLight,
    plannerCapturePointsOf,
    plannerCaptureShadowFrustum,
    plannerCaptureCleanTargets,
    plannerCaptureMoldingMaterial,
    plannerCaptureBorrowKind,
    plannerCaptureBorrowMaterial,
    PLANNER_CAPTURE_DOOR_GAP,
    PLANNER_CAPTURE_DOOR_EDGE_MIN_PX,
    PLANNER_CAPTURE_NEUTRAL,
    plannerCaptureDoorGap,
    plannerCaptureNeutralKind,
    plannerCaptureMmPerPixel,
    plannerCaptureDoorEdgeThickness,
    plannerCaptureDoorEdgeLayout,
    plannerCaptureStandInSpec,
    plannerCaptureSupportOf,
    plannerCaptureOverWhite,
    plannerCaptureParseKind,
    plannerCaptureStamp,
    plannerCaptureSafeId,
    plannerCaptureFileName,
    plannerCapturePath,
    plannerCaptureStableJson,
    plannerCaptureSha256,
    plannerCaptureDetailHash,
    plannerCaptureSizeFor,
    plannerCaptureAspectFor,
    plannerCaptureFrame,
    plannerCaptureCameraJson,
    PLANNER_CAPTURE_ANNOTATE_FILL,
    PLANNER_CAPTURE_ANNOTATE_STYLE,
    plannerCaptureAnnotatePlan,
    plannerCaptureProjectPoint,
    plannerCaptureScreenBox,
    plannerCaptureDimText,
    plannerCaptureUnionBox,
    plannerCaptureAnnotationLayout,
    plannerCaptureDrawAnnotation,
    PLANNER_CAPTURE_ANNOTATE_SPAN_SKIP,
    plannerCaptureModuleBounds,
    plannerCaptureBoundsOf,
    plannerCaptureModuleObject,
    plannerCaptureFlipRows,
    plannerCaptureApplySrgb,
    PlannerCapture,
  };
}
