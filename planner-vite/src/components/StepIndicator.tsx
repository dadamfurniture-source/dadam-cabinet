// ═══════════════════════════════════════════════════════════════
// StepIndicator.tsx — W6-6 3단계 워크플로우 progress bar
//
// 모든 step overlay 의 header 에 inline 으로 삽입.
// 단계 동그라미 클릭 시 직접 이동 가능 (단, 이전 단계로만).
// ═══════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';

export type WorkflowStep = 'layout' | 'structure' | 'detail';

export const WORKFLOW_STEPS: readonly { key: WorkflowStep; label: string; icon: string }[] = [
  { key: 'layout', label: '배치', icon: '📐' },
  { key: 'structure', label: '구조', icon: '📦' },
  { key: 'detail', label: '디테일', icon: '🎨' },
];

export interface StepIndicatorProps {
  current: WorkflowStep;
  onJump?: (step: WorkflowStep) => void;
  /** 비활성 step (segments 없으면 structure/detail 비활성 등) */
  disabledSteps?: WorkflowStep[];
}

export function StepIndicator({ current, onJump, disabledSteps = [] }: StepIndicatorProps) {
  const currentIdx = WORKFLOW_STEPS.findIndex((s) => s.key === current);

  return (
    <div style={styles.root} data-testid="step-indicator">
      {WORKFLOW_STEPS.map((s, idx) => {
        const isCurrent = s.key === current;
        const isPast = idx < currentIdx;
        const isFuture = idx > currentIdx;
        const isDisabled = disabledSteps.includes(s.key);
        const clickable = onJump && !isDisabled && !isCurrent;

        return (
          <div key={s.key} style={styles.stepWrap}>
            <button
              type="button"
              onClick={clickable ? () => onJump?.(s.key) : undefined}
              disabled={!clickable}
              style={{
                ...styles.stepBtn,
                ...(isCurrent ? styles.stepBtnCurrent : {}),
                ...(isPast ? styles.stepBtnPast : {}),
                ...(isFuture ? styles.stepBtnFuture : {}),
                ...(isDisabled ? styles.stepBtnDisabled : {}),
                cursor: clickable ? 'pointer' : 'default',
              }}
              data-testid={`step-btn-${s.key}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span style={styles.stepIcon}>{s.icon}</span>
              <span style={styles.stepLabel}>
                {idx + 1}. {s.label}
              </span>
            </button>
            {idx < WORKFLOW_STEPS.length - 1 && (
              <span
                style={{
                  ...styles.connector,
                  background: idx < currentIdx ? '#b8956c' : '#e5e0d4',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    padding: '6px 12px',
    background: '#fbfaf6',
    border: '1px solid #e5e0d4',
    borderRadius: 999,
  },
  stepWrap: {
    display: 'flex',
    alignItems: 'center',
  },
  stepBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    color: '#7a7062',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
  },
  stepBtnCurrent: {
    background: '#6a4b2a',
    color: '#fff',
    boxShadow: '0 2px 6px rgba(106, 75, 42, 0.3)',
  },
  stepBtnPast: {
    color: '#b8956c',
    background: '#f3ead9',
  },
  stepBtnFuture: {
    color: '#a89c84',
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  stepIcon: {
    fontSize: 14,
  },
  stepLabel: {},
  connector: {
    display: 'inline-block',
    width: 20,
    height: 2,
    margin: '0 2px',
  },
};
