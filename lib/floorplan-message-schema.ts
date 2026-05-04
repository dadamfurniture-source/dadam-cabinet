/**
 * iframe postMessage 양방향 계약 — 메시지 타입 정의 + 런타임 type guard
 *
 * M0 결정 §4: zod 도입은 빌드 시스템 변경이라 부담 → 수동 type guard로 시작.
 * 향후 zod 또는 valibot 도입 시 본 파일의 인터페이스만 그대로 두고 구현 교체.
 *
 * 사용:
 *   부모(ui-step1.js) — 송신 시 타입 캐스트 + buildXxxMessage 헬퍼
 *                     — 수신 시 isChildToParent로 검증
 *   자식(planner-vite/App.tsx) — 송신 시 buildXxxMessage 헬퍼
 *                              — 수신 시 isParentToChild로 검증
 */

import type { Floorplan, ItemV2, ModuleV2 } from './floorplan-types';
import { isFloorplan } from './floorplan-types';

// ============================================================
// 공통
// ============================================================

export type CameraView = 'top' | 'front' | 'perspective';
export type EditMode = 'view' | 'edit' | 'readonly';

export const VALID_CAMERA_VIEWS: readonly CameraView[] = ['top', 'front', 'perspective'] as const;
export const VALID_EDIT_MODES: readonly EditMode[] = ['view', 'edit', 'readonly'] as const;

/**
 * nonce — 같은 요청 echo 차단용. 부모가 보낸 메시지를 자식이 다시 부모에게 송신하는 ping-pong 방지.
 */
export type Nonce = string;

export function generateNonce(): Nonce {
  // 충분한 엔트로피, 16자.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-8);
}

// ============================================================
// 부모 → 자식
// ============================================================

export interface UpdateFloorplanMessage {
  type: 'UPDATE_FLOORPLAN';
  payload: {
    schemaVersion: 2;
    itemId: number;
    floorplan: Floorplan;
    modules: ModuleV2[];
    specs: ItemV2['specs'];
  };
  nonce: Nonce;
}

export interface SetCameraViewMessage {
  type: 'SET_CAMERA_VIEW';
  view: CameraView;
}

export interface SetEditModeMessage {
  type: 'SET_EDIT_MODE';
  mode: EditMode;
}

export interface LoadHitlCaseMessage {
  type: 'LOAD_HITL_CASE';
  payload: ItemV2;
}

export interface PingMessage {
  type: 'PING';
  nonce: Nonce;
}

export type ParentToChildMessage =
  | UpdateFloorplanMessage
  | SetCameraViewMessage
  | SetEditModeMessage
  | LoadHitlCaseMessage
  | PingMessage;

// ============================================================
// 자식 → 부모
// ============================================================

export type FloorplanChangeTrigger = 'drag' | 'rotate' | 'add' | 'delete' | 'resize' | 'zindex' | 'init';

export interface FloorplanChangedMessage {
  type: 'FLOORPLAN_CHANGED';
  payload: {
    floorplan: Floorplan;
    trigger: FloorplanChangeTrigger;
  };
  nonce: Nonce;
}

export interface ModuleChangedMessage {
  type: 'MODULE_CHANGED';
  payload: {
    modules: ModuleV2[];
  };
  nonce: Nonce;
}

export interface PlannerReadyMessage {
  type: 'PLANNER_READY';
  version: string;
}

export interface PlannerErrorMessage {
  type: 'PLANNER_ERROR';
  code: string;
  message: string;
}

export interface PongMessage {
  type: 'PONG';
  nonce: Nonce;
}

export type ChildToParentMessage =
  | FloorplanChangedMessage
  | ModuleChangedMessage
  | PlannerReadyMessage
  | PlannerErrorMessage
  | PongMessage;

// ============================================================
// 모든 메시지 타입
// ============================================================

export type PlannerMessage = ParentToChildMessage | ChildToParentMessage;

const PARENT_TO_CHILD_TYPES = new Set<ParentToChildMessage['type']>([
  'UPDATE_FLOORPLAN',
  'SET_CAMERA_VIEW',
  'SET_EDIT_MODE',
  'LOAD_HITL_CASE',
  'PING',
]);

const CHILD_TO_PARENT_TYPES = new Set<ChildToParentMessage['type']>([
  'FLOORPLAN_CHANGED',
  'MODULE_CHANGED',
  'PLANNER_READY',
  'PLANNER_ERROR',
  'PONG',
]);

// ============================================================
// Type guards
// ============================================================

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isUpdateFloorplanMessage(value: unknown): value is UpdateFloorplanMessage {
  if (!isObj(value) || value.type !== 'UPDATE_FLOORPLAN') return false;
  const p = value.payload;
  if (!isObj(p)) return false;
  return (
    p.schemaVersion === 2 &&
    isNumber(p.itemId) &&
    isFloorplan(p.floorplan) &&
    Array.isArray(p.modules) &&
    isObj(p.specs) &&
    isString(value.nonce)
  );
}

