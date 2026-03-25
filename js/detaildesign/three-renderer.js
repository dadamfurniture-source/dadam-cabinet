      // ============================================================
      // Three.js 3D Renderer for Dadam Cabinet Design
      // Front View 디자인 통일 + 2D 직교 카메라 + OrbitControls
      // ============================================================

      const ThreeRenderer = (() => {
        let scene, camera, renderer, controls;
        let container = null;
        let animFrameId = null;
        let moduleMeshes = []; // {mesh, moduleIndex}
        let _meshCache = []; // raycaster용 메시 배열 캐시
        let hoveredMesh = null;
        let isInitialized = false;
        let labelSprites = [];
        let _needsRender = true; // dirty flag — 변경 시에만 렌더
        let _hoverRafId = 0; // hover rAF throttle
        let _isDragging = false; // 마우스 버튼 눌린 상태 (OrbitControls 드래그 포함)
        let _cachedRect = null; // getBoundingClientRect 캐시
        let _rectCacheTime = 0;

        // ─── Front View 색상 통일 ───
        const COLORS = {
          upperBg:    0xeff6ff,  // #eff6ff 상부장 배경
          upperStroke: 0x93c5fd, // #93c5fd 상부장 외곽선
          hood:       0xfef3c7, // #fef3c7 후드
          hoodStroke: 0xf59e0b, // #f59e0b 후드 외곽선
          lowerBg:    0xf8fafc, // #f8fafc 하부장 배경
          lowerStroke: 0x94a3b8, // #94a3b8 하부장 외곽선
          sink:       0xdbeafe, // #dbeafe 싱크
          sinkStroke: 0x3b82f6, // #3b82f6
          cook:       0xfee2e2, // #fee2e2 쿡탑
          cookStroke: 0xef4444, // #ef4444
          tall:       0xdcfce7, // #dcfce7 키큰장
          tallStroke: 0x10b981, // #10b981
          drawer:     0xfef3c7, // #fef3c7 서랍
          drawerStroke: 0xf59e0b,
          countertop: 0xd4a574, // #d4a574 상판
          ctStroke:   0xb8956a, // #b8956a
          kickboard:  0x666666, // 걸레받이
          finish:     0xd1d5db, // #d1d5db 마감재
          finishStroke: 0x9ca3af,
          molding:    0xe5e7eb, // #e5e7eb 상몰딩
          moldStroke: 0x9ca3af,
          sinkBowl:   0xbfdbfe,
          burner:     0x333333,
          door:       0xf5f5f5,
        };

        const SELECTED_EMISSIVE = 0xb8956c;

        // 듀얼 카메라 상태
        let orthoCamera, perspCamera;
        let isOrtho = true;
        let orthoFront = { x: 0, y: 0, z: 3000 }; // 정면 기본 위치
        let lastRotateAngle = 0;
        const ROTATE_THRESHOLD = 0.05; // 이 각도 이상 회전하면 Perspective 전환
        let _cameraLocked = false; // 초기화/updateScene 중 카메라 전환 방지

        // ─── 초기화: 듀얼 카메라 (Ortho ↔ Perspective 자동 전환) ───
        function init(containerEl) {
          if (isInitialized) return;
          container = containerEl;
          const w = container.clientWidth;
          const h = container.clientHeight || 450;

          scene = new THREE.Scene();
          scene.background = new THREE.Color(0xffffff);

          const aspect = w / h;
          const frustumSize = 3000;

          // Orthographic 카메라 (2D 기본)
          orthoCamera = new THREE.OrthographicCamera(
            -frustumSize * aspect / 2, frustumSize * aspect / 2,
            frustumSize / 2, -frustumSize / 2,
            0.1, 20000
          );
          orthoCamera.position.set(1500, 1200, 3000);
          orthoCamera.lookAt(1500, 600, 0);

          // Perspective 카메라 (회전 시)
          perspCamera = new THREE.PerspectiveCamera(30, aspect, 1, 20000);
          perspCamera.position.set(1500, 1200, 3000);
          perspCamera.lookAt(1500, 600, 0);

          camera = orthoCamera; // 기본 = Ortho

          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
          renderer.setSize(w, h);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          renderer.shadowMap.enabled = false;
          container.appendChild(renderer.domElement);

          // OrbitControls
          controls = new THREE.OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.dampingFactor = 0.1;
          controls.enableRotate = true;
          controls.minZoom = 0.15;
          controls.maxZoom = 4.0;
          controls.minDistance = 300;
          controls.maxDistance = 12000;
          controls.target.set(1500, 600, 0);
          controls.update();

          // 회전 감지 → 카메라 자동 전환 (카메라→타겟 방향 기준, XZ 평면 각도만 사용)
          controls.addEventListener('change', () => {
            _needsRender = true; // dirty flag 설정
            if (_cameraLocked || _utilDrag) return; // 초기화/드래그 중에는 전환 안 함
            // 카메라→타겟 방향에서 XZ 평면 각도만 측정 (Y축 높이 차이 무시)
            const dx = controls.target.x - camera.position.x;
            const dz = controls.target.z - camera.position.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len < 0.001) return;
            // 정면 = (0, 0, -1) → 카메라가 +Z에서 바라봄 → dz < 0이면 정면
            const cosAngle = -dz / len; // 정면일 때 1.0
            const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

            if (isOrtho && angle > ROTATE_THRESHOLD) {
              switchToPerspective();
            } else if (!isOrtho && angle < ROTATE_THRESHOLD * 0.5) {
              switchToOrtho();
            }
          });

          // 조명 — 2D 기본 + 회전 시 약간의 입체감
          const ambient = new THREE.AmbientLight(0xffffff, 0.85);
          scene.add(ambient);
          const dirLight = new THREE.DirectionalLight(0xffffff, 0.25);
          dirLight.position.set(2000, 3000, 2000);
          scene.add(dirLight);
          const hemiLight = new THREE.HemisphereLight(0xffffff, 0xf5f5f5, 0.15);
          scene.add(hemiLight);

          // 이벤트 — pointermove 1개로 통합 (이벤트 디스패치 절감)
          renderer.domElement.addEventListener('click', onMouseClick);
          renderer.domElement.addEventListener('dblclick', onMouseDblClick);
          renderer.domElement.addEventListener('pointermove', onPointerMoveUnified);
          renderer.domElement.addEventListener('pointerdown', (e) => { _isDragging = true; _cachedRect = null; onUtilityDragStart(e); });
          renderer.domElement.addEventListener('pointerup', (e) => { _isDragging = false; onUtilityDragEnd(e); });

          // ── 뷰 프리셋 버튼 (3D 캔버스 내부 오버레이) ──
          const btnBar = document.createElement('div');
          btnBar.style.cssText = 'position:absolute;top:8px;left:8px;display:flex;gap:4px;z-index:10;';
          const presets = [
            { label: '📐 Front', pos: [0, 0, 1], up: [0, 1, 0] },
            { label: '⬇ Top', pos: [0, 1, 0.01], up: [0, 0, -1] },
            { label: '🧊 Iso', pos: [0.5, 0.5, 0.7], up: [0, 1, 0] },
            { label: '🔄 Free', pos: null },
          ];
          presets.forEach(p => {
            const btn = document.createElement('button');
            btn.textContent = p.label;
            btn.style.cssText = 'padding:4px 8px;font-size:10px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;opacity:0.85;';
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              if (!p.pos) return; // Free = 현재 유지
              setCameraPreset(p.pos, p.up);
            });
            btnBar.appendChild(btn);
          });
          container.style.position = 'relative';
          container.appendChild(btnBar);
          _btnBar = btnBar; // 참조 저장 (DOM 교체 시 이식용)

          // 리사이즈 — 듀얼 카메라 모두 업데이트
          const ro = new ResizeObserver(() => {
            if (!container || !renderer) return;
            const nw = container.clientWidth;
            const nh = container.clientHeight || 450;
            const na = nw / nh;
            const fs = 3000;
            // Ortho
            orthoCamera.left = -fs * na / 2;
            orthoCamera.right = fs * na / 2;
            orthoCamera.top = fs / 2;
            orthoCamera.bottom = -fs / 2;
            orthoCamera.updateProjectionMatrix();
            // Persp
            perspCamera.aspect = na;
            perspCamera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          });
          ro.observe(container);

          isInitialized = true;
          animate();
        }

        function animate() {
          if (!isInitialized) return;
          animFrameId = requestAnimationFrame(animate);
          if (controls) {
            controls.update(); // damping 보간
          }
          if (_needsRender && renderer && scene && camera) {
            renderer.render(scene, camera);
            _needsRender = false;
          }
        }

        // ─── 카메라 전환: Ortho ↔ Perspective ───
        function switchToPerspective() {
          if (!isOrtho) return;
          // Ortho 위치/타겟을 Perspective로 복사
          perspCamera.position.copy(orthoCamera.position);
          perspCamera.quaternion.copy(orthoCamera.quaternion);
          // ★ 종횡비 업데이트 (찌그러짐 방지)
          if (container) {
            perspCamera.aspect = container.clientWidth / (container.clientHeight || 450);
          }
          // ★ Ortho frustum과 동일한 영역이 보이도록 거리 보정
          const orthoHeight = orthoCamera.top - orthoCamera.bottom; // Ortho에서 보이는 세로 크기
          const fovRad = THREE.MathUtils.degToRad(perspCamera.fov);
          const targetDist = (orthoHeight / 2) / Math.tan(fovRad / 2);
          // 카메라→타겟 방향 유지하면서 거리만 조정
          const dir = new THREE.Vector3().subVectors(perspCamera.position, controls.target).normalize();
          perspCamera.position.copy(controls.target).addScaledVector(dir, targetDist);
          perspCamera.updateProjectionMatrix();
          camera = perspCamera;
          controls.object = perspCamera;
          controls.update();
          isOrtho = false;
        }

        function switchToOrtho() {
          if (isOrtho) return;
          // Perspective 위치를 Ortho로 복사
          orthoCamera.position.copy(perspCamera.position);
          orthoCamera.quaternion.copy(perspCamera.quaternion);
          // ★ Perspective에서 보이던 영역에 맞춰 Ortho frustum 계산
          if (container) {
            const aspect = container.clientWidth / (container.clientHeight || 450);
            const dist = perspCamera.position.distanceTo(controls.target);
            const fovRad = THREE.MathUtils.degToRad(perspCamera.fov);
            const visibleH = 2 * dist * Math.tan(fovRad / 2);
            orthoCamera.left = -visibleH * aspect / 2;
            orthoCamera.right = visibleH * aspect / 2;
            orthoCamera.top = visibleH / 2;
            orthoCamera.bottom = -visibleH / 2;
            orthoCamera.updateProjectionMatrix();
          }
          camera = orthoCamera;
          controls.object = orthoCamera;
          controls.update();
          isOrtho = true;
        }

        // ─── 카메라 프리셋 (Front/Top/Iso) ───
        let _lastW = 3000, _lastH = 2400, _lastD = 650;
        function setCameraPreset(dir, up) {
          const cx = _lastW / 2, cy = _lastH / 2 - 200;
          const dist = Math.max(_lastW, _lastH) * 1.2;
          const target = new THREE.Vector3(cx, cy, 0);
          const pos = new THREE.Vector3(
            cx + dir[0] * dist,
            cy + dir[1] * dist,
            dir[2] * dist
          );
          // 부드러운 전환
          const startPos = camera.position.clone();
          const startTarget = controls.target.clone();
          let t = 0;
          function tweenStep() {
            t += 0.08;
            if (t >= 1) t = 1;
            const ease = t * (2 - t); // easeOut
            camera.position.lerpVectors(startPos, pos, ease);
            controls.target.lerpVectors(startTarget, target, ease);
            if (up) camera.up.set(up[0], up[1], up[2]);
            controls.update();
            _needsRender = true;
            if (t < 1) requestAnimationFrame(tweenStep);
          }
          tweenStep();
        }

        // ─── 플랫 박스 생성 (MeshBasicMaterial — 그림자/조명 없음, 2D 느낌) ───
        const _edgeCache = new Map(); // EdgesGeometry 캐시 (동일 크기 재사용)
        function addBox(x, y, z, w, h, d, fillColor, strokeColor, moduleIndex, name) {
          const geo = new THREE.BoxGeometry(w, h, d);
          const mat = new THREE.MeshBasicMaterial({
            color: fillColor,
            transparent: true,
            opacity: 1.0,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
          mesh.userData = { moduleIndex, name, type: 'module', w, h, d };

          // 외곽선 — 1개만 (중복 제거, draw call 절감)
          const eKey = w + '_' + h + '_' + d;
          let edges = _edgeCache.get(eKey);
          if (!edges) { edges = new THREE.EdgesGeometry(geo); _edgeCache.set(eKey, edges); }
          const edgeMat = new THREE.LineBasicMaterial({ color: strokeColor || 0x333333 });
          const line = new THREE.LineSegments(edges, edgeMat);
          line.raycast = () => {}; // raycaster에서 제외 (성능)
          mesh.add(line);

          scene.add(mesh);
          moduleMeshes.push({ mesh, moduleIndex: (moduleIndex !== undefined && moduleIndex !== null && moduleIndex >= 0) ? moduleIndex : null });
          return mesh;
        }

        // 라벨 스프라이트 (캔버스 256x64 — GPU 텍스처 87% 절감)
        function addLabel(text, x, y, z, fontSize, textColor) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 256; canvas.height = 64;
          ctx.clearRect(0, 0, 256, 64);
          ctx.fillStyle = textColor || '#666';
          const scaledFont = (fontSize || 16) * 2.5;
          ctx.font = `bold ${scaledFont}px Pretendard, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, 128, 32);

          const texture = new THREE.CanvasTexture(canvas);
          const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
          const sprite = new THREE.Sprite(mat);
          sprite.position.set(x, y, z);
          sprite.scale.set(600, 130, 1);
          scene.add(sprite);
          labelSprites.push(sprite);
          return sprite;
        }

        // ─── 모듈 → 3D 메시 (Front View 디자인 통일) ───
        function updateScene(item, upperModules, lowerModules, showDoors) {
          // 정리 — 자식 메시(edges 등)까지 재귀 dispose
          function disposeObject(obj) {
            if (obj.children) {
              while (obj.children.length > 0) {
                disposeObject(obj.children[0]);
                obj.remove(obj.children[0]);
              }
            }
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
              if (Array.isArray(obj.material)) obj.material.forEach(m => { m.map?.dispose(); m.dispose(); });
              else { obj.material.map?.dispose(); obj.material.dispose(); }
            }
          }
          moduleMeshes.forEach(({ mesh }) => {
            disposeObject(mesh);
            scene.remove(mesh);
          });
          moduleMeshes = [];
          _edgeCache.clear(); // EdgesGeometry 캐시 클리어
          labelSprites.forEach(s => { disposeObject(s); scene.remove(s); });
          labelSprites = [];

          const W = _lastW = parseFloat(item.w) || 3000;
          const H = _lastH = parseFloat(item.h) || 2400;
          const D = _lastD = parseFloat(item.d) || 650;
          const legH = parseFloat(item.specs?.sinkLegHeight) || 120;
          const lowerH = parseFloat(item.specs?.lowerH) || 870;
          const upperH = parseFloat(item.specs?.upperH) || 720;
          const topT = parseFloat(item.specs?.topThickness) || 12;
          const moldingH = parseFloat(item.specs?.moldingH) || 60;
          const upperD = 295;
          const lowerD = D - 100;
          const finishL = item.specs?.finishLeftType !== 'None' ? (parseFloat(item.specs?.finishLeftWidth) || 0) : 0;
          const finishR = item.specs?.finishRightType !== 'None' ? (parseFloat(item.specs?.finishRightWidth) || 0) : 0;
          const midY = legH + lowerH;
          const upperY = H - moldingH - upperH;
          const gap = 2;

          // ═══ 킥보드 ═══
          addBox(finishL, 0, 50, W - finishL - finishR, legH, lowerD - 50, COLORS.kickboard, 0x444444, null, '킥보드');

          // ═══ 마감재 (좌우 상부는 상몰딩 아래까지만 — 상몰딩이 위에 덮음) ═══
          if (finishL > 0) {
            addBox(0, 0, 0, finishL, legH + lowerH, D, COLORS.finish, COLORS.finishStroke, null, '좌마감');
            addBox(0, upperY, 0, finishL, upperH, upperD, COLORS.finish, COLORS.finishStroke, null, '좌마감상');
          }
          if (finishR > 0) {
            addBox(W - finishR, 0, 0, finishR, legH + lowerH, D, COLORS.finish, COLORS.finishStroke, null, '우마감');
            addBox(W - finishR, upperY, 0, finishR, upperH, upperD, COLORS.finish, COLORS.finishStroke, null, '우마감상');
          }

          // ═══ 하부장 모듈 (상판 앞면보다 10mm 뒤로, 모듈 간 밀착) ═══
          const inset = 10;  // 상판 앞면 기준 뒤로 10mm
          let lx = finishL;
          for (let li = 0; li < lowerModules.length; li++) {
            const mod = lowerModules[li];
            const mw = parseFloat(mod.w) || 600;

            // ★ spacer(빈 공간) — 점선 박스 + 라벨만 표시
            if (mod.isSpacer || mod.type === 'spacer') {
              const modIdx = item.modules.indexOf(mod);
              const spacerGeo = new THREE.BoxGeometry(mw, lowerH, lowerD - inset * 2);
              const spacerMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.3 });
              const spacerMesh = new THREE.Mesh(spacerGeo, spacerMat);
              spacerMesh.position.set(lx + mw / 2, legH + lowerH / 2, inset + (lowerD - inset * 2) / 2);
              const edges = new THREE.EdgesGeometry(spacerGeo);
              const edgeLine = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xaaaaaa }));
              edgeLine.raycast = () => {};
              spacerMesh.add(edgeLine);
              spacerMesh.userData = { moduleIndex: modIdx, isSpacer: true };
              scene.add(spacerMesh);
              moduleMeshes.push({ mesh: spacerMesh, moduleIndex: modIdx });
              addLabel(`＋ ${mw}`, lx + mw / 2, legH + lowerH / 2, lowerD + 80, 15, '#999');
              lx += mw;
              continue;
            }

            const isSink = mod.type === 'sink' || mod.hasSink;
            const isCook = mod.type === 'cook' || mod.hasCooktop;
            const isTall = mod.type === 'tall';
            const isDrawer = mod.isDrawer;

            let fill, stroke;
            if (isSink)      { fill = COLORS.sink;    stroke = COLORS.sinkStroke; }
            else if (isCook)  { fill = COLORS.cook;    stroke = COLORS.cookStroke; }
            else if (isTall)  { fill = COLORS.tall;    stroke = COLORS.tallStroke; }
            else if (isDrawer){ fill = COLORS.drawer;  stroke = COLORS.drawerStroke; }
            else              { fill = COLORS.lowerBg; stroke = COLORS.lowerStroke; }

            const modIdx = item.modules.indexOf(mod);
            const mh = isTall ? (upperY + upperH - legH) : lowerH;
            addBox(lx, legH, inset, mw, mh, lowerD - inset * 2, fill, stroke, modIdx, mod.type);

            // 라벨
            const icons = { sink: '🚰', cook: '🔥', tall: '↕', drawer: '🗄', storage: '📦' };
            const icon = icons[mod.type] || (isDrawer ? '🗄' : '📦');
            const labelZ = lowerD + 80;
            addLabel(`${icon} ${mw}`, lx + mw / 2, legH + (isTall ? mh : lowerH) / 2, labelZ, 15, isSink ? '#1d4ed8' : isCook ? '#dc2626' : '#555');

            // 싱크볼
            if (isSink) {
              const bw = mw * 0.6, bd = lowerD * 0.45;
              addBox(lx + (mw - bw) / 2, midY - 60, (lowerD - bd) / 2, bw, 60, bd, COLORS.sinkBowl, 0x60a5fa, null, '싱크볼');
            }
            // 쿡탑
            if (isCook) {
              const rw = mw * 0.7, rd = lowerD * 0.45;
              addBox(lx + (mw - rw) / 2, midY + 2, (lowerD - rd) / 2, rw, 5, rd, COLORS.burner, 0x444444, null, '쿡탑');
            }

            lx += mw;
          }

          // ═══ 상판 ═══
          addBox(0, midY, 0, W, topT + 3, D, COLORS.countertop, COLORS.ctStroke, null, '상판');
          addLabel(`상판 ${topT}mm`, W / 2, midY + topT / 2, D + 60, 12, '#8b6914');

          // ═══ 상부장 모듈 (틈새 없이 밀착) ═══
          let ux = finishL;
          for (const mod of upperModules) {
            const mw = parseFloat(mod.w) || 600;

            // ★ spacer(빈 공간) — 점선 박스
            if (mod.isSpacer || mod.type === 'spacer') {
              const modIdx = item.modules.indexOf(mod);
              const spacerGeo = new THREE.BoxGeometry(mw, upperH, upperD);
              const spacerMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.3 });
              const spacerMesh = new THREE.Mesh(spacerGeo, spacerMat);
              spacerMesh.position.set(ux + mw / 2, upperY + upperH / 2, upperD / 2);
              const edges = new THREE.EdgesGeometry(spacerGeo);
              const edgeLine2 = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xaaaaaa }));
              edgeLine2.raycast = () => {};
              spacerMesh.add(edgeLine2);
              spacerMesh.userData = { moduleIndex: modIdx, isSpacer: true };
              scene.add(spacerMesh);
              moduleMeshes.push({ mesh: spacerMesh, moduleIndex: modIdx });
              addLabel(`＋ ${mw}`, ux + mw / 2, upperY + upperH / 2, upperD + 80, 15, '#999');
              ux += mw;
              continue;
            }

            const isHood = mod.type === 'hood';
            const fill = isHood ? COLORS.hood : COLORS.upperBg;
            const stroke = isHood ? COLORS.hoodStroke : COLORS.upperStroke;

            const modIdx = item.modules.indexOf(mod);
            addBox(ux, upperY, 0, mw, upperH, upperD, fill, stroke, modIdx, mod.type);

            const icon = isHood ? '🌀' : '📦';
            addLabel(`${icon} ${mw}`, ux + mw / 2, upperY + upperH / 2, upperD + 80, 15, isHood ? '#b45309' : '#1d4ed8');
            ux += mw;
          }

          // ═══ 상몰딩 ═══
          addBox(0, upperY + upperH, 0, W, moldingH, upperD, COLORS.molding, COLORS.moldStroke, null, '상몰딩');

          // ═══ 도어 오버레이 ═══
          if (showDoors) {
            const dc = getDoorColorHex(item.specs?.doorColorUpper || '화이트');
            let dx = finishL;
            for (const mod of upperModules) {
              const mw = parseFloat(mod.w) || 600;
              const cnt = mod.doorCount || Math.ceil(mw / 550);
              const dw = mw / cnt;
              for (let d = 0; d < cnt; d++) {
                addBox(dx + d * dw + 3, upperY + 3, -3, dw - 6, upperH - 6, 3, dc, 0x333333, null, '도어');
              }
              dx += mw;
            }
            let dlx = finishL;
            for (const mod of lowerModules) {
              const mw = parseFloat(mod.w) || 600;
              if (mod.isDrawer) {
                const drc = mod.drawerCount || 3;
                const dh = lowerH / drc;
                for (let dd = 0; dd < drc; dd++) {
                  addBox(dlx + 3, legH + dd * dh + 3, -3, mw - 6, dh - 6, 3, dc, 0x333333, null, '서랍');
                }
              } else {
                const cnt = mod.doorCount || Math.ceil(mw / 550);
                const dw = mw / cnt;
                for (let d = 0; d < cnt; d++) {
                  addBox(dlx + d * dw + 3, legH + 3, -3, dw - 6, lowerH - 6, 3, dc, 0x333333, null, '도어');
                }
              }
              dlx += mw;
            }
          }

          // ═══ 분배기/환풍구 벽면 마커 ═══
          const _finishLw = item.specs?.finishLeftType !== 'None' ? (parseFloat(item.specs?.finishLeftWidth) || 0) : 0;
          const _finishRw = item.specs?.finishRightType !== 'None' ? (parseFloat(item.specs?.finishRightWidth) || 0) : 0;
          const _isRefLeft = item.specs?.measurementBase === 'Left';
          const _startBound = _finishLw;
          const _endBound = W - _finishRw;

          // 분배기 범위 절대좌표 계산
          let _waterStartAbs = 0, _waterEndAbs = 0;
          {
            const dsAbs = parseFloat(item.specs?.distributorStartAbs) || 0;
            const deAbs = parseFloat(item.specs?.distributorEndAbs) || 0;
            if (dsAbs > 0 && deAbs > dsAbs) {
              _waterStartAbs = dsAbs;
              _waterEndAbs = deAbs;
            } else {
              const ds = parseFloat(item.specs?.distributorStart) || 0;
              const de = parseFloat(item.specs?.distributorEnd) || 0;
              if (ds > 0 && de > ds) {
                _waterStartAbs = Math.max(_startBound, _isRefLeft ? _startBound + ds : _endBound - de);
                _waterEndAbs = Math.min(_endBound, _isRefLeft ? _startBound + de : _endBound - ds);
              }
            }
          }
          let exhaustPos = item.specs?.exhaustPosition;
          if (!exhaustPos) {
            const vs = parseFloat(item.specs?.ventStart) || 0;
            if (vs > 0) {
              exhaustPos = Math.max(_startBound, Math.min(_endBound, _isRefLeft ? _startBound + vs : _endBound - vs));
            }
          }

          // 분배기 — 범위 표시 (시작~끝 파란색 영역 + 수직 파이프)
          if (_waterStartAbs > 0 && _waterEndAbs > _waterStartAbs) {
            const ws = Math.max(_startBound, Math.min(W, _waterStartAbs));
            const we = Math.max(_startBound, Math.min(W, _waterEndAbs));
            const rangeW = we - ws;
            const cx = (ws + we) / 2;
            // 범위 박스 (반투명 파란색) — MeshBasicMaterial (셰이더 스위칭 제거)
            const rangeGeo = new THREE.BoxGeometry(rangeW, 60, 20);
            const rangeMat = new THREE.MeshBasicMaterial({ color: 0x2196F3, transparent: true, opacity: 0.35 });
            const rangeMesh = new THREE.Mesh(rangeGeo, rangeMat);
            rangeMesh.position.set(cx, legH + 200, -15);
            rangeMesh.userData = { isDraggable: true, dragType: 'water' };
            scene.add(rangeMesh);
            moduleMeshes.push({ mesh: rangeMesh, moduleIndex: null });
            // 시작/끝 수직 파이프 (개별 드래그 가능)
            [{ px: ws, type: 'waterStart' }, { px: we, type: 'waterEnd' }].forEach(({ px, type }) => {
              const pipeGeo = new THREE.CylinderGeometry(8, 8, legH + 230, 8);
              const pipeMat = new THREE.MeshBasicMaterial({ color: 0x1E88E5 });
              const pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
              pipeMesh.position.set(px, (legH + 230) / 2, -15);
              pipeMesh.userData = { isDraggable: true, dragType: type };
              scene.add(pipeMesh);
              moduleMeshes.push({ mesh: pipeMesh, moduleIndex: null });
            });
            // 수평 연결 파이프
            const hPipeGeo = new THREE.CylinderGeometry(5, 5, rangeW, 8);
            const hPipeMat = new THREE.MeshBasicMaterial({ color: 0x64B5F6 });
            const hPipeMesh = new THREE.Mesh(hPipeGeo, hPipeMat);
            hPipeMesh.rotation.z = Math.PI / 2;
            hPipeMesh.position.set(cx, legH + 230, -15);
            hPipeMesh.userData = { isDraggable: true, dragType: 'water' };
            scene.add(hPipeMesh);
            moduleMeshes.push({ mesh: hPipeMesh, moduleIndex: null });
            addLabel('💧', cx, legH + 290, 40, 12, '#1565C0');
          }

          if (exhaustPos) {
            const ex = parseFloat(exhaustPos);
            if (ex > 0 && ex < W) {
              // 환풍구 — MeshBasicMaterial (셰이더 통일)
              const ventGeo = new THREE.BoxGeometry(120, 120, 30);
              const ventMat = new THREE.MeshBasicMaterial({ color: 0x78909C, transparent: true, opacity: 0.85 });
              const ventMesh = new THREE.Mesh(ventGeo, ventMat);
              ventMesh.position.set(ex, H - 150, -15);
              ventMesh.userData = { isDraggable: true, dragType: 'vent' };
              scene.add(ventMesh);
              moduleMeshes.push({ mesh: ventMesh, moduleIndex: null });
              // 환풍구 그릴 — 자식으로 통합 (별도 draw call 최소화)
              const slotGeo = new THREE.BoxGeometry(80, 6, 32);
              const slotMat = new THREE.MeshBasicMaterial({ color: 0x546E7A });
              for (let i = -2; i <= 2; i++) {
                const slotMesh = new THREE.Mesh(slotGeo, slotMat); // geo/mat 공유
                slotMesh.position.set(0, i * 18, 0); // 부모 기준 상대위치
                slotMesh.raycast = () => {}; // raycaster 제외
                ventMesh.add(slotMesh); // 부모의 자식으로 추가
              }
              addLabel('🌀 환풍구', ex, H - 30, 80, 12, '#37474F');
            }
          }

          // ═══ 빈 공간 + 버튼 (상부장/하부장 끝에 모듈 추가) ═══
          const usedLowerW = lowerModules.reduce((s, m) => s + (parseFloat(m.w) || 600), 0) + finishL + finishR;
          const usedUpperW = upperModules.reduce((s, m) => s + (parseFloat(m.w) || 600), 0) + finishL + finishR;
          const addBtnSize = 100;

          // 하부장 빈 공간에 + 버튼 (흰 구 + 빨간 +)
          const addBtnR = addBtnSize / 2;
          if (usedLowerW + addBtnSize < W) {
            const addGeo = new THREE.SphereGeometry(addBtnR, 24, 24);
            const addMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.9 });
            const addMesh = new THREE.Mesh(addGeo, addMat);
            const addPosX = lx + addBtnR + 20, addPosY = legH + lowerH / 2, addPosZ = lowerD / 2;
            addMesh.position.set(addPosX, addPosY, addPosZ);
            addMesh.userData = { isAddButton: true, pos: 'lower' };
            scene.add(addMesh);
            moduleMeshes.push({ mesh: addMesh, moduleIndex: -1 });
            addLabel('＋', addPosX, addPosY, addPosZ + addBtnR + 5, 22, '#E53935');
          }

          // 상부장 빈 공간에 + 버튼 (흰 구 + 빨간 +)
          if (usedUpperW + addBtnSize < W) {
            const addGeo = new THREE.SphereGeometry(addBtnR, 24, 24);
            const addMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.9 });
            const addMesh = new THREE.Mesh(addGeo, addMat);
            const addPosX = ux + addBtnR + 20, addPosY = upperY + upperH / 2, addPosZ = upperD / 2;
            addMesh.position.set(addPosX, addPosY, addPosZ);
            addMesh.userData = { isAddButton: true, pos: 'upper' };
            scene.add(addMesh);
            moduleMeshes.push({ mesh: addMesh, moduleIndex: -2 });
            addLabel('＋', addPosX, addPosY, addPosZ + addBtnR + 5, 22, '#E53935');
          }

          // ★ 카메라 위치 + frustum 크기 자동 보정 (자동계산 후 찌그러짐 방지)
          _cameraLocked = true; // 카메라 전환 방지 (updateScene 중)
          const maxDim = Math.max(W, H) * 1.3;
          if (orthoCamera) {
            const aspect = (container?.clientWidth || 800) / (container?.clientHeight || 450);
            orthoCamera.left = -maxDim * aspect / 2;
            orthoCamera.right = maxDim * aspect / 2;
            orthoCamera.top = maxDim / 2;
            orthoCamera.bottom = -maxDim / 2;
            orthoCamera.updateProjectionMatrix();
          }
          if (perspCamera) {
            perspCamera.updateProjectionMatrix();
          }
          // Ortho 카메라로 복귀 (updateScene 시 항상 정면 뷰)
          camera = orthoCamera;
          controls.object = orthoCamera;
          isOrtho = true;
          controls.target.set(W / 2, H / 2 - 200, 0);
          camera.position.set(W / 2, H / 2, maxDim * 1.2);
          controls.update();
          _cameraLocked = false;
          // 메시 배열 캐시 갱신 (raycaster용)
          _meshCache = moduleMeshes.map(m => m.mesh);
          _cachedRect = null; // rect 캐시 무효화
          _needsRender = true;
        }

        function getDoorColorHex(name) {
          const m = { '화이트': 0xf5f5f5, '그레이': 0xcccccc, '블랙': 0x333333, '오크': 0xc8a882, '월넛': 0x6b4e3d, '베이지': 0xe8dcc8 };
          return m[name] || 0xf5f5f5;
        }

        // ─── 인터랙션 ───
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        function getClickedModule(event) {
          if (!renderer) return null;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const intersects = raycaster.intersectObjects(_meshCache, true); // 캐시 사용
          if (intersects.length > 0) {
            let hit = intersects[0].object;
            // 자식(edge line 등)이 hit되면 부모에서 찾기
            let entry = moduleMeshes.find(m => m.mesh === hit);
            if (!entry && hit.parent) entry = moduleMeshes.find(m => m.mesh === hit.parent);
            return entry || null;
          }
          return null;
        }

        function onMouseClick(event) {
          if (_utilDragged) { _utilDragged = false; return; } // 드래그 후 클릭 무시
          const entry = getClickedModule(event);
          if (!entry) {
            close3DModulePopup();
            return;
          }

          // ★ 분배기/환풍구 클릭 → 배관 치수 팝업 (드래그 아닌 순수 클릭만)
          if (entry.mesh?.userData?.isDraggable) {
            const dragType = entry.mesh.userData.dragType;
            showUtilityPopup(dragType, event.clientX, event.clientY);
            return;
          }

          if (entry.moduleIndex === null) {
            close3DModulePopup();
            return;
          }

          // + 버튼 클릭 → 모듈 추가
          if (entry.moduleIndex === -1 || entry.moduleIndex === -2) {
            const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
            if (uid) {
              const item = typeof getItem === 'function' ? getItem(uid) : null;
              if (item) {
                const pos = entry.moduleIndex === -2 ? 'upper' : 'lower';
                const newMod = { pos, type: 'storage', w: 600, name: '수납장', doorCount: 1 };
                if (pos === 'lower') newMod.isDrawer = false;
                item.modules.push(newMod);
                if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
              }
            }
            return;
          }
          // ★ spacer 클릭 → 수납장으로 교체
          const uid2 = typeof currentItemId !== 'undefined' ? currentItemId : null;
          if (uid2) {
            const item2 = typeof getItem === 'function' ? getItem(uid2) : null;
            if (item2 && item2.modules[entry.moduleIndex]?.isSpacer) {
              if (typeof pushUndo === 'function') pushUndo(item2);
              const spacer = item2.modules[entry.moduleIndex];
              item2.modules[entry.moduleIndex] = {
                pos: spacer.pos, type: 'storage', name: '수납장', w: spacer.w, doorCount: 1,
              };
              if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item2);
              return;
            }
          }
          window._selectedModuleIndex = entry.moduleIndex;
          highlightModule(entry.moduleIndex);
          // ★ 치수 입력 팝업 표시
          show3DModulePopup(entry.moduleIndex, event.clientX, event.clientY);
        }

        // ★ 더블클릭 → 즉시 삭제
        function onMouseDblClick(event) {
          const entry = getClickedModule(event);
          if (!entry) return;

          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          const item = uid && typeof getItem === 'function' ? getItem(uid) : null;
          if (!item) return;

          // ★ 분배기/환풍구 더블클릭 → 값 초기화 (삭제)
          if (entry.mesh?.userData?.isDraggable) {
            close3DModulePopup();
            if (typeof pushUndo === 'function') pushUndo(item);
            const dt = entry.mesh.userData.dragType;
            if (dt === 'water' || dt === 'waterStart' || dt === 'waterEnd') {
              item.specs.distributorStart = 0;
              item.specs.distributorEnd = 0;
              delete item.specs.waterSupplyPosition;
              delete item.specs.distributorStartAbs;
              delete item.specs.distributorEndAbs;
            } else if (dt === 'vent') {
              item.specs.ventStart = 0;
              delete item.specs.exhaustPosition;
            }
            if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
            return;
          }

          // ★ 모듈 더블클릭 → 빈 공간으로 대체
          if (entry.moduleIndex !== null && entry.moduleIndex >= 0 && item.modules[entry.moduleIndex]) {
            close3DModulePopup();
            if (typeof pushUndo === 'function') pushUndo(item);
            const deletedMod = item.modules[entry.moduleIndex];
            item.modules[entry.moduleIndex] = {
              pos: deletedMod.pos,
              type: 'spacer',
              name: '빈공간',
              w: deletedMod.w,
              isSpacer: true,
            };
            if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
          }
        }

        // ★ 3D 모듈 치수 입력 팝업
        function show3DModulePopup(moduleIndex, clientX, clientY) {
          close3DModulePopup();
          // currentItemId 직접 사용 (data-uid 속성이 없는 경우 대비)
          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          if (!uid) return;
          const item = typeof getItem === 'function' ? getItem(uid) : null;
          if (!item || !item.modules[moduleIndex]) return;
          const mod = item.modules[moduleIndex];

          const popup = document.createElement('div');
          popup.id = 'three-module-popup';
          popup.style.cssText = `
            position: fixed; left: ${clientX + 10}px; top: ${clientY - 10}px;
            background: #fff; border: 2px solid #2196F3; border-radius: 10px;
            padding: 14px 16px; z-index: 9999; box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            font-size: 13px; min-width: 220px; font-family: Pretendard, sans-serif;
          `;

          const typeIcons = { sink: '🚰', cook: '🔥', tall: '↕', drawer: '🗄', hood: '🌀', storage: '📦' };
          const icon = typeIcons[mod.type] || '📦';
          const name = mod.name || mod.type || '모듈';

          popup.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <b style="font-size:14px;">${icon} ${name}</b>
              <span style="cursor:pointer;font-size:18px;color:#999;" onclick="document.getElementById('three-module-popup')?.remove()">✕</span>
            </div>
            <div style="display:grid;grid-template-columns:60px 1fr;gap:6px;align-items:center;">
              <label style="color:#666;">너비 W</label>
              <input type="number" value="${mod.w || ''}" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                onchange="window._update3DModule(${moduleIndex},'w',this.value)" />
              <label style="color:#666;">높이 H</label>
              <input type="number" value="${mod.h || ''}" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                onchange="window._update3DModule(${moduleIndex},'h',this.value)" />
              <label style="color:#666;">깊이 D</label>
              <input type="number" value="${mod.d || ''}" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                onchange="window._update3DModule(${moduleIndex},'d',this.value)" />
              <label style="color:#666;">위치 X</label>
              <input type="number" value="${mod.x || 0}" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                onchange="window._update3DModule(${moduleIndex},'x',this.value)" />
            </div>
            <div style="margin-top:10px;display:flex;gap:6px;">
              <select style="flex:1;padding:4px;border:1px solid #ddd;border-radius:6px;font-size:12px;"
                onchange="window._update3DModule(${moduleIndex},'type',this.value)">
                <option value="storage" ${mod.type==='storage'?'selected':''}>수납장</option>
                <option value="sink" ${mod.type==='sink'?'selected':''}>개수대</option>
                <option value="cook" ${mod.type==='cook'?'selected':''}>가스대</option>
                <option value="drawer" ${mod.type==='drawer'||mod.isDrawer?'selected':''}>서랍</option>
                <option value="tall" ${mod.type==='tall'?'selected':''}>키큰장</option>
                <option value="hood" ${mod.type==='hood'?'selected':''}>후드장</option>
              </select>
              ${(() => {
                const lShape = item.specs?.lowerLayoutShape || item.specs?.layoutShape || 'I';
                if (lShape === 'I') return '';
                const isCorner = mod.isCornerModule;
                return `<button style="padding:4px 8px;background:${isCorner ? '#7c3aed' : '#e5e7eb'};color:${isCorner ? '#fff' : '#666'};border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;" onclick="window._update3DModule(${moduleIndex},'isCornerModule',${!isCorner})">멍장</button>`;
              })()}
              <button style="padding:4px 12px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;"
                onclick="window._delete3DModule(${moduleIndex})">삭제</button>
            </div>
          `;

          document.body.appendChild(popup);

          // 화면 밖으로 나가지 않도록 보정
          requestAnimationFrame(() => {
            const pr = popup.getBoundingClientRect();
            if (pr.right > window.innerWidth) popup.style.left = (window.innerWidth - pr.width - 10) + 'px';
            if (pr.bottom > window.innerHeight) popup.style.top = (window.innerHeight - pr.height - 10) + 'px';
          });
        }

        function close3DModulePopup() {
          document.getElementById('three-module-popup')?.remove();
          document.getElementById('three-utility-popup')?.remove();
        }

        // ★ 분배기/환풍구 치수 입력 팝업
        function showUtilityPopup(dragType, clientX, clientY) {
          close3DModulePopup();
          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          const item = uid && typeof getItem === 'function' ? getItem(uid) : null;
          if (!item) return;

          const popup = document.createElement('div');
          popup.id = 'three-utility-popup';
          popup.style.cssText = `
            position:fixed;left:${clientX+10}px;top:${clientY-10}px;
            background:#fff;border:2px solid ${dragType==='water'?'#2196F3':'#78909C'};border-radius:10px;
            padding:14px 16px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.15);
            font-size:13px;min-width:200px;font-family:Pretendard,sans-serif;
          `;

          if (dragType === 'water' || dragType === 'waterStart' || dragType === 'waterEnd') {
            popup.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <b style="font-size:14px;color:#1565C0;">💧 분배기 위치</b>
                <span style="cursor:pointer;font-size:18px;color:#999;" onclick="document.getElementById('three-utility-popup')?.remove()">✕</span>
              </div>
              <div style="display:grid;grid-template-columns:70px 1fr;gap:6px;align-items:center;">
                <label style="color:#666;font-size:12px;">시작 (mm)</label>
                <input type="number" value="${item.specs.distributorStart||0}" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                  onchange="window._updateUtility('distributorStart',this.value)"/>
                <label style="color:#666;font-size:12px;">끝 (mm)</label>
                <input type="number" value="${item.specs.distributorEnd||0}" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                  onchange="window._updateUtility('distributorEnd',this.value)"/>
              </div>
              <div style="margin-top:8px;font-size:10px;color:#999;">기준: ${item.specs.measurementBase==='Left'?'좌':'우'}측에서 거리 (mm)</div>
            `;
          } else {
            popup.innerHTML = `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <b style="font-size:14px;color:#37474F;">🌀 환풍구 위치</b>
                <span style="cursor:pointer;font-size:18px;color:#999;" onclick="document.getElementById('three-utility-popup')?.remove()">✕</span>
              </div>
              <div style="display:grid;grid-template-columns:70px 1fr;gap:6px;align-items:center;">
                <label style="color:#666;font-size:12px;">위치 (mm)</label>
                <input type="number" value="${item.specs.ventStart||0}" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;"
                  onchange="window._updateUtility('ventStart',this.value)"/>
              </div>
              <div style="margin-top:8px;font-size:10px;color:#999;">기준: ${item.specs.measurementBase==='Left'?'좌':'우'}측에서 거리 (mm)</div>
            `;
          }

          document.body.appendChild(popup);
          requestAnimationFrame(() => {
            const pr = popup.getBoundingClientRect();
            if (pr.right > window.innerWidth) popup.style.left = (window.innerWidth - pr.width - 10) + 'px';
            if (pr.bottom > window.innerHeight) popup.style.top = (window.innerHeight - pr.height - 10) + 'px';
          });
        }

        // 전역: 배관 치수 업데이트
        window._updateUtility = function(field, value) {
          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          const item = uid && typeof getItem === 'function' ? getItem(uid) : null;
          if (!item) return;
          if (typeof pushUndo === 'function') pushUndo(item);
          item.specs[field] = parseFloat(value) || 0;
          // 절대좌표 초기화 → 렌더러에서 재계산
          delete item.specs.waterSupplyPosition;
          delete item.specs.exhaustPosition;
          delete item.specs.distributorStartAbs;
          delete item.specs.distributorEndAbs;
          document.getElementById('three-utility-popup')?.remove();
          if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
        };

        // ─── 분배기/환풍구 드래그 ───
        let _utilDrag = null;
        let _utilDragged = false; // 드래그 발생 여부 (클릭 구분용)

        function onUtilityDragStart(event) {
          if (!renderer) return;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const intersects = raycaster.intersectObjects(_meshCache, true);
          if (intersects.length === 0) return;
          let hit = intersects[0].object;
          // 자식 hit → 부모 확인
          if (!hit.userData?.isDraggable && hit.parent?.userData?.isDraggable) hit = hit.parent;
          if (!hit.userData?.isDraggable) return;

          event.stopPropagation();
          renderer.domElement.setPointerCapture(event.pointerId);

          const dragType = hit.userData.dragType;
          // waterStart/waterEnd: 개별 파이프만 이동, water/vent: 전체 이동
          const isSinglePipe = dragType === 'waterStart' || dragType === 'waterEnd';
          const relatedMeshes = isSinglePipe
            ? [hit]
            : moduleMeshes.filter(m => m.mesh.userData?.isDraggable && m.mesh.userData.dragType === dragType).map(m => m.mesh);

          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          const item = uid && typeof getItem === 'function' ? getItem(uid) : null;
          if (!item) return;

          const W = parseFloat(item.w) || 3000;
          const fL = item.specs?.finishLeftType !== 'None' ? (parseFloat(item.specs?.finishLeftWidth) || 0) : 0;
          const fR = item.specs?.finishRightType !== 'None' ? (parseFloat(item.specs?.finishRightWidth) || 0) : 0;

          // 관련 라벨 찾기 (깜빡임 방지용)
          const hitX = hit.position.x;
          const relatedLabels = scene.children.filter(c =>
            c.isSprite && Math.abs(c.position.x - hitX) < 5
          );

          _utilDrag = {
            dragType,
            startClientX: event.clientX,
            startWorldX: hit.position.x,
            meshes: relatedMeshes,
            labels: relatedLabels,
            W,
            startBound: fL,
            endBound: W - fR,
            isRefLeft: item.specs?.measurementBase === 'Left',
          };

          _utilDragged = false;
          if (controls) controls.enabled = false;
        }

        function onUtilityDragMove(event) {
          if (!_utilDrag) return;
          event.stopPropagation();

          const pxDelta = event.clientX - _utilDrag.startClientX;
          if (Math.abs(pxDelta) > 3) _utilDragged = true; // 3px 이상 이동 시 드래그로 판정

          // worldPerPx는 드래그 시작 시 한 번만 계산 (캐시)
          if (!_utilDrag._worldPerPx) {
            if (isOrtho) {
              _utilDrag._worldPerPx = (camera.right - camera.left) / renderer.domElement.clientWidth;
            } else {
              const dist = camera.position.distanceTo(controls.target);
              const fovRad = THREE.MathUtils.degToRad(camera.fov);
              const visibleH = 2 * dist * Math.tan(fovRad / 2);
              _utilDrag._worldPerPx = (visibleH * camera.aspect) / renderer.domElement.clientWidth;
            }
          }
          const worldDelta = pxDelta * _utilDrag._worldPerPx;

          let newX = _utilDrag.startWorldX + worldDelta;
          newX = Math.max(_utilDrag.startBound + 30, Math.min(_utilDrag.endBound - 30, newX));

          _utilDrag.meshes.forEach(m => { m.position.x = newX; });
          // 라벨도 같이 이동
          if (_utilDrag.labels) _utilDrag.labels.forEach(l => { l.position.x = newX; });
          renderer.domElement.style.cursor = 'ew-resize';
          _needsRender = true; // dirty flag → animate()에서 렌더
        }

        function onUtilityDragEnd(event) {
          if (!_utilDrag) return;
          event.stopPropagation();
          renderer.domElement.releasePointerCapture(event.pointerId);
          renderer.domElement.style.cursor = '';
          if (controls) controls.enabled = true;

          const finalX = _utilDrag.meshes[0].position.x;
          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          const item = uid && typeof getItem === 'function' ? getItem(uid) : null;

          if (item) {
            if (typeof pushUndo === 'function') pushUndo(item);
            const { dragType, isRefLeft, startBound, endBound } = _utilDrag;

            if (dragType === 'waterStart') {
              // 시작 파이프만 이동 → distributorStart 변경
              const relPos = isRefLeft ? finalX - startBound : endBound - finalX;
              if (isRefLeft) {
                item.specs.distributorStart = Math.max(0, Math.round(relPos));
              } else {
                item.specs.distributorEnd = Math.max(0, Math.round(relPos));
              }
            } else if (dragType === 'waterEnd') {
              // 끝 파이프만 이동 → distributorEnd 변경
              const relPos = isRefLeft ? finalX - startBound : endBound - finalX;
              if (isRefLeft) {
                item.specs.distributorEnd = Math.max(0, Math.round(relPos));
              } else {
                item.specs.distributorStart = Math.max(0, Math.round(relPos));
              }
            } else if (dragType === 'water') {
              // 범위 박스/수평파이프 드래그 → 전체 이동
              const relPos = isRefLeft ? finalX - startBound : endBound - finalX;
              const halfSpan = (parseFloat(item.specs.distributorEnd) - parseFloat(item.specs.distributorStart)) / 2 || 100;
              item.specs.distributorStart = Math.max(0, Math.round(relPos - halfSpan));
              item.specs.distributorEnd = Math.round(relPos + halfSpan);
            } else if (dragType === 'vent') {
              const relPos = isRefLeft ? finalX - startBound : endBound - finalX;
              item.specs.ventStart = Math.max(0, Math.round(relPos));
            }

            // start > end 보정
            if (parseFloat(item.specs.distributorStart) > parseFloat(item.specs.distributorEnd)) {
              const tmp = item.specs.distributorStart;
              item.specs.distributorStart = item.specs.distributorEnd;
              item.specs.distributorEnd = tmp;
            }

            // 절대좌표 초기화 → 렌더러에서 재계산
            delete item.specs.waterSupplyPosition;
            delete item.specs.exhaustPosition;
            delete item.specs.distributorStartAbs;
            delete item.specs.distributorEndAbs;

            if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
          }

          _utilDrag = null;
        }

        // 전역 함수: 모듈 업데이트 + 삭제
        window._update3DModule = function(moduleIndex, field, value) {
          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          if (!uid) return;
          const item = typeof getItem === 'function' ? getItem(uid) : null;
          if (!item || !item.modules[moduleIndex]) return;
          const mod = item.modules[moduleIndex];
          if (field === 'type') {
            mod.type = value;
            mod.isDrawer = value === 'drawer';
            mod.hasSink = value === 'sink';
            mod.hasCooktop = value === 'cook';
          } else if (field === 'isCornerModule') {
            mod.isCornerModule = !!value;
            if (mod.isCornerModule) mod.name = '멍장';
          } else {
            mod[field] = parseFloat(value) || 0;
          }
          close3DModulePopup();
          if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
        };

        window._delete3DModule = function(moduleIndex) {
          const uid = typeof currentItemId !== 'undefined' ? currentItemId : null;
          if (!uid) return;
          const item = typeof getItem === 'function' ? getItem(uid) : null;
          if (!item || !item.modules[moduleIndex]) return;
          const mod = item.modules[moduleIndex];
          if (confirm(`"${mod.name || mod.type} (${mod.w}mm)" 삭제하시겠습니까?`)) {
            item.modules.splice(moduleIndex, 1);
            close3DModulePopup();
            if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
          }
        };

        // 통합 pointermove 핸들러 — 드래그 vs hover 분기
        function onPointerMoveUnified(event) {
          // 유틸리티 드래그 중 → 드래그 처리만
          if (_utilDrag) { onUtilityDragMove(event); return; }
          // OrbitControls/기타 드래그 중 → hover 스킵
          if (_isDragging || !renderer) return;
          // rAF throttle — 프레임당 최대 1회만 hover
          if (_hoverRafId) return;
          const cx = event.clientX, cy = event.clientY;
          _hoverRafId = requestAnimationFrame(() => {
            _hoverRafId = 0;
            onMouseMove(cx, cy);
          });
        }

        function onMouseMove(clientX, clientY) {
          if (!renderer) return;
          // rect 캐시 (200ms마다 갱신)
          const now = performance.now();
          if (!_cachedRect || now - _rectCacheTime > 200) {
            _cachedRect = renderer.domElement.getBoundingClientRect();
            _rectCacheTime = now;
          }
          const rect = _cachedRect;
          pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const intersects = raycaster.intersectObjects(_meshCache, false);

          if (hoveredMesh && hoveredMesh !== (moduleMeshes.find(m => m.moduleIndex === window._selectedModuleIndex)?.mesh)) {
            hoveredMesh.material.color.setHex(hoveredMesh.userData._origColor || 0xffffff);
            _needsRender = true;
          }

          if (intersects.length > 0) {
            hoveredMesh = intersects[0].object;
            if (!hoveredMesh.userData._origColor) hoveredMesh.userData._origColor = hoveredMesh.material.color.getHex();
            hoveredMesh.material.color.setHex(0xe0e7ff);
            renderer.domElement.style.cursor = 'pointer';
            _needsRender = true;
          } else {
            if (hoveredMesh) _needsRender = true;
            hoveredMesh = null;
            renderer.domElement.style.cursor = 'default';
          }
        }

        function highlightModule(moduleIndex) {
          moduleMeshes.forEach(({ mesh, moduleIndex: idx }) => {
            if (!mesh.userData._origColor) mesh.userData._origColor = mesh.material.color.getHex();
            if (idx === moduleIndex) {
              mesh.material.color.setHex(0xfef3c7); // 선택 = 노란 하이라이트
              mesh.material.opacity = 1.0;
            } else {
              mesh.material.color.setHex(mesh.userData._origColor);
              mesh.material.opacity = 0.85;
            }
          });
          _needsRender = true;
          if (typeof highlightSelectedModule === 'function') highlightSelectedModule();
        }

        function dispose() {
          if (animFrameId) cancelAnimationFrame(animFrameId);
          if (_hoverRafId) cancelAnimationFrame(_hoverRafId);
          moduleMeshes.forEach(({ mesh }) => { scene.remove(mesh); if (mesh.geometry) mesh.geometry.dispose(); });
          moduleMeshes = [];
          _meshCache = [];
          labelSprites.forEach(s => { scene.remove(s); });
          labelSprites = [];
          if (renderer) {
            renderer.domElement.removeEventListener('click', onMouseClick);
            renderer.domElement.removeEventListener('dblclick', onMouseDblClick);
            renderer.domElement.removeEventListener('pointermove', onPointerMoveUnified);
            if (container && renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
            renderer.dispose();
          }
          scene = camera = renderer = controls = null;
          container = null;
          _cachedRect = null;
          _isDragging = false;
          _hoverRafId = 0;
          isInitialized = false;
        }

        let _btnBar = null; // 뷰 프리셋 버튼 바 참조

        function render3DView(containerEl, item, upperModules, lowerModules, showDoors) {
          // ★ 캔버스가 살아있고 새 컨테이너에 이식되었으면 → dispose 없이 updateScene만
          if (isInitialized && renderer && renderer.domElement) {
            if (renderer.domElement.parentNode === containerEl) {
              // 캔버스가 이미 올바른 컨테이너에 있음 → updateScene만
              container = containerEl;
              updateScene(item, upperModules, lowerModules, showDoors);
              return;
            }
          }
          // 캔버스가 없거나 컨테이너 불일치 → 재초기화
          if (isInitialized) dispose();
          init(containerEl);
          updateScene(item, upperModules, lowerModules, showDoors);
        }

        return {
          init, updateScene, dispose, render3DView, highlightModule,
          isInitialized: () => isInitialized,
          _getCanvas: () => renderer ? renderer.domElement : null,
          _getBtnBar: () => _btnBar,
        };
      })();
