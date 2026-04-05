import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, PerspectiveCamera, Html, ContactShadows } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  MATERIALS, MODULE_DEFAULT_W, autoCalculateModules, genModuleId,
  type CabinetCategory, type MaterialTone, type ModuleEntry, type ModuleKind,
  createPlannerState, deriveCabinet, getPresetById, type PlannerState,
} from './lib/planner';

type CameraView = 'perspective' | 'front' | 'top';

// ═══ 타입별 색상 ═══
const TYPE_COLORS: Record<string, { body: string; face: string; outline: string; emissive: string }> = {
  sink: { body: '#b3d4e8', face: '#8ab8d4', outline: '#0284c7', emissive: '#0369a1' },
  cook: { body: '#e8b3b3', face: '#d48a8a', outline: '#dc2626', emissive: '#b91c1c' },
  hood: { body: '#c9b3e8', face: '#a88ad4', outline: '#7c3aed', emissive: '#6d28d9' },
};

// ═══ 공통: 모듈 윤곽선 ═══
function ModuleEdges({ w, h, d, color = '#333333' }: { w: number; h: number; d: number; color?: string }) {
  return (
    <lineSegments>
      <edgesGeometry args={[new THREE.BoxGeometry(w, h, d)]} />
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}

// ═══ 3D 메쉬: 싱크대 ═══
function SinkMesh({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <ModuleEdges w={w} h={h} d={d} color="#0284c7" />
    </group>
  );
}

// ═══ 3D 메쉬: 도어 ═══
function DoorMesh({ w, h, d, color, doorCount }: { w: number; h: number; d: number; color: string; doorCount: number }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <ModuleEdges w={w} h={h} d={d} />
    </group>
  );
}

// ═══ 3D 메쉬: 서랍 ═══
function DrawerMesh({ w, h, d, color, drawerCount }: { w: number; h: number; d: number; color: string; drawerCount: number }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <ModuleEdges w={w} h={h} d={d} />
    </group>
  );
}

// ═══ 3D 메쉬: 후드 ═══
function HoodMesh({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
      </mesh>
      <ModuleEdges w={w} h={h} d={d} color="#7c3aed" />
    </group>
  );
}

// ═══ 3D 메쉬: 가스대 (쿡탑) ═══
function CookMesh({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <ModuleEdges w={w} h={h} d={d} color="#dc2626" />
    </group>
  );
}