export function isSetCameraViewMessage(value: unknown): value is SetCameraViewMessage {
  return (
    isObj(value) &&
    value.type === 'SET_CAMERA_VIEW' &&
    isString(value.view) &&
    (VALID_CAMERA_VIEWS as readonly string[]).includes(value.view)
  );
}

export function isSetEditModeMessage(value: unknown): value is SetEditModeMessage {
  return (
    isObj(value) &&
    value.type === 'SET_EDIT_MODE' &&
    isString(value.mode) &&
    (VALID_EDIT_MODES as readonly string[]).includes(value.mode)
  );
}

export function isLoadHitlCaseMessage(value: unknown): value is LoadHitlCaseMessage {
  if (!isObj(value) || value.type !== 'LOAD_HITL_CASE') return false;
  const p = value.payload;
  if (!isObj(p)) return false;
  return (
    p.schemaVersion === 2 &&
    isNumber(p.uniqueId) &&
    isFloorplan(p.floorplan) &&
    Array.isArray(p.modules) &&
    isObj(p.specs)
  );
}

export function isPingMessage(value: unknown): value is PingMessage {
  return isObj(value) && value.type === 'PING' && isString(value.nonce);
}

export function isParentToChildMessage(value: unknown): value is ParentToChildMessage {
  if (!isObj(value) || !isString(value.type)) return false;
  if (!(PARENT_TO_CHILD_TYPES as Set<string>).has(value.type)) return false;
  return (
    isUpdateFloorplanMessage(value) ||
    isSetCameraViewMessage(value) ||
    isSetEditModeMessage(value) ||
    isLoadHitlCaseMessage(value) ||
    isPingMessage(value)
  );
}

export function isFloorplanChangedMessage(value: unknown): value is FloorplanChangedMessage {
  if (!isObj(value) || value.type !== 'FLOORPLAN_CHANGED') return false;
  const p = value.payload;
  if (!isObj(p) || !isFloorplan(p.floorplan)) return false;
  if (!isString(p.trigger)) return false;
  const validTriggers: FloorplanChangeTrigger[] = ['drag', 'rotate', 'add', 'delete', 'resize', 'zindex', 'init'];
  if (!(validTriggers as string[]).includes(p.trigger)) return false;
  return isString(value.nonce);
}

export function isModuleChangedMessage(value: unknown): value is ModuleChangedMessage {
  if (!isObj(value) || value.type !== 'MODULE_CHANGED') return false;
  const p = value.payload;
  return isObj(p) && Array.isArray(p.modules) && isString(value.nonce);
}

export function isPlannerReadyMessage(value: unknown): value is PlannerReadyMessage {
  return isObj(value) && value.type === 'PLANNER_READY' && isString(value.version);
}

export function isPlannerErrorMessage(value: unknown): value is PlannerErrorMessage {
  return (
    isObj(value) &&
    value.type === 'PLANNER_ERROR' &&
    isString(value.code) &&
    isString(value.message)
  );
}

export function isPongMessage(value: unknown): value is PongMessage {
  return isObj(value) && value.type === 'PONG' && isString(value.nonce);
}

export function isChildToParentMessage(value: unknown): value is ChildToParentMessage {
  if (!isObj(value) || !isString(value.type)) return false;
  if (!(CHILD_TO_PARENT_TYPES as Set<string>).has(value.type)) return false;
  return (
    isFloorplanChangedMessage(value) ||
    isModuleChangedMessage(value) ||
    isPlannerReadyMessage(value) ||
    isPlannerErrorMessage(value) ||
    isPongMessage(value)
  );
}

// ============================================================
// 빌더 헬퍼 (송신 측에서 nonce 자동 생성)
// ============================================================

export function buildUpdateFloorplan(
  itemId: number,
  floorplan: Floorplan,
  modules: ModuleV2[],
  specs: ItemV2['specs'],
  nonce?: Nonce,
): UpdateFloorplanMessage {
  return {
    type: 'UPDATE_FLOORPLAN',
    payload: { schemaVersion: 2, itemId, floorplan, modules, specs },
    nonce: nonce ?? generateNonce(),
  };
}

export function buildFloorplanChanged(
  floorplan: Floorplan,
  trigger: FloorplanChangeTrigger,
  nonce?: Nonce,
): FloorplanChangedMessage {
  return {
    type: 'FLOORPLAN_CHANGED',
    payload: { floorplan, trigger },
    nonce: nonce ?? generateNonce(),
  };
}
