// ═══ Supabase RAG Search — 카테고리별 설계 규칙 검색 ═══
// Parse Wall Data → [이 노드] → Build All Prompts
// Supabase quick_trigger_search RPC 호출 후 규칙 분류
const input = $('Parse Wall Data').first().json;
const category = (input.category || 'sink').toLowerCase();
const style = input.style || '';

// ─── Trigger Map (MCP trigger-map.ts와 동일) ───
const TRIGGER_MAP = {
  sink: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  wardrobe: ['붙박이장', '좌대', '상몰딩', '짧은옷', '긴옷', '서랍', '스마트바', '배경보정', '벽면마감'],
  fridge: ['냉장고장', '상부장', 'EL장', '홈카페', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  vanity: ['화장대', '서랍', '미러', '배경보정', '벽면마감'],
  shoe: ['신발장', '서랍', '선반', '배경보정', '벽면마감'],
  storage: ['수납장', '선반', '서랍', '배경보정', '벽면마감'],
};

const COLOR_KEYWORDS = ['화이트', '그레이', '블랙', '오크', '월넛', '무광', '유광'];
const colorHits = COLOR_KEYWORDS.filter(k => style.includes(k));
const triggers = [...(TRIGGER_MAP[category] || TRIGGER_MAP.sink), ...colorHits.slice(0, 5)];

// ─── Supabase RPC 호출 ───
const SUPABASE_URL = '%%SUPABASE_URL%%';
const SUPABASE_ANON_KEY = '%%SUPABASE_ANON_KEY%%';

let rules = [];
try {
  const response = await this.helpers.request({
    method: 'POST',
    uri: SUPABASE_URL + '/rest/v1/rpc/quick_trigger_search',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: {
      query_triggers: triggers,
      filter_category: category,
      limit_count: 25,
    },
    json: true,
    timeout: 15000,
  });
  if (Array.isArray(response)) {
    rules = response;
  }
} catch (e) {
  console.log('RAG search failed (using defaults):', e.message);
}

// ─── 규칙 분류 (rule-classifier.ts와 동일) ───
const classified = {
  background: [],
  modules: [],
  doors: [],
  materials: [],
};

const DEFAULT_BACKGROUND = [
  '- Clean, bright walls with smooth finished surface',
  '- Natural light coming into the space',
  '- Modern minimal interior design',
];

for (const rule of rules) {
  const type = rule.rule_type || rule.chunk_type || 'module';
  switch (type) {
    case 'background':
      classified.background.push('- ' + rule.content);
      break;
    case 'module':
      classified.modules.push('- ' + (rule.triggers && rule.triggers[0] ? rule.triggers[0] : '') + ': ' + rule.content);
      break;
    case 'door':
      classified.doors.push('- ' + (rule.triggers && rule.triggers[0] ? rule.triggers[0] : '') + ': ' + rule.content);
      break;
    case 'material':
    case 'material_keyword':
      classified.materials.push(rule);
      break;
  }
}

if (classified.background.length === 0) {
  classified.background = DEFAULT_BACKGROUND;
}

// ─── Pass through all input data + RAG results ───
return [{
  ...input,
  ragRules: classified,
  ragTriggers: triggers,
  ragRuleCount: rules.length,
}];
