/**
 * GeminiProxy — 미국 콜로에 고정된 Durable Object.
 *
 * 왜 필요한가:
 *   Google AI Studio 는 발신 지역으로 요청을 막는다. 워커가 HKG·KIX 콜로에서 뜨면
 *   게이트웨이·직접 호출 모두 400 "User location is not supported" 가 났다 (2026-09-09 실측).
 *   Durable Object 는 만들 때 locationHint 로 콜로를 고를 수 있고, 한 번 만들어지면
 *   거기 머문다. 그래서 Gemini 호출만 이 객체를 거쳐 미국에서 나가게 한다.
 *
 * 하는 일은 하나다: 받은 {url, body} 를 그대로 Google 에 POST 하고 응답을 돌려준다.
 * 상태를 저장하지 않는다.
 */
export class GeminiProxy {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response('POST only', { status: 405 });
    const { url, body } = await request.json();
    if (!url || !/^https:\/\/generativelanguage\.googleapis\.com\//.test(url)) {
      return new Response('bad target', { status: 400 });
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // 상태 코드와 본문을 그대로 넘긴다. 호출 쪽이 지역 차단 여부를 판단한다.
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
  }
}

/** 미국 동부 힌트로 프록시 stub 을 얻는다. 이름을 고정하면 같은 객체(같은 콜로)를 다시 쓴다. */
export function proxyStub(env) {
  if (!env.GEMINI_PROXY) return null;
  const id = env.GEMINI_PROXY.idFromName('us-east');
  return env.GEMINI_PROXY.get(id, { locationHint: 'enam' });
}
