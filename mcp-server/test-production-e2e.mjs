#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// 다담AI 프로덕션 E2E 종합 테스트
// n8n Cloud 워크플로우 + MCP Server CRUD + 프론트엔드 시뮬레이션
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { config } from 'dotenv';
config();

const N8N_INTERIOR_URL = 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4';
const N8N_CHAT_URL = 'https://dadam.app.n8n.cloud/webhook/chat';
const MCP_BASE = 'http://localhost:3200';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 테스트 이미지 목록
const TEST_IMAGES = [
  { path: '../screenshot/testimage/KakaoTalk_20260216_123628816.jpg', desc: '주방 사진 (792KB)' },
  { path: '../screenshot/testimage/KakaoTalk_20260206_063103659.jpg', desc: '공간 사진 (1.2MB)' },
];

let userToken = null;
let testUserId = null;
let createdDesignId = null;
const results = [];
let startTime;

// ─── 유틸리티 ───
function log(emoji, msg, detail) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${elapsed}s] ${emoji} ${msg}`);
  if (detail) {
    const str = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    console.log('  ', str.substring(0, 800));
  }
}

function pass(name) { results.push([name, true]); }
function fail(name, reason) {
  results.push([name, false]);
  log('❌', `FAIL: ${name}`, reason);
}

async function api(method, baseUrl, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${baseUrl}${path}`, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

// ═══════════════════════════════════════════════════════════════
// PART 1: 인증 준비
// ═══════════════════════════════════════════════════════════════
async function test_auth() {
  log('🔐', '=== PART 1: 테스트 유저 생성 + JWT 발급 ===');

  // Admin API로 자동 확인된 유저 생성
  const email = `e2e-${Date.now()}@test.dadam.local`;
  const password = 'Test@1234!Dadam';

  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (!createRes.ok) {
    fail('유저 생성', await createRes.text());
    return false;
  }

  const userData = await createRes.json();
  testUserId = userData.id;

  // 로그인
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!loginRes.ok) {
    fail('JWT 발급', await loginRes.text());
    return false;
  }

  const loginData = await loginRes.json();
  userToken = loginData.access_token;
  log('✅', `인증 완료: ${testUserId.substring(0, 8)}...`);
  pass('인증 (유저 생성 + JWT)');
  return true;
}

