// ═══════════════════════════════════════════════════════════════
// ModuleDetailPanel.tsx — W6-5 Step 3 모듈별 디테일 편집
//
// 좌측: segment 별 모듈 목록 (lower/upper/tall 그룹)
// 우측: 선택 모듈의 디테일 (높이/도어/서랍/색상/재질)
//
// 기존 ModulePopup (App.tsx L413) 은 legacy ModuleEntry 전용으로 유지.
// W6-5 는 V2 ModuleEntryV2 전용 신규 컴포넌트 — 같은 코드 베이스 안 분리.
// ═══════════════════════════════════════════════════════════════

import { useState, useMemo, useCallback } from 'react';
import type {
  CabinetSegment,
  ModuleEntryV2,
  ModuleKind,
  ModuleSectionV2,
} from '../lib/planner';

// ─────────────────────────────────────────────────────────────
// 카탈로그 (BOM 자재 코드 매핑은 별 cycle)
// ─────────────────────────────────────────────────────────────

export const DOOR_FINISH_OPTIONS = [
  { value: 'pet-matte', label: 'PET 매트' },
  { value: 'pet-gloss', label: 'PET 광택' },
  { value: 'mfb', label: 'MFB 멜라민' },
  { value: 'lpm', label: 'LPM 라미네이트' },
  { value: 'paint-matte', label: '도장 무광' },
  { value: 'paint-gloss', label: '도장 유광' },
  { value: 'veneer', label: '무늬목' },
];

export const DOOR_COLOR_OPTIONS = [
  { value: 'cream', label: '크림' },
  { value: 'oak', label: '오크' },
  { value: 'walnut', label: '월넛' },
  { value: 'graphite', label: '그라파이트' },
  { value: 'white', label: '화이트' },
  { value: 'black', label: '블랙' },
  { value: 'sage', label: '세이지' },
];

// section 기본 높이 (heightOverride 없을 때 표시용)
export const SECTION_DEFAULT_HEIGHT: Record<ModuleSectionV2, number> = {
  lower: 870,
  upper: 720,
  tall: 2310,
};

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

const MIN_HEIGHT = 200;
const MAX_HEIGHT = 2800;
const SNAP_HEIGHT = 10;

// ─────────────────────────────────────────────────────────────
// 디테일 완성도 계산 (UI 표시용)
// ─────────────────────────────────────────────────────────────

export const detailCompleteness = (m: ModuleEntryV2): number => {
  let filled = 0;
  let total = 4; // kind, width (이미 있음), doorFinish, doorColor
  if (m.kind) filled++;
  if (m.width > 0) filled++;
  if (m.doorFinish) filled++;
  if (m.doorColor) filled++;
  // heightOverride 는 optional (없으면 section 기본값)
  if (m.kind === 'drawer') { total++; if (m.drawerCount) filled++; }
  if (m.kind === 'door') { total++; if (m.doorCount) filled++; }
  return Math.round((filled / total) * 100);
};

// ─────────────────────────────────────────────────────────────
// Props + 컴포넌트
// ─────────────────────────────────────────────────────────────

export interface ModuleDetailPanelProps {
  segments: CabinetSegment[];
  modulesV2: ModuleEntryV2[];
  onChange: (modules: ModuleEntryV2[]) => void;
  onBack?: () => void;
  onDone?: () => void;
}

