#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// Supabase API 통합 테스트
// 전제: MCP 서버가 localhost:3200에 실행 중
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const BASE = 'http://localhost:3200';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 테스트용 계정
const TEST_EMAIL = 'apitest-' + Date.now() + '@test.dadam.local';
const TEST_PASSWORD = 'Test@1234!Dadam';

let userToken = null;
let createdDesignId = null;
let createdImageId = null;

// ─── 유틸리티 ───
function log(emoji, msg, detail) {
  console.log(`${emoji} ${msg}`);
  if (detail) console.log('  ', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).substring(0, 500));
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  return { status: res.status, ok: res.ok, json, text };
}

let testUserId = null;

// ─── 1. Admin API로 자동 확인된 테스트 유저 생성 + JWT 발급 ───
async function step1_login() {
  log('🔐', '=== Step 1: Admin API로 테스트 유저 생성 + JWT 발급 ===');

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    log('❌', 'SUPABASE_SERVICE_ROLE_KEY가 .env에 없습니다');
    return false;
  }

  // Admin API로 자동 확인된 유저 생성
  log('📝', `테스트 유저 생성: ${TEST_EMAIL}`);
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,  // 이메일 자동 확인
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    log('❌', `유저 생성 실패 (${createRes.status})`, err);
    return false;
  }

  const userData = await createRes.json();
  testUserId = userData.id;
  log('✅', `테스트 유저 생성 완료: ${testUserId}`);

  // 로그인으로 JWT 발급
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });

  if (!loginRes.ok) {
    const err = await loginRes.text();
    log('❌', `로그인 실패 (${loginRes.status})`, err);
    return false;
  }

  const data = await loginRes.json();
  userToken = data.access_token;
  log('✅', `JWT 발급 성공! user_id: ${data.user?.id}`);
  return true;
}

// ─── 테스트 유저 정리 (Admin API) ───
async function cleanupTestUser() {
  if (!testUserId || !SUPABASE_SERVICE_ROLE_KEY) return;

  log('🧹', `테스트 유저 삭제: ${testUserId}`);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUserId}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  log(res.ok ? '✅' : '⚠️', `유저 삭제: ${res.status}`);
}

// ─── 2. 인증 없이 요청 → 401 ───
async function step2_noauth() {
  log('🚫', '=== Step 2: 인증 없이 요청 (401 예상) ===');

  const res = await api('GET', '/api/designs');
  log(res.status === 401 ? '✅' : '❌', `GET /api/designs → ${res.status}`, res.json);
  return res.status === 401;
}

// ─── 3. 디자인 생성 (POST) ───
async function step3_createDesign() {
  log('📝', '=== Step 3: 디자인 생성 (POST /api/designs) ===');

  const res = await api('POST', '/api/designs', {
    name: '테스트 주방 설계',
    description: 'API 통합 테스트용 설계',
    total_items: 1,
    total_modules: 5,
    app_version: 'test-1.0',
  }, userToken);

  if (res.ok && res.json?.data?.id) {
    createdDesignId = res.json.data.id;
    log('✅', `디자인 생성 성공! id: ${createdDesignId}`, res.json.data);
    return true;
  }
  log('❌', `디자인 생성 실패 (${res.status})`, res.json || res.text);
  return false;
}

// ─── 4. 디자인 목록 조회 (GET) ───
async function step4_listDesigns() {
  log('📋', '=== Step 4: 디자인 목록 조회 (GET /api/designs) ===');

  const res = await api('GET', '/api/designs', null, userToken);
  if (res.ok) {
    const count = res.json?.data?.length || 0;
    log('✅', `디자인 ${count}개 조회 성공`);
    return true;
  }
  log('❌', `목록 조회 실패 (${res.status})`, res.json);
  return false;
}

