/**
 * 회계장부 — 내 자리 · 업체 과세 설정.
 *
 *   GET /ledger/me         구성원 누구나 — 역할 · 자격 · 할 수 있는 것 (화면이 무엇을 보일지 정한다)
 *                          ai — 사진 AI 읽기(칸 채우기 · 바로 올리기)를 쓰는 업체인가 (Agent · 시험, DB 0038 ledger_ai)
 *                          대표 · 실장에게는 여는 장부 목록 ledgers (본사 대표 · 실장은 공장 장부도 — ?company= 로 연다, 보기만)
 *   GET /ledger/settings   대표 · 실장 — company_settings.settings.tax { vat_type, business_kind }
 *   PUT /ledger/settings   대표 · 실장, 자격 full — tax 묶음만 바꾸고 다른 설정(원가 · 견적 …)은 그대로 둔다
 *     vat_type       general 일반과세 · simplified 간이과세 · exempt 면세 — 일반과세만 수금을 공급가 · 부가세로 나눈다
 *     business_kind  manufacturing 제조 · retail 도소매 — 수주 원가(자재 · 부속)의 계정을 고른다
 */
import { selectOne, upsertOne, ValidationError } from '../supabase.js';
import { ledgerAccess, ledgerList, ledgerAi, assertMoney, assertWritable } from './access.js';
import { VAT_TYPES, BUSINESS_KINDS } from './checks.js';

function taxOf(settings) {
  const t = (settings && settings.tax) || {};
  return {
    vat_type: VAT_TYPES.includes(t.vat_type) ? t.vat_type : null,
    business_kind: BUSINESS_KINDS.includes(t.business_kind) ? t.business_kind : null,
  };
}

async function settingsRow(env, companyId) {
  return selectOne(env, 'company_settings', { company_id: `eq.${companyId}`, select: 'settings' });
}

/** GET /ledger/me */
export async function ledgerMe(env, { user, company }) {
  let access;
  try {
    access = await ledgerAccess(env, user, { company });
  } catch (e) {
    // 자기 업체 장부 자격이 없어도 본사 대표 · 실장은 공장 장부를 본다
    const other = !company && e.code === 'not_entitled' ? (await ledgerList(env, user)).find((x) => !x.own) : null;
    if (!other) throw e;
    access = await ledgerAccess(env, user, { company: other.company_id });
  }
  const out = {
    company_id: access.companyId,
    role: access.role,
    money: access.money,
    level: access.level,
    viewing: access.viewing,
    can_upload: access.level === 'full',
    can_write: access.money && access.level === 'full',
    ai: await ledgerAi(env, access.companyId),
  };
  if (access.money) {
    out.tax = taxOf((await settingsRow(env, access.companyId) || {}).settings);
    out.ledgers = await ledgerList(env, user);
  }
  return out;
}

/** GET /ledger/settings */
export async function getLedgerSettings(env, { user, company }) {
  const access = await ledgerAccess(env, user, { company });
  assertMoney(access);
  return taxOf((await settingsRow(env, access.companyId) || {}).settings);
}

/** PUT /ledger/settings */
export async function putLedgerSettings(env, { user, body }) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  assertWritable(access);
  const b = body || {};
  if (!VAT_TYPES.includes(b.vat_type)) throw new ValidationError(`vat_type 은 ${VAT_TYPES.join(' · ')} 중 하나입니다`);
  if (!BUSINESS_KINDS.includes(b.business_kind)) throw new ValidationError(`business_kind 는 ${BUSINESS_KINDS.join(' · ')} 중 하나입니다`);
  const prev = await settingsRow(env, access.companyId);
  const settings = { ...((prev && prev.settings) || {}), tax: { vat_type: b.vat_type, business_kind: b.business_kind } };
  const row = await upsertOne(env, 'company_settings', {
    company_id: access.companyId,
    settings,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, 'company_id');
  return taxOf(row && row.settings);
}
