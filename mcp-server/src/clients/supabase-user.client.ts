// ═══════════════════════════════════════════════════════════════
// Supabase User Client - 사용자 JWT 기반 RLS CRUD
// ═══════════════════════════════════════════════════════════════

import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from './base-http.client.js';
import { NotFoundError } from '../utils/errors.js';
import type {
  Design, DesignCreateInput, DesignUpdateInput,
  DesignItemDB, DesignItemCreateInput,
  UserImage, UserImageCreateInput,
} from '../types/index.js';

const log = createLogger('supabase-user');

// ─────────────────────────────────────────────────────────────────
// 헤더 유틸리티
// ─────────────────────────────────────────────────────────────────

function supabaseHeaders(userToken: string, prefer?: string): Record<string, string> {
  const config = getConfig();
  const headers: Record<string, string> = {
    'apikey': config.supabase.anonKey,
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  };
  if (prefer) {
    headers['Prefer'] = prefer;
  }
  return headers;
}

function restUrl(path: string): string {
  const config = getConfig();
  return `${config.supabase.url}/rest/v1/${path}`;
}

function storageUrl(path: string): string {
  const config = getConfig();
  return `${config.supabase.url}/storage/v1/${path}`;
}

// ─────────────────────────────────────────────────────────────────
// Designs CRUD
// ─────────────────────────────────────────────────────────────────

export async function listDesigns(userToken: string): Promise<Design[]> {
  const url = restUrl('designs?select=*&order=updated_at.desc');
  const response = await fetchWithRetry('supabase', url, {
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });
  return response.json() as Promise<Design[]>;
}

export async function getDesign(userToken: string, designId: string): Promise<Design> {
  const url = restUrl(`designs?id=eq.${designId}&select=*`);
  const response = await fetchWithRetry('supabase', url, {
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });
  const rows = await response.json() as Design[];
  if (rows.length === 0) throw new NotFoundError('Design');
  return rows[0];
}

export async function createDesign(userToken: string, input: DesignCreateInput): Promise<Design> {
  const url = restUrl('designs');
  const response = await fetchWithRetry('supabase', url, {
    method: 'POST',
    headers: supabaseHeaders(userToken, 'return=representation'),
    body: JSON.stringify(input),
    timeout: 10000,
  });
  const rows = await response.json() as Design[];
  return rows[0];
}

export async function updateDesign(userToken: string, designId: string, input: DesignUpdateInput): Promise<Design> {
  const url = restUrl(`designs?id=eq.${designId}`);
  const response = await fetchWithRetry('supabase', url, {
    method: 'PATCH',
    headers: supabaseHeaders(userToken, 'return=representation'),
    body: JSON.stringify(input),
    timeout: 10000,
  });
  const rows = await response.json() as Design[];
  if (rows.length === 0) throw new NotFoundError('Design');
  return rows[0];
}

export async function deleteDesign(userToken: string, designId: string): Promise<void> {
  const url = restUrl(`designs?id=eq.${designId}`);
  await fetchWithRetry('supabase', url, {
    method: 'DELETE',
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });
}

// ─────────────────────────────────────────────────────────────────
// Design Items (전체 교체 방식)
// ─────────────────────────────────────────────────────────────────

export async function replaceDesignItems(
  userToken: string,
  designId: string,
  items: DesignItemCreateInput[]
): Promise<DesignItemDB[]> {
  // 1) 기존 items 삭제
  const deleteUrl = restUrl(`design_items?design_id=eq.${designId}`);
  await fetchWithRetry('supabase', deleteUrl, {
    method: 'DELETE',
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });

  // 2) 새 items 삽입
  if (items.length === 0) return [];

  // PostgREST 벌크 INSERT: 모든 객체가 동일한 키를 가져야 함 (PGRST102)
  const insertData = items.map((item, index) => ({
    design_id: designId,
    category: item.category,
    name: item.name ?? null,
    unique_id: item.unique_id ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    depth: item.depth ?? null,
    specs: item.specs ?? {},
    modules: item.modules ?? [],
    customer_notes: item.customer_notes ?? null,
    item_order: item.item_order ?? index,
  }));

  const insertUrl = restUrl('design_items');
  const response = await fetchWithRetry('supabase', insertUrl, {
    method: 'POST',
    headers: supabaseHeaders(userToken, 'return=representation'),
    body: JSON.stringify(insertData),
    timeout: 10000,
  });
  return response.json() as Promise<DesignItemDB[]>;
}