// ═══ 모듈 컴포넌트 (드래그+클릭+타입별 렌더링) ═══
function ModuleBox({ part, color, onSelect, halfW, controlsRef, onDragDone, onDragMove, shiftDir }: {
  part: { id: string; x: number; y: number; z: number; width: number; height: number; depth: number; essential?: boolean; moduleType?: string; moduleKind?: string; doorCount?: number; drawerCount?: number; rotationY?: number };
  color: string;
  onSelect: (id: string) => void;
  halfW: number;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  onDragDone: (id: string, newX: number) => void;
  onDragMove: (id: string | null, x: number | null) => void;
  shiftDir?: 'left' | 'right' | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const dragOffset = useRef(0);

  const isMod = part.id.startsWith('mod-');
  const isFace = part.id.endsWith('-face');
  const isPerp = !!part.rotationY;
  const isDraggable = isMod && !isFace && !isPerp; // perpendicular 모듈은 드래그 불가
  const isClickable = isMod; // 측판/몰딩/걸레받이 등은 클릭 불가
  const isEssential = !!part.essential;
  const moduleId = isMod ? part.id.replace(/-face$/, '') : part.id;

  const mType = part.moduleType;
  const tc = mType ? TYPE_COLORS[mType] : null;
  const baseColor = tc ? (isFace ? tc.face : tc.body) : color;
  const outlineColor = tc ? tc.outline : '#b8956c';

  const getPlaneX = (e: { ray: THREE.Ray }) => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -part.z);
    const v = new THREE.Vector3();
    e.ray.intersectPlane(plane, v);
    return v.x;
  };

  const posX = dragX ?? part.x;

  // 타입별 메쉬 선택
  const renderInner = () => {
    const w = part.width, h = part.height, d = part.depth;
    if (isFace) return null; // face 파트는 타입 메쉬가 대체

    if (mType === 'sink') return <SinkMesh w={w} h={h} d={d} color={baseColor} />;
    if (mType === 'cook') return <CookMesh w={w} h={h} d={d} color={baseColor} />;
    if (mType === 'hood') return <HoodMesh w={w} h={h} d={d} color={baseColor} />;
    if (part.moduleKind === 'drawer') return <DrawerMesh w={w} h={h} d={d} color={baseColor} drawerCount={part.drawerCount || 3} />;
    return <DoorMesh w={w} h={h} d={d} color={baseColor} doorCount={part.doorCount || 1} />;
  };

  if (isFace) return null; // face 파트 숨김 (타입 메쉬가 도어면 포함)

  return (
    <group position={[posX, part.y, part.z]} rotation={isPerp ? [0, part.rotationY!, 0] : undefined}>
      {/* 히트박스 (투명, 드래그/클릭용) — perpendicular는 전체 박스, 일반은 정면 평면 */}
      <mesh
        position={isPerp ? [0, 0, 0] : [0, 0, part.depth / 2]}
        onPointerDown={isDraggable ? (e) => {
          e.stopPropagation();
          dragging.current = true; didDrag.current = false;
          dragOffset.current = getPlaneX(e) - part.x;
          (e.target as any).setPointerCapture(e.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = false;
        } : undefined}
        onPointerUp={isDraggable ? (e) => {
          if (!dragging.current) return;
          dragging.current = false;
          (e.target as any).releasePointerCapture(e.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = true;
          onDragMove(null, null);
          if (didDrag.current) { onDragDone(moduleId, dragX ?? part.x); setDragX(null); }
          else { e.stopPropagation(); onSelect(moduleId); }
        } : undefined}
        onPointerMove={isDraggable ? (e) => {
          if (!dragging.current) return;
          didDrag.current = true;
          const nx = Math.max(-halfW, Math.min(halfW, getPlaneX(e) - dragOffset.current));
          setDragX(nx);
          onDragMove(moduleId, nx);
        } : undefined}
        onClick={(!isDraggable && isClickable) ? (e) => { e.stopPropagation(); onSelect(moduleId); } : undefined}
        onPointerOver={isClickable ? () => setHovered(true) : undefined}
        onPointerOut={isClickable ? () => {
          setHovered(false);
          if (dragging.current) {
            dragging.current = false;
            if (controlsRef.current) controlsRef.current.enabled = true;
            onDragMove(null, null);
            if (didDrag.current) { onDragDone(moduleId, dragX ?? part.x); }
            setDragX(null);
          }
        } : undefined}
      >
        {isPerp
          ? <boxGeometry args={[part.width, part.height, part.depth]} />
          : <planeGeometry args={[part.width, part.height]} />}
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 타입별 3D 메쉬 */}
      <group scale={hovered ? [1.005, 1.005, 1.005] : [1, 1, 1]}>
        {renderInner()}
      </group>

      {/* 필수장 윤곽선 제거됨 — 타입별 색상으로 충분히 구분 */}

      {/* 이동 방향 인디케이터 */}
      {shiftDir && (
        <mesh position={[shiftDir === 'left' ? -part.width / 2 - 2 : part.width / 2 + 2, 0, part.depth / 2 + 1]}>
          <boxGeometry args={[4, part.height, 4]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      )}
    </group>
  );
}

// ═══ 유틸리티 (분배기/환풍구) ═══
function UtilityMesh({ part, halfW, controlsRef, onDrag, onSelect }: {
  part: { id: string; x: number; y: number; z: number; width: number; height: number; depth: number };
  halfW: number;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  onDrag: (id: string, x: number) => void;
  onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const dragOffset = useRef(0);
  const isDist = part.id.includes('distributor');

  const getPlaneX = (e: { ray: THREE.Ray }) => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -part.z);
    const v = new THREE.Vector3();
    e.ray.intersectPlane(plane, v);
    return v.x;
  };

  return (
    <group>
      <mesh
        position={[part.x, part.y, part.z]}
        onPointerDown={(e) => {
          e.stopPropagation(); dragging.current = true; didDrag.current = false;
          dragOffset.current = getPlaneX(e) - part.x;
          (e.target as any).setPointerCapture(e.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = false;
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          (e.target as any).releasePointerCapture(e.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = true;
          if (!didDrag.current) { e.stopPropagation(); onSelect(part.id); }
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          didDrag.current = true;
          onDrag(part.id, Math.max(-halfW, Math.min(halfW, getPlaneX(e) - dragOffset.current)));
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => { setHovered(false); if (dragging.current) { dragging.current = false; if (controlsRef.current) controlsRef.current.enabled = true; } }}
      >
        <boxGeometry args={[part.width, part.height, part.depth]} />
        <meshStandardMaterial color={hovered ? '#64b5f6' : (isDist ? '#2196f3' : '#78909c')} emissive={hovered ? '#1565c0' : '#000'} emissiveIntensity={hovered ? 0.2 : 0} />
      </mesh>
      {/* 라벨은 뒤쪽 벽면에만 표시 — 정면에서는 메쉬만 보임 */}
    </group>
  );
}

// ═══ 치수 라벨 ═══
function DimLabel({ position, text, color = '#666' }: { position: [number, number, number]; text: string; color?: string }) {
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }} zIndexRange={[1, 0]}>
      <div style={{ fontSize: 10, color, fontWeight: 600, background: 'rgba(255,255,255,0.8)', padding: '1px 4px', borderRadius: 3, whiteSpace: 'nowrap', border: `1px solid ${color}33` }}>{text}</div>
    </Html>
  );
}

