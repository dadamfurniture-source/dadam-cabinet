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

        // 색상 매핑
        const MODULE_COLORS = {
          storage: 0xf3f4f6,
          sink: 0xdbeafe,
          cook: 0xfee2e2,
          tall: 0xdcfce7,
          drawer: 0xfef3c7,
          hood: 0xfef3c7,
          countertop: 0xd4a574,
          kickboard: 0xd1d5db,
          finish: 0xe0e0e0,
          molding: 0xc8c8c8,
          door: 0xf5f5f5,
          sinkBowl: 0xc0d8f0,
          faucet: 0x888888,
          burner: 0x333333,
        };

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
          // 기존 모듈 메시 제거
          moduleMeshes.forEach(({ mesh }) => {
            scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
              if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
              else mesh.material.dispose();
            }
          });
          moduleMeshes = [];

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

          // Helper: 박스 생성
          function addBox(x, y, z, w, h, d, color, moduleIndex, name) {
            const geo = new THREE.BoxGeometry(w, h, d);
            const mat = new THREE.MeshStandardMaterial({
              color: color,
              roughness: 0.6,
              metalness: 0.1,
              transparent: true,
              opacity: 1.0,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x + w / 2, y + h / 2, z + d / 2);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { moduleIndex, name, type: 'module' };

            // 외곽선
            const edges = new THREE.EdgesGeometry(geo);
            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x999999, linewidth: 1 }));
            mesh.add(line);

            scene.add(mesh);
            if (moduleIndex !== undefined && moduleIndex !== null) {
              moduleMeshes.push({ mesh, moduleIndex });
            }
            return mesh;
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

          // ═══ 하부장 모듈 ═══
          let lx = finishL;
          for (let i = 0; i < lowerModules.length; i++) {
            const mod = lowerModules[i];
            const mw = parseFloat(mod.w) || 600;
            const mh = lowerH - topT - legH;
            const md = lowerD;
            const isSink = mod.type === 'sink' || mod.hasSink || mod.has_sink;
            const isCook = mod.type === 'cook' || mod.hasCooktop || mod.has_cooktop;
            const color = isSink ? MODULE_COLORS.sink : isCook ? MODULE_COLORS.cook :
                          mod.isDrawer ? MODULE_COLORS.drawer : MODULE_COLORS.storage;

            const modIdx = item.modules.indexOf(mod);
            addBox(lx, legH, 0, mw, mh, md, color, modIdx, mod.name || mod.type);

            // 싱크볼
            if (isSink) {
              const bowlW = mw * 0.6, bowlH = 100, bowlD = md * 0.5;
              addBox(lx + (mw - bowlW) / 2, midY - bowlH + 5, (md - bowlD) / 2, bowlW, bowlH, bowlD, MODULE_COLORS.sinkBowl, null, '싱크볼');
            }

            // 쿡탑 버너 표시 (얇은 박스)
            if (isCook) {
              const burnerW = mw * 0.7, burnerD = md * 0.5;
              addBox(lx + (mw - burnerW) / 2, midY + 2, (md - burnerD) / 2, burnerW, 5, burnerD, MODULE_COLORS.burner, null, '쿡탑');
            }

            lx += mw;
          }

          // ═══ 상판 (카운터탑) ═══
          addBox(0, midY - topT, 0, W, topT + 5, D, MODULE_COLORS.countertop, null, '상판');

          // ═══ 상부장 모듈 ═══
          let ux = finishL;
          for (let i = 0; i < upperModules.length; i++) {
            const mod = upperModules[i];
            const mw = parseFloat(mod.w) || 600;
            const mh = upperH;
            const md = upperD;
            const isHood = mod.type === 'hood';
            const color = isHood ? MODULE_COLORS.hood : MODULE_COLORS.storage;

            const modIdx = item.modules.indexOf(mod);
            addBox(ux, upperY, 0, mw, mh, md, color, modIdx, mod.name || mod.type);
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

        return { init, updateScene, dispose, render3DView, highlightModule };
      })();
