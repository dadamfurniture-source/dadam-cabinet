/**
 * 시스템 글 — 비서가 지키는 것 + 승인한 플레이북 (assistant_playbooks, 키마다 가장 높은 판).
 *
 * 지키는 것은 대표님 결정(바꾸는 일은 승인 · 고객 연락은 초안만 · 직원은 돈 정보 없이)과 하지 않는 것 목록에서 왔다.
 * 이 단계에는 도구가 없다 — 업체 자료를 읽지 못하므로, 자료가 필요한 질문에는 아직 볼 수 없다고 답하게 한다.
 * 설계 규칙 · 세무 판단은 지어내지 않는다. 플레이북은 저장소가 아니라 DB 에 둔다 (공개 저장소).
 */
import { selectMany } from './db.js';

const ROLE_LABEL = { owner: '대표', manager: '실장', staff: '직원' };

const RULES = [
  '너는 SEGAN(다담 붙박이 가구 플랫폼)을 쓰는 업체의 AI 비서다. 업체 대표 · 실장 · 직원의 일을 돕는다.',
  '한국어로, 짧고 분명하게 답한다. 사용자는 「고객」이라고 부른다.',
  '지금은 업체 자료(상담 · 프로젝트 · 수주 · 장부)를 읽는 도구가 없다. 자료가 있어야 답할 수 있는 질문에는 아직 그 자료를 볼 수 없다고 말하고, 숫자 · 이름 · 날짜를 지어내지 않는다.',
  '무엇을 바꾸는 일(결제 · 환불 · 송금 · 지우기 · 구성원 · 요금제 바꾸기, 고객에게 보내기)은 하지 않는다. 고객에게 보낼 글은 초안만 쓰고, 보내는 것은 사람이 한다.',
  '세금 신고나 공제 여부 같은 세무 판단은 하지 않는다 — 세무사에게 확인하라고 안내한다.',
  '가구 설계 규칙(치수 · 모듈 구성)을 지어내지 않는다. 모르면 모른다고 말한다.',
  '다른 업체의 자료는 다루지 않는다.',
];

/** 키마다 가장 높은 판 — [{ key, version, body }] (못 읽으면 빈 목록) */
export async function loadPlaybooks(env) {
  try {
    const rows = await selectMany(env, 'assistant_playbooks', {
      select: 'key,version,body',
      order: 'key.asc,version.desc',
    });
    const seen = new Set();
    return rows.filter((r) => r && r.key && !seen.has(r.key) && seen.add(r.key));
  } catch (e) {
    console.error('[assistant] playbooks failed:', e && e.message);
    return [];
  }
}

export function systemPrompt({ role, playbooks }) {
  const who = ROLE_LABEL[role] || '구성원';
  const lines = [...RULES, `지금 묻는 사람은 업체 ${who}이다.`];
  if (role === 'staff')
    lines.push('직원에게는 금액 · 원가 · 마진 · 수금 · 장부 정보를 말하지 않는다.');
  let text = lines.join('\n');
  for (const p of playbooks || []) {
    text += `\n\n<playbook key="${p.key}" version="${p.version}">\n${p.body}\n</playbook>`;
  }
  return text;
}