// ═══ 추가 버튼 ═══
function AddBtn({ position, label, onClick }: { position: [number, number, number]; label: string; onClick: () => void }) {
  return (
    <Html position={position} center style={{ pointerEvents: 'auto' }} zIndexRange={[1, 0]}>
      <button onClick={onClick} style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid #b8956c', background: 'rgba(255,255,255,0.9)', color: '#b8956c', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>+</button>
      <div style={{ marginTop: 4, fontSize: 10, color: '#666', textAlign: 'center', whiteSpace: 'nowrap' }}>{label}</div>
    </Html>
  );
}

function AddSide({ position, h, d, color, onClick }: { position: [number, number, number]; h: number; d: number; color: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <group position={position}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerOver={() => setHov(true)} onPointerOut={() => setHov(false)}>
        <boxGeometry args={[18, h, d]} />
        <meshStandardMaterial color={hov ? '#b8956c' : color} metalness={0.15} roughness={0.7} opacity={hov ? 1 : 0.6} transparent />
      </mesh>
      <Html center style={{ pointerEvents: 'none' }} zIndexRange={[1, 0]}>
        <div style={{ color: hov ? '#fff' : '#b8956c', fontSize: 18, fontWeight: 600, userSelect: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>+</div>
      </Html>
    </group>
  );
}

// ═══ 팝업: 모듈 편집 ═══
function ModulePopup({ mod, section, onUpdate, onDelete, onClose, onBlindPanel }: {
  mod: ModuleEntry; section: 'lower' | 'upper';
  onUpdate: (id: string, c: Partial<ModuleEntry>) => void;
  onDelete: (id: string) => void; onClose: () => void;
  onBlindPanel: (modId: string, blindW: number) => void;
}) {
  const [blindW, setBlindW] = useState('600');
  const sc = section === 'upper' ? '#6366f1' : '#b8956c';
  const kinds: { value: ModuleKind; label: string; icon: string }[] = [
    { value: 'door', label: '도어', icon: '🚪' }, { value: 'drawer', label: '서랍', icon: '🗄️' }, { value: 'open', label: '오픈', icon: '📦' },
  ];
  const blindWNum = Math.max(30, Math.min(1200, Number(blindW) || 600));
  return (
    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'calc(100% - 32px)', maxWidth: 400, background: '#fff', borderRadius: 14, padding: '20px 22px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', zIndex: 9999 }} onClick={e => e.stopPropagation()}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: sc, color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{section === 'upper' ? '상부장' : '하부장'}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{mod.width}mm</span>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#999', padding: 4 }}>✕</button>
      </div>

      {/* 타입 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>타입</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {kinds.map(k => (
            <button key={k.value} onClick={() => onUpdate(mod.id, { kind: k.value })}
              style={{ flex: 1, padding: '8px 0', border: mod.kind === k.value ? `2px solid ${sc}` : '1px solid #ddd', borderRadius: 8, background: mod.kind === k.value ? `${sc}11` : '#fafafa', cursor: 'pointer', fontSize: 12 }}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* 너비 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>너비 (mm)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => onUpdate(mod.id, { width: Math.max(350, mod.width - 50) })} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>-</button>
          <input type="number" value={mod.width} step={50} min={350} max={1200}
            onChange={e => { const v = Math.min(1200, Math.max(350, Math.round(Number(e.target.value) / 50) * 50)); onUpdate(mod.id, { width: v }); }}
            style={{ flex: 1, textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: 6, fontSize: 14, fontWeight: 600, minWidth: 0 }} />
          <button onClick={() => onUpdate(mod.id, { width: Math.min(1200, mod.width + 50) })} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>+</button>
        </div>
      </div>

      {/* 멍장 섹션 */}
      <div style={{ marginBottom: 14, padding: '12px 14px', border: '1px solid #e0d6c8', borderRadius: 10, background: '#faf7f2' }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>멍장 (블라인드 패널)</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>멍장 너비 (mm)</div>
            <input type="number" value={blindW} step={10} min={30} max={1200}
              onChange={e => setBlindW(e.target.value)}
              onBlur={() => setBlindW(String(blindWNum))}
              style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: 6, fontSize: 13, fontWeight: 600, boxSizing: 'border-box' }} />
          </div>
          <button onClick={() => { onBlindPanel(mod.id, blindWNum); onClose(); }}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #b8956c', background: 'linear-gradient(135deg,#b8956c,#d4b896)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
            멍장 적용
          </button>
        </div>
      </div>

      {/* 삭제 */}
      <button onClick={() => { onDelete(mod.id); onClose(); }} style={{ width: '100%', padding: 10, border: '1px solid #fca5a5', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🗑 모듈 삭제</button>
    </div>
  );
}

// ═══ 팝업: 유틸리티 편집 ═══
function UtilityPopup({ type, planner, onUpdate, onDelete, onClose }: {
  type: 'distributor' | 'vent'; planner: PlannerState;
  onUpdate: (c: Partial<PlannerState>) => void;
  onDelete: () => void; onClose: () => void;
}) {
  const isDist = type === 'distributor';
  const startVal = isDist ? (planner.distributorStart ?? Math.round(planner.width * 0.15)) : (planner.ventStart ?? Math.round(planner.width * 0.7));
  const endVal = isDist ? (planner.distributorEnd ?? Math.round(planner.width * 0.15 + 700)) : 0;
  return (
    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#fff', borderRadius: 14, padding: '20px 24px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)', zIndex: 9999, minWidth: 280 }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: isDist ? '#2196f3' : '#78909c' }}>{isDist ? '💧 분배기 위치' : '🌀 환풍구'}</span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#999' }}>✕</button>
      </div>
      {isDist ? (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>시작 (mm)</div><input type="number" value={startVal} step={10} min={0} max={planner.width} onChange={e => onUpdate({ distributorStart: Math.max(0, Number(e.target.value)) })} style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: 6, fontSize: 13 }} /></div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>끝 (mm)</div><input type="number" value={endVal} step={10} min={0} max={planner.width} onChange={e => onUpdate({ distributorEnd: Math.max(0, Number(e.target.value)) })} style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: 6, fontSize: 13 }} /></div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>위치 (mm, 좌측 기준)</div><input type="number" value={startVal} step={10} min={0} max={planner.width} onChange={e => onUpdate({ ventStart: Math.max(0, Number(e.target.value)) })} style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: 6, fontSize: 13 }} /></div>
      )}
      <button onClick={() => { onDelete(); onClose(); }} style={{ width: '100%', padding: 10, border: '1px solid #fca5a5', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🗑 삭제 (숨김)</button>
    </div>
  );
}

