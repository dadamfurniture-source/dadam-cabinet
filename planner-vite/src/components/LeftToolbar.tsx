// ═══════════════════════════════════════════════════════════════
// LeftToolbar.tsx — W8-5 SketchUp 스타일 좌측 icon-only toolbar
//
// 가구 카테고리 아이콘 (싱크/벽장/냉장고/...) + 모듈 type 추가 도구.
// 부모 detaildesign 으로 postMessage 전송 (incrementCategory 호출).
// ═══════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';

export interface ToolItem {
  id: string;
  icon: string;
  label: string;
  /** badge: 현재 추가된 개수 (시각 표시) */
  badge?: number;
  /** 그룹 구분선 (이 아이템 위에 separator) */
  separator?: boolean;
}

export const DEFAULT_TOOLS: ToolItem[] = [
  // 가구 카테고리 (detaildesign incrementCategory 호출)
  { id: 'sink', icon: '🚰', label: '싱크대' },
  { id: 'island', icon: '🏝', label: '아일랜드' },
  { id: 'wardrobe', icon: '👔', label: '붙박이장' },
  { id: 'fridge', icon: '🧊', label: '냉장고장' },
  { id: 'shoerack', icon: '👟', label: '신발장' },
  { id: 'vanity', icon: '💄', label: '화장대' },
  { id: 'storage', icon: '📦', label: '수납장' },
  { id: 'warehouse', icon: '🏭', label: '창고장' },
  { id: 'door', icon: '🚪', label: '도어교체' },
  { id: 'custom', icon: '✏️', label: '비규격장' },
];

export interface LeftToolbarProps {
  collapsed?: boolean;
  /** 카테고리별 추가된 개수 (badge 표시) */
  counts?: Record<string, number>;
  /** 카테고리 아이콘 클릭 시 호출 */
  onAdd?: (categoryId: string) => void;
}

export function LeftToolbar({
  collapsed = false,
  counts = {},
  onAdd,
}: LeftToolbarProps) {
  const handleClick = (id: string) => {
    if (onAdd) {
      onAdd(id);
    } else {
      // 기본 동작: 부모 detaildesign 으로 postMessage
      try {
        window.parent?.postMessage({ type: 'ADD_CATEGORY', categoryId: id }, '*');
      } catch {}
    }
  };

  return (
    <div
      style={{
        ...styles.root,
        width: collapsed ? 0 : 48,
        borderRight: collapsed ? 'none' : '1px solid #e5e0d4',
      }}
      data-testid="left-toolbar"
    >
      {DEFAULT_TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          onClick={() => handleClick(tool.id)}
          title={tool.label}
          style={styles.toolBtn}
          data-testid={`tool-${tool.id}`}
        >
          <span style={styles.icon}>{tool.icon}</span>
          {counts[tool.id] > 0 && <span style={styles.badge}>{counts[tool.id]}</span>}
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    flexShrink: 0,
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '6px 0',
    gap: 2,
    transition: 'width 0.18s ease, border-right 0.18s ease',
    overflow: 'hidden',
  },
  toolBtn: {
    width: 38,
    height: 38,
    border: '1px solid transparent',
    borderRadius: 6,
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#7a7062',
    position: 'relative',
    fontSize: 18,
    transition: 'all 0.12s ease',
  },
  icon: {
    fontSize: 18,
    lineHeight: 1,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    background: '#6a4b2a',
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    padding: '0 3px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