// ─── 5. 디자인 상세 조회 (GET :id) ───
async function step5_getDesign() {
  log('🔍', '=== Step 5: 디자인 상세 조회 (GET /api/designs/:id) ===');

  const res = await api('GET', `/api/designs/${createdDesignId}`, null, userToken);
  if (res.ok) {
    log('✅', `상세 조회 성공`, {
      id: res.json.data.id,
      name: res.json.data.name,
      status: res.json.data.status,
      items_count: res.json.data.items?.length || 0,
    });
    return true;
  }
  log('❌', `상세 조회 실패 (${res.status})`, res.json);
  return false;
}

// ─── 6. 디자인 수정 (PATCH) ───
async function step6_updateDesign() {
  log('✏️', '=== Step 6: 디자인 수정 (PATCH /api/designs/:id) ===');

  const res = await api('PATCH', `/api/designs/${createdDesignId}`, {
    name: '테스트 주방 설계 (수정됨)',
    status: 'submitted',
    total_modules: 12,
  }, userToken);

  if (res.ok) {
    log('✅', `수정 성공`, { name: res.json.data.name, status: res.json.data.status });
    return true;
  }
  log('❌', `수정 실패 (${res.status})`, res.json);
  return false;
}

// ─── 7. 디자인 아이템 교체 (POST :id/items) ───
async function step7_replaceItems() {
  log('📦', '=== Step 7: 디자인 아이템 교체 (POST /api/designs/:id/items) ===');

  const res = await api('POST', `/api/designs/${createdDesignId}/items`, {
    items: [
      { category: 'sink', name: '하부장1', width: 600, height: 720, depth: 580, specs: { type: 'standard' } },
      { category: 'sink', name: '싱크장', width: 800, height: 720, depth: 580, specs: { has_sink: true } },
      { category: 'sink', name: '하부장2', width: 600, height: 720, depth: 580, specs: { type: 'standard' } },
    ],
  }, userToken);

  if (res.ok) {
    log('✅', `아이템 ${res.json.data.length}개 교체 성공`);
    return true;
  }
  log('❌', `아이템 교체 실패 (${res.status})`, res.json);
  return false;
}

// ─── 8. 이미지 업로드 (POST /api/images/upload) ───
async function step8_uploadImage() {
  log('🖼️', '=== Step 8: 이미지 업로드 (POST /api/images/upload) ===');

  try {
    const imgPath = '../screenshot/testimage/KakaoTalk_20260216_123628816.jpg';
    const imgBuffer = readFileSync(imgPath);
    const base64 = imgBuffer.toString('base64');

    log('📏', `이미지 크기: ${(imgBuffer.length / 1024).toFixed(0)}KB → base64: ${(base64.length / 1024).toFixed(0)}KB`);

    const res = await api('POST', '/api/images/upload', {
      image_data: base64,
      mime_type: 'image/jpeg',
      file_name: 'test-kitchen.jpg',
      image_type: 'site_photo',
      design_id: createdDesignId,
      metadata: { source: 'api-test', original: 'KakaoTalk_20260216_123628816.jpg' },
    }, userToken);

    if (res.ok && res.json?.data?.id) {
      createdImageId = res.json.data.id;
      log('✅', `이미지 업로드 성공!`, res.json.data);
      return true;
    }
    log('❌', `업로드 실패 (${res.status})`, res.json || res.text);
    return false;
  } catch (err) {
    log('❌', `파일 읽기 오류: ${err.message}`);
    return false;
  }
}

// ─── 9. 이미지 목록 조회 (GET /api/images) ───
async function step9_listImages() {
  log('📋', '=== Step 9: 이미지 목록 조회 (GET /api/images) ===');

  // design_id 필터 포함
  const res = await api('GET', `/api/images?design_id=${createdDesignId}`, null, userToken);
  if (res.ok) {
    const count = res.json?.data?.length || 0;
    log('✅', `이미지 ${count}개 조회 (design_id 필터)`);
    return true;
  }
  log('❌', `이미지 목록 실패 (${res.status})`, res.json);
  return false;
}

