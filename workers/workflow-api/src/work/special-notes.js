/**
 * 특별 지시 — 지시서 맨 위 빨간 상자 (2026-11-05 사장님 메모 「일반적이지 않은 특수한 경우가 발생할 경우 따로 메세지 전달」 →
 * 되물음 답 「자동 + 사무실 글」).
 *
 *   자동   동결본(설계 · BOM)에서 뽑히는 것 — 숫자를 새로 만들지 않고 행 · 모듈에 이미 있는 것만 옮긴다.
 *          재단  색이 지정된 몸통 부재 · 원장보다 긴 부재 · [확인 필요] 부재
 *          조립  알루미늄 프레임 유리 도어(구매품)
 *          도어  도어 색 미지정 · 도어 색이 여럿
 *          상판  하부장 위 수납장 자리에서 끊긴 상판 · 얕은 하부장 (상판은 깊은 쪽 깊이 한 장 — 2026-11-14 대표님)
 *          설치  콘센트 타공(뒷판 비고) · 싱크볼 · 수전 · 쿡탑 자리 · 후드 덕트
 *   사무실  발행 본문 notes { cut, assembly, door, top, install } — 줄마다 한 항목 (자투리 판 쓰기 · 엘리베이터 없음 …).
 *
 * 발행 때 render_payload.special_notes 로 고정한다 (documents.js). 작업자 역할이 있는 재단 · 조립 · 설치는
 * check_list 에 `note-<역할>-n` 필수 항목으로도 넣어 작업자 화면 필수 확인에 그대로 뜬다 (확인하지 않으면 완료 기록이 막힌다 — v1 block must).
 * 순수 함수 — DB 없음.
 */

import {
  materialsOf,
  hardwareOf,
  isDoorClass,
  isOutsourcedCutRow,
  isOutsourcedTopRow,
} from '../work-order-data.js';
import { isSinkModule, isCookModule } from '../countertop.js';

/** 특별 지시 역할 — 지시서 꾸러미 이름과 같다 (install 은 시공 지시서) */
export const NOTE_ROLES = Object.freeze(['cut', 'assembly', 'door', 'top', 'install']);
export const NOTE_ROLE_LABEL = Object.freeze({
  cut: '재단',
  assembly: '조립',
  door: '도어',
  top: '상판',
  install: '설치',
});
/** 작업자 필수 확인에도 넣는 역할 (check-items.js CHECK_ROLES 중) */
const CHECK_NOTE_ROLES = ['cut', 'assembly', 'install'];
const OFFICE_MAX_LINES = 10;
const OFFICE_MAX_LEN = 300;

const qty = (m) => Math.max(0, Math.round(Number(m && m.qty) || 0));
const sum = (rows) => rows.reduce((s, m) => s + qty(m), 0);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const isInHouse = (m) => !isDoorClass(m) && !isOutsourcedCutRow(m) && !isOutsourcedTopRow(m);
const isDoorPanel = (m) =>
  m.slot === 'door' || m.slot === 'drawerFront' || m.part === '도어' || m.part === '서랍도어';
const moduleLabel = (item, mi, m) =>
  `${mi + 1} ${String(m.name || m.type || '').split(' — ')[0]}`.trim();

