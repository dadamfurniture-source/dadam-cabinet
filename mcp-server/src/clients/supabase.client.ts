// ═══════════════════════════════════════════════════════════════
// Supabase Client - Supabase RPC 전용 클라이언트
// ═══════════════════════════════════════════════════════════════

import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from './base-http.client.js';
import type { RagSearchParams, DesignRule, ReferenceImage, ReferenceImageCategory } from '../types/index.js';

const log = createLogger('supabase-client');

export async function supabaseRpc<T>(
  functionName: string,
  params: Record<string, unknown>
): Promise<T> {
  const config = getConfig();

  const response = await fetchWithRetry(
    'supabase',
    `${config.supabase.url}/rest/v1/rpc/${functionName}`,
    {
      method: 'POST',
      headers: {
        'apikey': config.supabase.anonKey,
        'Authorization': `Bearer ${config.supabase.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      timeout: config.supabase.timeout,
    }
  );

  return response.json() as Promise<T>;
}

export async function searchRagRules(params: RagSearchParams): Promise<DesignRule[]> {
  log.debug({ triggers: params.query_triggers, category: params.filter_category }, 'Searching RAG rules');
  return supabaseRpc<DesignRule[]>('quick_trigger_search', params as unknown as Record<string, unknown>);
}

export async function getReferenceImagesByCategory(
  categories: ReferenceImageCategory[]
): Promise<ReferenceImage[]> {
  const config = getConfig();
  const categoryFilter = categories.map(c => `"${c}"`).join(',');
  const url = `${config.supabase.url}/rest/v1/reference_images?category=in.(${categoryFilter})&is_active=eq.true&select=*`;

  const response = await fetchWithRetry('supabase', url, {
    method: 'GET',
    headers: {
      'apikey': config.supabase.anonKey,
      'Authorization': `Bearer ${config.supabase.anonKey}`,
      'Content-Type': 'application/json',
    },
    timeout: config.supabase.timeout,
  });

  return response.json() as Promise<ReferenceImage[]>;
}

export async function loadStorageImage(storagePath: string): Promise<string | null> {
  const config = getConfig();
  const url = `${config.supabase.url}/storage/v1/object/public/${storagePath}`;

  try {
    const response = await fetchWithRetry('supabase-storage', url, {
      timeout: 30000,
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  } catch (error) {
    log.error({ storagePath, error }, 'Failed to load storage image');
    return null;
  }
}
