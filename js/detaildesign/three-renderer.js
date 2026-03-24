      // ============================================================
      // Three.js 3D Renderer for Dadam Cabinet Design
      // 모듈 데이터 → 3D 박스 메시 변환 + OrbitControls + Raycaster
      // ============================================================

      const ThreeRenderer = (() => {
        let scene, camera, renderer, controls;
        let container = null;
        let animFrameId = null;
        let moduleMeshes = []; // {mesh, moduleIndex}
        let hoveredMesh = null;
        let isInitialized = false;

        // 색상 매핑 — 모듈별 뚜렷한 색상 구분
        const MODULE_COLORS = {
          storage: 0xe8eaed,
          sink: 0xa8d5ff,
          cook: 0xffb3b3,
          tall: 0xa8e6cf,
          drawer: 0xffe0a3,
          hood: 0xffd480,
          countertop: 0xc89660,
          kickboard: 0x888888,
          finish: 0xd0d0d0,
          molding: 0xb0b0b0,
          door: 0xf0f0f0,
          sinkBowl: 0x7eb8e0,
          faucet: 0x999999,
          burner: 0x222222,
        };

        // 모듈 타입별 외곽선 색상
        const MODULE_EDGE_COLORS = {
          storage: 0x666666,
          sink: 0x2277cc,
          cook: 0xcc3333,
          tall: 0x22aa66,
          drawer: 0xcc8800,
          hood: 0xcc8800,
        };

        // 3D 라벨용 (스프라이트)
        let labelSprites = [];

        const SELECTED_EMISSIVE = 0xb8956c;

        function init(containerEl) {
          if (isInitialized) return;
          container = containerEl;

          // Scene
          scene = new THREE.Scene();
          scene.background = new THREE.Color(0xfafafa);

          // Camera (Perspective, ISO-like angle)
          const aspect = container.clientWidth / container.clientHeight;
          camera = new THREE.PerspectiveCamera(35, aspect, 1, 10000);
          camera.position.set(2000, 1800, 2500);
          camera.lookAt(1500, 500, 300);

          // Renderer
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
          renderer.setSize(container.clientWidth, container.clientHeight);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          container.appendChild(renderer.domElement);

          // Controls
          controls = new THREE.OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.dampingFactor = 0.08;
          controls.minDistance = 500;
          controls.maxDistance = 6000;
          controls.target.set(1500, 500, 300);
          controls.update();

          // Lighting
          const ambient = new THREE.AmbientLight(0xffffff, 0.6);
          scene.add(ambient);

          const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
          dirLight.position.set(3000, 3000, 2000);
          dirLight.castShadow = true;
          dirLight.shadow.mapSize.width = 1024;
          dirLight.shadow.mapSize.height = 1024;
          scene.add(dirLight);

          const hemiLight = new THREE.HemisphereLight(0xffffff, 0xf0f0f0, 0.3);
          scene.add(hemiLight);

          // Ground plane (subtle grid)
          const gridHelper = new THREE.GridHelper(5000, 50, 0xe0e0e0, 0xf0f0f0);
          gridHelper.position.y = -1;
          scene.add(gridHelper);

          // Interaction
          renderer.domElement.addEventListener('click', onMouseClick);
          renderer.domElement.addEventListener('pointermove', onMouseMove);

          // Resize
          const ro = new ResizeObserver(() => {
            if (!container) return;
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
          });
          ro.observe(container);

          isInitialized = true;
          animate();
        }

        function animate() {
          if (!isInitialized) return;
          animFrameId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        }

        // ─── 모듈 → 3D 메시 ───
        function updateScene(item, upperModules, lowerModules, showDoors) {
          // 기존 메시 + 라벨 제거
          moduleMeshes.forEach(({ mesh }) => {
            scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
              if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
              else mesh.material.dispose();
            }
          });
          moduleMeshes = [];
          labelSprites.forEach(s => { scene.remove(s); s.material.map?.dispose(); s.material.dispose(); });
          labelSprites = [];

          const W = parseFloat(item.w) || 3000;
          const H = parseFloat(item.h) || 2400;
          const D = parseFloat(item.d) || 650;
          const legH = parseFloat(item.specs?.sinkLegHeight) || 120;
          const lowerH = parseFloat(item.specs?.lowerH) || 870;
          const upperH = parseFloat(item.specs?.upperH) || 720;
          const topT = parseFloat(item.specs?.topThickness) || 12;
          const moldingH = parseFloat(item.specs?.moldingH) || 60;
          const upperD = 295;
          const lowerD = D - 100; // kickboard recess
          const finishL = item.specs?.finishLeftType !== 'None' ? (parseFloat(item.specs?.finishLeftWidth) || 0) : 0;
          const finishR = item.specs?.finishRightType !== 'None' ? (parseFloat(item.specs?.finishRightWidth) || 0) : 0;

          const midY = legH + lowerH;
          const upperY = midY + 600; // backsplash gap

          // 모듈 간 간격 (시각적 구분)
          const MOD_GAP = 3;

          // Helper: 박스 생성 (강화된 외곽선 + 라벨)
          function addBox(x, y, z, w, h, d, color, moduleIndex, name, edgeColor) {
            const geo = new THREE.BoxGeometry(w, h, d);
            const mat = new THREE.MeshStandardMaterial({
              color: color,
              roughness: 0.5,
              metalness: 0.05,
              transparent: true,
              opacity: 1.0,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { moduleIndex, name, type: 'module', w, h, d };

            // 진한 외곽선 (모듈은 색상, 비모듈은 회색)
            const ec = edgeColor || 0x888888;
            const edges = new THREE.EdgesGeometry(geo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: ec, linewidth: 2 }));
            mesh.add(line);

            scene.add(mesh);
            if (moduleIndex !== undefined && moduleIndex !== null && moduleIndex >= 0) {
              moduleMeshes.push({ mesh, moduleIndex });
            }
            return mesh;
          }

          // Helper: 3D 텍스트 라벨 (스프라이트)
          function addLabel(text, x, y, z, fontSize, color) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 256;
            canvas.height = 64;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(0, 0, 256, 64);
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 1;
            ctx.strokeRect(0, 0, 256, 64);
            ctx.fillStyle = color || '#333';
            ctx.font = `bold ${fontSize || 20}px Pretendard, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 128, 32);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.position.set(x, y, z);
            sprite.scale.set(200, 50, 1);
            scene.add(sprite);
            labelSprites.push(sprite);
            return sprite;
          }

          // ═══ 킥보드 (다리 부분) ═══
          addBox(finishL, 0, 60, W - finishL - finishR, legH, lowerD - 60, MODULE_COLORS.kickboard, null, '킥보드');

          // ═══ 좌측 마감재 ═══
          if (finishL > 0) {
            addBox(0, 0, 0, finishL, legH + lowerH, D, MODULE_COLORS.finish, null, '좌측 마감');
            addBox(0, upperY, 0, finishL, upperH + moldingH, upperD, MODULE_COLORS.finish, null, '좌측 마감 상부');
          }

          // ═══ 우측 마감재 ═══
          if (finishR > 0) {
            addBox(W - finishR, 0, 0, finishR, legH + lowerH, D, MODULE_COLORS.finish, null, '우측 마감');
            addBox(W - finishR, upperY, 0, finishR, upperH + moldingH, upperD, MODULE_COLORS.finish, null, '우측 마감 상부');
          }

          // ═══ 하부장 모듈 (갭 + 외곽선 색상 + 라벨) ═══
          let lx = finishL;
          for (let i = 0; i < lowerModules.length; i++) {
            const mod = lowerModules[i];
            const mw = parseFloat(mod.w) || 600;
            const mh = lowerH;
            const md = lowerD;
            const isSink = mod.type === 'sink' || mod.hasSink || mod.has_sink;
            const isCook = mod.type === 'cook' || mod.hasCooktop || mod.has_cooktop;
            const isTall = mod.type === 'tall';
            const modType = isSink ? 'sink' : isCook ? 'cook' : isTall ? 'tall' : mod.isDrawer ? 'drawer' : 'storage';
            const color = MODULE_COLORS[modType];
            const edgeColor = MODULE_EDGE_COLORS[modType] || 0x666666;

            const modIdx = item.modules.indexOf(mod);
            const tallH = isTall ? (upperH + (upperY - midY) + lowerH) : mh;
            const tallY = isTall ? legH : legH;
            addBox(lx + MOD_GAP, tallY, MOD_GAP, mw - MOD_GAP * 2, isTall ? tallH : mh, md - MOD_GAP, color, modIdx, mod.name || modType, edgeColor);

            // 모듈 라벨 (타입 + 치수)
            const icons = { sink: '🚰', cook: '🔥', tall: '↕️', drawer: '🗄', storage: '📦' };
            addLabel(`${icons[modType] || '📦'} ${mw}mm`, lx + mw / 2, legH + mh / 2, -30, 18, '#333');

            // 싱크볼
            if (isSink) {
              const bowlW = mw * 0.6, bowlH = 80, bowlD = md * 0.45;
              addBox(lx + (mw - bowlW) / 2, midY - bowlH + 5, (md - bowlD) / 2, bowlW, bowlH, bowlD, MODULE_COLORS.sinkBowl, null, '싱크볼', 0x4488bb);
            }

            // 쿡탑 버너 표시
            if (isCook) {
              const burnerW = mw * 0.7, burnerD = md * 0.5;
              addBox(lx + (mw - burnerW) / 2, midY + 2, (md - burnerD) / 2, burnerW, 5, burnerD, MODULE_COLORS.burner, null, '쿡탑', 0x444444);
            }

            lx += mw;
          }

          // ═══ 상판 (카운터탑) ═══
          addBox(0, midY - topT, 0, W, topT + 5, D, MODULE_COLORS.countertop, null, '상판');

          // ═══ 상부장 모듈 (갭 + 라벨) ═══
          let ux = finishL;
          for (let i = 0; i < upperModules.length; i++) {
            const mod = upperModules[i];
            const mw = parseFloat(mod.w) || 600;
            const mh = upperH;
            const md = upperD;
            const isHood = mod.type === 'hood';
            const modType = isHood ? 'hood' : 'storage';
            const color = MODULE_COLORS[modType];
            const edgeColor = MODULE_EDGE_COLORS[modType] || 0x3366aa;

            const modIdx = item.modules.indexOf(mod);
            addBox(ux + MOD_GAP, upperY + MOD_GAP, MOD_GAP, mw - MOD_GAP * 2, mh - MOD_GAP, md - MOD_GAP, color, modIdx, mod.name || modType, edgeColor);

            // 상부장 라벨
            const icon = isHood ? '🌀' : '📦';
            addLabel(`${icon} ${mw}mm`, ux + mw / 2, upperY + mh / 2, -30, 18, '#333');
            ux += mw;
          }

          // ═══ 상몰딩 ═══
          addBox(0, upperY + upperH, 0, W, moldingH, upperD, MODULE_COLORS.molding, null, '상몰딩');

          // ═══ 도어 오버레이 ═══
          if (showDoors) {
            const doorColor = getDoorColorHex(item.specs?.doorColorUpper || '화이트');
            // 상부장 도어
            let dx = finishL;
            for (const mod of upperModules) {
              const mw = parseFloat(mod.w) || 600;
              const doorCount = mod.doorCount || Math.ceil(mw / 600);
              const dw = mw / doorCount;
              for (let d = 0; d < doorCount; d++) {
                addBox(dx + d * dw + 2, upperY + 2, -2, dw - 4, upperH - 4, 4, doorColor, null, '도어');
              }
              dx += mw;
            }
            // 하부장 도어
            let dlx = finishL;
            for (const mod of lowerModules) {
              const mw = parseFloat(mod.w) || 600;
              const mh = lowerH - topT - legH;
              if (mod.isDrawer) {
                const dc = mod.drawerCount || 3;
                const dh = mh / dc;
                for (let dd = 0; dd < dc; dd++) {
                  addBox(dlx + 2, legH + dd * dh + 2, -2, mw - 4, dh - 4, 4, doorColor, null, '서랍');
                }
              } else {
                const doorCount = mod.doorCount || Math.ceil(mw / 600);
                const dw = mw / doorCount;
                for (let d = 0; d < doorCount; d++) {
                  addBox(dlx + d * dw + 2, legH + 2, -2, dw - 4, mh - 4, 4, doorColor, null, '도어');
                }
              }
              dlx += mw;
            }
          }

          // 카메라 타겟 업데이트
          controls.target.set(W / 2, (legH + lowerH + 300) / 2, D / 2);
          camera.position.set(W / 2 + 1500, 1800, D + 2000);
          controls.update();
        }

        function getDoorColorHex(colorName) {
          const map = {
            '화이트': 0xf5f5f5, '그레이': 0xcccccc, '블랙': 0x333333,
            '오크': 0xc8a882, '월넛': 0x6b4e3d, '베이지': 0xe8dcc8,
          };
          return map[colorName] || 0xf5f5f5;
        }

        // ─── 인터랙션 ───
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        function onMouseClick(event) {
          if (!renderer) return;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);

          const meshes = moduleMeshes.map(m => m.mesh);
          const intersects = raycaster.intersectObjects(meshes);

          if (intersects.length > 0) {
            const hit = intersects[0].object;
            const entry = moduleMeshes.find(m => m.mesh === hit);
            if (entry && entry.moduleIndex !== null) {
              window._selectedModuleIndex = entry.moduleIndex;
              highlightModule(entry.moduleIndex);

              // 기존 팝업 호출
              const ws = document.getElementById('designWorkspace');
              if (ws) {
                const uid = ws.querySelector('[data-uid]')?.dataset.uid;
                if (uid && typeof openModulePopup === 'function') {
                  openModulePopup(parseFloat(uid), entry.moduleIndex);
                }
              }
            }
          }
        }

        function onMouseMove(event) {
          if (!renderer) return;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);

          const meshes = moduleMeshes.map(m => m.mesh);
          const intersects = raycaster.intersectObjects(meshes);

          // 호버 리셋
          if (hoveredMesh) {
            hoveredMesh.material.emissive.setHex(0x000000);
            renderer.domElement.style.cursor = 'grab';
          }

          if (intersects.length > 0) {
            hoveredMesh = intersects[0].object;
            hoveredMesh.material.emissive.setHex(0x222222);
            renderer.domElement.style.cursor = 'pointer';
          } else {
            hoveredMesh = null;
          }
        }

        function highlightModule(moduleIndex) {
          moduleMeshes.forEach(({ mesh, moduleIndex: idx }) => {
            if (idx === moduleIndex) {
              mesh.material.emissive.setHex(SELECTED_EMISSIVE);
              mesh.material.opacity = 1.0;
            } else {
              mesh.material.emissive.setHex(0x000000);
              mesh.material.opacity = 0.6;
            }
          });

          // SVG 뷰 동기화
          if (typeof highlightSelectedModule === 'function') {
            highlightSelectedModule();
          }
        }

        function dispose() {
          if (animFrameId) cancelAnimationFrame(animFrameId);
          moduleMeshes.forEach(({ mesh }) => {
            scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
          });
          moduleMeshes = [];
          if (renderer) {
            renderer.domElement.removeEventListener('click', onMouseClick);
            renderer.domElement.removeEventListener('pointermove', onMouseMove);
            if (container && renderer.domElement.parentNode === container) {
              container.removeChild(renderer.domElement);
            }
            renderer.dispose();
          }
          scene = camera = renderer = controls = null;
          container = null;
          isInitialized = false;
        }

        // 외부 렌더 함수 (SVG 대신 canvas 반환)
        function render3DView(containerEl, item, upperModules, lowerModules, showDoors) {
          if (!isInitialized || container !== containerEl) {
            if (isInitialized) dispose();
            init(containerEl);
          }
          updateScene(item, upperModules, lowerModules, showDoors);
        }

        return { init, updateScene, dispose, render3DView, highlightModule, isInitialized: () => isInitialized };
      })();