/** 동결본 → 자동 특별 지시 { 역할: [글] } */
export function autoNotesOf(snapshot, { cutPlan = null } = {}) {
  const out = Object.fromEntries(NOTE_ROLES.map((r) => [r, []]));
  const materials = materialsOf(snapshot);
  const hardware = hardwareOf(snapshot);
  const inHouse = materials.filter(isInHouse);

  // 재단 — 색이 지정된 몸통 부재 (도어재가 아닌데 마감 코드가 있다)
  const colored = new Map();
  inHouse
    .filter((m) => m.finishCode)
    .forEach((m) => colored.set(m.finishCode, (colored.get(m.finishCode) || []).concat([m])));
  colored.forEach((rows, code) =>
    out.cut.push(
      `색 지정 부재 ${sum(rows)}장 — ${code} (${uniq(rows.map((m) => m.part)).join(' · ')})`
    )
  );
  // 재단 — 원장보다 긴 부재 (사내)
  const plan = cutPlan || (snapshot && snapshot.cut_plan_payload) || null;
  const longs = (plan && Array.isArray(plan.unallocated) ? plan.unallocated : []).filter(
    (u) => u.partClass !== '도어'
  );
  if (longs.length)
    out.cut.push(
      `원장보다 긴 부재 ${longs.reduce((s, u) => s + (Number(u.qty) || 0), 0)}장 — 따로 재단 (${uniq(longs.flatMap((u) => u.parts || [])).join(' · ')})`
    );
  // 재단 — [확인 필요]
  const confirm = inHouse.filter((m) => /확인 필요/.test(String(m.note || '')));
  if (confirm.length)
    out.cut.push(
      `[확인 필요] 부재 ${confirm.length}줄 — 자르기 전 담당자에게 확인 (${uniq(confirm.map((m) => m.part)).join(' · ')})`
    );

  // 조립 — 유리 도어 (구매품)
  const glass = materials.filter((m) => /유리/.test(String(m.material || '')));
  if (glass.length)
    out.assembly.push(`알루미늄 프레임 유리 도어 ${sum(glass)}짝 — 구매품 입고 확인 후 달기`);

  // 도어 — 색
  const doors = materials.filter(
    (m) => isDoorClass(m) && isDoorPanel(m) && !/유리/.test(String(m.material || ''))
  );
  if (doors.length) {
    const none = doors.filter((m) => !m.finishCode);
    const codes = uniq(doors.map((m) => m.finishCode));
    if (none.length) out.door.push(`도어 색 미지정 ${sum(none)}장 — 발주 전 색 확인`);
    if (codes.length > 1)
      out.door.push(
        `도어 색 ${codes.length}가지 — ${codes.map((c) => `${c} ${sum(doors.filter((m) => m.finishCode === c))}장`).join(' · ')}`
      );
  }

  // 상판 · 설치 — 설계 모듈에서
  const items =
    snapshot && snapshot.design_payload && Array.isArray(snapshot.design_payload.items)
      ? snapshot.design_payload.items
      : [];
  const tops = materials.filter((m) => m.slot === 'top' || m.part === '상판');
  items.forEach((item, ii) => {
    const mods = Array.isArray(item.modules) ? item.modules : [];
    const name = items.length > 1 ? `${item.labelName || item.name || `품목 ${ii + 1}`} · ` : '';
    if (mods.some((m) => m && m.cabinetOnTop === true) && tops.length > 1)
      out.top.push(
        `${name}하부장 위 수납장 자리에서 끊긴 상판 — 장마다 따로 (발주서 ${tops.length}쪽)`
      );
    // 얕은 하부장 (2026-11-14 대표님 「얕은 하부장이 생기면 상판은 깊이가 큰 쪽을 기준으로 한 장 … 발주 보고서에 하부장 얕다고 알려주기」) —
    //   상판이 지나는 하부장(countertop.js 와 같은 가름 — 키큰장 · 냉장고 자리 빼고)의 깊이가 섞여 있을 때만. 깊이는 설계 모듈에 적힌 값 그대로
    const lowers = mods
      .map((m, mi) => ({ m, mi }))
      .filter(
        ({ m }) =>
          m && m.pos === 'lower' && m.type !== 'tall' && m.type !== 'fridge' && Number(m.d) > 0
      );
    const deep = lowers.reduce((d, { m }) => Math.max(d, Number(m.d)), 0);
    const shallow = lowers.filter(({ m }) => Number(m.d) < deep);
    if (shallow.length) {
      out.top.push(
        `${name}얕은 하부장 ${shallow.length}개 — ${shallow.map(({ m, mi }) => `${moduleLabel(item, mi, m)} (깊이 ${Math.round(Number(m.d))})`).join(' · ')} · 다른 하부장 깊이 ${Math.round(deep)} · 상판은 깊은 쪽 기준 한 장`
      );
    }
    mods.forEach((m, mi) => {
      if (!m) return;
      if (isSinkModule(m))
        out.install.push(
          `${name}싱크볼 · 수전 타공 자리 — ${moduleLabel(item, mi, m)} (급배수 연결)`
        );
      else if (isCookModule(m))
        out.install.push(`${name}쿡탑 타공 자리 — ${moduleLabel(item, mi, m)} (가스 · 전기 확인)`);
      if (m.type === 'hood' || /후드/.test(String(m.name || '')))
        out.install.push(`${name}후드 덕트 · 전기 — ${moduleLabel(item, mi, m)}`);
    });
  });
  // 설치 — 콘센트 (뒷판 비고의 타공 · 높이, 엔진 bomOutletNoteOf)
  materials
    .filter((m) => /콘센트 타공/.test(String(m.note || '')))
    .forEach((m) => {
      out.install.push(
        `${String(m.note)
          .match(/콘센트 타공[^·]*/)[0]
          .trim()} — ${String(m.module || '').trim() || '모듈'} · 전기 확인`
      );
    });
  if (
    !materials.some((m) => /콘센트 타공/.test(String(m.note || ''))) &&
    hardware.some((h) => h.category === '전기')
  ) {
    out.install.push(
      `콘센트 ${sum(hardware.filter((h) => h.category === '전기'))}구 — 위치 현장 확인 · 전기 확인`
    );
  }
  NOTE_ROLES.forEach((r) => {
    out[r] = uniq(out[r]);
  });
  return out;
}

