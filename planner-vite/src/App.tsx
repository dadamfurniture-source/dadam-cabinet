import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, PerspectiveCamera, Html, ContactShadows, Edges } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  MATERIALS, MODULE_DEFAULT_W, autoCalculateModules, genModuleId,
  type CabinetCategory, type MaterialTone, type ModuleEntry, type ModuleKind,
  createPlannerState, deriveCabinet, getPresetById, type PlannerState,
} from './lib/planner';

type CameraView = 'perspective' | 'front' | 'top';

// ═══ 파트 분류 — 모든 모듈 판별 로직 통합 ═══
const STRUCTURAL_PREFIXES = [
  'molding', 'toekick', 'finish-', 'install-space', 'countertop',
  'fridge-cavity', 'mirror', 'sec-inner-panel', 'corner-post', 'corner-floor', 'blind-panel',
  'filler-sec', 'molding-top-sec', 'countertop-sec',
];

interface PartClass {
  isModule: boolean;     // 클릭/드래그 가능한 모듈인가
  isStructural: boolean; // 구조물(몰딩/걸레받이 등)인가
  isUtility: boolean;    // 유틸리티(분배기/환풍구)인가
  isSecondary: boolean;  // 차선(90° 회전) 모듈인가
  isDraggable: boolean;  // 드래그 이동 가능한가
  isClickable: boolean;  // 클릭으로 팝업 열 수 있는가
  dragAxis: 'x' | 'z';  // 드래그 축 (주선=X, 차선=Z)
  moduleId: string;      // 모듈 조회용 ID (-face 제거)
}

function classifyPart(partId: string, rotationY?: number): PartClass {
  const isUtility = partId.startsWith('utility-');
  const isStructural = STRUCTURAL_PREFIXES.some(p => partId.startsWith(p));
  const isFace = partId.endsWith('-face');
  const isModule = !isStructural && !isUtility && !isFace;
  const isSecondary = !!rotationY;

  return {
    isModule,
    isStructural,
    isUtility,
    isSecondary,
    isDraggable: isModule,         // 모든 모듈 드래그 가능 (차선 포함)
    isClickable: isModule,         // 모든 모듈 클릭 가능
    dragAxis: isSecondary ? 'z' : 'x',
    moduleId: partId.replace(/-face$/, ''),
  };
}

