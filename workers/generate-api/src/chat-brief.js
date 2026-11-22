/**
 * 앱 연출컷 상담 한 마디 · 상담 정리 (「정리하기」, 2026-11-21 대표님) — 상담 대화를 연출컷 참고 내용으로.
 * 텍스트 모델 한 번, JSON 답(responseSchema). 프롬프트 · 답 모양 · 읽기는 prompts.js (buildBriefPrompt · briefSchema · parseBrief).
 * extraConfig 를 쓰는 호출이라 worker.js 밖에 둔다 (position.test.js 「기존 호출부는 새 인자를 쓰지 않는다」).
 */
import { callGemini } from './gemini.js';
import { briefSchema, buildBriefPrompt, buildChatPrompt, cleanChatReply, parseBrief, resolveCategory } from './prompts.js';
import { upsertOne } from './supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 화면이 보낸 상담 열쇠 — uuid 가 아니면 null (정리본을 적지 않는다) */
export function cleanNoteKey(v) {
  return typeof v === 'string' && UUID_RE.test(v) ? v.toLowerCase() : null;
}

/**
 * 정리본 적기 (2026-11-23 대표님 「상담내역은 마이페이지에 정리본 자동저장」, DB 0081 make_consult_notes).
 * 같은 상담(note_key)에서 다시 정리하면 같은 줄을 고친다. 정리본 글만 — 대화 원문 · 사진은 적지 않는다.
 * 못 적어도 정리 답은 그대로 준다 (표가 아직 없거나 DB 가 잠시 안 될 때) — 적었는지만 돌려준다.
 * @returns {Promise<boolean>}
 */
export async function saveBriefNote(env, { userId, noteKey, category, brief }, { upsert = upsertOne } = {}) {
  if (!userId || !noteKey || !brief) return false;
  try {
    await upsert(
      env,
      'make_consult_notes',
      { user_id: userId, note_key: noteKey, category: resolveCategory(category), brief },
      'user_id,note_key'
    );
    return true;
  } catch (e) {
    console.warn('[chat-brief] note not saved:', e && e.message);
    return false;
  }
}

/**
 * 앱 상담 한 마디 (app:true). 「답이 너무 느림」(11-21 대표님) — 생각은 짧게(low),
 * 방 사진은 낮은 해상도로 본다(벽 · 바닥 색만 보면 된다). ai-design.html 의 상담(app 없음)은 worker.js 그대로.
 * @returns {Promise<string>} 다듬은 답
 */
export async function requestChatReply(env, c, { call = callGemini } = {}) {
  const photo = c.images.length > 0;
  const r = await call(env, {
    prompt: buildChatPrompt({ category: c.category, messages: c.messages, photo, app: true }),
    images: c.images,
    want: 'text',
    temperature: 0.6,
    retryDelaysMs: [3_000], // 손님이 채팅창에서 기다린다 — 과부하면 3초 뒤 한 번만
    extraConfig: {
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 1024,
      ...(photo ? { mediaResolution: 'MEDIA_RESOLUTION_LOW' } : {}),
    },
  });
  const reply = cleanChatReply(r && r.text);
  if (!reply) throw new Error('chat: empty reply');
  return reply;
}

/**
 * @param {object} env
 * @param {{category?:string, messages:{role:string,text:string}[], images:{base64:string,mimeType:string}[]}} c
 * @returns {Promise<{brief:string, door_color?:string, design_style?:string}>}
 */
export async function requestBrief(env, c, { call = callGemini } = {}) {
  const r = await call(env, {
    prompt: buildBriefPrompt({
      category: c.category,
      messages: c.messages,
      photo: c.images.length > 0,
    }),
    images: c.images,
    want: 'text',
    temperature: 0.2,
    retryDelaysMs: [3_000], // 손님이 화면에서 기다린다 — 과부하면 3초 뒤 한 번만
    extraConfig: {
      responseMimeType: 'application/json',
      responseSchema: briefSchema(),
      thinkingConfig: { thinkingLevel: 'low' },
      maxOutputTokens: 2048,
    },
  });
  const out = parseBrief(r && r.text);
  if (!out) throw new Error('chat brief: unreadable reply');
  return out;
}