// ─── 10. 이미지 삭제 (DELETE /api/images/:id) ───
async function step10_deleteImage() {
  log('🗑️', '=== Step 10: 이미지 삭제 (DELETE /api/images/:id) ===');

  if (!createdImageId) {
    log('⏭️', '업로드된 이미지 없음 → skip');
    return true;
  }

  const res = await api('DELETE', `/api/images/${createdImageId}`, null, userToken);
  if (res.status === 204) {
    log('✅', '이미지 삭제 성공 (204)');
    return true;
  }
  log('❌', `이미지 삭제 실패 (${res.status})`, res.json || res.text);
  return false;
}

// ─── 11. 디자인 삭제 (DELETE /api/designs/:id) ───
async function step11_deleteDesign() {
  log('🗑️', '=== Step 11: 디자인 삭제 (DELETE /api/designs/:id) ===');

  if (!createdDesignId) {
    log('⏭️', '생성된 디자인 없음 → skip');
    return true;
  }

  const res = await api('DELETE', `/api/designs/${createdDesignId}`, null, userToken);
  if (res.status === 204) {
    log('✅', '디자인 삭제 성공 (204)');
    return true;
  }
  log('❌', `디자인 삭제 실패 (${res.status})`, res.json || res.text);
  return false;
}

// ─── 입력 검증 테스트 ───
async function step_validation() {
  log('🛡️', '=== Bonus: 입력 검증 테스트 ===');

  // 필수 필드 누락
  const r1 = await api('POST', '/api/designs', {}, userToken);
  log(r1.status === 400 ? '✅' : '❌', `name 누락 → ${r1.status} (400 예상)`);

  // items에 category 누락
  const r2 = await api('POST', `/api/designs/${createdDesignId}/items`, {
    items: [{ name: 'test', width: 100 }]
  }, userToken);
  log(r2.status === 400 ? '✅' : '❌', `item category 누락 → ${r2.status} (400 예상)`);

  // items가 배열이 아님
  if (createdDesignId) {
    const r3 = await api('POST', `/api/designs/${createdDesignId}/items`, { items: 'not-array' }, userToken);
    log(r3.status === 400 ? '✅' : '❌', `items=string → ${r3.status} (400 예상)`);
  }

  return true;
}

// ─── 메인 실행 ───
async function main() {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  다담AI Supabase API 통합 테스트');
  console.log('═══════════════════════════════════════════════════════\n');

  const results = [];

  // Step 1: 로그인
  const loggedIn = await step1_login();
  results.push(['로그인', loggedIn]);

  if (!loggedIn) {
    console.log('\n⚠️  로그인 실패로 인증 필요 테스트만 수행합니다.\n');
  }

  // Step 2: 인증 없이 → 401
  results.push(['401 테스트', await step2_noauth()]);

  if (loggedIn) {
    // Step 3-7: Design CRUD
    results.push(['디자인 생성', await step3_createDesign()]);
    results.push(['디자인 목록', await step4_listDesigns()]);
    results.push(['디자인 상세', await step5_getDesign()]);
    results.push(['디자인 수정', await step6_updateDesign()]);
    results.push(['아이템 교체', await step7_replaceItems()]);

    // Validation tests (before delete)
    results.push(['입력 검증', await step_validation()]);

    // Step 8-9: Image upload/list
    results.push(['이미지 업로드', await step8_uploadImage()]);
    results.push(['이미지 목록', await step9_listImages()]);

    // Step 10-11: Cleanup (delete)
    results.push(['이미지 삭제', await step10_deleteImage()]);
    results.push(['디자인 삭제', await step11_deleteDesign()]);
  }

  // 결과 요약
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  테스트 결과 요약');
  console.log('═══════════════════════════════════════════════════════');

  let pass = 0, fail = 0;
  for (const [name, ok] of results) {
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
    ok ? pass++ : fail++;
  }

  console.log(`\n  Total: ${pass} passed, ${fail} failed / ${results.length} tests`);
  console.log('═══════════════════════════════════════════════════════\n');

  // 테스트 유저 정리
  await cleanupTestUser();

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
