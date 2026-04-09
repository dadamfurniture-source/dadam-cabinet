// ═══════════════════════════════════════════════════════════════
// Sink HITL AI Design Service
// Claude API를 사용한 AI 싱크대 설계 생성
// 학습된 규칙 + few-shot 예시 기반 프롬프트 조립
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { extractJsonFromText } from '../utils/json-extractor.js';
import {
  getActiveRules,
  getHighRatedPairs,
  type SinkHitlRule,
  type SimilarPairResult,
} from './sink-hitl-storage.service.js';
import { generateRandomSinkDesign } from './sink-hitl-random.service.js';
import type { SinkEnv, SinkDesign, SinkModule } from '../schemas/sink-hitl.schemas.js';

const log = createLogger('sink-hitl-ai-design');

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const CLAUDE_API_VERSION = '2023-06-01';

// ─── 시스템 프롬프트 조립 ───

function buildSystemPrompt(rules: SinkHitlRule[], examples: SimilarPairResult[]): string {
  let prompt = `당신은 싱크대 캐비닛 모듈 배치 전문가입니다.
주어진 환경(벽 치수, 분배기/환풍구 위치, 레이아웃 타입)에 맞춰 하부장(lower)과 상부장(upper) 모듈 배열을 설계하세요.

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. 설명 텍스트 없이 JSON만 출력:
\`\`\`json
{
  "lower": [
    { "idx": 0, "width": 600, "kind": "door", "type": "storage", "doorCount": 2, "orientation": "normal" },
    ...
  ],
  "upper": [
    { "idx": 0, "width": 600, "kind": "door", "type": "storage", "doorCount": 2, "orientation": "normal" },
    ...
  ]
}
\`\`\`

## 모듈 필드 설명
- idx: 0부터 시작하는 순서 인덱스
- width: 모듈 폭 (mm, 정수)
- kind: "door" | "drawer" | "open"
- type: "sink" | "cook" | "hood" | "lt" | "storage" | "drawer" | "blank"
- doorCount: kind=door일 때 도어 수 (1 또는 2, 폭 600mm 이상이면 2)
- drawerCount: kind=drawer일 때 서랍 수 (2~4)
- orientation: "normal"(주선) | "secondary"(ㄱ자 좌측 차선) | "tertiary"(ㄷ자 우측 차선)
- blindAnchorIdx: 차선 모듈이 연결되는 주선 멍장 인덱스 (차선 모듈에만 필요)

## 기본 설계 규칙

### 하부장 (lower)
1. **cook (쿡탑)**: 환풍구(vent) 중심에 배치. 폭 580~620mm. kind는 drawer 선호.
2. **sink (개수대)**: 분배기(distributor) 전체를 포함하도록 배치. 폭 900~1100mm. kind=door.
3. **lt (키큰장)**: cook 옆, 벽에 가까운 쪽에 배치. 폭 150~300mm. kind=door, doorCount=1.
4. **storage/drawer**: 나머지 공간을 채움. 적절히 분할.
5. 좌측→우측 논리적 순서: sink가 좌측이면 cook은 우측에.
6. doorCount: 폭 600mm 이상이면 2, 미만이면 1.

### 상부장 (upper)
1. **hood (후드)**: 환풍구 중심에 배치. 폭 600~900mm. kind=open.
2. **storage**: 나머지 공간. kind=door.

### ㄱ자/ㄷ자 레이아웃
- L형(ㄱ자): 주선 맨 앞에 blank(멍장, 폭=depth) 삽입. secondary 모듈은 좌측 차선.
- U형(ㄷ자): 주선 앞뒤에 blank 삽입. secondary=좌측, tertiary=우측 차선.
- 차선 모듈은 storage/drawer로 구성. blindAnchorIdx로 멍장에 연결.
- 차선 가용폭 = 보조벽길이 - depth - 자유단마감재(60)

### 폭 합산 제약
- 주선(normal) 모듈 폭 합 = 주벽너비(width) - 좌마감재(finishLeftW) - 우마감재(finishRightW)
- 차선(secondary/tertiary) 모듈 폭 합 = 해당 보조벽 가용폭
- 이 제약을 반드시 정확히 지키세요.`;

  // 학습된 규칙 추가
  if (rules.length > 0) {
    prompt += '\n\n## 학습된 규칙 (사용자 피드백에서 자동 추출)\n다음 규칙들은 과거 수정 데이터에서 높은 빈도로 나타난 패턴입니다. 설계 시 반영하세요:\n';
    for (const rule of rules) {
      const conf = Math.round(rule.confidence * 100);
      const preferred = rule.action.preferred_value
        ? ` → 선호값: ${rule.action.preferred_value}`
        : '';
      prompt += `- [${conf}% 확신] ${rule.description}${preferred}\n`;
    }
  }

  // few-shot 예시 추가
  if (examples.length > 0) {
    prompt += '\n\n## 참고 설계 예시 (고평점 사용자 수정본)\n';
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      const env = ex.corrected.env as Record<string, unknown>;
      const lower = ex.corrected.lower as unknown[];
      const upper = ex.corrected.upper as unknown[];
      prompt += `\n### 예시 ${i + 1} (평점 ${ex.rating}/5)\n`;
      prompt += `환경: 주벽=${env.width}mm, 레이아웃=${env.layoutType}, 분배기=${env.distributorStart}~${env.distributorEnd}, 환풍구=${env.ventStart}~${env.ventEnd}\n`;
      prompt += `결과:\n\`\`\`json\n${JSON.stringify({ lower, upper }, null, 2)}\n\`\`\`\n`;
    }
  }

  return prompt;
}

