/**
 * 프로젝트가 지금 단계에 머문 날 — 느림 · 멈춤 판정 한 곳.
 * (2026-11-23 대표님 답 「상담 2/7 실측 2/7 설계 3/7 견적 3/7 계약 3/7 (느림/멈춤 일)」 · 생산 · 설치는 잡은 날이 지나면 멈춤)
 *
 * 프로젝트 목록(company-projects.js — 줄마다 stay) · 프로젝트 한 건(company-project.js) · 대시보드(company-dashboard.js)가
 * 같은 함수를 쓴다 — 목록의 「n일째 멈춤」과 대시보드의 막대가 어긋나지 않는다.
 *
 *   stay { days, state }   days = 그 단계에 머문 날(생산 · 설치는 null) · state = fresh(여유) | slow(느림) | stuck(멈춤)
 *   세기 시작하는 날  상담 = 프로젝트를 만든 날 · 실측 = 실측 예정일(끝냈으면 끝낸 날) ·
 *                    설계 = 실측을 끝낸 날(실측이 없으면 만든 날) · 견적 = 견적을 보낸 날(답을 받았으면 그날) ·
 *                    계약 = 계약을 만든 날
 *   생산 · 설치       잡아 둔 제작 완료일 · 설치일이 지났는데 끝내지 않았으면 멈춤, 아니면 여유
 */

import { selectMany } from './supabase.js';
import { kstDate } from './production/service.js';

const DAY_MS = 86400000;
/** 주소가 길어지지 않게 id 목록을 나눠 묻는 크기 */
const ID_CHUNK = 100;

/** 머문 날을 재는 단계 — 끝난 것(done)은 재지 않는다 */
export const STAY_STEPS = Object.freeze(['consult', 'measure', 'design', 'quote', 'contract', 'make', 'install']);
/** 며칠을 머물면 느림 · 멈춤인가 (2026-11-23 대표님). 생산 · 설치는 잡은 날이 지났는지로 본다 */
export const STUCK_DAYS = Object.freeze({
  consult: Object.freeze({ slow: 2, stuck: 7 }),
  measure: Object.freeze({ slow: 2, stuck: 7 }),
  design: Object.freeze({ slow: 3, stuck: 7 }),
  quote: Object.freeze({ slow: 3, stuck: 7 }),
  contract: Object.freeze({ slow: 3, stuck: 7 }),
});
/** 끝난 일정 */
const SCHEDULE_OVER = new Set(['cancelled', 'completed', 'done']);

/** 'YYYY-MM-DD' 둘 사이 날수 (b − a) */
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * 한 프로젝트가 지금 단계에 머문 날과 상태 — { since, days, state: fresh | slow | stuck }.
 * item = 프로젝트 목록의 한 줄 (step · next · visit · created_at)
 */
export function stayOf(item, { today, orderOf = new Map(), lateMake = new Set(), lateInstall = new Set() }) {
  const step = item.step;
  if (step === 'make' || step === 'install') {
    const late = (step === 'make' ? lateMake : lateInstall).has(item.id);
    return { since: null, days: null, state: late ? 'stuck' : 'fresh' };
  }
  const limit = STUCK_DAYS[step];
  if (!limit) return { since: null, days: null, state: 'fresh' };
  const visit = item.visit || null;
  const next = item.next || null;
  let since = null;
  if (step === 'measure') since = visit ? (visit.status === 'done' ? visit.done_at : visit.scheduled_at) : null;
  else if (step === 'design') since = visit && visit.status === 'done' ? visit.done_at : null;
  else if (step === 'quote') since = next ? next.since : null;
  else if (step === 'contract') since = (orderOf.get(item.id) || {}).ordered_at || (next ? next.since : null);
  since = since || item.created_at || null;
  const days = since ? Math.max(0, dayDiff(kstDate(since), today)) : 0;
  return { since, days, state: days >= limit.stuck ? 'stuck' : days >= limit.slow ? 'slow' : 'fresh' };
}

/**
 * 잡아 둔 날이 지났는데 끝내지 않은 일정이 있는 프로젝트.
 * 일정 줄의 프로젝트 = project_id, 없으면 묶어 읽은 설계의 것(designs.project_id)
 */
export function lateProjects(schedules, type, today) {
  const out = new Set();
  for (const s of schedules || []) {
    if (s.type !== type || s.completed_at || SCHEDULE_OVER.has(s.status) || !s.scheduled_at) continue;
    const pid = s.project_id || (s.designs && s.designs.project_id) || null;
    if (pid && kstDate(s.scheduled_at) < today) out.add(pid);
  }
  return out;
}

/**
 * 그 설계들의 제작 완료 · 설치 일정 가운데 날이 지났는데 끝내지 않은 것 → { lateMake, lateInstall } (프로젝트 번호 묶음).
 * designs = [{ id, project_id }] — 생산 · 설치 단계 프로젝트의 설계만 넘기면 된다.
 */
export async function lateOf(env, designs, today) {
  const out = { lateMake: new Set(), lateInstall: new Set() };
  const list = (designs || []).filter((d) => d && d.id && d.project_id);
  if (!list.length) return out;
  const projectOfDesign = new Map(list.map((d) => [d.id, d.project_id]));
  const ids = [...projectOfDesign.keys()];
  const chunks = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const rows = (
    await Promise.all(
      chunks.map((part) =>
        selectMany(env, 'design_schedules', {
          design_id: `in.(${part.join(',')})`,
          type: 'in.(manufacturing_end,installation)',
          completed_at: 'is.null',
          scheduled_at: `lt.${today}T00:00:00+09:00`,
          select: 'design_id,type,status,scheduled_at,completed_at',
          limit: '500',
        })
      )
    )
  ).flat();
  const withProject = (rows || []).map((s) => ({ ...s, project_id: projectOfDesign.get(s.design_id) || null }));
  out.lateMake = lateProjects(withProject, 'manufacturing_end', today);
  out.lateInstall = lateProjects(withProject, 'installation', today);
  return out;
}

/**
 * 줄에 싣는 값 — { days, state } (진행 중이고 재는 단계일 때만, 아니면 null)
 */
export function stayRow(item, ctx) {
  if (!item || (item.status && item.status !== 'active') || !STAY_STEPS.includes(item.step)) return null;
  const s = stayOf(item, ctx);
  return { days: s.days, state: s.state };
}
