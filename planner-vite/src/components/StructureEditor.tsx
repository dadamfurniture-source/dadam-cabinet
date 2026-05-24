// ═══════════════════════════════════════════════════════════════
// StructureEditor.tsx — W6-4 Step 2 모듈 구조 배치 (section: lower/upper/tall)
//
// 사용자가 segment 를 선택하고 그 안에 모듈을 lower/upper/tall 분류로 배치.
// 자동 분배 (segment.width / N) + 수동 ±/삭제/너비 편집 + tall 추가 시 lower/upper 충돌 확인.
//
// Props:
//   - segments: Step 1 결과
//   - modulesV2: 현재 모듈 배열
//   - onChange: 모듈 변경 콜백
//   - onNext / onBack: 단계 이동
//   - defaultKind: preset.fullHeight 기반 기본 kind 결정용
// ═══════════════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import type {
  CabinetSegment,
  ModuleEntryV2,
  ModuleKind,
  ModuleSectionV2,
} from '../lib/planner';
import { segmentBounds } from './SegmentEditor';

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const SECTIONS: readonly ModuleSectionV2[] = ['lower', 'upper', 'tall'];
const SECTION_LABELS: Record<ModuleSectionV2, string> = {
  lower: '하부장',
  upper: '상부장',
  tall: '키큰장',
};
const SECTION_COLORS: Record<ModuleSectionV2, string> = {
  lower: '#b8956c',
  upper: '#7c9c8f',
  tall: '#9c6e7c',
};
const KIND_LABELS: Record<ModuleKind, string> = {
  door: '도어',
  drawer: '서랍',
  open: '오픈',
};
const MIN_MODULE_W = 300;
const MAX_MODULE_W = 1200;
const SNAP = 50;
const TOP_VIEW_SIZE = 240; // Top inset SVG

let moduleIdCounter = 0;
const genV2Id = (): string => {
  moduleIdCounter += 1;
  return `m2-${Date.now().toString(36)}-${moduleIdCounter}`;
};

// ─────────────────────────────────────────────────────────────
// 자동 분배 (W6-4 단순 균등)
// ─────────────────────────────────────────────────────────────

/**
 * segment 폭을 N 등분하여 균등 모듈 배열 생성.
 * preset 별 sink/cook/hood 고정 배치는 별 cycle (지금은 단순 균등).
 */
export const autoDistributeModules = (
  segmentId: string,
  section: ModuleSectionV2,
  segmentWidth: number,
  desiredCount: number,
  defaultKind: ModuleKind = 'door'
): ModuleEntryV2[] => {
  const n = Math.max(1, desiredCount);
  const raw = segmentWidth / n;
  const snapped = Math.max(MIN_MODULE_W, Math.min(MAX_MODULE_W, Math.round(raw / SNAP) * SNAP));
  return Array.from({ length: n }, () => ({
    id: genV2Id(),
    segmentId,
    section,
    kind: defaultKind,
    width: snapped,
  }));
};

// ─────────────────────────────────────────────────────────────
// section 별 그룹핑
// ─────────────────────────────────────────────────────────────

export const groupBySection = (
  modules: ModuleEntryV2[],
  segmentId: string
): Record<ModuleSectionV2, ModuleEntryV2[]> => ({
  lower: modules.filter((m) => m.segmentId === segmentId && m.section === 'lower'),
  upper: modules.filter((m) => m.segmentId === segmentId && m.section === 'upper'),
  tall: modules.filter((m) => m.segmentId === segmentId && m.section === 'tall'),
});

// ─────────────────────────────────────────────────────────────
// Props + 컴포넌트
// ─────────────────────────────────────────────────────────────

export interface StructureEditorProps {
  segments: CabinetSegment[];
  modulesV2: ModuleEntryV2[];
  onChange: (modules: ModuleEntryV2[]) => void;
  onNext?: () => void;
  onBack?: () => void;
  defaultKind?: ModuleKind;
}

