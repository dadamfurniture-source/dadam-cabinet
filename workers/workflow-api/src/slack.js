/**
 * Slack 알림 — Incoming Webhook.
 *
 * Bot Token 이 아니라 Webhook 을 쓰는 이유: 지금 필요한 것은 단방향 알림
 * 1채널이다. Bot Token 은 OAuth 설치 · scope · 토큰 회전이 따라오고,
 * 인터랙티브 버튼을 쓰려면 요청 서명 검증(x-slack-signature)까지 필요하다.
 *
 * 나중에 Bot Token 으로 갈아탈 수 있도록 공개 인터페이스는
 * notifySlack(env, {...}) 하나로 감싼다. 호출부는 전송 방식을 모른다.
 */

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1500, 4000];

/** Slack 이 링크로 해석하지 않도록 최소한만 이스케이프한다. */
function slackEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const SCHEDULE_LABELS = {
  measurement: '실측',
  material_order: '자재 발주',
  manufacturing_start: '제작 착수',
  manufacturing_end: '제작 완료',
  quality_check: '검수',
  delivery: '납품',
  installation: '설치',
  as_visit: 'A/S 방문',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO → '8/12(수) 09:00' (KST). */
function formatKst(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const mm = kst.getUTCMonth() + 1;
  const dd = kst.getUTCDate();
  const wd = WEEKDAYS[kst.getUTCDay()];
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd}(${wd}) ${hh}:${mi}`;
}

/**
 * 일정 등록 알림 Block Kit.
 *
 * ⚠️ 버튼은 url 형 만 쓴다. action_id 기반 인터랙티브는 Bot Token +
 *    요청 서명 검증이 필요하다.
 * ⚠️ text(fallback) 를 반드시 채운다 — 모바일 알림·접근성에서
 *    blocks 가 렌더되지 않는 경우가 있다.
 */
export function buildScheduleBlocks({ title, customerName, schedules, links, totalKrw }) {
  const lines = schedules.map((s) => {
    const label = SCHEDULE_LABELS[s.type] || s.type;
    const who = s.assignee_name ? ` · 담당 ${slackEscape(s.assignee_name)}` : '';
    const where = s.location ? `\n${slackEscape(s.location)}` : '';
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${formatKst(s.scheduled_at)}* ${slackEscape(label)}${who}${where}`,
      },
    };
  });

  const fields = [
    { type: 'mrkdwn', text: `*고객*\n${slackEscape(customerName || '-')}` },
    { type: 'mrkdwn', text: `*일정*\n${schedules.length}건` },
  ];
  if (totalKrw != null) {
    fields.push({
      type: 'mrkdwn',
      text: `*견적*\n${Number(totalKrw).toLocaleString('ko-KR')}원`,
    });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📐 ${String(title || '설계').slice(0, 140)}`, emoji: true },
    },
    { type: 'section', fields },
    { type: 'divider' },
    ...lines,
  ];

  // 버튼은 로그인 뒤 워크플로 패널이 열리는 설계 페이지로 보낸다.
  // Worker 의 인쇄 경로는 JWT 를 요구해 브라우저 클릭으로는 401 이 되고,
  // 고객 공유 링크는 평문 토큰이 DB 에 없어 여기서 만들 수 없다.
  if (links && links.designUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '설계 · 문서 열기', emoji: true },
          url: links.designUrl,
        },
      ],
    });
  }

  if (links && links.docNo) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `다담AI · ${slackEscape(links.docNo)}` }],
    });
  }

  // fallback
  const text = `[다담] ${title || '설계'} — 일정 ${schedules.length}건 등록 (${schedules
    .map((s) => `${SCHEDULE_LABELS[s.type] || s.type} ${formatKst(s.scheduled_at)}`)
    .join(', ')})`;

  return { blocks, text };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 실제 전송. 재시도 정책:
 *   - 429 / 5xx → 지수 백오프 3회. Retry-After 헤더를 존중한다
 *   - 4xx (invalid_payload 등) → 즉시 실패. 재시도해도 소용없다
 *
 * @returns {{ok:boolean, attempts:number, error?:string}}
 */
export async function postToWebhook(env, payload) {
  const url = env.SLACK_WEBHOOK_URL;
  if (!url) {
    // secret 미설정은 설정 실수이지 일정 등록의 실패가 아니다.
    // 호출부가 201 을 유지하고 이 사유를 기록한다.
    return { ok: false, attempts: 0, error: 'SLACK_WEBHOOK_URL not configured' };
  }

  let lastError = '';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      lastError = `network: ${e && e.message}`;
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }

    if (res.ok) return { ok: true, attempts: attempt + 1 };

    const body = await res.text().catch(() => '');
    lastError = `${res.status}: ${body.slice(0, 300)}`;

    // 4xx 는 재시도 무의미 (429 제외)
    if (res.status !== 429 && res.status < 500) {
      return { ok: false, attempts: attempt + 1, error: lastError };
    }

    const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
    await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : BACKOFF_MS[attempt]);
  }

  return { ok: false, attempts: MAX_ATTEMPTS, error: lastError };
}

export { SCHEDULE_LABELS, formatKst };
