// ═══════════════════════════════════════════════════════════════
// SketchUp Build MCP Tool — CabinetPartV2[] → SketchUp 모델 빌드
//
// W2 도구 노출. 외부 (LLM agent, HTTP route) 가 호출하면:
//   1) buildPlanFromParts 로 CabinetPartV2[] 를 mhyrr 명령 시퀀스로 변환
//   2) sendBatch 로 단일 TCP 연결에서 순차 전송
//   3) 트랜잭션 실패 시 abort_operation 자동 호출
//
// 보안:
//   - eval_ruby 는 builder 가 allowlist 명령만 생성 (RUBY_COMMANDS)
//   - 자유 입력 Ruby 코드는 받지 않는다
//   - partId 는 builder 에서 영숫자/언더스코어/하이픈으로 sanitize
//
// W4-4: V2 (Z-up corner mm degrees) 만 허용. V1 입력은 schema 에서 거부.
// ═══════════════════════════════════════════════════════════════

import { registerTool } from './registry.js';
import { mcpSuccess, mcpError } from '../utils/response-builder.js';
import { buildPlanFromParts } from '../services/sketchup-builder.service.js';
import { sendBatch, pingSketchup } from '../services/sketchup-mcp-bridge.service.js';
import { sketchupBuildSchema } from '../schemas/sketchup.schema.js';

// W3-2: 공유 zod 스키마로 분리 — HTTP route (sketchup.route.ts) 와 동일.
const inputSchema = sketchupBuildSchema;

registerTool(
  {
    name: 'build_sketchup_scene',
    description:
      'CabinetPartV2 배열을 SketchUp 씬으로 빌드합니다. 단위(mm→inch)·머티리얼 매핑·트랜잭션 래핑·자동 ABORT 를 모두 처리하며, mhyrr/sketchup-mcp 확장이 떠 있어야 합니다 (기본 127.0.0.1:9876).',
    inputSchema: {
      type: 'object',
      properties: {
        schemaVersion: {
          type: 'string',
          enum: ['v2'],
          description: '스키마 버전 — 옵션. 미지정 시 v2 로 해석. v1 은 W4-4 부터 거부.',
        },
        parts: {
          type: 'array',
          description: 'planner CabinetPartV2 배열 (mm 단위, Z-up corner 좌표계, rotationZDeg degrees)',
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
        applyRotation: {
          type: 'boolean',
          description:
            'W4-5: rotationZDeg ≠ 0 인 파트에 transform_component 명령 추가 (기본 false). secondary 모듈이 SketchUp 에서 ±90° 회전된 상태로 배치됨.',
        },
        applyMaterial: {
          type: 'boolean',
          description:
            'W4-5: 각 파트에 set_material 명령 추가 (기본 false). 빌드 시작 시 16개 머티리얼 사전 등록 자동 동반.',
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
      applyRotation,
      applyMaterial,
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

    const plan = buildPlanFromParts(parts, {
      category,
      materialTone,
      clearExisting,
      transactional,
      applyRotation,
      applyMaterial,
    });

    if (plan.componentCount === 0) {
      return mcpError(
        'No buildable parts after filtering (wireframe / essential=false / zero-dim). Nothing sent to SketchUp.',
      );
    }

    // W4-5c: mhyrr v0.1.0 호환 per-command 모드 + entityIdMap 응답 chaining.
    const batch = await sendBatch(plan.commands, {
      host,
      port,
      timeoutMs,
      autoAbortOnFailure: transactional,
      stopOnFirstFailure: transactional,
      connectionMode: 'per-command',
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
