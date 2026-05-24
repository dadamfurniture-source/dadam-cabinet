// ═══════════════════════════════════════════════════════════════
// RightPanel.tsx — W8-5 SketchUp 스타일 우측 collapsible 패널
//
// 4 collapsible sections:
//   1. 가구 정보 (W/H/D, 선택 모듈, 카테고리)
//   2. 도어 / 손잡이 (색상 swatch, 도어 개수, 손잡이 종류)
//   3. 마감 / 조명 (몰딩, 걸레받이, LED)
//   4. BOM 미리보기 (모듈 수, 자재비 예상)
//
// 각 섹션 접기/펴기 + 패널 전체 접기 (32px) 토글.
// ═══════════════════════════════════════════════════════════════

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { PlannerState } from '../lib/planner';

export interface RightPanelProps {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  planner: PlannerState;
  selectedModuleId?: string | null;
  moduleCount?: number;
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
}: RightPanelProps) {
  const [sections, setSections] = useState<SectionState>({
    info: true,
    door: true,
    finish: false,
    bom: false,
  });

  const toggleSection = (key: keyof SectionState) => {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const selectedModule = selectedModuleId
    ? planner.modulesV2?.find((m) => m.id === selectedModuleId)
    : null;

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

      {/* 접힌 상태에서는 sections 숨김 */}
      {!collapsed && (
        <div style={styles.sectionsScroll}>
          <Section
            title="가구 정보"
            open={sections.info}
            onToggle={() => toggleSection('info')}
          >
            <Row label="W × H × D">
              <span>{planner.width} × {planner.height} × {planner.depth}</span>
            </Row>
            <Row label="카테고리">
              <span>{planner.presetId}</span>
            </Row>
            <Row label="재질">
              <span>{planner.material}</span>
            </Row>
            {selectedModule && (
              <>
                <hr style={styles.divider} />
                <Row label="선택 모듈">
                  <span>#{selectedModule.id.slice(-4)} · {selectedModule.section}</span>
                </Row>
                <Row label="모듈 W">
                  <span>{selectedModule.width}mm</span>
                </Row>
              </>
            )}
          </Section>

          <Section
            title="도어 / 손잡이"
            open={sections.door}
            onToggle={() => toggleSection('door')}
          >
            {selectedModule ? (
              <>
                <Row label="개구부">
                  <span>{selectedModule.kind === 'door' ? '도어' : selectedModule.kind === 'drawer' ? '서랍' : '오픈'}</span>
                </Row>
                <Row label="색상">
                  <span>{selectedModule.doorColor ?? '미설정'}</span>
                </Row>
                <Row label="재질">
                  <span>{selectedModule.doorFinish ?? '미설정'}</span>
                </Row>
              </>
            ) : (
              <div style={styles.hint}>모듈을 선택하세요.</div>
            )}
          </Section>

          <Section
            title="마감 / 조명"
            open={sections.finish}
            onToggle={() => toggleSection('finish')}
          >
            <Row label="몰딩 높이">
              <span>{planner.moldingH}mm</span>
            </Row>
            <Row label="걸레받이">
              <span>{planner.toeKickH}mm</span>
            </Row>
            <Row label="좌측 마감">
              <span>{planner.finishLeftW}mm</span>
            </Row>
            <Row label="우측 마감">
              <span>{planner.finishRightW}mm</span>
            </Row>
          </Section>

          <Section
            title="BOM 미리보기"
            open={sections.bom}
            onToggle={() => toggleSection('bom')}
          >
            <Row label="총 모듈">
              <span>{moduleCount} 개</span>
            </Row>
            <Row label="segment 수">
              <span>{planner.segments?.length ?? 0} 개</span>
            </Row>
            <div style={styles.hint}>전체 BOM 산출은 부모에서 진행</div>
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
  },
  rowLabel: {
    color: '#7a7062',
  },
  rowValue: {
    color: '#3d342a',
    fontWeight: 600,
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
