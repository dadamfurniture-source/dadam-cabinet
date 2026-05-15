// ═══════════════════════════════════════════════════════════════
// SketchUp Build MCP Tool — CabinetPart[] → SketchUp 모델 빌드
//
// W2 도구 노출. 외부 (LLM agent, HTTP route) 가 호출하면:
//   1) buildPlanFromParts 로 CabinetPart[] 를 mhyrr 명령 시퀀스로 변환
//   2) sendBatch 로 단일 TCP 연결에서 순차 전송
//   3) 트랜잭션 실패 시 abort_operation 자동 호출
//
// 보안:
//   - eval_ruby 는 builder 가 allowlist 명령만 생성 (RUBY_COMMANDS)
//   - 자유 입력 Ruby 코드는 받지 않는다
//   - partId 는 builder 에서 영숫자/언더스코어/하이픈으로 sanitize
// ═══════════════════════════════════════════════════════════════

import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import { buildPlanFromParts } from '../services/sketchup-builder.service.js';
import { sendBatch, pingSketchup } from '../services/sketchup-mcp-bridge.service.js';
import { sketchupBuildSchema } from '../schemas/sketchup.schema.js';
import type { CabinetPart } from '../types/planner.types.js';

// W3-2: 공유 zod 스키마로 분리 — HTTP route (sketchup.route.ts) 와 동일.
const inputSchema = sketchupBuildSchema;

registerTool(
  {
    name: 'build_sketchup_scene',
    description:
      'CabinetPart 배열을 SketchUp 씬으로 빌드합니다. 단위·축 변환·머티리얼 매핑·트랜잭션 래핑·자동 ABORT 를 모두 처리하며, mhyrr/sketchup-mcp 확장이 떠 있어야 합니다 (기본 127.0.0.1:9876).',
    inputSchema: {
      type: 'object',
      properties: {
        parts: {
          type: 'array',
          description: 'planner CabinetPart 배열 (mm 단위, Y-up 좌표계)',
          items: { type: 'object' },
        },
        category: {
          type: 'string',
          enum: ['sink', 'wardrobe', 'fridge', 'vanity', 'shoe', 'storage'],
          description: '가구 카테고리 — 컴포넌트 이름 dadam.{category}.{partId} 에 반영',
        },
        materialTone: {
          type: 'string',
          enum: ['cream', 'oak', 'walnut', 'graphite'],
          description: 'MaterialTone — SketchUp 머티리얼 이름 dadam_{tone}_{colorKey} 로 매핑',
        },
        clearExisting: {
          type: 'boolean',
          description: '빌드 전에 active_entities 를 비울지 (기본값 false)',
        },
        transactional: {
          type: 'boolean',
          description:
            'true (기본값) 면 빌드를 start_operation/commit_operation 으로 감싼다. 디자이너 undo 1회로 전체 롤백 가능.',
        },
        host: { type: 'string', description: 'SketchUp 확장 호스트 (기본값 127.0.0.1)' },
        port: { type: 'number', description: 'SketchUp 확장 포트 (기본값 9876)' },
        timeoutMs: { type: 'number', description: '개별 명령 타임아웃 ms (기본값 15000)' },
        ping: {
          type: 'boolean',
          description: '빌드 전 SketchUp 확장 가용성 ping (기본값 true)',
        },
      },
      required: ['parts', 'category', 'materialTone'],
    },
  },
  async (args) => {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return mcpError(`Invalid input: ${parsed.error.message}`);
    }

    const {
      parts,
      category,
      materialTone,
      clearExisting,
      transactional,
      host,
      port,
      timeoutMs,
      ping,
    } = parsed.data;

    if (ping) {
      const probe = await pingSketchup({ host, port, timeoutMs });
      if (!probe.ok) {
        return mcpError(
          `SketchUp bridge unavailable: ${probe.error?.message ?? 'unknown error'}. mhyrr/sketchup-mcp extension running on ${host ?? '127.0.0.1'}:${port ?? 9876}?`,
        );
      }
    }

    const plan = buildPlanFromParts(parts as CabinetPart[], {
      category,
      materialTone,
      clearExisting,
      transactional,
    });

    if (plan.componentCount === 0) {
      return mcpError(
        'No buildable parts after filtering (wireframe / essential=false / zero-dim). Nothing sent to SketchUp.',
      );
    }

    const batch = await sendBatch(plan.commands, {
      host,
      port,
      timeoutMs,
      autoAbortOnFailure: transactional,
      stopOnFirstFailure: transactional,
    });

    return mcpSuccess({
      category,
      materialTone,
      componentCount: plan.componentCount,
      transactional,
      clearExisting,
      sent: batch.totalSent,
      succeeded: batch.successCount,
      failed: batch.failures.length,
      aborted: batch.aborted,
      durationMs: batch.durationMs,
      failures: batch.failures.slice(0, 5), // 최대 5건만 노출 (응답 크기 제어)
    });
  },
);
