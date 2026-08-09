/**
 * CD-4: 현장 정보.
 *
 * 설치 작업지시서의 입력이다. **스냅샷이 아니라 설계**에 붙인다 —
 * 주소를 고쳤다고 설계 스냅샷 rev 가 올라가면 안 되기 때문이다.
 * 문서 발행 시점에 render_payload 로 복사돼 그 문서 안에서 동결된다.
 *
 * 연락처가 들어가므로 공유 링크가 붙는 문서(고객 확인서)에는 싣지 않는다.
 */

import { selectMany, upsertOne, ValidationError } from './supabase.js';

/** DB 컬럼과 1:1. 여기 없는 키는 버린다. */
const FIELDS = [
  'address',
  'address_detail',
  'floor',
  'has_elevator',
  'elevator_note',
  'access_note',
  'install_order',
  'contact_name',
  'contact_phone',
  'notes',
];

/** DB CHECK 와 같은 상한. 넘으면 여기서 막아 500 대신 400 을 준다. */
const MAX_LEN = {
  address: 200,
  address_detail: 100,
  floor: 30,
  elevator_note: 300,
  access_note: 1000,
  install_order: 2000,
  contact_name: 50,
  contact_phone: 30,
  notes: 2000,
};

export function normalizeSiteInfo(body) {
  const out = {};
  for (const key of FIELDS) {
    if (!(key in (body || {}))) continue;
    const raw = body[key];

    if (key === 'has_elevator') {
      // NULL(미확인) 과 false(없음) 를 구분해야 사다리차 판단이 된다.
      out[key] = raw === null || raw === '' || raw === undefined ? null : !!raw;
      continue;
    }

    if (raw === null || raw === undefined) {
      out[key] = null;
      continue;
    }
    const s = String(raw).trim();
    const limit = MAX_LEN[key];
    if (limit && s.length > limit) {
      throw new ValidationError(`${key} 는 ${limit}자를 넘을 수 없습니다`);
    }
    out[key] = s || null;
  }
  return out;
}

export async function getSiteInfo(env, designId) {
  const rows = await selectMany(env, 'design_site_info', {
    select: '*',
    design_id: `eq.${designId}`,
    limit: '1',
  });
  return (rows && rows[0]) || null;
}

export async function saveSiteInfo(env, designId, body) {
  const patch = normalizeSiteInfo(body);
  if (Object.keys(patch).length === 0) {
    throw new ValidationError('저장할 현장 정보가 없습니다');
  }
  return upsertOne(env, 'design_site_info', { design_id: designId, ...patch }, 'design_id');
}

/** 설치 지시서에 함께 실을 일정 (예정 순) */
export async function listSchedulesForDoc(env, designId) {
  return (
    (await selectMany(env, 'design_schedules', {
      select: 'type,title,scheduled_at,started_at,completed_at,assignee_name,location,status',
      design_id: `eq.${designId}`,
      order: 'scheduled_at.asc',
      limit: '100',
    })) || []
  );
}