// ─── Claude API 호출 ───

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY');
  }

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    temperature: 0.3,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  };

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': CLAUDE_API_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown');
    throw new Error(`Claude API error: HTTP ${response.status} — ${errText.substring(0, 300)}`);
  }

  const data = await response.json() as {
    content: Array<{ type: string; text?: string }>;
  };

  const text = data.content?.find(c => c.type === 'text')?.text;
  if (!text) throw new Error('Claude returned empty response');
  return text;
}

// ─── 응답 파싱 + 검증 ───

interface AIDesignOutput {
  lower: SinkModule[];
  upper: SinkModule[];
}

function parseAndValidate(text: string, env: SinkEnv): AIDesignOutput {
  const json = extractJsonFromText(text);
  if (!json) throw new Error('Failed to parse JSON from Claude response');

  const lower = json.lower as SinkModule[] | undefined;
  const upper = json.upper as SinkModule[] | undefined;

  if (!Array.isArray(lower) || !Array.isArray(upper)) {
    throw new Error('Claude response missing lower or upper arrays');
  }

  // idx 재번호
  lower.forEach((m, i) => { m.idx = i; });
  upper.forEach((m, i) => { m.idx = i; });

  // 기본값 채우기
  for (const m of [...lower, ...upper]) {
    m.orientation = m.orientation ?? 'normal';
    if (m.kind === 'door' && !m.doorCount) {
      m.doorCount = m.width >= 600 ? 2 : 1;
    }
    if (m.kind === 'drawer' && !m.drawerCount) {
      m.drawerCount = 3;
    }
  }

  // 폭 합산 검증 (주선)
  const layoutType = env.layoutType ?? 'I';
  const depth = env.depth ?? 650;
  const hasLeft = (layoutType === 'L' || layoutType === 'U') && (env.secondaryLeftW ?? 0) > 0;
  const hasRight = layoutType === 'U' && (env.secondaryRightW ?? 0) > 0;
  const blindLeftW = hasLeft ? depth : 0;
  const blindRightW = hasRight ? depth : 0;
  const expectedPrimaryW = env.width - env.finishLeftW - env.finishRightW;

  const primaryLower = lower.filter(m => (m.orientation ?? 'normal') === 'normal');
  const primaryUpper = upper.filter(m => (m.orientation ?? 'normal') === 'normal');

  const lowerSum = primaryLower.reduce((s, m) => s + m.width, 0);
  const upperSum = primaryUpper.reduce((s, m) => s + m.width, 0);

  // 허용 오차 ±50mm 이내면 보정, 초과면 에러
  if (Math.abs(lowerSum - expectedPrimaryW) > 50) {
    log.warn({ lowerSum, expected: expectedPrimaryW }, 'Lower width sum mismatch — normalizing');
    normalizeWidths(primaryLower, expectedPrimaryW);
  } else if (lowerSum !== expectedPrimaryW) {
    normalizeWidths(primaryLower, expectedPrimaryW);
  }

  if (Math.abs(upperSum - expectedPrimaryW) > 50) {
    log.warn({ upperSum, expected: expectedPrimaryW }, 'Upper width sum mismatch — normalizing');
    normalizeWidths(primaryUpper, expectedPrimaryW);
  } else if (upperSum !== expectedPrimaryW) {
    normalizeWidths(primaryUpper, expectedPrimaryW);
  }

  return { lower, upper };
}