export function ModuleDetailPanel({
  segments,
  modulesV2,
  onChange,
  onBack,
  onDone,
}: ModuleDetailPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    modulesV2[0]?.id ?? null
  );

  const selected = useMemo(
    () => modulesV2.find((m) => m.id === selectedId) ?? null,
    [modulesV2, selectedId]
  );
  const selectedSegment = useMemo(
    () => (selected ? segments.find((s) => s.id === selected.segmentId) ?? null : null),
    [segments, selected]
  );

  const updateModule = useCallback(
    (id: string, patch: Partial<ModuleEntryV2>) => {
      onChange(modulesV2.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    },
    [modulesV2, onChange]
  );

  // segment + section 으로 그룹핑된 모듈 목록 (UI 사이드바)
  const grouped = useMemo(() => {
    const map = new Map<string, ModuleEntryV2[]>();
    for (const seg of segments) {
      for (const section of ['lower', 'upper', 'tall'] as ModuleSectionV2[]) {
        const list = modulesV2.filter((m) => m.segmentId === seg.id && m.section === section);
        if (list.length > 0) map.set(`${seg.id}::${section}`, list);
      }
    }
    return map;
  }, [segments, modulesV2]);

  return (
    <div data-testid="module-detail-panel" style={styles.root}>
      {/* 좌측: 모듈 list (segment+section 그룹) */}
      <aside style={styles.leftPanel}>
        <header style={styles.panelHeader}>
          <h3 style={styles.panelTitle}>모듈 선택</h3>
          <p style={styles.panelHint}>{modulesV2.length}개 모듈 · {segments.length}개 segment</p>
        </header>

        <div style={styles.groupedList}>
          {segments.length === 0 && (
            <p style={styles.empty}>segment 없음 — Step 1 으로 돌아가세요.</p>
          )}
          {segments.map((seg) =>
            (['lower', 'upper', 'tall'] as ModuleSectionV2[]).map((section) => {
              const list = grouped.get(`${seg.id}::${section}`);
              if (!list || list.length === 0) return null;
              return (
                <div key={`${seg.id}-${section}`} style={styles.groupBlock}>
                  <h4 style={{ ...styles.groupTitle, color: SECTION_COLORS[section] }}>
                    {seg.label ?? seg.id} · {SECTION_LABELS[section]}
                  </h4>
                  <ul style={styles.modList}>
                    {list.map((m, idx) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(m.id)}
                          style={{
                            ...styles.modItemBtn,
                            ...(m.id === selectedId ? styles.modItemBtnSelected : {}),
                          }}
                          data-testid={`select-mod-${m.id}`}
                        >
                          <span style={styles.modItemTitle}>
                            #{idx + 1} · {m.width}mm · {KIND_LABELS[m.kind]}
                          </span>
                          <CompletenessBar value={detailCompleteness(m)} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* 우측: 선택 모듈 디테일 */}
      <main style={styles.rightPanel}>
        <header style={styles.panelHeader}>
          <h3 style={styles.panelTitle}>Step 3 · 디테일</h3>
          <p style={styles.panelHint}>
            모듈별 높이/도어/서랍/색상/재질 설정
          </p>
        </header>

        {!selected && <p style={styles.empty}>모듈을 선택하세요.</p>}

        {selected && selectedSegment && (
          <div style={styles.detailForm}>
            <div style={styles.detailHeader}>
              <h4 style={styles.detailTitle}>
                {selectedSegment.label ?? selectedSegment.id} · {SECTION_LABELS[selected.section]} ·{' '}
                {selected.width}mm
              </h4>
              <span style={styles.detailMeta}>완성도 {detailCompleteness(selected)}%</span>
            </div>

            {/* 1. 기본 — kind / width / heightOverride */}
            <section style={styles.formSection}>
              <h5 style={styles.formSectionTitle}>기본</h5>

              <Field label="개구부 유형">
                <select
                  value={selected.kind}
                  onChange={(e) => updateModule(selected.id, { kind: e.target.value as ModuleKind })}
                  style={styles.select}
                  data-testid="kind-select"
                >
                  {(Object.keys(KIND_LABELS) as ModuleKind[]).map((k) => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </select>
              </Field>

              <Field label="가로 (mm)">
                <input
                  type="number"
                  value={selected.width}
                  min={300}
                  max={1200}
                  step={50}
                  onChange={(e) => updateModule(selected.id, { width: Number(e.target.value) || 0 })}
                  style={styles.input}
                  data-testid="width-input"
                />
              </Field>

              <Field label={`높이 (mm) · 기본 ${SECTION_DEFAULT_HEIGHT[selected.section]}`}>
                <input
                  type="number"
                  value={selected.heightOverride ?? SECTION_DEFAULT_HEIGHT[selected.section]}
                  min={MIN_HEIGHT}
                  max={MAX_HEIGHT}
                  step={SNAP_HEIGHT}
                  onChange={(e) => {
                    const v = Number(e.target.value) || SECTION_DEFAULT_HEIGHT[selected.section];
                    // 기본값과 일치하면 override 제거 (정보 노이즈 ↓)
                    const isDefault = v === SECTION_DEFAULT_HEIGHT[selected.section];
                    updateModule(selected.id, { heightOverride: isDefault ? undefined : v });
                  }}
                  style={styles.input}
                  data-testid="height-input"
                />
              </Field>
            </section>

            {/* 2. 도어/서랍 옵션 */}
            <section style={styles.formSection}>
              <h5 style={styles.formSectionTitle}>{KIND_LABELS[selected.kind]} 옵션</h5>

              {selected.kind === 'door' && (
                <Field label="도어 수">
                  <select
                    value={selected.doorCount ?? 1}
                    onChange={(e) => updateModule(selected.id, { doorCount: Number(e.target.value) })}
                    style={styles.select}
                    data-testid="door-count"
                  >
                    <option value={1}>1짝</option>
                    <option value={2}>2짝 (양개)</option>
                  </select>
                </Field>
              )}

              {selected.kind === 'drawer' && (
                <Field label="서랍 수">
                  <select
                    value={selected.drawerCount ?? 3}
                    onChange={(e) => updateModule(selected.id, { drawerCount: Number(e.target.value) })}
                    style={styles.select}
                    data-testid="drawer-count"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}단</option>
                    ))}
                  </select>
                </Field>
              )}

              {selected.kind === 'open' && (
                <p style={styles.hint}>오픈 모듈 — 도어/서랍 옵션 없음</p>
              )}
            </section>

            {/* 3. 재질/색상 */}
            <section style={styles.formSection}>
              <h5 style={styles.formSectionTitle}>재질 · 색상</h5>

              <Field label="도어 재질">
                <select
                  value={selected.doorFinish ?? ''}
                  onChange={(e) => updateModule(selected.id, { doorFinish: e.target.value || undefined })}
                  style={styles.select}
                  data-testid="door-finish"
                >
                  <option value="">— 선택 —</option>
                  {DOOR_FINISH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="도어 색상">
                <select
                  value={selected.doorColor ?? ''}
                  onChange={(e) => updateModule(selected.id, { doorColor: e.target.value || undefined })}
                  style={styles.select}
                  data-testid="door-color"
                >
                  <option value="">— 선택 —</option>
                  {DOOR_COLOR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
            </section>
          </div>
        )}

        <footer style={styles.footer}>
          {onBack && (
            <button type="button" onClick={onBack} style={styles.backBtn} data-testid="back-step">
              ← 구조 배치로
            </button>
          )}
          {onDone && (
            <button type="button" onClick={onDone} style={styles.doneBtn} data-testid="done-step">
              ✓ 완료
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 하위 컴포넌트
// ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function CompletenessBar({ value }: { value: number }) {
  const color = value === 100 ? '#4a7c4f' : value >= 60 ? '#b8956c' : '#a89c84';
  return (
    <span style={styles.completenessWrap} aria-label={`완성도 ${value}%`}>
      <span style={{ ...styles.completenessBar, width: `${value}%`, background: color }} />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    gap: 16,
    padding: 16,
    background: '#fbfaf6',
    border: '1px solid #d9d2bf',
    borderRadius: 12,
    height: '100%',
    overflow: 'hidden',
  },
  leftPanel: {
    flex: '0 0 280px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
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
  groupedList: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  empty: {
    margin: '20px auto',
    color: '#7a7062',
    fontStyle: 'italic',
    fontSize: 13,
  },
  groupBlock: {
    background: '#fff',
    borderRadius: 6,
    padding: 8,
    border: '1px solid #e5e0d4',
  },
  groupTitle: {
    margin: '0 0 6px',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  modItemBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
    padding: '6px 8px',
    background: '#fbfaf6',
    border: '1px solid #e5e0d4',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left',
    gap: 4,
  },
  modItemBtnSelected: {
    background: '#f3ead9',
    borderColor: '#b8956c',
  },
  modItemTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#3a3530',
  },
  completenessWrap: {
    display: 'block',
    width: '100%',
    height: 4,
    background: '#eae3d3',
    borderRadius: 2,
    overflow: 'hidden',
  },
  completenessBar: {
    display: 'block',
    height: '100%',
    transition: 'width 0.2s ease',
  },
  detailForm: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    paddingRight: 4,
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: 8,
    borderBottom: '1px solid #e5e0d4',
  },
  detailTitle: {
    margin: 0,
    fontSize: 14,
    color: '#6a4b2a',
  },
  detailMeta: {
    fontSize: 11,
    color: '#7a7062',
  },
  formSection: {
    background: '#fff',
    padding: 12,
    borderRadius: 6,
    border: '1px solid #e5e0d4',
  },
  formSectionTitle: {
    margin: '0 0 10px',
    fontSize: 12,
    fontWeight: 600,
    color: '#6a4b2a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  field: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '6px 0',
    fontSize: 13,
    color: '#3a3530',
  },
  fieldLabel: {
    fontSize: 12,
    color: '#5a5048',
  },
  input: {
    flex: '0 0 110px',
    padding: '4px 8px',
    border: '1px solid #d9d2bf',
    borderRadius: 4,
    fontSize: 12,
    textAlign: 'right',
  },
  select: {
    flex: '0 0 140px',
    padding: '4px 8px',
    border: '1px solid #d9d2bf',
    borderRadius: 4,
    fontSize: 12,
    background: '#fff',
  },
  hint: {
    margin: 0,
    fontSize: 11,
    color: '#7a7062',
    fontStyle: 'italic',
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
  doneBtn: {
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
