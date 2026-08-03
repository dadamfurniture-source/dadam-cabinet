/**
 * HTML 렌더 공용 헬퍼.
 *
 * ★ 문서에 들어가는 값은 전부 사용자 입력이다 (설계명, 모듈명, 고객명,
 *   자재 비고 등). 이 저장소는 과거 collection renderGrid 에서 Supabase 데이터를
 *   그대로 innerHTML 에 넣어 XSS 가 났던 이력이 있다(PR #422).
 *   여기서는 esc() 를 거치지 않은 값을 템플릿에 넣지 않는다.
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** HTML 텍스트/속성 이스케이프. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/**
 * 값이 비어 있는지. Number(null) 과 Number('') 는 0 이라서
 * 그냥 Number 로 변환하면 "값 없음" 이 고객 문서에 0원으로 찍힌다.
 */
function isBlank(n) {
  return n === null || n === undefined || (typeof n === 'string' && n.trim() === '');
}

/** 원화 표기. 값이 없거나 숫자가 아니면 '-'. */
export function krw(n) {
  if (isBlank(n)) return '-';
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return `${v.toLocaleString('ko-KR')}원`;
}

/** 숫자 천단위 구분. 값이 없으면 '-'. */
export function num(n) {
  if (isBlank(n)) return '-';
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('ko-KR');
}

/** ISO → 'YYYY-MM-DD' (KST 기준). */
export function ymd(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** ISO → 'YYYY-MM-DD HH:mm' (KST 기준). */
export function ymdhm(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.toISOString().slice(0, 10)} ${kst.toISOString().slice(11, 16)}`;
}

/** 표 한 줄. cells 는 이미 이스케이프된 문자열 배열. */
export function tr(cells, classes = []) {
  return `<tr>${cells
    .map((c, i) => `<td${classes[i] ? ` class="${classes[i]}"` : ''}>${c}</td>`)
    .join('')}</tr>`;
}

export function thead(headers, classes = []) {
  return `<thead><tr>${headers
    .map((h, i) => `<th${classes[i] ? ` class="${classes[i]}"` : ''}>${esc(h)}</th>`)
    .join('')}</tr></thead>`;
}

/**
 * 문서 껍데기.
 * @param {string} title    <title> (이스케이프해서 넘길 것)
 * @param {string} css      인라인 CSS
 * @param {string} body     본문 HTML
 */
export function documentShell({ title, css, body, lang = 'ko' }) {
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}
