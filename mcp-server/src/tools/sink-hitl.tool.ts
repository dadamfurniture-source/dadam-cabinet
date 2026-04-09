// ═══════════════════════════════════════════════════════════════
// Sink HITL Tools - 랜덤/AI 생성, 수정안 저장, 규칙 마이닝, 통계
// ═══════════════════════════════════════════════════════════════

import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import {
  SinkEnvSchema,
  GenerateRequestSchema,
  SaveCorrectionRequestSchema,
} from '../schemas/sink-hitl.schemas.js';
import { generateRandomSinkDesign } from '../services/sink-hitl-random.service.js';
import { generateAIDesign } from '../services/sink-hitl-ai-design.service.js';
import { computeSinkDiff } from '../services/sink-hitl-diff.service.js';
import {
  saveCase,
  savePair,
  getStats,
  newPairId,
  listPairs,
  getAllRules,
} from '../services/sink-hitl-storage.service.js';
import { mineRules, getFeedbackSummary } from '../services/sink-hitl-rule-mining.service.js';

// ─── sink_hitl_generate (랜덤) ───
registerTool(
  {
    name: 'sink_hitl_generate',
    description: 'HITL 학습용 싱크대 랜덤 설계안을 생성합니다. 의도적으로 흔한 실수를 포함하여 사용자 수정 → 규칙 학습 루프에 사용됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        env: {
          type: 'object',
          description: '벽/환경 치수 (width, height, depth, finishLeftW, finishRightW, moldingH, toeKickH, distributorStart/End, ventStart/End, measurementBase)',
        },
        seed: { type: 'number', description: '재현 가능한 랜덤 시드 (선택)' },
      },
      required: ['env'],
    },
  },
  async (args) => {
    const parsed = GenerateRequestSchema.safeParse(args);
    if (!parsed.success) return mcpError(`Invalid input: ${parsed.error.message}`);
    try {
      const design = generateRandomSinkDesign(parsed.data.env, parsed.data.seed);
      await saveCase(design);
      return mcpSuccess({ success: true, design });
    } catch (e) {
      return mcpError(`sink_hitl_generate failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// ─── sink_hitl_generate_ai (AI 설계) ───
registerTool(
  {
    name: 'sink_hitl_generate_ai',
    description: 'Claude AI가 학습된 규칙 + few-shot 예시를 기반으로 싱크대를 직접 설계합니다. 랜덤 생성보다 정확한 설계안을 만들어냅니다.',
    inputSchema: {
      type: 'object',
      properties: {
        env: {
          type: 'object',
          description: '벽/환경 치수 (SinkEnv 전체)',
        },
      },
      required: ['env'],
    },
  },
  async (args) => {
    const parsed = SinkEnvSchema.safeParse((args as { env: unknown }).env);
    if (!parsed.success) return mcpError(`Invalid env: ${parsed.error.message}`);
    try {
      const design = await generateAIDesign(parsed.data);
      await saveCase(design);
      return mcpSuccess({
        success: true,
        design,
        generated_by: design.meta.generated_by,
      });
    } catch (e) {
      return mcpError(`sink_hitl_generate_ai failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// ─── sink_hitl_save_correction ───
registerTool(
  {
    name: 'sink_hitl_save_correction',
    description: '사용자가 수정한 싱크대 설계안을 pair로 저장합니다. generated + corrected + diff + rating.',
    inputSchema: {
      type: 'object',
      properties: {
        generated: { type: 'object', description: '원본 설계안 (SinkDesign)' },
        corrected: { type: 'object', description: '사용자 수정 설계안 (SinkDesign)' },
        rating: { type: 'number', description: '1-5 평점 (5: 수정 거의 없음)' },
        comment: { type: 'string', description: '주석 (선택)' },
      },
      required: ['generated', 'corrected', 'rating'],
    },
  },
  async (args) => {
    const parsed = SaveCorrectionRequestSchema.safeParse(args);
    if (!parsed.success) return mcpError(`Invalid input: ${parsed.error.message}`);
    try {
      const { generated, corrected, rating, comment } = parsed.data;
      const diffs = computeSinkDiff(generated, corrected);
      const pair = {
        pair_id: newPairId(),
        timestamp: new Date().toISOString(),
        generated,
        corrected,
        diffs,
        rating,
        comment,
      };
      await saveCase({ ...corrected, meta: { ...corrected.meta, generated_by: 'human-correction', parent_id: generated.id } });
      await savePair(pair);
      return mcpSuccess({ success: true, pair_id: pair.pair_id, diff_count: diffs.length });
    } catch (e) {
      return mcpError(`sink_hitl_save_correction failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// ─── sink_hitl_mine_rules ───
registerTool(
  {
    name: 'sink_hitl_mine_rules',
    description: '수집된 HITL pair 데이터에서 반복 수정 패턴을 자동 추출하여 학습 규칙으로 저장합니다.',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => {
    try {
      const result = await mineRules();
      return mcpSuccess(result);
    } catch (e) {
      return mcpError(`sink_hitl_mine_rules failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// ─── sink_hitl_stats ───
registerTool(
  {
    name: 'sink_hitl_stats',
    description: 'Sink HITL 수집 통계를 반환합니다 (총 pair 수, 평균 rating, 규칙 수, 주간 증가 등).',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => {
    try {
      const stats = await getStats();
      return mcpSuccess(stats);
    } catch (e) {
      return mcpError(`sink_hitl_stats failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// ─── sink_hitl_list_pairs ───
registerTool(
  {
    name: 'sink_hitl_list_pairs',
    description: 'Sink HITL pair 레코드 메타데이터 목록 (최근 순).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '최대 반환 개수 (기본 50)' } },
    },
  },
  async (args) => {
    try {
      const limit = (args as { limit?: number })?.limit ?? 50;
      const pairs = await listPairs(limit);
      const sorted = pairs
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit)
        .map(p => ({
          pair_id: p.pair_id,
          timestamp: p.timestamp,
          rating: p.rating,
          diff_count: p.diffs.length,
          env_width: p.generated.env.width,
          generated_by: p.generated.meta.generated_by,
        }));
      return mcpSuccess({ total: pairs.length, items: sorted });
    } catch (e) {
      return mcpError(`sink_hitl_list_pairs failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// ─── sink_hitl_rules ───
registerTool(
  {
    name: 'sink_hitl_rules',
    description: '학습된 HITL 규칙 목록을 반환합니다. is_active=true인 규칙이 AI 설계에 반영됩니다.',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => {
    try {
      const rules = await getAllRules();
      return mcpSuccess({
        total: rules.length,
        active: rules.filter(r => r.is_active).length,
        rules,
      });
    } catch (e) {
      return mcpError(`sink_hitl_rules failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// ─── sink_hitl_feedback_summary ───
registerTool(
  {
    name: 'sink_hitl_feedback_summary',
    description: 'AI 학습 피드백 현황 요약 (총 pair 수, 활성 규칙 수, AI 정확도, 빈번한 수정 태그).',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => {
    try {
      const summary = await getFeedbackSummary();
      return mcpSuccess(summary);
    } catch (e) {
      return mcpError(`sink_hitl_feedback_summary failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
);

// 빈 export로 import 부작용 확실화
export {};

// Note: SinkEnvSchema is re-exported via schemas; lint guard
void SinkEnvSchema;
