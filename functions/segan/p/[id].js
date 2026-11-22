// 시공사례 사진 한 장 주소 — /segan/p/<게시물 id> (마케팅 「사이트 새는 곳 막기」 묶음 5, 2026-11-23)
//
// Cloudflare Pages Function. 메신저 · SNS 가 링크를 미리 볼 때 그 사진이 뜨도록 og 를 담은 작은 HTML 을 주고,
// 사람은 곧바로 시공사례 화면의 그 사진(/segan/collection?p=<id>)으로 넘긴다.
//   - 읽는 것은 시공사례 화면과 같은 공개 칸 · 같은 공개 조건 (segan/collection.js queryPage) — 공개 키로 읽는다
//   - 없거나 숨은 게시물 · 모르는 id 는 302 로 시공사례 목록
//   - 이 주소는 검색에 내지 않는다 (noindex) — 검색은 시공사례 목록이 맡는다
// 공개 키는 js/config.js 와 같은 값이어야 한다 (__tests__/segan-share-fn.test.js 가 본다).

export const SUPABASE_URL = 'https://vvqrvgcgnlfpiqqndsve.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_OV4D2-LwhTMj8YJ711HTvA_lA2jk_PW';
export const SITE = 'https://dadamfurniture.com';
const FALLBACK_IMAGE = `${SITE}/segan/og/collection.jpg`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 한 건 읽는 주소 — 공개 조건은 시공사례 화면과 같다 */
export function postUrl(id) {
  const q = new URLSearchParams({
    select: 'id,image_url,place_label,door_color,source',
    id: `eq.${id}`,
    or: '(source.eq.upload,hq_picked_at.not.is.null)',
    limit: '1',
  });
  return `${SUPABASE_URL}/rest/v1/collection_posts?${q}`;
}

/** 미리보기 HTML — 제목 = 장소 · 도어 색, 사진 = 그 게시물 사진 (https 가 아니면 공통 사진) */
export function buildPage(post) {
  const id = post.id;
  const label = [post.place_label, post.door_color]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' · ');
  const title = `${label || '시공사례'} · SEGAN`;
  const desc =
    post.source === 'upload'
      ? '실제 시공 사진입니다. 내 방 사진으로 같은 스타일의 연출컷을 만들어 볼 수 있습니다.'
      : 'AI 연출컷입니다. 내 방 사진으로 같은 스타일의 연출컷을 만들어 볼 수 있습니다.';
  const image = /^https:\/\//.test(String(post.image_url || '')) ? post.image_url : FALLBACK_IMAGE;
  const share = `${SITE}/segan/p/${id}`;
  const target = `/segan/collection?p=${id}`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}" />
<link rel="canonical" href="${SITE}/segan/collection" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="SEGAN" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<meta property="og:url" content="${share}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#F6F3EE" />
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body>
<p><a href="${target}">SEGAN 시공사례에서 보기</a></p>
</body>
</html>
`;
}

function toList() {
  return new Response(null, {
    status: 302,
    headers: { Location: '/segan/collection', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest({ request, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const id = String(params.id || '');
  if (!UUID.test(id)) return toList();
  let post = null;
  try {
    const res = await fetch(postUrl(id.toLowerCase()), {
      headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
    });
    if (res.ok) post = (await res.json())[0] || null;
  } catch {
    post = null;
  }
  if (!post) return toList();
  const html = buildPage(post);
  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex',
    },
  });
}