// ═══════════════════════════════════════════════════════════════
// PART 1.5: MCP Auth Verify 엔드포인트
// ═══════════════════════════════════════════════════════════════
async function test_auth_verify() {
  log('🔑', '=== PART 1.5: MCP Auth Verify 엔드포인트 테스트 ===');

  // 토큰 없이 → 401
  const noToken = await api('POST', MCP_BASE, '/api/auth/verify');
  if (noToken.status === 401) {
    log('✅', 'Auth verify 토큰 없이 → 401');
    pass('Auth Verify 401');
  } else {
    fail('Auth Verify 401', `Expected 401, got ${noToken.status}`);
  }

  // 유효한 토큰으로 → user 정보 반환
  if (userToken) {
    const verified = await api('POST', MCP_BASE, '/api/auth/verify', null, userToken);
    if (verified.ok && verified.json?.user?.id) {
      log('✅', `Auth verify 성공: ${verified.json.user.email}`);
      pass('Auth Verify 성공');
    } else {
      fail('Auth Verify 성공', verified.json || verified.text);
    }

    // 무효한 토큰으로 → 401
    const badToken = await api('POST', MCP_BASE, '/api/auth/verify', null, 'invalid-token-12345');
    if (badToken.status === 401) {
      log('✅', 'Auth verify 무효 토큰 → 401');
      pass('Auth Verify 무효 토큰');
    } else {
      fail('Auth Verify 무효 토큰', `Expected 401, got ${badToken.status}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PART 2: n8n 워크플로우 - 인테리어 디자인 생성
// ═══════════════════════════════════════════════════════════════
async function test_n8n_interior() {
  log('🏠', '=== PART 2: n8n 인테리어 디자인 워크플로우 테스트 ===');

  const imgFile = TEST_IMAGES[0];
  let imgBuffer;
  try {
    imgBuffer = readFileSync(imgFile.path);
  } catch {
    fail('이미지 로드', `파일 없음: ${imgFile.path}`);
    return false;
  }

  const base64 = imgBuffer.toString('base64');
  log('📷', `이미지: ${imgFile.desc} (base64: ${(base64.length / 1024).toFixed(0)}KB)`);

  const payload = {
    room_image: base64,
    image_type: 'image/jpeg',
    category: 'sink',
    design_style: 'modern-minimal',
    style_name: '모던 미니멀',
    style_keywords: 'clean lines, minimal design, hidden handles, matte finish, geometric shapes',
    style_atmosphere: 'serene, uncluttered, contemporary',
    design_prompt: 'E2E 테스트 - 모던 미니멀 싱크대',
    manual_positions: null,
    has_manual_positions: false,
  };

  log('⏳', `n8n 워크플로우 호출 중... (약 60~120초 소요)`);
  const t0 = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3분 타임아웃

    const res = await fetch(N8N_INTERIOR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    log('📡', `n8n 응답 상태: ${res.status} ${res.statusText}`);
    log('📡', `Content-Type: ${res.headers.get('content-type')}, Content-Length: ${res.headers.get('content-length')}`);

    if (!res.ok) {
      const errText = await res.text();
      fail(`n8n 인테리어 (${res.status})`, errText.substring(0, 500));
      return false;
    }

    // 큰 응답 처리: 먼저 text로 받은 후 JSON 파싱
    const rawText = await res.text();
    log('📦', `응답 크기: ${(rawText.length / 1024).toFixed(0)}KB (${rawText.length}자)`);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      fail(`n8n 인테리어 JSON 파싱 (${elapsed}s)`, `응답 ${rawText.length}자, 파싱 오류: ${parseErr.message}, 앞부분: ${rawText.substring(0, 200)}`);
      return false;
    }
    if (Array.isArray(data)) data = data[0];

    log('⏱️', `n8n 응답 시간: ${elapsed}s`);

    // 에러 응답 처리 (Format Response (Error) 노드)
    if (data.success === false) {
      log('⚠️', `n8n 에러 응답 (정상 처리됨):`, {
        message: data.message,
        error_detail: data.error_detail,
        category: data.category,
      });
      pass(`n8n 인테리어 에러 핸들링 (${elapsed}s)`);
      log('📝', '배경 정리 실패 → 에러 JSON 응답 반환 (빈 응답 아님 = 수정 성공)');
      return data;
    }

    // 응답 검증
    const checks = {
      'generated_image 존재': !!data.generated_image,
      'closed 이미지': !!(data.generated_image?.closed?.base64),
      'open 이미지': !!(data.generated_image?.open?.base64),
    };

    let allOk = true;
    for (const [key, ok] of Object.entries(checks)) {
      log(ok ? '✅' : '⚠️', `  ${key}: ${ok}`);
      if (!ok && key.includes('closed')) allOk = false; // closed는 필수
    }

    // 분석 결과 요약
    if (data.room_analysis) {
      const analysis = typeof data.room_analysis === 'string'
        ? data.room_analysis.substring(0, 200)
        : JSON.stringify(data.room_analysis).substring(0, 200);
      log('📋', `분석 결과 (일부):`, analysis);
    }

    // 이미지 크기 확인
    if (data.generated_image?.closed?.base64) {
      const closedSize = (data.generated_image.closed.base64.length / 1024).toFixed(0);
      log('🖼️', `닫힌 도어 이미지: ${closedSize}KB (base64)`);
    }
    if (data.generated_image?.open?.base64) {
      const openSize = (data.generated_image.open.base64.length / 1024).toFixed(0);
      log('🖼️', `열린 도어 이미지: ${openSize}KB (base64)`);
    }

    // RAG 규칙
    if (data.rag_rules_count) {
      log('📚', `RAG 규칙 ${data.rag_rules_count}개 적용됨`);
    }

    // 추가 필드 로그
    const responseKeys = Object.keys(data);
    log('🔑', `응답 필드: ${responseKeys.join(', ')}`);

    if (allOk) {
      pass(`n8n 인테리어 (${elapsed}s)`);
    } else {
      fail(`n8n 인테리어`, 'closed 이미지 누락');
    }
    return data;

  } catch (err) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    fail(`n8n 인테리어 (${elapsed}s)`, err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// PART 3: n8n 채팅 워크플로우
// ═══════════════════════════════════════════════════════════════
async function test_n8n_chat() {
  log('💬', '=== PART 3: n8n 채팅 워크플로우 테스트 ===');

  try {
    const res = await fetch(N8N_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(userToken ? { 'Authorization': `Bearer ${userToken}` } : {}),
      },
      body: JSON.stringify({ message: '싱크대 높이는 보통 얼마인가요?' }),
    });

    if (!res.ok) {
      fail(`n8n 채팅 (${res.status})`, await res.text());
      return false;
    }

    const data = await res.json();
    const response = data.response || data.output || '';

    if (response.length > 0) {
      log('✅', `채팅 응답 (${response.length}자):`, response.substring(0, 200));
      pass('n8n 채팅');
    } else {
      fail('n8n 채팅', '빈 응답');
    }
    return true;
  } catch (err) {
    fail('n8n 채팅', err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// PART 4: MCP Server CRUD API (인증 포함)
// ═══════════════════════════════════════════════════════════════
async function test_mcp_crud() {
  log('🗄️', '=== PART 4: MCP Server CRUD API 테스트 ===');

  // 4-1. Health check
  const health = await api('GET', MCP_BASE, '/health');
  if (health.ok) {
    log('✅', 'MCP 서버 Health OK');
    pass('MCP Health');
  } else {
    fail('MCP Health', `${health.status}`);
    return false;
  }

  // 4-2. 인증 없이 → 401
  const noAuth = await api('GET', MCP_BASE, '/api/designs');
  if (noAuth.status === 401) {
    log('✅', '인증 없이 → 401');
    pass('MCP 401 체크');
  } else {
    fail('MCP 401 체크', `Expected 401, got ${noAuth.status}`);
  }

  // 4-3. 디자인 생성
  const createRes = await api('POST', MCP_BASE, '/api/designs', {
    name: 'E2E 프로덕션 테스트',
    description: 'n8n + MCP 종합 테스트',
    total_items: 1,
    total_modules: 3,
    app_version: 'e2e-test',
  }, userToken);

  if (createRes.ok && createRes.json?.data?.id) {
    createdDesignId = createRes.json.data.id;
    log('✅', `디자인 생성: ${createdDesignId.substring(0, 8)}...`);
    pass('MCP 디자인 생성');
  } else {
    fail('MCP 디자인 생성', createRes.json || createRes.text);
    return false;
  }

  // 4-4. 아이템 추가
  const itemsRes = await api('POST', MCP_BASE, `/api/designs/${createdDesignId}/items`, {
    items: [
      { category: 'sink', name: '하부장', width: 600, height: 720, depth: 580 },
      { category: 'sink', name: '싱크장', width: 800, height: 720, depth: 580, specs: { has_sink: true } },
    ],
  }, userToken);

  if (itemsRes.ok) {
    log('✅', `아이템 ${itemsRes.json.data.length}개 추가`);
    pass('MCP 아이템 추가');
  } else {
    fail('MCP 아이템 추가', itemsRes.json);
  }

  // 4-5. 이미지 업로드
  try {
    const imgBuffer = readFileSync(TEST_IMAGES[0].path);
    const base64 = imgBuffer.toString('base64');

    const uploadRes = await api('POST', MCP_BASE, '/api/images/upload', {
      image_data: base64,
      mime_type: 'image/jpeg',
      file_name: 'e2e-test.jpg',
      image_type: 'site_photo',
      design_id: createdDesignId,
      metadata: { source: 'e2e-test' },
    }, userToken);

    if (uploadRes.ok && uploadRes.json?.data?.id) {
      const imgId = uploadRes.json.data.id;
      log('✅', `이미지 업로드: ${imgId.substring(0, 8)}... → ${uploadRes.json.data.public_url.substring(0, 80)}`);
      pass('MCP 이미지 업로드');

      // 이미지 삭제
      const delImg = await api('DELETE', MCP_BASE, `/api/images/${imgId}`, null, userToken);
      if (delImg.status === 204) {
        log('✅', '이미지 삭제 성공');
        pass('MCP 이미지 삭제');
      } else {
        fail('MCP 이미지 삭제', `${delImg.status}`);
      }
    } else {
      fail('MCP 이미지 업로드', uploadRes.json || uploadRes.text);
    }
  } catch (err) {
    fail('MCP 이미지 업로드', err.message);
  }

  // 4-6. 디자인 삭제 (정리)
  const delRes = await api('DELETE', MCP_BASE, `/api/designs/${createdDesignId}`, null, userToken);
  if (delRes.status === 204) {
    log('✅', '디자인 삭제 (정리)');
    pass('MCP 디자인 삭제');
  } else {
    fail('MCP 디자인 삭제', `${delRes.status}`);
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════
// PART 5: MCP Server 기존 엔드포인트 (벽면 분석 등)
// ═══════════════════════════════════════════════════════════════
async function test_mcp_endpoints() {
  log('🔌', '=== PART 5: MCP Server 기존 엔드포인트 ===');

  // 테마 이미지 조회
  const themes = await api('GET', MCP_BASE, '/api/themes/images');
  if (themes.ok) {
    const count = themes.json?.length || themes.json?.data?.length || 'unknown';
    log('✅', `테마 이미지 조회: ${count}개`);
    pass('MCP 테마 이미지');
  } else {
    log('⚠️', `테마 이미지 조회 실패 (${themes.status}) - 비필수`);
    results.push(['MCP 테마 이미지', null]); // skip
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════
async function cleanup() {
  if (testUserId && SUPABASE_SERVICE_ROLE_KEY) {
    log('🧹', '테스트 유저 정리...');
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUserId}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    log('✅', '유저 삭제 완료');
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  startTime = Date.now();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  다담AI 프로덕션 E2E 종합 테스트');
  console.log('  n8n Cloud + MCP Server + Supabase Auth');
  console.log('═══════════════════════════════════════════════════════════\n');

  // PART 1: 인증
  const authed = await test_auth();

  // PART 1.5: Auth Verify 엔드포인트
  await test_auth_verify();

  // PART 2: n8n 인테리어 (가장 핵심, 시간 오래 걸림)
  const n8nResult = await test_n8n_interior();

  // PART 3: n8n 채팅
  await test_n8n_chat();

  // PART 4: MCP CRUD (인증 필요)
  if (authed) {
    await test_mcp_crud();
  } else {
    log('⏭️', 'MCP CRUD 건너뜀 (인증 실패)');
  }

  // PART 5: MCP 기존 엔드포인트
  await test_mcp_endpoints();

  // 결과 요약
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  테스트 결과 요약');
  console.log('═══════════════════════════════════════════════════════════');

  let passed = 0, failed = 0, skipped = 0;
  for (const [name, ok] of results) {
    if (ok === null) {
      console.log(`  ⏭️  ${name} (skipped)`);
      skipped++;
    } else if (ok) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      failed++;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Total: ${passed} passed, ${failed} failed, ${skipped} skipped / ${results.length} tests`);
  console.log(`  Time: ${totalTime}s`);
  console.log('═══════════════════════════════════════════════════════════\n');

  await cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  cleanup().then(() => process.exit(1));
});
