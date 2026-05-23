// ═══════════════════════════════════════════════════════════════
// Phase 3a: 수동 매핑 UI 패널
//
// SketchUp 활성 모델의 모든 entity 를 목록 표시. 각 entity 에 대해 사용자가
// type (도어/본체/구조물/유틸/unknown) + 카테고리 + partId 를 분류.
// 자동 추론 (suggestion) 이 default 값으로 채워져 빠른 검토 가능.
//
// 확정 후 "적용" → 마킹된 entities 를 mcp-server 가 reconstructPlannerData 로
// 처리하거나, 또는 클라이언트 측에서 직접 PlannerState 구성.
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { RawEntity, EntitySuggestion, SuggestedPartType } from '../lib/sketchup-client';
import { classifyEntitiesAi } from '../lib/sketchup-client';
import type { CabinetCategory } from '../lib/planner';

interface UserMapping {
  partType: SuggestedPartType;
  partId: string;
  moduleType?: 'storage' | 'sink' | 'cook' | 'hood' | 'drawer';
  colorKey: 'body' | 'accent' | 'shadow' | 'trim';
}

interface Props {
  entities: RawEntity[];
  suggestions: EntitySuggestion[];
  defaultCategory: CabinetCategory;
  onCancel: () => void;
  onApply: (category: CabinetCategory, mappings: Array<{ entity: RawEntity; mapping: UserMapping }>) => void;
}

const TYPE_LABELS: Record<SuggestedPartType, string> = {
  'module-body':  '모듈 본체',
  'module-door':  '도어',
  'toekick':      '걸레받이',
  'molding-top':  '상몰딩',
  'finish-side':  '마감재 (좌/우)',
  'countertop':   '상판',
  'utility':      '유틸리티 (분배기/환풍구)',
  'unknown':      '미분류',
};

const CATEGORIES: CabinetCategory[] = ['sink', 'wardrobe', 'vanity', 'shoe', 'fridge', 'storage'];

