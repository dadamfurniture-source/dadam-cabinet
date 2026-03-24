      // ============================================================
      // Three.js 3D Renderer for Dadam Cabinet Design
      // Front View 디자인 통일 + 2D 직교 카메라 + OrbitControls
      // ============================================================

      const ThreeRenderer = (() => {
        let scene, camera, renderer, controls;
        let container = null;
        let animFrameId = null;
        let moduleMeshes = []; // {mesh, moduleIndex}
        let hoveredMesh = null;
        let isInitialized = false;
        let labelSprites = [];

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

        // ─── 초기화: Orthographic Camera (2D 느낌) ───
        function init(containerEl) {
          if (isInitialized) return;
          container = containerEl;
          const w = container.clientWidth;
          const h = container.clientHeight || 450;

          scene = new THREE.Scene();
          scene.background = new THREE.Color(0xffffff);

          // Orthographic 카메라 (2D 느낌)
          const frustumSize = 3000;
          const aspect = w / h;
          camera = new THREE.OrthographicCamera(
            -frustumSize * aspect / 2, frustumSize * aspect / 2,
            frustumSize / 2, -frustumSize / 2,
            0.1, 20000
          );
          camera.position.set(1500, 1200, 2500);
          camera.lookAt(1500, 600, 0);

          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
          renderer.setSize(w, h);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          renderer.shadowMap.enabled = false; // 2D 스타일 — 그림자 OFF
          container.appendChild(renderer.domElement);

          // OrbitControls — 줌 범위 2배 확대
          controls = new THREE.OrbitControls(camera, renderer.domElement);
          controls.enableDamping = true;
          controls.dampingFactor = 0.1;
          controls.enableRotate = true;
          controls.minZoom = 0.15;  // 2배 축소 가능 (기존 0.3)
          controls.maxZoom = 4.0;   // 2배 확대 가능 (기존 2.0)
          controls.target.set(1500, 600, 0);
          controls.update();

          // 조명 — 플랫 라이팅 (2D 느낌)
          const ambient = new THREE.AmbientLight(0xffffff, 0.95);
          scene.add(ambient);
          const dirLight = new THREE.DirectionalLight(0xffffff, 0.15);
          dirLight.position.set(0, 2000, 2000);
          scene.add(dirLight);

          // 이벤트
          renderer.domElement.addEventListener('click', onMouseClick);
          renderer.domElement.addEventListener('pointermove', onMouseMove);

          // 리사이즈
          const ro = new ResizeObserver(() => {
            if (!container || !camera || !renderer) return;
            const nw = container.clientWidth;
            const nh = container.clientHeight || 450;
            const na = nw / nh;
            const fs = 3000;
            camera.left = -fs * na / 2;
            camera.right = fs * na / 2;
            camera.top = fs / 2;
            camera.bottom = -fs / 2;
            camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          });
          ro.observe(container);

          isInitialized = true;
          animate();
        }

        function animate() {
          if (!isInitialized) return;
          animFrameId = requestAnimationFrame(animate);
          if (controls) controls.update();
          if (renderer && scene && camera) renderer.render(scene, camera);
        }

        // ─── 플랫 박스 생성 (MeshBasicMaterial — 그림자/조명 없음, 2D 느낌) ───
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

          // 외곽선 (Front View stroke 색상)
          const edges = new THREE.EdgesGeometry(geo);
          const edgeMat = new THREE.LineBasicMaterial({ color: strokeColor || 0x999999, linewidth: 1 });
          const line = new THREE.LineSegments(edges, edgeMat);
          mesh.add(line);

          scene.add(mesh);
          if (moduleIndex !== undefined && moduleIndex !== null && moduleIndex >= 0) {
            moduleMeshes.push({ mesh, moduleIndex });
          }
          return mesh;
        }

        // 라벨 스프라이트
        function addLabel(text, x, y, z, fontSize, textColor) {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = 256; canvas.height = 48;
          ctx.clearRect(0, 0, 256, 48);
          ctx.fillStyle = textColor || '#666';
          ctx.font = `bold ${fontSize || 16}px Pretendard, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, 128, 24);

          const texture = new THREE.CanvasTexture(canvas);
          const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
          const sprite = new THREE.Sprite(mat);
          sprite.position.set(x, y, z);
          sprite.scale.set(180, 40, 1);
          scene.add(sprite);
          labelSprites.push(sprite);
          return sprite;
        }

        // ─── 모듈 → 3D 메시 (Front View 디자인 통일) ───
        function updateScene(item, upperModules, lowerModules, showDoors) {
          // 정리
          moduleMeshes.forEach(({ mesh }) => {
            scene.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) { if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose()); else mesh.material.dispose(); }
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
          const lowerD = D - 100;
          const finishL = item.specs?.finishLeftType !== 'None' ? (parseFloat(item.specs?.finishLeftWidth) || 0) : 0;
          const finishR = item.specs?.finishRightType !== 'None' ? (parseFloat(item.specs?.finishRightWidth) || 0) : 0;
          const midY = legH + lowerH;
          const upperY = H - moldingH - upperH;
          const gap = 2;

          // ═══ 킥보드 ═══
          addBox(finishL, 0, 50, W - finishL - finishR, legH, lowerD - 50, COLORS.kickboard, 0x444444, null, '킥보드');

          // ═══ 마감재 ═══
          if (finishL > 0) {
            addBox(0, 0, 0, finishL, legH + lowerH, D, COLORS.finish, COLORS.finishStroke, null, '좌마감');
            addBox(0, upperY, 0, finishL, upperH + moldingH, upperD, COLORS.finish, COLORS.finishStroke, null, '좌마감상');
          }
          if (finishR > 0) {
            addBox(W - finishR, 0, 0, finishR, legH + lowerH, D, COLORS.finish, COLORS.finishStroke, null, '우마감');
            addBox(W - finishR, upperY, 0, finishR, upperH + moldingH, upperD, COLORS.finish, COLORS.finishStroke, null, '우마감상');
          }

          // ═══ 하부장 모듈 ═══
          let lx = finishL;
          for (const mod of lowerModules) {
            const mw = parseFloat(mod.w) || 600;
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
            addBox(lx + gap, legH, gap, mw - gap * 2, mh, lowerD - gap, fill, stroke, modIdx, mod.type);

            // 라벨
            const icons = { sink: '🚰', cook: '🔥', tall: '↕', drawer: '🗄', storage: '📦' };
            const icon = icons[mod.type] || (isDrawer ? '🗄' : '📦');
            addLabel(`${icon} ${mw}`, lx + mw / 2, legH + (isTall ? mh : lowerH) / 2, -20, 15, isSink ? '#1d4ed8' : isCook ? '#dc2626' : '#555');

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
          addLabel(`상판 ${topT}mm`, W / 2, midY + topT / 2, -15, 12, '#8b6914');

          // ═══ 상부장 모듈 ═══
          let ux = finishL;
          for (const mod of upperModules) {
            const mw = parseFloat(mod.w) || 600;
            const isHood = mod.type === 'hood';
            const fill = isHood ? COLORS.hood : COLORS.upperBg;
            const stroke = isHood ? COLORS.hoodStroke : COLORS.upperStroke;

            const modIdx = item.modules.indexOf(mod);
            addBox(ux + gap, upperY + gap, gap, mw - gap * 2, upperH - gap, upperD - gap, fill, stroke, modIdx, mod.type);

            const icon = isHood ? '🌀' : '📦';
            addLabel(`${icon} ${mw}`, ux + mw / 2, upperY + upperH / 2, -20, 15, isHood ? '#b45309' : '#1d4ed8');
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

          // 카메라 위치 조정
          controls.target.set(W / 2, H / 2 - 200, 0);
          camera.position.set(W / 2, H / 2, 3000);
          controls.update();
        }

        function getDoorColorHex(name) {
          const m = { '화이트': 0xf5f5f5, '그레이': 0xcccccc, '블랙': 0x333333, '오크': 0xc8a882, '월넛': 0x6b4e3d, '베이지': 0xe8dcc8 };
          return m[name] || 0xf5f5f5;
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
              const ws = document.getElementById('designWorkspace');
              if (ws) {
                const uid = ws.querySelector('[data-uid]')?.dataset.uid;
                if (uid && typeof openModulePopup === 'function') openModulePopup(parseFloat(uid), entry.moduleIndex);
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

          if (hoveredMesh && hoveredMesh !== (moduleMeshes.find(m => m.moduleIndex === window._selectedModuleIndex)?.mesh)) {
            hoveredMesh.material.color.setHex(hoveredMesh.userData._origColor || 0xffffff);
          }

          if (intersects.length > 0) {
            hoveredMesh = intersects[0].object;
            if (!hoveredMesh.userData._origColor) hoveredMesh.userData._origColor = hoveredMesh.material.color.getHex();
            hoveredMesh.material.color.setHex(0xe0e7ff);
            renderer.domElement.style.cursor = 'pointer';
          } else {
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
          if (typeof highlightSelectedModule === 'function') highlightSelectedModule();
        }

        function dispose() {
          if (animFrameId) cancelAnimationFrame(animFrameId);
          moduleMeshes.forEach(({ mesh }) => { scene.remove(mesh); if (mesh.geometry) mesh.geometry.dispose(); });
          moduleMeshes = [];
          labelSprites.forEach(s => { scene.remove(s); });
          labelSprites = [];
          if (renderer) {
            renderer.domElement.removeEventListener('click', onMouseClick);
            renderer.domElement.removeEventListener('pointermove', onMouseMove);
            if (container && renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
            renderer.dispose();
          }
          scene = camera = renderer = controls = null;
          container = null;
          isInitialized = false;
        }

        function render3DView(containerEl, item, upperModules, lowerModules, showDoors) {
          if (!isInitialized || container !== containerEl) {
            if (isInitialized) dispose();
            init(containerEl);
          }
          updateScene(item, upperModules, lowerModules, showDoors);
        }

        return { init, updateScene, dispose, render3DView, highlightModule, isInitialized: () => isInitialized };
      })();
