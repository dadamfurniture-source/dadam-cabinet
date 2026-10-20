/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
/**
 * T1 (PR1) 판재 겹침 판정 — PR7 에서 운영 코드 js/detaildesign/assembly-check.js 로 옮겼다.
 * 시험·도구가 쓰던 이름을 그대로 내보낸다.
 */
const C = require('../js/detaildesign/assembly-check.js');

module.exports = {
  DEFAULT_LIMITS: C.DEFAULT_LIMITS,
  IDENTITY: C.IDENTITY,
  apply: C.apply,
  cornersOf: C.cornersOf,
  worldAabbOf: C.worldAabbOf,
  penetrationDepth: C.penetrationDepth,
  intersectionVolume: C.intersectionVolume,
  boxPairOverlap: C.boxPairOverlap,
  pieceOverlap: C.pieceOverlap,
  isOverlap: C.isOverlap,
  findOverlaps: C.findOverlaps,
  rectilinearRects: C.rectilinearRects,
};