export function StructureEditor({
  segments,
  modulesV2,
  onChange,
  onNext,
  onBack,
  defaultKind = 'door',
}: StructureEditorProps) {
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(
    segments[0]?.id ?? null
  );

  const activeSegment = segments.find((s) => s.id === activeSegmentId) ?? null;
  const segmentModules = useMemo(
    () => (activeSegment ? groupBySection(modulesV2, activeSegment.id) : null),
    [modulesV2, activeSegment]
  );

  // ── 액션 ─────────────────────────────────────────────────────
  const addModule = useCallback(
    (segmentId: string, section: ModuleSectionV2) => {
      const newMod: ModuleEntryV2 = {
        id: genV2Id(),
        segmentId,
        section,
        kind: section === 'upper' ? 'door' : defaultKind,
        width: 600,
      };
      // tall 추가 시 같은 segment 의 lower/upper 모듈 자동 제거 (확인 다이얼로그)
      if (section === 'tall') {
        const hasConflict = modulesV2.some(
          (m) => m.segmentId === segmentId && (m.section === 'lower' || m.section === 'upper')
        );
        if (hasConflict) {
          const ok = window.confirm(
            '키큰장(tall) 은 동일 segment 의 하부장/상부장과 공존할 수 없습니다.\n' +
            '기존 하부장/상부장을 제거하고 키큰장을 추가하시겠습니까?'
          );
          if (!ok) return;
          const filtered = modulesV2.filter(
            (m) => !(m.segmentId === segmentId && (m.section === 'lower' || m.section === 'upper'))
          );
          onChange([...filtered, newMod]);
          return;
        }
      }
      onChange([...modulesV2, newMod]);
    },
    [modulesV2, onChange, defaultKind]
  );

  const updateModule = useCallback(
    (id: string, patch: Partial<ModuleEntryV2>) => {
      onChange(modulesV2.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    },
    [modulesV2, onChange]
  );

  const removeModule = useCallback(
    (id: string) => {
      onChange(modulesV2.filter((m) => m.id !== id));
    },
    [modulesV2, onChange]
  );

  const autoDistribute = useCallback(
    (section: ModuleSectionV2, count: number) => {
      if (!activeSegment) return;
      // 기존 동일 (segmentId, section) 모듈 제거 + 균등 분배 신규 추가
      const others = modulesV2.filter(
        (m) => !(m.segmentId === activeSegment.id && m.section === section)
      );
      const fresh = autoDistributeModules(
        activeSegment.id,
        section,
        activeSegment.width,
        count,
        defaultKind
      );
      // tall 추가 시 lower/upper 동시 제거
      if (section === 'tall') {
        const cleaned = others.filter(
          (m) => !(m.segmentId === activeSegment.id && (m.section === 'lower' || m.section === 'upper'))
        );
        onChange([...cleaned, ...fresh]);
      } else {
        onChange([...others, ...fresh]);
      }
    },
    [activeSegment, modulesV2, onChange, defaultKind]
  );

  // ── 렌더링 ───────────────────────────────────────────────────
  return (
    <div data-testid="structure-editor" style={styles.root}>
      {/* 좌측: segment 선택 (Top inset) */}
      <aside style={styles.leftPanel}>
        <header style={styles.panelHeader}>
          <h3 style={styles.panelTitle}>segment 선택</h3>
        </header>
        <SegmentMiniMap
          segments={segments}
          activeId={activeSegmentId}
          onSelect={setActiveSegmentId}
        />
        <ul style={styles.segmentList}>
          {segments.map((seg) => (
            <li key={seg.id}>
              <button
                type="button"
                onClick={() => setActiveSegmentId(seg.id)}
                style={{
                  ...styles.segmentItemBtn,
                  ...(seg.id === activeSegmentId ? styles.segmentItemBtnSelected : {}),
                }}
                data-testid={`select-seg-${seg.id}`}
              >
                <strong>{seg.label ?? seg.id}</strong>
                <span style={styles.segmentItemMeta}>
                  {seg.width}×{seg.depth}mm
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* 우측: section 별 모듈 편집 */}
      <main style={styles.rightPanel}>
        <header style={styles.panelHeader}>
          <h3 style={styles.panelTitle}>Step 2 · 구조 배치</h3>
          <p style={styles.panelHint}>
            활성 segment 안에 하부장/상부장/키큰장 모듈 배치
            {activeSegment && ` (${activeSegment.label ?? activeSegment.id}, ${activeSegment.width}mm)`}
          </p>
        </header>

        {!activeSegment && <p style={styles.empty}>segment 를 먼저 선택하세요.</p>}

        {activeSegment && segmentModules && (
          <div style={styles.sectionsGrid}>
            {SECTIONS.map((section) => (
              <SectionBlock
                key={section}
                section={section}
                modules={segmentModules[section]}
                segmentWidth={activeSegment.width}
                onAdd={() => addModule(activeSegment.id, section)}
                onUpdate={updateModule}
                onRemove={removeModule}
                onAutoDistribute={(count) => autoDistribute(section, count)}
              />
            ))}
          </div>
        )}

        <footer style={styles.footer}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn} data-testid="back-step">
              ← 배치로
            </button>
          )}
          {onNext && (
            <button type="button" onClick={onNext} style={styles.nextBtn} data-testid="next-step">
              디테일 →
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 하위 컴포넌트 — SegmentMiniMap
// ─────────────────────────────────────────────────────────────

function SegmentMiniMap({
  segments,
  activeId,
  onSelect,
}: {
  segments: CabinetSegment[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  // 모든 segment AABB 합 → viewBox
  const bounds = useMemo(() => {
    if (segments.length === 0) return { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
    const all = segments.map(segmentBounds);
    const pad = 200;
    return {
      minX: Math.min(...all.map((b) => b.minX)) - pad,
      maxX: Math.max(...all.map((b) => b.maxX)) + pad,
      minY: Math.min(...all.map((b) => b.minY)) - pad,
      maxY: Math.max(...all.map((b) => b.maxY)) + pad,
    };
  }, [segments]);
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;

  return (
    <svg
      viewBox={`${bounds.minX} ${-bounds.maxY} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      width={TOP_VIEW_SIZE}
      height={TOP_VIEW_SIZE}
      style={styles.miniMap}
    >
      <g transform="scale(1, -1)">
        {segments.map((seg) => (
          <g
            key={seg.id}
            transform={`translate(${seg.x}, ${seg.y}) rotate(${seg.rotationDeg})`}
            onClick={() => onSelect(seg.id)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={0}
              y={0}
              width={seg.width}
              height={seg.depth}
              fill={seg.id === activeId ? '#b8956c' : '#e8dfd0'}
              stroke="#6a4b2a"
              strokeWidth={20}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// 하위 컴포넌트 — SectionBlock
// ─────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  modules,
  segmentWidth,
  onAdd,
  onUpdate,
  onRemove,
  onAutoDistribute,
}: {
  section: ModuleSectionV2;
  modules: ModuleEntryV2[];
  segmentWidth: number;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ModuleEntryV2>) => void;
  onRemove: (id: string) => void;
  onAutoDistribute: (count: number) => void;
}) {
  const totalW = modules.reduce((s, m) => s + m.width, 0);
  const overflow = totalW > segmentWidth;

  return (
    <section
      style={{
        ...styles.sectionBlock,
        borderColor: SECTION_COLORS[section],
      }}
      data-testid={`section-block-${section}`}
    >
      <header style={styles.sectionHeader}>
        <h4 style={{ ...styles.sectionTitle, color: SECTION_COLORS[section] }}>
          {SECTION_LABELS[section]} ({modules.length})
        </h4>
        <div style={styles.sectionActions}>
          <button
            type="button"
            onClick={() => onAutoDistribute(Math.max(1, Math.round(segmentWidth / 600)))}
            style={styles.autoBtn}
            title="segment 가로 / 600mm 으로 균등 분배"
            data-testid={`auto-${section}`}
          >
            자동 배치
          </button>
          <button type="button" onClick={onAdd} style={styles.addBtn} data-testid={`add-${section}`}>
            + 추가
          </button>
        </div>
      </header>

      {modules.length === 0 && <p style={styles.emptyHint}>모듈 없음. + 추가 또는 자동 배치 클릭.</p>}

      <ul style={styles.modList}>
        {modules.map((m, idx) => (
          <li key={m.id} style={styles.modItem}>
            <span style={styles.modIndex}>{idx + 1}</span>
            <input
              type="number"
              value={m.width}
              step={SNAP}
              min={MIN_MODULE_W}
              max={MAX_MODULE_W}
              onChange={(e) => onUpdate(m.id, { width: Number(e.target.value) || MIN_MODULE_W })}
              style={styles.modInput}
              data-testid={`mod-width-${m.id}`}
            />
            <span style={styles.modUnit}>mm</span>
            <select
              value={m.kind}
              onChange={(e) => onUpdate(m.id, { kind: e.target.value as ModuleKind })}
              style={styles.modSelect}
              data-testid={`mod-kind-${m.id}`}
            >
              {(Object.keys(KIND_LABELS) as ModuleKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onRemove(m.id)}
              style={styles.modRemoveBtn}
              aria-label="삭제"
              data-testid={`mod-remove-${m.id}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {modules.length > 0 && (
        <p style={{ ...styles.totalLine, color: overflow ? '#c95d5d' : '#7a7062' }}>
          합계 {totalW}mm / 가용 {segmentWidth}mm {overflow && '⚠ 초과'}
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 인라인 스타일
// ─────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    background: '#fbfaf6',
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  leftPanel: {
    flex: '0 0 220px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  rightPanel: {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflow: 'hidden',
  },
  panelHeader: {},
  panelTitle: { margin: 0, fontSize: 16, color: '#6a4b2a' },
  panelHint: { margin: '4px 0 0', fontSize: 12, color: '#7a7062' },
  miniMap: {
    background: '#fff',
    border: '1px solid #e5e0d4',
    borderRadius: 8,
  },
  segmentList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    overflowY: 'auto',
  },
  segmentItemBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
    padding: '8px 10px',
    background: '#fff',
    border: '1px solid #e5e0d4',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left',
  },
  segmentItemBtnSelected: {
    background: '#f3ead9',
    borderColor: '#b8956c',
  },
  segmentItemMeta: {
    fontSize: 11,
    color: '#7a7062',
    marginTop: 2,
  },
  empty: {
    margin: '20px auto',
    color: '#7a7062',
    fontStyle: 'italic',
  },
  sectionsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },
  sectionBlock: {
    background: '#fff',
    borderRadius: 8,
    border: '2px solid',
    padding: 12,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 14,
  },
  sectionActions: {
    display: 'flex',
    gap: 6,
  },
  autoBtn: {
    padding: '4px 10px',
    background: '#f3ead9',
    border: '1px solid #b8956c',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    color: '#6a4b2a',
  },
  addBtn: {
    padding: '4px 10px',
    background: '#6a4b2a',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
  },
  emptyHint: {
    margin: '8px 0',
    fontSize: 11,
    color: '#a89c84',
    fontStyle: 'italic',
  },
  modList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  modItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 6px',
    background: '#fbfaf6',
    borderRadius: 4,
  },
  modIndex: {
    fontSize: 11,
    color: '#a89c84',
    fontWeight: 600,
    width: 18,
  },
  modInput: {
    flex: '0 0 70px',
    padding: '2px 4px',
    border: '1px solid #d9d2bf',
    borderRadius: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  modUnit: {
    fontSize: 10,
    color: '#7a7062',
  },
  modSelect: {
    flex: '0 0 70px',
    padding: '2px 4px',
    border: '1px solid #d9d2bf',
    borderRadius: 3,
    fontSize: 11,
  },
  modRemoveBtn: {
    marginLeft: 'auto',
    padding: '2px 6px',
    background: 'transparent',
    border: '1px solid #c95d5d',
    color: '#c95d5d',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
  },
  totalLine: {
    margin: '8px 0 0',
    fontSize: 11,
    textAlign: 'right',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 8,
    borderTop: '1px solid #e5e0d4',
  },
  backBtn: {
    padding: '10px 16px',
    background: '#fff',
    border: '1px solid #b8956c',
    color: '#6a4b2a',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  },
  nextBtn: {
    padding: '10px 16px',
    background: '#4a7c4f',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
};
