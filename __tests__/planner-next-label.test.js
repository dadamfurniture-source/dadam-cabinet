/**
 * 구조 단계 다음 버튼 — 누르면 BOM 산출로 간다(PLANNER_DONE). 라벨이 동작과 같아야 한다
 * (작업지시서 계획 work-order-stage.plan.md PR 5, 예전 라벨 "디테일 단계 →").
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../mockup-structure.html'), 'utf8');

test('#nextBtn 라벨은 "BOM 산출 →" 이고, 누르면 PLANNER_DONE 을 보낸다', () => {
  const btn = HTML.match(/<button[^>]*id="nextBtn"[^>]*>([^<]*)<\/button>/);
  expect(btn).not.toBeNull();
  expect(btn[1].trim()).toBe('BOM 산출 →');
  expect(btn[0]).not.toMatch(/디테일/);
  const handler = HTML.slice(HTML.indexOf("document.getElementById('nextBtn').onclick"));
  expect(handler.slice(0, 300)).toMatch(/sendPlannerState\('PLANNER_DONE'\)/);
});