/** 모듈 폭 합산을 목표값으로 보정 */
function normalizeWidths(modules: SinkModule[], targetW: number): void {
  if (modules.length === 0) return;
  const totalW = modules.reduce((s, m) => s + m.width, 0);
  const diff = targetW - totalW;
  if (diff === 0) return;

  // 가장 넓은 비필수(storage/drawer) 모듈에 diff 흡수
  const ESSENTIAL = new Set(['sink', 'cook', 'hood', 'lt', 'blank']);
  const adjustable = modules.filter(m => !ESSENTIAL.has(m.type));
  const target = adjustable.length > 0
    ? adjustable.reduce((a, b) => b.width > a.width ? b : a)
    : modules.reduce((a, b) => b.width > a.width ? b : a);
  target.width = Math.max(200, target.width + diff);

  // 재검증
  const finalDiff = targetW - modules.reduce((s, m) => s + m.width, 0);
  if (finalDiff !== 0) {
    modules[modules.length - 1].width = Math.max(200, modules[modules.length - 1].width + finalDiff);
  }
}

// ─── 메인 엔트리 ───

export async function generateAIDesign(env: SinkEnv): Promise<SinkDesign> {
  const startTime = Date.now();

  try {
    // 1. 학습된 규칙 로드
    const rules = await getActiveRules();
    log.info({ ruleCount: rules.length }, 'Loaded active rules for AI design');

    // 2. 유사 환경 고평점 예시 검색
    const widthRange = 500; // ±500mm 범위
    const examples = await getHighRatedPairs(
      env.layoutType ?? 'I',
      env.width - widthRange,
      env.width + widthRange,
      4,
      3,
    );
    log.info({ exampleCount: examples.length }, 'Loaded few-shot examples');

    // 3. 프롬프트 조립
    const systemPrompt = buildSystemPrompt(rules, examples);
    const userMessage = `다음 환경에 맞는 싱크대 모듈 배치를 설계하세요.

환경 (SinkEnv):
${JSON.stringify(env, null, 2)}

주선(normal) 모듈 폭 합 = ${env.width - env.finishLeftW - env.finishRightW}mm (반드시 정확히 맞추세요)`;

    // 4. Claude API 호출
    log.info('Calling Claude API for AI design...');
    const responseText = await callClaude(systemPrompt, userMessage);

    // 5. 파싱 + 검증
    const { lower, upper } = parseAndValidate(responseText, env);

    const elapsed = Date.now() - startTime;
    log.info(
      { elapsed, lowerCount: lower.length, upperCount: upper.length },
      'AI design generated successfully',
    );

    // 6. SinkDesign 조립
    const designId = `sink-ai-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
    return {
      id: designId,
      timestamp: new Date().toISOString(),
      version: 'v1',
      env,
      lower,
      upper,
      meta: {
        generated_by: 'ai_design',
        seed: undefined,
        user_notes: `AI generated in ${elapsed}ms, ${rules.length} rules, ${examples.length} examples`,
      },
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    log.error({ error, elapsed }, 'AI design failed — falling back to random generator');

    // fallback: 기존 랜덤 생성기
    const fallbackDesign = generateRandomSinkDesign(env);
    fallbackDesign.meta = {
      ...fallbackDesign.meta,
      generated_by: 'random',
      user_notes: `AI fallback (error: ${error instanceof Error ? error.message : String(error)})`,
    };
    return fallbackDesign;
  }
}
