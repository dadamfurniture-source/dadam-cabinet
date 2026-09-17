# 그림자 프러스텀 — 이 앱은 그림자를 그린 적이 없다

> 2026-09-17. 사진 합성 P2 (#679) 를 만들다 발견했고, 그 기능을 통째로 되돌리면서
> (`revert(planner): 사진 모드 제거`) 발견만 여기 남긴다.
> **이 발견은 사진 합성과 무관하다** — 평소 3D 화면에도 그대로 해당한다.
> 3D Planner 도메인 (`mockup-structure.html`).

## 증상

`mockup-structure.html` 의 3D 화면은 그림자가 켜져 있는 것처럼 보이도록 다 갖춰져 있다.

```js
// mockup-structure.html · init3D()
renderer.shadowMap.enabled = true;                 // 6177
renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // 6178
const d1 = new THREE.DirectionalLight(0xffffff, 1.8);
d1.position.set(5000, 8000, 5000); d1.castShadow = true;   // 6189
d1.shadow.mapSize.set(1024, 1024);                         // 6190
...
ground.receiveShadow = true;                       // 6204
mesh.castShadow = true; mesh.receiveShadow = true; // 6457·6458 (부재마다)
```

그런데 **화면에 그림자는 한 번도 나온 적이 없다.** 켜져 있으니 나오겠거니 하고
아무도 확인하지 않았을 뿐이다. 그림자 지도를 그리는 비용(1024×1024 깊이 패스)만
매 프레임 나가고 결과는 비어 있다.

## 왜 — 기본 프러스텀이 mm 단위 씬에 맞지 않는다

`DirectionalLight` 의 그림자 카메라는 직교(orthographic) 카메라이고, three 가 주는
기본값은 이렇다.

```js
// node_modules/three/src/lights/DirectionalLightShadow.js:16  (three r0.183.2)
super( new OrthographicCamera( - 5, 5, 5, - 5, 0.5, 500 ) );
```

즉 **좌우·상하 ±5, 근평면 0.5, 원평면 500** 의 상자다. 단위는 씬의 단위를 그대로
따른다 — three 는 「미터」를 모른다.

이 씬의 단위는 **밀리미터**다.

- 그리드 6000mm, 바닥판 8000mm, 화면 카메라 `near 10 / far 50000`
- 가구 한 모듈이 폭 600~1200mm, 높이 720~2400mm
- 조명 `d1` 은 (5000, 8000, 5000) 에 있고 타깃은 기본값 (0,0,0) — 원점까지 약 **10,677mm**

그러니 기본 프러스텀은

1. **너비·높이 10mm × 10mm** — 가구 한 장의 두께(18mm)보다도 작다.
2. **원평면 500mm** — 조명에서 10,677mm 떨어진 가구는 깊이 범위 안에 아예 들어오지 못한다.

상자 안에 아무것도 없으니 깊이 지도는 전부 「멀리」로 채워지고, 그림자는 한 픽셀도
칠해지지 않는다. `shadow.camera` 를 손대는 곳은 이 페이지 어디에도 없다.

> 같은 실수가 `planner-vite/src/App.tsx:1316` (`<directionalLight ... castShadow />`) 에도 있다.
> 구조 페이지의 조명 블록은 주석이 말하듯 그 파일에서 베껴 왔다. (planner-vite 는 정지된
> 레거시라 고칠 대상은 아니다.)

## 고치려면 — 그림자 카메라를 씬 경계에 맞춘다

단위를 바꾸는 것이 아니라, 프러스텀을 씬에 맞춰 넓히면 된다.

```js
// 예시 — 실제 경계는 plannerCaptureBoundsOf 처럼 moduleGroup 을 순회해 얻는다
const S = 4000;                       // 가구를 넉넉히 덮는 반지름 (mm)
d1.shadow.camera.left   = -S;
d1.shadow.camera.right  =  S;
d1.shadow.camera.top    =  S;
d1.shadow.camera.bottom = -S;
d1.shadow.camera.near   =  100;       // 조명~가구 최단 거리보다 짧게
d1.shadow.camera.far    =  20000;     // 조명~가구 최장 거리보다 길게 (원점까지 10,677mm)
d1.shadow.camera.updateProjectionMatrix();
d1.shadow.needsUpdate = true;
```

주의할 점 세 가지.

- **넓힐수록 흐려진다.** 1024×1024 지도를 8000mm 폭에 펼치면 한 텍셀이 약 7.8mm 다.
  경계를 가구에 꼭 맞게 재서 좁히는 것이 화질에 제일 크게 듣는다 (설계가 바뀌면 다시 재야 한다).
- **`PCFSoftShadowMap` 은 r0.183 에서 폐기됐다.** 첫 프레임에 경고 한 줄을 찍고 스스로
  `PCFShadowMap` 으로 바꿔 쓴다 — `node_modules/three/src/renderers/webgl/WebGLShadowMap.js:99-103`.
  지금 `mockup-structure.html:6178` 가 넣는 값이 바로 그것이라, 그림자를 살리면 콘솔에
  경고가 뜨기 시작한다. 처음부터 `PCFShadowMap` 을 적는 편이 낫다.
- **`shadow.radius` 는 PCF 와 VSM 만 읽는다.** 셰이더의 `shadowRadius`
  (`shaders/ShaderChunk/shadowmap_pars_fragment.glsl.js`) 와 VSM 흐리기 패스
  (`WebGLShadowMap.js:402·411`) 뿐이다. `BasicShadowMap` 에서는 값을 바꿔도 아무 일도 없다.
  기본값은 1 (`src/lights/LightShadow.js:87`).

## [확인 필요] 평소 3D 화면에 그림자를 켤 것인가

**이 PR 은 평소 화면을 건드리지 않았다.** 지금도 그림자는 나오지 않는다 — 발견 전과
똑같다. 켜는 것은 화면이 눈에 띄게 달라지는 변화라 사장님 결정 사항이다.

판단 재료:

- **켠다면** — 가구가 바닥에 붙어 보여 입체감이 는다. 대신 그림자 지도 패스가 실제로
  일을 하기 시작하므로 프레임 비용이 는다(지금은 빈 패스라 싸다). 설계를 바꿀 때마다
  경계를 다시 재고 `needsUpdate` 를 세워야 한다. 렌더 저장(`planner-capture.js`)의
  결과물 그림도 함께 달라진다.
- **끈다면** — `renderer.shadowMap.enabled` 와 부재마다의 `castShadow`/`receiveShadow` 를
  떼는 것이 정직하다. 지금은 「켜 놓았지만 아무 일도 안 하는」 상태라 다음 사람이
  또 속는다.

어느 쪽이든 **아무것도 안 하는 지금 상태를 그대로 두는 것만은 피하는 게 좋다.**
