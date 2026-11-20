/**
 * 홍보용 캐러셀 장의 HTML (2026-11-20). carousel.mjs 가 이 HTML 을 크롬으로 찍어 1080 × 1350 JPEG 로 만든다.
 *
 * 장 종류:
 *   slideHtml  사진 한 장 + 색 이름 + 「AI 연출 이미지」 표시 + 주소 (첫 장에는 제목이 더 붙는다)
 *   ctaHtml    마지막 장 — 「내 주방 사진으로 색을 바꿔 보세요」
 *   buildCaption  게시 글 (색 번호 · 사이트 주소 · AI 연출 고지 · 해시태그)
 *
 * 규칙:
 *   - 사진마다 「AI 연출 이미지」를 사진 안에 찍는다 (표시광고법 — 시공 사례처럼 보이지 않게). 글에도 한 번 더 적는다.
 *   - 모양은 다담 v5 그대로: 각진 모서리, 그림자 없음, 가는 글자. 사진을 가리지 않게 아래 띠 안에만 쓴다.
 *   - 글꼴은 PC 에 있는 것만 쓴다 (맑은 고딕). 웹 글꼴을 불러오지 않아 찍을 때마다 같은 모양이 나온다.
 */

export const CAROUSEL_SIZE = { width: 1080, height: 1350 };

const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";

export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 색 조합 이름이 이보다 길면(자재 이름 — 「매트 라이트그레이 · 카카오월넛」) 작은 글씨로, 게시 글은 한 줄에 하나씩. */
const LONG_TONE = 11;

/** 색 조합 이름 「세이지 · 크림」 → 「상부장 세이지 · 하부장 크림」 (품목이 주방일 때). */
export function toneParts(tone, subject = 'kitchen') {
  const [a, b] = String(tone || '')
    .split('·')
    .map((s) => s.trim());
  if (!a || !b) return '';
  return subject === 'kitchen' ? `상부장 ${a} · 하부장 ${b}` : `도어 ${a} · 포인트 ${b}`;
}

const page = (body, extraCss = '') => `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CAROUSEL_SIZE.width}px;height:${CAROUSEL_SIZE.height}px;overflow:hidden;font-family:${FONT};-webkit-font-smoothing:antialiased}
${extraCss}
</style></head><body>${body}</body></html>`;

/**
 * 사진 장.
 * @param {object} p
 * @param {string} p.src      사진 주소 (file:// 또는 data:)
 * @param {string} p.tone     색 조합 이름 — 「세이지 · 크림」
 * @param {number} p.index    1부터
 * @param {number} p.total    사진 장 수
 * @param {string} [p.title]  첫 장에만 — 「같은 주방, 다른 색」
 * @param {string} [p.subject='kitchen']
 * @param {string} [p.site='dadamfurniture.com/segan']
 */
export function slideHtml({
  src,
  tone,
  index,
  total,
  title,
  subject = 'kitchen',
  site = 'dadamfurniture.com/segan',
}) {
  const css = `
.ph{position:absolute;inset:0;background:#e7e1d7}
.ph img{width:100%;height:100%;object-fit:cover;display:block}
.top{position:absolute;left:0;right:0;top:0;height:230px;background:linear-gradient(to bottom,rgba(20,18,16,.5),rgba(20,18,16,0))}
.brand{position:absolute;left:56px;top:50px;color:#f6f3ee;font-size:30px;font-weight:300;letter-spacing:.34em}
.count{position:absolute;right:56px;top:54px;color:#f6f3ee;font-size:24px;letter-spacing:.08em;font-variant-numeric:tabular-nums}
.title{position:absolute;left:56px;top:112px;color:#f6f3ee;font-size:64px;font-weight:300;letter-spacing:-.02em;line-height:1.2}
.band{position:absolute;left:0;right:0;bottom:0;height:330px;background:linear-gradient(to top,rgba(20,18,16,.72),rgba(20,18,16,0))}
.tone{position:absolute;left:56px;bottom:112px;color:#f6f3ee;font-size:68px;font-weight:300;letter-spacing:-.02em;line-height:1.15}
.tone.long{font-size:50px;max-width:750px}
.parts{position:absolute;left:58px;bottom:62px;color:rgba(246,243,238,.86);font-size:27px}
.ai{position:absolute;right:56px;bottom:112px;color:#f6f3ee;font-size:23px;border:1px solid rgba(246,243,238,.7);padding:7px 16px 8px;letter-spacing:.04em}
.site{position:absolute;right:56px;bottom:64px;color:rgba(246,243,238,.86);font-size:24px;letter-spacing:.02em}`;
  const body = `
<div class="ph"><img src="${esc(src)}" alt=""></div>
<div class="top"></div>
<div class="brand">SEGAN</div>
<div class="count">${esc(index)} / ${esc(total)}</div>
${title ? `<div class="title">${esc(title)}</div>` : ''}
<div class="band"></div>
<div class="tone${String(tone || '').length > LONG_TONE ? ' long' : ''}">${esc(tone)}</div>
<div class="parts">${esc(toneParts(tone, subject))}</div>
<div class="ai">AI 연출 이미지</div>
<div class="site">${esc(site)}</div>`;
  return page(body, css);
}