// ═══ 타입별 색상 ═══
const TYPE_COLORS: Record<string, { body: string; face: string; outline: string; emissive: string }> = {
  sink: { body: '#b3d4e8', face: '#8ab8d4', outline: '#0284c7', emissive: '#0369a1' },
  cook: { body: '#e8b3b3', face: '#d48a8a', outline: '#dc2626', emissive: '#b91c1c' },
  hood: { body: '#c9b3e8', face: '#a88ad4', outline: '#7c3aed', emissive: '#6d28d9' },
  blind: { body: '#a8b5a0', face: '#8fa086', outline: '#4a6741', emissive: '#3d5636' },
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

// ═══ 3D 메쉬: 멍장 (blind corner) ═══
function BlindMesh({ w, h, d, color }: { w: number; h: number; d: number; color: string }) {
  return (
    <group>
      {/* 본체: 약간 어두운 톤으로 고정 패널 느낌 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.8} metalness={0.05} />
      </mesh>
      {/* X자 표시: 멍장 식별용 대각선 — 정면 패널 위에 렌더 */}
      <group position={[0, 0, d / 2 + 0.5]}>
        <mesh>
          <planeGeometry args={[w * 0.6, 2]} />
          <meshBasicMaterial color="#4a6741" transparent opacity={0.5} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <planeGeometry args={[h * 0.6, 2]} />
          <meshBasicMaterial color="#4a6741" transparent opacity={0.5} />
        </mesh>
      </group>
      <ModuleEdges w={w} h={h} d={d} color="#4a6741" />
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

// ═══ 모듈 컴포넌트 (드래그+클릭+타입별 렌더링) — classifyPart 통합 ═══
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
  const [dragPos, setDragPos] = useState<number | null>(null); // X 또는 Z 드래그 위치
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const dragOffset = useRef(0);

  // ═══ 통합 파트 분류 (classifyPart) ═══
  const cls = classifyPart(part.id, part.rotationY);

  const mType = part.moduleType;
  const tc = mType ? TYPE_COLORS[mType] : null;
  const baseColor = tc ? tc.body : color;

  // 드래그용 평면 교차 계산 — 주선(X축)/차선(Z축) 통합
  const getDragValue = (e: { ray: THREE.Ray }): number => {
    if (cls.dragAxis === 'z') {
      // 차선 모듈: X 평면에서 Z값 추출
      const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -part.x);
      const v = new THREE.Vector3();
      e.ray.intersectPlane(plane, v);
      return v.z;
    }
    // 주선 모듈: Z 평면에서 X값 추출
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -part.z);
    const v = new THREE.Vector3();
    e.ray.intersectPlane(plane, v);
    return v.x;
  };

  const dragOrigin = cls.dragAxis === 'z' ? part.z : part.x;
  const shiftOffset = shiftDir ? (shiftDir === 'left' ? -40 : 40) : 0;
  const posX = cls.dragAxis === 'x' ? ((dragPos ?? part.x) + shiftOffset) : part.x;
  const posZ = cls.dragAxis === 'z' ? (dragPos ?? part.z) : part.z;

  // 타입별 메쉬 선택 (통합 렌더러)
  const renderInner = () => {
    const w = part.width, h = part.height, d = part.depth;
    // 구조물: 단순 박스 렌더 (상판/몰딩/걸레받이/마감재 등)
    if (cls.isStructural || cls.isUtility) {
      const isWire = !!(part as any).wireframe;
      return (
        <mesh castShadow={!isWire} receiveShadow={!isWire}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={baseColor} wireframe={isWire} transparent={isWire} opacity={isWire ? 0.3 : 1} roughness={0.7} />
        </mesh>
      );
    }
    // 모듈: 타입별 전용 메쉬
    if (mType === 'blind') return <BlindMesh w={w} h={h} d={d} color={baseColor} />;
    if (mType === 'sink') return <SinkMesh w={w} h={h} d={d} color={baseColor} />;
    if (mType === 'cook') return <CookMesh w={w} h={h} d={d} color={baseColor} />;
    if (mType === 'hood') return <HoodMesh w={w} h={h} d={d} color={baseColor} />;
    if (part.moduleKind === 'drawer') return <DrawerMesh w={w} h={h} d={d} color={baseColor} drawerCount={part.drawerCount || 3} />;
    return <DoorMesh w={w} h={h} d={d} color={baseColor} doorCount={part.doorCount || 1} />;
  };

  // 구조물/유틸리티: 단순 렌더만 (인터랙션 없음)
  if (!cls.isModule) {
    return (
      <group position={[part.x, part.y, part.z]}>
        {renderInner()}
      </group>
    );
  }

  // ═══ 통합 드래그/클릭 핸들러 ═══
  const handlePointerDown = cls.isDraggable ? (e: any) => {
    e.stopPropagation();
    dragging.current = true; didDrag.current = false;
    dragOffset.current = getDragValue(e) - dragOrigin;
    (e.target as any).setPointerCapture(e.pointerId);
    if (controlsRef.current) controlsRef.current.enabled = false;
  } : undefined;

  const handlePointerUp = cls.isDraggable ? (e: any) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as any).releasePointerCapture(e.pointerId);
    if (controlsRef.current) controlsRef.current.enabled = true;
    onDragMove(null, null);
    if (didDrag.current) { onDragDone(cls.moduleId, dragPos ?? dragOrigin); setDragPos(null); }
    else { e.stopPropagation(); onSelect(cls.moduleId); }
  } : undefined;

  const handlePointerMove = cls.isDraggable ? (e: any) => {
    if (!dragging.current) return;
    didDrag.current = true;
    const nv = Math.max(-halfW * 2, Math.min(halfW * 2, getDragValue(e) - dragOffset.current));
    setDragPos(nv);
    onDragMove(cls.moduleId, nv);
  } : undefined;

  const handleClick = (!cls.isDraggable && cls.isClickable) ? (e: any) => { e.stopPropagation(); onSelect(cls.moduleId); } : undefined;

  const handlePointerOver = cls.isClickable ? () => setHovered(true) : undefined;
  const handlePointerOut = cls.isClickable ? () => {
    setHovered(false);
    if (dragging.current) {
      dragging.current = false;
      if (controlsRef.current) controlsRef.current.enabled = true;
      onDragMove(null, null);
      if (didDrag.current) { onDragDone(cls.moduleId, dragPos ?? dragOrigin); }
      setDragPos(null);
    }
  } : undefined;

  return (
    <group position={[posX, part.y, posZ]} rotation={cls.isSecondary ? [0, part.rotationY!, 0] : undefined}>
      {/* 히트박스 (투명) — 모든 모듈 공통 */}
      <mesh
        position={cls.isSecondary ? [0, 0, 0] : [0, 0, part.depth / 2]}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <boxGeometry args={[part.width, part.height, cls.isSecondary ? part.depth : 1]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 타입별 3D 메쉬 */}
      <group scale={hovered ? [1.005, 1.005, 1.005] : [1, 1, 1]}>
        {renderInner()}
      </group>

      {/* 필수장 윤곽선 제거됨 — 타입별 색상으로 충분히 구분 */}

      {/* 이동 방향 인디케이터 — 박스 외곽선 + 화살표 라벨 */}
      {shiftDir && (
        <>
          {/* 강조 외곽선 (모듈 본체 래핑) */}
          <mesh position={[0, 0, part.depth / 2]}>
            <boxGeometry args={[part.width + 8, part.height + 8, part.depth + 8]} />
            <meshBasicMaterial transparent opacity={0.12} color="#f59e0b" depthWrite={false} />
            <Edges color="#f59e0b" linewidth={3} threshold={15} />
          </mesh>
          {/* 이동 방향 화살표 Html 라벨 */}
          <Html position={[0, part.height / 2 + 40, part.depth / 2 + 20]} center style={{ pointerEvents: 'none' }} zIndexRange={[100, 99]}>
            <div style={{ background: '#f59e0b', color: '#fff', padding: '4px 10px', borderRadius: 999, fontSize: 14, fontWeight: 700, boxShadow: '0 2px 8px rgba(245,158,11,0.5)', whiteSpace: 'nowrap' }}>
              {shiftDir === 'left' ? '← 이동' : '이동 →'}
            </div>
          </Html>
        </>
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

function AddSide({ position, h, d, color, onClick, rotationY }: { position: [number, number, number]; h: number; d: number; color: string; onClick: () => void; rotationY?: number }) {
  const [hov, setHov] = useState(false);
  return (
    <group position={position} rotation={rotationY ? [0, rotationY, 0] : undefined}>
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
function ModulePopup({ mod, section, secondaryFillerW, onUpdate, onDelete, onClose, onBlindPanel, onUpdateFiller }: {
  mod: ModuleEntry; section: 'lower' | 'upper';
  secondaryFillerW: number;
  onUpdate: (id: string, c: Partial<ModuleEntry>) => void;
  onDelete: (id: string) => void; onClose: () => void;
  onBlindPanel: (modId: string, blindW: number) => void;
  onUpdateFiller: (w: number) => void;
}) {
  const [blindW, setBlindW] = useState(section === 'upper' ? '340' : '600');
  const [fillerW, setFillerW] = useState(String(secondaryFillerW));
  const fillerWNum = Math.max(0, Math.min(200, Number(fillerW) || 0));
  const isSec = mod.orientation === 'secondary';
  const sc = section === 'upper' ? '#6366f1' : '#b8956c';
  const kinds: { value: ModuleKind; label: string; icon: string }[] = [
    { value: 'door', label: '도어', icon: '🚪' }, { value: 'drawer', label: '서랍', icon: '🗄️' }, { value: 'open', label: '오픈', icon: '📦' },
  ];
  const blindWDefault = section === 'upper' ? 340 : 600;
  const blindWNum = Math.max(30, Math.min(1200, Number(blindW) || blindWDefault));
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

      {/* 차선모듈(Secondary Line Module) 섹션 — 멍장을 통해 추가 */}
      {!isSec && (
        <div style={{ marginBottom: 14, padding: '12px 14px', border: '1px solid #e0d6c8', borderRadius: 10, background: '#faf7f2' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>차선모듈 추가 (멍장 경유)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>멍 너비 (mm)</div>
              <input type="number" value={blindW} step={10} min={30} max={1200}
                onChange={e => setBlindW(e.target.value)}
                onBlur={() => setBlindW(String(blindWNum))}
                style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: 6, fontSize: 13, fontWeight: 600, boxSizing: 'border-box' }} />
            </div>
            <button onClick={() => { onBlindPanel(mod.id, blindWNum); onClose(); }}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #b8956c', background: 'linear-gradient(135deg,#b8956c,#d4b896)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
              차선모듈 추가
            </button>
          </div>
        </div>
      )}

      {/* 차선모듈 ㄱ자 마감재 (휠라) — 차선 모듈 선택 시 */}
      {isSec && (
        <div style={{ marginBottom: 14, padding: '12px 14px', border: '1px solid #e0d6c8', borderRadius: 10, background: '#faf7f2' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>ㄱ자 마감재 (휠라)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>자유단 휠라 폭 (mm)</div>
              <input type="number" value={fillerW} step={10} min={0} max={200}
                onChange={e => setFillerW(e.target.value)}
                onBlur={() => { setFillerW(String(fillerWNum)); onUpdateFiller(fillerWNum); }}
                style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: 6, fontSize: 13, fontWeight: 600, boxSizing: 'border-box' }} />
            </div>
            <button onClick={() => onUpdateFiller(fillerWNum)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #b8956c', background: 'linear-gradient(135deg,#b8956c,#d4b896)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
              적용
            </button>
          </div>
        </div>
      )}

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
    if (params.get('secondaryFillerW')) s.secondaryFillerW = Number(params.get('secondaryFillerW'));
    // 유틸리티 (분배기/환풍구)
    if (params.get('distStart')) s.distributorStart = Number(params.get('distStart'));
    if (params.get('distEnd')) s.distributorEnd = Number(params.get('distEnd'));
    if (params.get('ventStart')) s.ventStart = Number(params.get('ventStart'));
    return s;
  });
  const hitlMode = params.get('mode') === 'hitl';
  const [view, setView] = useState<CameraView>((params.get('view') as CameraView) || 'perspective');
  const [selId, setSelId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ id: string; x: number } | null>(null);
  const [blindPanel, setBlindPanel] = useState<{ modId: string; blindW: number } | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const derived = useMemo(() => {
    const d = deriveCabinet(planner);
    const secParts = d.parts.filter(p => p.rotationY);
    const secMods = [...(planner.lowerModules ?? []), ...(planner.upperModules ?? [])].filter(m => m.orientation === 'secondary' || m.orientation === 'tertiary');
    if (secMods.length > 0) {
      console.log('[CornerDebug:planner-vite] secondary/tertiary 모듈 입력:', secMods.map(m => `${m.id}:${m.width}:${m.orientation}`));
      console.log('[CornerDebug:planner-vite] rotationY 파트:', secParts.map(p => `${p.id}:x=${Math.round(p.x)},z=${Math.round(p.z)},rotY=${p.rotationY?.toFixed(2)}`));
      console.log('[CornerDebug:planner-vite] secondaryStartSide:', planner.secondaryStartSide);
      console.log('[CornerDebug:planner-vite] 전체 파트 수:', d.parts.length, '모듈 수:', d.modules.length);
    }
    return d;
  }, [planner]);
  const palette = MATERIALS[planner.material];
  const preset = getPresetById(planner.presetId);

  // postMessage 통신
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.data?.type === 'UPDATE_PLANNER') setPlanner(p => ({ ...p, ...e.data.payload }));
      if (e.data?.type === 'SET_CAMERA_VIEW') setView(e.data.view);
      if (e.data?.type === 'LOAD_HITL_CASE' && e.data.payload) setPlanner(e.data.payload as PlannerState);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);

  useEffect(() => {
    window.parent?.postMessage({ type: 'PLANNER_STATE', payload: { planner, derived } }, '*');
    if (hitlMode) {
      window.parent?.postMessage({ type: 'HITL_STATE', payload: { planner, derived } }, '*');
    }
  }, [planner, derived, hitlMode]);

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

  // 멍장을 통한 차선모듈(Secondary Line Module) 추가 핸들러
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
      // 차선모듈: 멍장을 통해 정면(Z축) 방향으로 돌출 배치 (ㄱ자형)
      const secondaryMod: ModuleEntry = {
        id: genModuleId(),
        kind: 'door',
        width: blindW,
        orientation: 'secondary',
        blindAnchorId: modId,
      };
      // 주선(앵커) 모듈 바로 뒤에 삽입 (차선모듈은 X cursor 안 먹음)
      list.splice(idx + 1, 0, secondaryMod);
      return { ...p, [key]: list, [`${key === 'lowerModules' ? 'lower' : 'upper'}Count`]: list.length };
    });
    setBlindPanel(null);
  }, [blindPanel]);

  const cancelBlindPanel = useCallback(() => setBlindPanel(null), []);

  // 차선모듈 체인 연장: 기존 차선모듈 뒤에 같은 blindAnchorId로 새 차선모듈 추가
  const addSecondaryToChain = useCallback((chainEndModId: string) => {
    setPlanner(p => {
      const isUp = (p.upperModules ?? []).some(m => m.id === chainEndModId);
      const key = isUp ? 'upperModules' : 'lowerModules';
      const list = [...(p[key] as ModuleEntry[] ?? [])];
      const idx = list.findIndex(m => m.id === chainEndModId);
      if (idx < 0) return p;
      const target = list[idx];
      if (target.orientation !== 'secondary') return p;
      const newMod: ModuleEntry = {
        id: genModuleId(),
        kind: 'door',
        width: target.width, // 이전 차선모듈과 같은 Z 돌출 폭으로 기본값
        orientation: 'secondary',
        blindAnchorId: target.blindAnchorId,
      };
      list.splice(idx + 1, 0, newMod);
      return { ...p, [key]: list, [`${key === 'lowerModules' ? 'lower' : 'upper'}Count`]: list.length };
    });
  }, []);

  // 차선 체인의 마지막 모듈 ID 집합 (다음 엔트리가 secondary가 아니면 체인 끝)
  const secondaryChainEnds = useMemo(() => {
    const ends = new Set<string>();
    const scan = (list: ModuleEntry[] | undefined) => {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        if (list[i].orientation === 'secondary' && (i === list.length - 1 || list[i + 1].orientation !== 'secondary')) {
          ends.add(list[i].id);
        }
      }
    };
    scan(planner.lowerModules);
    scan(planner.upperModules);
    return ends;
  }, [planner.lowerModules, planner.upperModules]);

  // 모듈 드래그 → 순서 재정렬 (앵커 주선 + 부속 차선 체인을 ㄱ자 단위로 함께 이동)
  const dragModule = useCallback((id: string, newX: number) => {
    setPlanner(p => {
      const halfW = p.width / 2;
      const targetMm = Math.max(0, Math.min(p.width, newX + halfW));
      const isUp = (p.upperModules ?? []).some(m => m.id === id);
      const key = isUp ? 'upperModules' : 'lowerModules';
      const list = [...(p[key] as ModuleEntry[] ?? [])];
      const idx = list.findIndex(m => m.id === id);
      if (idx < 0 || list[idx].orientation === 'secondary') return p; // 차선모듈은 드래그 불가

      // 앵커 + 뒤따르는 차선 체인을 하나의 그룹으로 묶어서 이동
      let groupEnd = idx;
      while (groupEnd + 1 < list.length && list[groupEnd + 1].orientation === 'secondary') groupEnd++;
      const group = list.splice(idx, groupEnd - idx + 1);

      // 삽입 위치 계산 — 주선(non-secondary) 모듈만 X cursor에 기여
      let ins = list.length;
      let cursor = p.finishLeftW ?? 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i].orientation === 'secondary') continue;
        if (targetMm < cursor + list[i].width / 2) { ins = i; break; }
        cursor += list[i].width;
      }
      list.splice(ins, 0, ...group);
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

  // shiftMap 계산 — 차선모듈은 X cursor/정렬에서 제외 (앵커와 함께 이동)
  const shiftMap = useMemo<Record<string, 'left' | 'right'>>(() => {
    if (!dragState) return {};
    const halfW = planner.width / 2;
    const targetMm = Math.max(0, Math.min(planner.width, dragState.x + halfW));
    const isUp = (planner.upperModules ?? []).some(m => m.id === dragState.id);
    const list = isUp ? (planner.upperModules ?? []) : (planner.lowerModules ?? []);
    const mainOnly = list.filter(m => m.orientation !== 'secondary');
    const dragIdx = mainOnly.findIndex(m => m.id === dragState.id);
    if (dragIdx < 0) return {};
    const fL = planner.finishLeftW ?? 0;
    let c = fL;
    const centers: { id: string; cx: number }[] = [];
    mainOnly.forEach(m => { centers.push({ id: m.id, cx: c + m.width / 2 }); c += m.width; });
    const without = centers.filter(x => x.id !== dragState.id);
    let ins = without.length;
    for (let i = 0; i < without.length; i++) { if (targetMm < without[i].cx) { ins = i; break; } }
    const origPos = mainOnly.slice(0, dragIdx).filter(m => m.id !== dragState.id).length;
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

            {/* 차선모듈 추가 모드: 선택된 주선 모듈 정면에 +/✓ 버튼 */}
            {blindPanel && (() => {
              const bp = blindPanel;
              const mp = derived.parts.find(p => p.id === `mod-${bp.modId}` || p.id === bp.modId);
              if (!mp) return null;
              return (
                <Html position={[mp.x, mp.y, mp.z + mp.depth / 2 + 1]} center style={{ pointerEvents: 'auto' }} zIndexRange={[9999, 9998]}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button onClick={confirmBlindPanel}
                      style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #22c55e', background: 'rgba(255,255,255,0.95)', color: '#22c55e', fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontWeight: 700 }}
                      title="차선모듈 생성 확인">+</button>
                    <button onClick={cancelBlindPanel}
                      style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #ef4444', background: 'rgba(255,255,255,0.95)', color: '#ef4444', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontWeight: 700 }}
                      title="취소">✕</button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: '#666', textAlign: 'center', background: 'rgba(255,255,255,0.9)', padding: '2px 8px', borderRadius: 4 }}>
                    차선모듈 (멍장 {bp.blindW}mm)
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

            {/* 차선모듈 체인 연장 버튼 — 각 체인의 마지막 secondary의 Z축 자유단(free end) 측판에 부착 */}
            {!selId && Array.from(secondaryChainEnds).map(modId => {
              const part = derived.parts.find(p => p.id === modId);
              if (!part || !part.rotationY) return null;
              const isUp = (planner.upperModules ?? []).some(m => m.id === modId);
              const total = ((planner.lowerModules ?? []).length + (planner.upperModules ?? []).length);
              if (total >= 20) return null;
              // part.width = 차선모듈의 월드 Z extent (= blindW), part.depth = 월드 X extent (= 600)
              const freeZ = part.z + part.width / 2 + 9;
              return (
                <AddSide
                  key={`sec-add-${modId}`}
                  position={[part.x, part.y, freeZ]}
                  h={part.height}
                  d={part.depth}
                  color={isUp ? palette.accent : palette.body}
                  onClick={() => addSecondaryToChain(modId)}
                  rotationY={-Math.PI / 2}
                />
              );
            })}
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
      {selMod && <ModulePopup mod={selMod} section={selSection} secondaryFillerW={planner.secondaryFillerW ?? 60} onUpdate={updateMod} onDelete={deleteMod} onClose={() => setSelId(null)} onBlindPanel={applyBlindPanel} onUpdateFiller={(w) => setPlanner(p => ({ ...p, secondaryFillerW: w }))} />}
      {selId === 'utility-distributor' && <UtilityPopup type="distributor" planner={planner} onUpdate={c => setPlanner(p => ({ ...p, ...c }))} onDelete={() => setPlanner(p => ({ ...p, distributorStart: 0, distributorEnd: 0 }))} onClose={() => setSelId(null)} />}
      {selId === 'utility-vent' && <UtilityPopup type="vent" planner={planner} onUpdate={c => setPlanner(p => ({ ...p, ...c }))} onDelete={() => setPlanner(p => ({ ...p, ventStart: 0 }))} onClose={() => setSelId(null)} />}

      {/* 툴바는 부모 페이지(ui-step1.js) 자동계산 바에 통합됨 */}
    </div>
  );
}