// ═══ 메인 앱 ═══
export default function App() {
  // URL 파라미터 파싱
  const params = new URLSearchParams(window.location.search);
  const [planner, setPlanner] = useState<PlannerState>(() => {
    const s = createPlannerState((params.get('preset') || 'sink') as CabinetCategory);
    if (params.get('w')) s.width = Number(params.get('w'));
    if (params.get('h')) s.height = Number(params.get('h'));
    if (params.get('d')) s.depth = Number(params.get('d'));
    if (params.get('material')) s.material = params.get('material') as MaterialTone;
    if (params.get('moldingH')) s.moldingH = Number(params.get('moldingH'));
    if (params.get('toeKickH')) s.toeKickH = Number(params.get('toeKickH'));
    if (params.get('finishLeftW')) s.finishLeftW = Number(params.get('finishLeftW'));
    if (params.get('finishRightW')) s.finishRightW = Number(params.get('finishRightW'));
    // 유틸리티 (분배기/환풍구)
    if (params.get('distStart')) s.distributorStart = Number(params.get('distStart'));
    if (params.get('distEnd')) s.distributorEnd = Number(params.get('distEnd'));
    if (params.get('ventStart')) s.ventStart = Number(params.get('ventStart'));
    return s;
  });
  const [view, setView] = useState<CameraView>((params.get('view') as CameraView) || 'perspective');
  const [selId, setSelId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ id: string; x: number } | null>(null);
  const [blindPanel, setBlindPanel] = useState<{ modId: string; blindW: number } | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const derived = useMemo(() => deriveCabinet(planner), [planner]);
  const palette = MATERIALS[planner.material];
  const preset = getPresetById(planner.presetId);

  // postMessage 통신
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.data?.type === 'UPDATE_PLANNER') setPlanner(p => ({ ...p, ...e.data.payload }));
      if (e.data?.type === 'SET_CAMERA_VIEW') setView(e.data.view);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);

  useEffect(() => {
    window.parent?.postMessage({ type: 'PLANNER_STATE', payload: { planner, derived } }, '*');
  }, [planner, derived]);

  // 모듈 CRUD
  const defaultKind: ModuleKind = preset.fullHeight ? 'door' : 'drawer';
  const addLower = useCallback(() => setPlanner(p => ({ ...p, lowerModules: [...(p.lowerModules ?? []), { id: genModuleId(), kind: defaultKind, width: MODULE_DEFAULT_W }], lowerCount: (p.lowerModules ?? []).length + 1 })), [defaultKind]);
  const addUpper = useCallback(() => setPlanner(p => ({ ...p, upperModules: [...(p.upperModules ?? []), { id: genModuleId(), kind: 'door', width: MODULE_DEFAULT_W }], upperCount: (p.upperModules ?? []).length + 1 })), []);
  const updateMod = useCallback((id: string, c: Partial<ModuleEntry>) => setPlanner(p => {
    const up = (l: ModuleEntry[]) => l.map(m => m.id === id ? { ...m, ...c } : m);
    return { ...p, lowerModules: up(p.lowerModules ?? []), upperModules: up(p.upperModules ?? []) };
  }), []);
  const deleteMod = useCallback((id: string) => {
    setPlanner(p => { const nl = (p.lowerModules ?? []).filter(m => m.id !== id); const nu = (p.upperModules ?? []).filter(m => m.id !== id); return { ...p, lowerModules: nl, upperModules: nu, lowerCount: nl.length, upperCount: nu.length }; });
    setSelId(null);
  }, []);

  // 멍장 적용 핸들러: 모듈 앞에 멍장 너비만큼 새 모듈 생성
  const applyBlindPanel = useCallback((modId: string, blindW: number) => {
    setBlindPanel({ modId, blindW });
  }, []);

  const confirmBlindPanel = useCallback(() => {
    if (!blindPanel) return;
    const { modId, blindW } = blindPanel;
    setPlanner(p => {
      const isUp = (p.upperModules ?? []).some(m => m.id === modId);
      const key = isUp ? 'upperModules' : 'lowerModules';
      const list = [...(p[key] as ModuleEntry[] ?? [])];
      const idx = list.findIndex(m => m.id === modId);
      if (idx < 0) return p;
      // 멍장 모듈: 정면(Z축) 방향으로 돌출 배치 (ㄱ자형)
      const blindMod: ModuleEntry = {
        id: genModuleId(),
        kind: 'door',
        width: blindW,
        orientation: 'perpendicular',
        blindAnchorId: modId,
      };
      // 앵커 모듈 바로 뒤에 삽입 (perpendicular 모듈은 X cursor 안 먹음)
      list.splice(idx + 1, 0, blindMod);
      return { ...p, [key]: list, [`${key === 'lowerModules' ? 'lower' : 'upper'}Count`]: list.length };
    });
    setBlindPanel(null);
  }, [blindPanel]);

  const cancelBlindPanel = useCallback(() => setBlindPanel(null), []);

  // 모듈 드래그 → 순서 재정렬
  const dragModule = useCallback((id: string, newX: number) => {
    setPlanner(p => {
      const halfW = p.width / 2;
      const targetMm = Math.max(0, Math.min(p.width, newX + halfW));
      const isUp = (p.upperModules ?? []).some(m => m.id === id);
      const key = isUp ? 'upperModules' : 'lowerModules';
      const list = [...(p[key] as ModuleEntry[] ?? [])];
      const idx = list.findIndex(m => m.id === id);
      if (idx < 0) return p;
      const [dragged] = list.splice(idx, 1);
      let ins = list.length;
      let cursor = p.finishLeftW ?? 0;
      for (let i = 0; i < list.length; i++) { if (targetMm < cursor + list[i].width / 2) { ins = i; break; } cursor += list[i].width; }
      list.splice(ins, 0, dragged);
      return { ...p, [key]: list };
    });
  }, []);

  const dragUtility = useCallback((id: string, newX: number) => {
    const halfW = planner.width / 2;
    const mm = Math.round(Math.max(0, Math.min(planner.width, newX + halfW)));
    setPlanner(p => {
      if (id === 'utility-distributor') { const s = p.distributorStart ?? Math.round(p.width * 0.15); const e = p.distributorEnd ?? Math.round(p.width * 0.15 + 700); const dw = e - s; return { ...p, distributorStart: Math.max(0, mm - dw / 2), distributorEnd: Math.min(p.width, mm + dw / 2) }; }
      if (id === 'utility-vent') return { ...p, ventStart: mm };
      return p;
    });
  }, [planner.width]);

  // shiftMap 계산
  const shiftMap = useMemo<Record<string, 'left' | 'right'>>(() => {
    if (!dragState) return {};
    const halfW = planner.width / 2;
    const targetMm = Math.max(0, Math.min(planner.width, dragState.x + halfW));
    const isUp = (planner.upperModules ?? []).some(m => m.id === dragState.id);
    const list = isUp ? (planner.upperModules ?? []) : (planner.lowerModules ?? []);
    const dragIdx = list.findIndex(m => m.id === dragState.id);
    if (dragIdx < 0) return {};
    const fL = planner.finishLeftW ?? 0;
    let c = fL;
    const centers: { id: string; cx: number }[] = [];
    list.forEach(m => { centers.push({ id: m.id, cx: c + m.width / 2 }); c += m.width; });
    const without = centers.filter(x => x.id !== dragState.id);
    let ins = without.length;
    for (let i = 0; i < without.length; i++) { if (targetMm < without[i].cx) { ins = i; break; } }
    const origPos = list.slice(0, dragIdx).filter(m => m.id !== dragState.id).length;
    const result: Record<string, 'left' | 'right'> = {};
    if (ins < origPos) { for (let i = ins; i < origPos; i++) result[`mod-${without[i].id}`] = 'right'; }
    else if (ins > origPos) { for (let i = origPos; i < ins; i++) result[`mod-${without[i].id}`] = 'left'; }
    return result;
  }, [dragState, planner]);

  const handleDragMove = useCallback((id: string | null, x: number | null) => setDragState(id && x != null ? { id, x } : null), []);

  const selMod = selId ? [...(planner.lowerModules ?? []), ...(planner.upperModules ?? [])].find(m => m.id === selId) : null;
  const selSection: 'lower' | 'upper' = selId ? (planner.upperModules ?? []).some(m => m.id === selId) ? 'upper' : 'lower' : 'lower';

  // 레이아웃 계산
  const toeKickH = planner.toeKickH ?? 0;
  const moldingH = planner.moldingH ?? 0;
  const height = planner.height;
  const depth = planner.depth;
  const upperDepth = preset.fullHeight ? depth : preset.upperDepth;
  const lowerBodyH = preset.fullHeight ? Math.max(0, height - moldingH - toeKickH) : Math.min(preset.lowerHeight - toeKickH, height - toeKickH);
  const upperHeight = preset.fullHeight ? 0 : Math.min(preset.upperHeight, Math.max(0, height - moldingH - (toeKickH + lowerBodyH) - (preset.hasCountertop ? preset.counterThickness : 0)));
  const { lowerLayout, upperLayout } = derived;
  const hasLower = (planner.lowerModules ?? []).length > 0;
  const hasUpper = (planner.upperModules ?? []).length > 0;

  // 카메라 위치
  const camPos: [number, number, number] = view === 'top' ? [0, 2400, 0.01] : view === 'front' ? [0, 900, 2800] : [2300, 1500, 2300];

  return (
    <div style={{ width: '100%', height: '100vh', overflow: 'hidden', position: 'relative' }} onPointerDown={e => { if (e.target === e.currentTarget) setSelId(null); }}>
      <Canvas shadows gl={{ antialias: true }} dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
        <Suspense fallback={null}>
          <color attach="background" args={['#f4efe7']} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[1800, 2200, 1200]} intensity={1.8} castShadow />
          <directionalLight position={[-1200, 1000, -900]} intensity={0.6} />
          <Environment preset="city" />
          <ContactShadows position={[0, -1, 0]} opacity={0.4} scale={6000} blur={2.5} far={4000} />

          <group rotation={view === 'top' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
            {/* 일반 파츠 */}
            {derived.parts.filter(p => !p.id.startsWith('utility-')).map(part => (
              <ModuleBox key={part.id} part={part} color={palette[part.colorKey]} onSelect={setSelId} halfW={planner.width / 2} controlsRef={controlsRef} onDragDone={dragModule} onDragMove={handleDragMove} shiftDir={shiftMap[part.id] || null} />
            ))}

            {/* 유틸리티 (팝업 열려있으면 숨김) */}
            {!selId && derived.parts.filter(p => p.id.startsWith('utility-')).map(part => (
              <UtilityMesh key={part.id} part={part} halfW={planner.width / 2} controlsRef={controlsRef} onDrag={dragUtility} onSelect={setSelId} />
            ))}

            {/* 멍장 모드: 선택된 모듈 정면에 +/✓ 버튼 */}
            {blindPanel && (() => {
              const bp = blindPanel;
              const mp = derived.parts.find(p => p.id === `mod-${bp.modId}` || p.id === bp.modId);
              if (!mp) return null;
              return (
                <Html position={[mp.x, mp.y, mp.z + mp.depth / 2 + 1]} center style={{ pointerEvents: 'auto' }} zIndexRange={[9999, 9998]}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button onClick={confirmBlindPanel}
                      style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #22c55e', background: 'rgba(255,255,255,0.95)', color: '#22c55e', fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontWeight: 700 }}
                      title="멍장 확인 — 모듈 생성">+</button>
                    <button onClick={cancelBlindPanel}
                      style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #ef4444', background: 'rgba(255,255,255,0.95)', color: '#ef4444', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontWeight: 700 }}
                      title="취소">✕</button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#666', textAlign: 'center', background: 'rgba(255,255,255,0.9)', padding: '2px 8px', borderRadius: 4 }}>
                    멍장 {bp.blindW}mm
                  </div>
                </Html>
              );
            })()}

            {/* 치수 라벨 (팝업 열려있으면 숨김) */}
            {!selId && derived.modules.length > 0 && (
              <>
                <DimLabel position={[0, -30, depth / 2 + 80]} text={`${planner.width}mm`} color="#333" />
                <DimLabel position={[-planner.width / 2 - 60, height / 2, 0]} text={`${height}mm`} color="#333" />
                {derived.modules.map(mod => {
                  const mp = derived.parts.find(p => p.id === mod.id);
                  return mp ? <DimLabel key={`dim-${mod.id}`} position={[mp.x, mp.y - mp.height / 2 - 20, mp.z + mp.depth / 2 + 30]} text={`${mod.width}`} color={mod.section === 'upper' ? '#6366f1' : '#b8956c'} /> : null;
                })}
              </>
            )}

            {/* 추가 버튼 (팝업 열려있으면 숨김) */}
            {!selId && !preset.fullHeight && (planner.lowerModules ?? []).length < 10 && (
              hasLower && lowerLayout ? (
                <><AddSide position={[lowerLayout.startX - 9, lowerLayout.centerY, 0]} h={lowerBodyH} d={depth} color={palette.body} onClick={addLower} /><AddSide position={[lowerLayout.endX + 9, lowerLayout.centerY, 0]} h={lowerBodyH} d={depth} color={palette.body} onClick={addLower} /></>
              ) : <AddBtn position={[0, toeKickH + lowerBodyH / 2, depth / 2 + 50]} label="하부장 추가" onClick={addLower} />
            )}
            {!selId && !preset.fullHeight && upperHeight > 0 && (planner.upperModules ?? []).length < 10 && (
              hasUpper && upperLayout ? (
                <><AddSide position={[upperLayout.startX - 9, upperLayout.centerY, upperLayout.z]} h={upperHeight} d={upperDepth} color={palette.accent} onClick={addUpper} /><AddSide position={[upperLayout.endX + 9, upperLayout.centerY, upperLayout.z]} h={upperHeight} d={upperDepth} color={palette.accent} onClick={addUpper} /></>
              ) : <AddBtn position={[0, height - moldingH - upperHeight / 2, upperDepth / 2 + 50]} label="상부장 추가" onClick={addUpper} />
            )}
          </group>

          <gridHelper args={[6000, 40, 0x000000, 0xcccccc]} position={[0, -1, 0]} />
          <OrbitControls ref={controlsRef} enablePan enableDamping dampingFactor={0.08} minDistance={700} maxDistance={7000} target={[0, 900, 0]} minPolarAngle={view === 'top' ? 0.01 : 0.1} maxPolarAngle={view === 'top' ? 0.01 : Math.PI / 2} />
          <PerspectiveCamera makeDefault position={camPos} fov={45} near={1} far={20000} />
        </Suspense>
      </Canvas>

      {/* 팝업 배경 — 반투명 오버레이로 Canvas 위 Html 요소 완전 차단 */}
      {selId && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 9000, background: 'rgba(244,239,231,0.6)', backdropFilter: 'blur(2px)' }} onClick={() => setSelId(null)} />
      )}
      {selMod && <ModulePopup mod={selMod} section={selSection} onUpdate={updateMod} onDelete={deleteMod} onClose={() => setSelId(null)} onBlindPanel={applyBlindPanel} />}
      {selId === 'utility-distributor' && <UtilityPopup type="distributor" planner={planner} onUpdate={c => setPlanner(p => ({ ...p, ...c }))} onDelete={() => setPlanner(p => ({ ...p, distributorStart: 0, distributorEnd: 0 }))} onClose={() => setSelId(null)} />}
      {selId === 'utility-vent' && <UtilityPopup type="vent" planner={planner} onUpdate={c => setPlanner(p => ({ ...p, ...c }))} onDelete={() => setPlanner(p => ({ ...p, ventStart: 0 }))} onClose={() => setSelId(null)} />}

      {/* 툴바 */}
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 6, zIndex: 10 }}>
        <button onClick={() => { const r = autoCalculateModules(planner); setPlanner(p => ({ ...p, lowerModules: r.lower, upperModules: r.upper, lowerCount: r.lower.length, upperCount: r.upper.length })); setSelId(null); }}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #b8956c', background: 'linear-gradient(135deg,#b8956c,#d4b896)', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600, boxShadow: '0 2px 6px rgba(184,149,108,0.3)' }}>⚡ 자동계산</button>
        <button onClick={() => setPlanner(p => ({ ...p, distributorStart: p.distributorStart === 0 ? null : 0, distributorEnd: p.distributorEnd === 0 ? null : 0 }))}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #90caf9', background: planner.distributorStart !== 0 ? '#e3f2fd' : '#f5f5f5', color: planner.distributorStart !== 0 ? '#1565c0' : '#999', fontSize: 11, cursor: 'pointer' }}>💧 {planner.distributorStart !== 0 ? '분배기' : '분배기 (숨김)'}</button>
        {!preset.fullHeight && (
          <button onClick={() => setPlanner(p => ({ ...p, ventStart: p.ventStart === 0 ? null : 0 }))}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #b0bec5', background: planner.ventStart !== 0 ? '#eceff1' : '#f5f5f5', color: planner.ventStart !== 0 ? '#546e7a' : '#999', fontSize: 11, cursor: 'pointer' }}>🌀 {planner.ventStart !== 0 ? '환풍구' : '환풍구 (숨김)'}</button>
        )}
      </div>
    </div>
  );
}
