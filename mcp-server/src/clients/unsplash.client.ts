// ═══════════════════════════════════════════════════════════════
// Unsplash Client - Unsplash API 전용 클라이언트
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from './base-http.client.js';
import { ValidationError } from '../utils/errors.js';

const log = createLogger('unsplash-client');

const UNSPLASH_API_BASE = 'https://api.unsplash.com';

export interface UnsplashImage {
  id: string;
  url: string;
  thumbUrl: string;
  smallUrl: string;
  alt: string;
  photographer: string;
  photographerUrl: string;
  color: string;
  blurHash?: string;
}

export interface UnsplashSearchResponse {
  success: boolean;
  images: UnsplashImage[];
  hasMore: boolean;
  nextPage: number;
  total: number;
}

interface UnsplashApiPhoto {
  id: string;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  alt_description: string | null;
  description: string | null;
  user: { name: string; links: { html: string } };
  color: string;
  blur_hash: string | null;
}

interface UnsplashSearchApiResponse {
  total: number;
  total_pages: number;
  results: UnsplashApiPhoto[];
}

function getAccessKey(): string {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new ValidationError('UNSPLASH_ACCESS_KEY environment variable is not set');
  return key;
}

function mapPhoto(photo: UnsplashApiPhoto): UnsplashImage {
  return {
    id: photo.id,
    url: photo.urls.regular,
    thumbUrl: photo.urls.thumb,
    smallUrl: photo.urls.small,
    alt: photo.alt_description || photo.description || 'Interior design',
    photographer: photo.user.name,
    photographerUrl: photo.user.links.html,
    color: photo.color,
    blurHash: photo.blur_hash || undefined,
  };
}

export async function searchInteriorImages(
  query: string = 'korean interior kitchen',
  page: number = 1,
  perPage: number = 20
): Promise<UnsplashSearchResponse> {
  const accessKey = getAccessKey();

  const params = new URLSearchParams({
    query,
    page: String(page),
    per_page: String(Math.min(perPage, 30)),
    orientation: 'landscape',
    content_filter: 'high',
  });

  const url = `${UNSPLASH_API_BASE}/search/photos?${params}`;
  log.info({ query, page }, 'Searching Unsplash images');

  const response = await fetchWithRetry('unsplash', url, {
    headers: {
      Authorization: `Client-ID ${accessKey}`,
      'Accept-Version': 'v1',
    },
    timeout: 15000,
  });

  const data = (await response.json()) as UnsplashSearchApiResponse;
  const images = data.results.map(mapPhoto);
  const totalPages = Math.ceil(data.total / perPage);

  log.info({ total: data.total, returned: images.length }, 'Unsplash search complete');

  return {
    success: true,
    images,
    hasMore: page < totalPages,
    nextPage: page + 1,
    total: data.total,
  };
}

const CATEGORY_QUERY_MAP: Record<string, string> = {
  kitchen: 'minimalist white kitchen cabinet modern apartment',
  wardrobe: 'built-in wardrobe closet white minimalist bedroom',
  fridge: 'modern kitchen cabinet pantry white clean',
  bathroom: 'minimalist bathroom vanity white modern',
  living: 'minimalist living room white apartment modern',
  bedroom: 'minimalist bedroom white modern apartment',
  default: 'minimalist apartment interior white modern clean',
};

export function getCategoryQuery(category: string): string {
  return CATEGORY_QUERY_MAP[category] || CATEGORY_QUERY_MAP.default;
}

export async function trackDownload(imageId: string): Promise<void> {
  const accessKey = getAccessKey();
  const url = `${UNSPLASH_API_BASE}/photos/${imageId}/download`;

  try {
    await fetchWithRetry('unsplash', url, {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
      timeout: 5000,
    }, { maxRetries: 0 });
    log.debug({ imageId }, 'Download tracked');
  } catch {
    log.debug({ imageId }, 'Download tracking failed (non-critical)');
  }
}