/** 품목마다 다른 말 — 고객이 찍어 올릴 곳(place)과 해시태그. 모르는 품목은 주방으로 본다. */
export const SUBJECT_WORDS = {
  kitchen: { place: '주방', tags: ['주방인테리어', '주방리모델링', '싱크대교체', '투톤주방'] },
  wardrobe: { place: '방', tags: ['붙박이장', '드레스룸', '붙박이장시공', '침실인테리어'] },
  storage: { place: '집', tags: ['수납장', '냉장고장', '홈카페장', '다이닝인테리어'] },
};
const COMMON_TAGS = ['아파트인테리어', '맞춤가구', '다담가구', 'SEGAN'];

export function subjectWords(subject = 'kitchen') {
  return SUBJECT_WORDS[subject] || SUBJECT_WORDS.kitchen;
}

/**
 * 마지막 장 — 사이트로 부르는 장.
 * @param {object} p
 * @param {string[]} p.tones  이 캐러셀의 색 조합 이름들
 * @param {string} [p.subject='kitchen']  제목의 「내 ○○ 사진으로」를 정한다
 * @param {string} [p.headline]  적으면 품목 말 대신 이 글
 * @param {string} [p.site]
 */
export function ctaHtml({
  tones = [],
  subject = 'kitchen',
  headline,
  site = 'dadamfurniture.com/segan',
} = {}) {
  const head = headline || `내 ${subjectWords(subject).place} 사진으로\n색을 바꿔 보세요`;
  const css = `
body{background:#ffffff;color:#2d2a26}
.brand{position:absolute;left:72px;top:72px;font-size:34px;font-weight:300;letter-spacing:.34em}
.head{position:absolute;left:72px;top:230px;font-size:92px;font-weight:300;letter-spacing:-.03em;line-height:1.22;white-space:pre-line}
.sub{position:absolute;left:76px;top:500px;width:880px;font-size:35px;line-height:1.6;color:#55504a}
.list{position:absolute;left:76px;top:690px;right:72px;border-top:1px solid rgba(45,42,38,.28)}
.row{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid rgba(45,42,38,.14);padding:15px 0;font-size:30px}
.row span{color:#756e66;font-size:24px;font-variant-numeric:tabular-nums}
.site{position:absolute;left:72px;bottom:118px;font-size:46px;letter-spacing:-.01em;color:#0b2545;border-bottom:2px solid #0b2545;padding-bottom:6px}
.note{position:absolute;left:76px;bottom:62px;font-size:23px;color:#756e66}`;
  const rows = tones
    .slice(0, 5)
    .map((t, i) => `<div class="row">${esc(t)}<span>${i + 1}</span></div>`)
    .join('');
  const body = `
<div class="brand">SEGAN</div>
<div class="head">${esc(head)}</div>
<div class="sub">방 사진 한 장을 올리면 맞춤 가구가 들어간 연출컷과 예상 견적을 만들어 드립니다.</div>
<div class="list">${rows}</div>
<div class="site">${esc(site)}</div>
<div class="note">앞의 사진은 모두 AI 로 연출한 이미지이며 실제 시공 사진이 아닙니다 · 다담가구</div>`;
  return page(body, css);
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

/**
 * 게시 글. 링크는 사이트 주소에 유입 꼬리표(UTM)를 붙인다.
 * @param {object} p
 * @param {string} p.title            「같은 주방, 다른 색」
 * @param {string[]} p.tones
 * @param {string} [p.source='instagram']  utm_source
 * @param {string} [p.campaign]       utm_campaign — 예: kitchen-tones_2026-11
 * @param {string} [p.subject='kitchen']  「내 ○○ 사진으로도」와 기본 해시태그를 정한다
 * @param {string[]} [p.tags]         적으면 기본 해시태그 대신 이 목록
 */
export function buildCaption({
  title,
  tones = [],
  source = 'instagram',
  campaign = 'tones',
  subject = 'kitchen',
  tags,
} = {}) {
  const words = subjectWords(subject);
  const long = tones.some((t) => String(t).length > LONG_TONE);
  const list = tones.map((t, i) => `${CIRCLED[i] || i + 1} ${t}`).join(long ? '\n' : '  ');
  const link = `https://dadamfurniture.com/segan/?utm_source=${encodeURIComponent(source)}&utm_medium=social&utm_campaign=${encodeURIComponent(campaign)}`;
  const hash = (tags || [...words.tags, ...COMMON_TAGS]).map((t) => `#${t}`).join(' ');
  return [
    `${title}. 방은 그대로 두고 가구 색만 바꿨습니다.`,
    list,
    '어느 쪽이 우리 집에 어울릴까요? 번호로 알려 주세요.',
    '',
    `내 ${words.place} 사진으로도 해 볼 수 있습니다. 사진 한 장을 올리면 맞춤 가구가 들어간 연출컷과 예상 견적이 나옵니다.`,
    link,
    '',
    '※ AI 로 연출한 이미지입니다. 실제 시공 사진이 아닙니다. 화면의 색은 실제 자재와 다를 수 있습니다.',
    hash,
  ].join('\n');
}