export async function getDesignItems(userToken: string, designId: string): Promise<DesignItemDB[]> {
  const url = restUrl(`design_items?design_id=eq.${designId}&order=item_order.asc`);
  const response = await fetchWithRetry('supabase', url, {
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });
  return response.json() as Promise<DesignItemDB[]>;
}

// ─────────────────────────────────────────────────────────────────
// Storage (design-images 버킷)
// ─────────────────────────────────────────────────────────────────

const BUCKET = 'design-images';

export async function uploadImage(
  userToken: string,
  userId: string,
  imageType: string,
  fileName: string,
  base64Data: string,
  mimeType: string
): Promise<{ storagePath: string; publicUrl: string; fileSize: number }> {
  const config = getConfig();
  // 기존 패턴: {userId}/{imageType}/{timestamp}.{ext}
  const storagePath = `${userId}/${imageType}/${Date.now()}-${fileName}`;
  const url = storageUrl(`object/${BUCKET}/${storagePath}`);

  const buffer = Buffer.from(base64Data, 'base64');

  await fetchWithRetry('supabase-storage', url, {
    method: 'POST',
    headers: {
      'apikey': config.supabase.anonKey,
      'Authorization': `Bearer ${userToken}`,
      'Content-Type': mimeType,
      'x-upsert': 'true',
    },
    body: buffer,
    timeout: 30000,
  });

  const publicUrl = `${config.supabase.url}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  return { storagePath, publicUrl, fileSize: buffer.length };
}

export async function deleteStorageObject(userToken: string, storagePath: string): Promise<void> {
  const config = getConfig();
  const url = storageUrl(`object/${BUCKET}/${storagePath}`);

  await fetchWithRetry('supabase-storage', url, {
    method: 'DELETE',
    headers: {
      'apikey': config.supabase.anonKey,
      'Authorization': `Bearer ${userToken}`,
    },
    timeout: 10000,
  });
}

// ─────────────────────────────────────────────────────────────────
// User Images (DB 레코드)
// ─────────────────────────────────────────────────────────────────

export async function createUserImage(userToken: string, input: UserImageCreateInput): Promise<UserImage> {
  const url = restUrl('user_images');
  const response = await fetchWithRetry('supabase', url, {
    method: 'POST',
    headers: supabaseHeaders(userToken, 'return=representation'),
    body: JSON.stringify(input),
    timeout: 10000,
  });
  const rows = await response.json() as UserImage[];
  return rows[0];
}

export async function listUserImages(userToken: string, designId?: string): Promise<UserImage[]> {
  let url = restUrl('user_images?select=*&order=created_at.desc');
  if (designId) {
    url = restUrl(`user_images?design_id=eq.${designId}&select=*&order=created_at.desc`);
  }
  const response = await fetchWithRetry('supabase', url, {
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });
  return response.json() as Promise<UserImage[]>;
}

export async function getUserImage(userToken: string, imageId: string): Promise<UserImage | null> {
  const url = restUrl(`user_images?id=eq.${imageId}&select=*`);
  const response = await fetchWithRetry('supabase', url, {
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });
  const rows = await response.json() as UserImage[];
  return rows[0] || null;
}

export async function deleteUserImage(userToken: string, imageId: string): Promise<void> {
  // 먼저 이미지 정보 조회 (storage 삭제용)
  const image = await getUserImage(userToken, imageId);
  if (!image) throw new NotFoundError('Image');

  // Storage 파일 삭제
  try {
    await deleteStorageObject(userToken, image.storage_path);
  } catch (error) {
    log.warn({ imageId, storagePath: image.storage_path, error }, 'Storage delete failed, continuing with DB delete');
  }

  // DB 레코드 삭제
  const url = restUrl(`user_images?id=eq.${imageId}`);
  await fetchWithRetry('supabase', url, {
    method: 'DELETE',
    headers: supabaseHeaders(userToken),
    timeout: 10000,
  });
}