export function SketchupImportPanel({ entities, suggestions, defaultCategory, onCancel, onApply }: Props) {
  const [category, setCategory] = useState<CabinetCategory>(defaultCategory);

  // 각 entity 의 사용자 매핑 (초기값: suggestion)
  const initialMappings = useMemo<UserMapping[]>(
    () => suggestions.map((s) => ({
      partType: s.type,
      partId: s.suggestedPartId,
      moduleType: s.suggestedModuleType,
      colorKey: s.suggestedColorKey,
    })),
    [suggestions],
  );
  const [mappings, setMappings] = useState<UserMapping[]>(initialMappings);
  // Phase 3b: AI 분류 상태
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<string>('');

  const updateMapping = (idx: number, patch: Partial<UserMapping>) => {
    setMappings((prev) => prev.map((m, i) => i === idx ? { ...m, ...patch } : m));
  };

  // Phase 3b: AI 분류 호출 — 결과로 mappings 갱신
  const runAiClassification = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiMessage('AI 분류 중… (5-10초 소요)');
    try {
      const result = await classifyEntitiesAi({});
      if (!result.ok || !result.suggestions) {
        setAiMessage(`✗ AI 분류 실패: ${result.error ?? 'unknown'}`);
        return;
      }
      // AI suggestion 으로 mappings 일괄 갱신
      const newMappings: UserMapping[] = result.suggestions.map((s) => ({
        partType: s.type,
        partId: s.suggestedPartId,
        moduleType: s.suggestedModuleType,
        colorKey: s.suggestedColorKey,
      }));
      setMappings(newMappings);
      // 카테고리 추정도 적용
      if (result.inferredCategory && CATEGORIES.includes(result.inferredCategory as CabinetCategory)) {
        setCategory(result.inferredCategory as CabinetCategory);
      }
      const fallback = result.fallback ? ' (fallback: 휴리스틱 사용)' : '';
      setAiMessage(`✓ AI 분류 완료${fallback} · 평균 신뢰 ${Math.round(result.suggestions.reduce((s, x) => s + x.confidence, 0) / result.suggestions.length * 100)}% · ${result.durationMs ?? 0}ms`);
    } catch (e) {
      setAiMessage(`✗ 예외: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(false);
    }
  };

  const handleApply = () => {
    const result = entities.map((ent, i) => ({ entity: ent, mapping: mappings[i] }));
    onApply(category, result);
  };

  // 통계
  const counts = useMemo(() => {
    const byType = mappings.reduce<Record<string, number>>((acc, m) => {
      acc[m.partType] = (acc[m.partType] ?? 0) + 1;
      return acc;
    }, {});
    return byType;
  }, [mappings]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 24, maxWidth: 900, width: '95%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ margin: 0, color: '#2d2a26', fontSize: 18 }}>📋 SketchUp 수동 매핑</h3>
          <span style={{ fontSize: 12, color: '#6a4b2a' }}>
            entity {entities.length}개 · 자동 추론 결과 검토 후 적용
          </span>
        </div>

        {/* 카테고리 선택 + AI 분류 버튼 */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>가구 카테고리:</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CabinetCategory)}
              style={{ padding: '4px 10px', fontSize: 13, borderRadius: 4, border: '1px solid #d4c4a8' }}
            >
              {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          {/* Phase 3b: AI 분류 버튼 */}
          <button
            onClick={runAiClassification}
            disabled={aiBusy}
            title="Gemini Vision API 로 entity 자동 분류 (~$0.003 비용, 5-10초)"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #7c4a93',
              background: aiBusy ? '#ccc' : '#fff',
              color: '#7c4a93',
              fontSize: 12,
              fontWeight: 600,
              cursor: aiBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {aiBusy ? '🤖 분류 중…' : '🤖 AI 자동 분류 시작'}
          </button>
          {aiMessage && (
            <span style={{
              fontSize: 11,
              color: aiMessage.startsWith('✓') ? '#047857' : aiMessage.startsWith('✗') ? '#b91c1c' : '#6a4b2a',
            }}>
              {aiMessage}
            </span>
          )}
        </div>

        {/* 통계 */}
        <div style={{ marginTop: 8, fontSize: 11, color: '#6a4b2a' }}>
          {Object.entries(counts).map(([k, v]) => `${TYPE_LABELS[k as SuggestedPartType] ?? k}: ${v}`).join(' · ')}
        </div>

        {/* entity 목록 */}
        <div style={{ marginTop: 12, flex: 1, overflowY: 'auto', border: '1px solid #e3ddd0', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#f1ede3' }}>
              <tr>
                <th style={th}>#</th>
                <th style={th}>이름</th>
                <th style={th}>bbox (mm)</th>
                <th style={th}>type</th>
                <th style={th}>partId</th>
                <th style={th}>moduleType</th>
                <th style={th}>색상</th>
                <th style={th}>신뢰</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((ent, i) => {
                const m = mappings[i];
                const s = suggestions[i];
                const w = ent.bounds.max[0] - ent.bounds.min[0];
                const d = ent.bounds.max[1] - ent.bounds.min[1];
                const h = ent.bounds.max[2] - ent.bounds.min[2];
                return (
                  <tr key={ent.id} style={{ borderTop: '1px solid #e3ddd0' }}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{ent.name}</td>
                    <td style={{ ...td, fontSize: 11 }}>{Math.round(w)}×{Math.round(d)}×{Math.round(h)}</td>
                    <td style={td}>
                      <select
                        value={m.partType}
                        onChange={(e) => updateMapping(i, { partType: e.target.value as SuggestedPartType })}
                        style={selectStyle}
                      >
                        {Object.entries(TYPE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td style={td}>
                      <input
                        type="text"
                        value={m.partId}
                        onChange={(e) => updateMapping(i, { partId: e.target.value })}
                        style={{ ...inputStyle, width: 130 }}
                      />
                    </td>
                    <td style={td}>
                      {(m.partType === 'module-body' || m.partType === 'module-door') && (
                        <select
                          value={m.moduleType ?? 'storage'}
                          onChange={(e) => updateMapping(i, { moduleType: e.target.value as any })}
                          style={selectStyle}
                        >
                          <option value="storage">storage</option>
                          <option value="sink">sink</option>
                          <option value="cook">cook</option>
                          <option value="hood">hood</option>
                          <option value="drawer">drawer</option>
                        </select>
                      )}
                    </td>
                    <td style={td}>
                      <select
                        value={m.colorKey}
                        onChange={(e) => updateMapping(i, { colorKey: e.target.value as any })}
                        style={selectStyle}
                      >
                        <option value="body">body</option>
                        <option value="accent">accent</option>
                        <option value="shadow">shadow</option>
                        <option value="trim">trim</option>
                      </select>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <span style={{
                        color: s.confidence > 0.7 ? '#047857' : s.confidence > 0.4 ? '#c97a3d' : '#b91c1c',
                        fontWeight: 600,
                      }}>
                        {Math.round(s.confidence * 100)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 액션 */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 11, color: '#6a4b2a', margin: 0 }}>
            💡 자동 추론을 검토 후 잘못된 항목 수정. "적용" 클릭 시 dadam.* 마킹 + planner UI 가구 복원.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onCancel} style={btnStyleSecondary}>취소</button>
            <button onClick={handleApply} style={btnStylePrimary}>적용</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '8px 6px', textAlign: 'left', color: '#6a4b2a', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px', verticalAlign: 'middle' };
const selectStyle: React.CSSProperties = { padding: '3px 6px', fontSize: 11, borderRadius: 3, border: '1px solid #d4c4a8', background: '#fff' };
const inputStyle: React.CSSProperties = { padding: '3px 6px', fontSize: 11, borderRadius: 3, border: '1px solid #d4c4a8' };
const btnStylePrimary: React.CSSProperties = { padding: '8px 16px', borderRadius: 6, border: '1px solid #6a4b2a', background: '#6a4b2a', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const btnStyleSecondary: React.CSSProperties = { padding: '8px 16px', borderRadius: 6, border: '1px solid #e3ddd0', background: '#fff', color: '#5a564e', fontSize: 13, cursor: 'pointer' };
