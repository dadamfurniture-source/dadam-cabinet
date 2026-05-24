// ═══════════════════════════════════════════════════════════════
// RightPanel.tsx — W8-5 SketchUp 스타일 우측 collapsible 패널
// W8-7 — 4 sections 편집 가능 (read-only → input/select)
//
// 1. 가구 정보 (카테고리, 재질) + 선택 모듈 (W, kind)
// 2. 도어 / 손잡이 (선택 모듈 한정: kind, doorCount/drawerCount, doorColor, doorFinish)
// 3. 마감 (몰딩, 걸레받이, 좌/우 마감)
// 4. BOM 미리보기 (read-only)
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import type {
  PlannerState,
  ModuleEntryV2,
  ModuleKind,
  CabinetCategory,
  MaterialTone,
} from '../lib/planner';
import {
  DOOR_FINISH_OPTIONS,
  DOOR_COLOR_OPTIONS,
} from './ModuleDetailPanel';

const CATEGORY_OPTIONS: { value: CabinetCategory; label: string }[] = [
  { value: 'sink', label: '싱크대' },
  { value: 'wardrobe', label: '붙박이장' },
  { value: 'vanity', label: '화장대' },
  { value: 'shoe', label: '신발장' },
  { value: 'fridge', label: '냉장고장' },
  { value: 'storage', label: '수납장' },
];

const MATERIAL_OPTIONS: { value: MaterialTone; label: string }[] = [
  { value: 'cream', label: '크림' },
  { value: 'oak', label: '오크' },
  { value: 'walnut', label: '월넛' },
  { value: 'graphite', label: '그라파이트' },
];

const KIND_OPTIONS: { value: ModuleKind; label: string }[] = [
  { value: 'door', label: '도어' },
  { value: 'drawer', label: '서랍' },
  { value: 'open', label: '오픈' },
];

export interface RightPanelProps {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  planner: PlannerState;
  selectedModuleId?: string | null;
  moduleCount?: number;
  /** W8-7: 가구 전체 속성 편집 (planner state patch) */
  onPlannerChange?: (patch: Partial<PlannerState>) => void;
  /** W8-7: 선택 모듈 편집 (modulesV2 patch) */
  onModuleChange?: (id: string, patch: Partial<ModuleEntryV2>) => void;
}

interface SectionState {
  info: boolean;
  door: boolean;
  finish: boolean;
  bom: boolean;
}