/** 발행 본문 notes → { 역할: [글] } — 줄마다 한 항목, 빈 줄 빼고, 역할마다 10줄 · 줄마다 300자까지 */
export function officeNotesOf(notes) {
  const out = Object.fromEntries(NOTE_ROLES.map((r) => [r, []]));
  if (!notes || typeof notes !== 'object') return out;
  NOTE_ROLES.forEach((r) => {
    const v = notes[r];
    const lines = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : [];
    out[r] = lines
      .map((s) =>
        String(s || '')
          .trim()
          .slice(0, OFFICE_MAX_LEN)
      )
      .filter(Boolean)
      .slice(0, OFFICE_MAX_LINES);
  });
  return out;
}

/**
 * 발행 때 고정하는 특별 지시 — { 역할: [{ text, src: 'auto'|'office' }] }. roles 를 주면 그 역할만 (작업지시서 = 재단 · 조립 · 도어 · 상판, 시공 지시서 = 설치).
 */
export function specialNotesOf(snapshot, notes, { roles = NOTE_ROLES, cutPlan = null } = {}) {
  const auto = autoNotesOf(snapshot, { cutPlan });
  const office = officeNotesOf(notes);
  const out = {};
  roles.forEach((r) => {
    const list = auto[r]
      .map((text) => ({ text, src: 'auto' }))
      .concat(office[r].map((text) => ({ text, src: 'office' })));
    if (list.length) out[r] = list;
  });
  return out;
}

/** 고정한 확인 목록에 특별 지시를 필수 항목으로 더한다 (재단 · 조립 · 설치) — 항목 키 note-<역할>-n (DB work_checks.item_key 모양) */
export function withNoteChecks(checkList, specialNotes) {
  if (!checkList || !checkList.roles || !specialNotes) return checkList;
  const roles = { ...checkList.roles };
  CHECK_NOTE_ROLES.forEach((r) => {
    const list = specialNotes[r];
    if (!Array.isArray(list) || !list.length || !Array.isArray(roles[r])) return;
    roles[r] = roles[r].concat(
      list.map((n, i) => ({
        key: `note-${r}-${i + 1}`,
        label: `특별 지시 — ${n.text}`,
        short: `특별 지시 ${i + 1}`,
        scope: 'order',
        must: true,
        photo: 'none',
        note: true,
        src: n.src,
      }))
    );
  });
  return { ...checkList, roles };
}

/** 문서가 고정한 특별 지시 (옛 문서는 빈 값) */
export function specialNotesOfDoc(doc) {
  const v = doc && doc.render_payload && doc.render_payload.special_notes;
  return v && typeof v === 'object' ? v : {};
}