export function RightPanel({
  collapsed = false,
  onToggleCollapsed,
  planner,
  selectedModuleId,
  moduleCount = 0,
  onPlannerChange,
  onModuleChange,
}: RightPanelProps) {
  const [sections, setSections] = useState<SectionState>({
    info: true,
    door: true,
    finish: false,
    bom: false,
  });

  const toggleSection = useCallback((key: keyof SectionState) => {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  }, []);

  const selectedModule = selectedModuleId
    ? planner.modulesV2?.find((m) => m.id === selectedModuleId)
    : null;

  const patchPlanner = useCallback(
    (patch: Partial<PlannerState>) => onPlannerChange?.(patch),
    [onPlannerChange]
  );

  const patchModule = useCallback(
    (patch: Partial<ModuleEntryV2>) => {
      if (selectedModule && onModuleChange) onModuleChange(selectedModule.id, patch);
    },
    [selectedModule, onModuleChange]
  );

  return (
    <div
      style={{
        ...styles.root,
        width: collapsed ? 32 : 280,
      }}
      data-testid="right-panel"
    >
      {/* Panel header (collapse 버튼) */}
      <div style={styles.panelHeader}>
        {!collapsed && <span style={styles.panelHeaderTitle}>속성 트레이</span>}
        <button
          type="button"
          onClick={onToggleCollapsed}
          style={styles.panelHeaderBtn}
          title={collapsed ? '패널 펴기 (R)' : '패널 접기 (R)'}
          data-testid="right-panel-toggle"
        >
          {collapsed ? '«' : '»'}
        </button>
      </div>

      {!collapsed && (
        <div style={styles.sectionsScroll}>
          {/* ── 1. 가구 정보 ─────────────────────────── */}
          <Section title="가구 정보" open={sections.info} onToggle={() => toggleSection('info')}>
            <Row label="카테고리">
              <select
                value={planner.presetId}
                onChange={(e) => patchPlanner({ presetId: e.target.value as CabinetCategory })}
                style={styles.select}
                data-testid="rp-category"
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>
            <Row label="재질 톤">
              <select
                value={planner.material}
                onChange={(e) => patchPlanner({ material: e.target.value as MaterialTone })}
                style={styles.select}
                data-testid="rp-material"
              >
                {MATERIAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>
            <Row label="치수 (W×H×D)">
              <span style={styles.dimText}>{planner.width} × {planner.height} × {planner.depth}</span>
            </Row>
            {selectedModule && (
              <>
                <hr style={styles.divider} />
                <Row label="선택 모듈">
                  <span>#{selectedModule.id.slice(-4)} · {selectedModule.section}</span>
                </Row>
                <Row label="모듈 W">
                  <input
                    type="number"
                    value={selectedModule.width}
                    min={300}
                    max={1200}
                    step={50}
                    onChange={(e) => patchModule({ width: Number(e.target.value) || selectedModule.width })}
                    style={styles.input}
                    data-testid="rp-mod-width"
                  />
                </Row>
              </>
            )}
          </Section>

          {/* ── 2. 도어 / 손잡이 ──────────────────────── */}
          <Section title="도어 / 손잡이" open={sections.door} onToggle={() => toggleSection('door')}>
            {selectedModule ? (
              <>
                <Row label="개구부">
                  <select
                    value={selectedModule.kind}
                    onChange={(e) => patchModule({ kind: e.target.value as ModuleKind })}
                    style={styles.select}
                    data-testid="rp-mod-kind"
                  >
                    {KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Row>
                {selectedModule.kind === 'door' && (
                  <Row label="도어 수">
                    <select
                      value={selectedModule.doorCount ?? 1}
                      onChange={(e) => patchModule({ doorCount: Number(e.target.value) })}
                      style={styles.select}
                      data-testid="rp-mod-door-count"
                    >
                      <option value={1}>1짝</option>
                      <option value={2}>2짝 (양개)</option>
                    </select>
                  </Row>
                )}
                {selectedModule.kind === 'drawer' && (
                  <Row label="서랍 수">
                    <select
                      value={selectedModule.drawerCount ?? 3}
                      onChange={(e) => patchModule({ drawerCount: Number(e.target.value) })}
                      style={styles.select}
                      data-testid="rp-mod-drawer-count"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n}단</option>
                      ))}
                    </select>
                  </Row>
                )}
                <Row label="재질">
                  <select
                    value={selectedModule.doorFinish ?? ''}
                    onChange={(e) => patchModule({ doorFinish: e.target.value || undefined })}
                    style={styles.select}
                    data-testid="rp-mod-finish"
                  >
                    <option value="">— 선택 —</option>
                    {DOOR_FINISH_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Row>
                <Row label="색상">
                  <select
                    value={selectedModule.doorColor ?? ''}
                    onChange={(e) => patchModule({ doorColor: e.target.value || undefined })}
                    style={styles.select}
                    data-testid="rp-mod-color"
                  >
                    <option value="">— 선택 —</option>
                    {DOOR_COLOR_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Row>
              </>
            ) : (
              <div style={styles.hint}>모듈을 선택하세요.</div>
            )}
          </Section>

          {/* ── 3. 마감 ──────────────────────────────── */}
          <Section title="마감" open={sections.finish} onToggle={() => toggleSection('finish')}>
            <Row label="몰딩 높이">
              <input
                type="number"
                value={planner.moldingH}
                min={0}
                max={120}
                step={10}
                onChange={(e) => patchPlanner({ moldingH: Number(e.target.value) || 0 })}
                style={styles.input}
                data-testid="rp-molding-h"
              />
            </Row>
            <Row label="걸레받이">
              <input
                type="number"
                value={planner.toeKickH}
                min={0}
                max={300}
                step={10}
                onChange={(e) => patchPlanner({ toeKickH: Number(e.target.value) || 0 })}
                style={styles.input}
                data-testid="rp-toekick-h"
              />
            </Row>
            <Row label="좌측 마감">
              <input
                type="number"
                value={planner.finishLeftW}
                min={0}
                max={200}
                step={10}
                onChange={(e) => patchPlanner({ finishLeftW: Number(e.target.value) || 0 })}
                style={styles.input}
                data-testid="rp-finish-left"
              />
            </Row>
            <Row label="우측 마감">
              <input
                type="number"
                value={planner.finishRightW}
                min={0}
                max={200}
                step={10}
                onChange={(e) => patchPlanner({ finishRightW: Number(e.target.value) || 0 })}
                style={styles.input}
                data-testid="rp-finish-right"
              />
            </Row>
          </Section>

          {/* ── 4. BOM 미리보기 (read-only) ────────────── */}
          <Section title="BOM 미리보기" open={sections.bom} onToggle={() => toggleSection('bom')}>
            <Row label="총 모듈">
              <span>{moduleCount} 개</span>
            </Row>
            <Row label="segment 수">
              <span>{planner.segments?.length ?? 0} 개</span>
            </Row>
            <Row label="finish 적용">
              <span>{(planner.modulesV2 ?? []).filter((m) => m.doorFinish && m.doorColor).length} 개</span>
            </Row>
            <div style={styles.hint}>전체 BOM 산출은 부모 페이지에서 진행</div>
          </Section>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 하위 컴포넌트
// ─────────────────────────────────────────────────────────────

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div style={styles.section}>
      <button
        type="button"
        onClick={onToggle}
        style={styles.sectionHeader}
        data-testid={`section-${title}`}
      >
        <span style={{ ...styles.chev, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
        {title}
      </button>
      {open && <div style={styles.sectionBody}>{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{children}</span>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    flexShrink: 0,
    background: '#fff',
    borderLeft: '1px solid #e5e0d4',
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.18s ease',
    overflow: 'hidden',
  },
  panelHeader: {
    height: 28,
    flexShrink: 0,
    background: '#fbfaf6',
    borderBottom: '1px solid #e5e0d4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 8px',
    fontSize: 11,
    fontWeight: 600,
    color: '#7a7062',
  },
  panelHeaderTitle: {},
  panelHeaderBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: '#7a7062',
    fontSize: 14,
    padding: '2px 4px',
  },
  sectionsScroll: {
    flex: 1,
    overflowY: 'auto',
  },
  section: {
    borderBottom: '1px solid #e5e0d4',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    background: '#fff',
    cursor: 'pointer',
    userSelect: 'none',
    fontSize: 12,
    fontWeight: 600,
    color: '#3d342a',
    width: '100%',
    border: 'none',
    textAlign: 'left',
  },
  chev: {
    fontSize: 10,
    color: '#a89c84',
    transition: 'transform 0.15s ease',
    display: 'inline-block',
  },
  sectionBody: {
    padding: '6px 10px 12px',
    background: '#fff',
    fontSize: 11,
    color: '#7a7062',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
    gap: 8,
  },
  rowLabel: {
    color: '#7a7062',
    flexShrink: 0,
  },
  rowValue: {
    color: '#3d342a',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
  },
  dimText: {
    fontFamily: '"SF Mono", monospace',
    fontSize: 10,
  },
  input: {
    width: 80,
    padding: '2px 5px',
    border: '1px solid #d9d2bf',
    borderRadius: 3,
    fontSize: 11,
    textAlign: 'right',
  },
  select: {
    width: 110,
    padding: '2px 5px',
    border: '1px solid #d9d2bf',
    borderRadius: 3,
    fontSize: 11,
    background: '#fff',
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #e5e0d4',
    margin: '6px 0',
  },
  hint: {
    fontSize: 10,
    color: '#a89c84',
    fontStyle: 'italic',
    padding: '4px 0',
  },
};
