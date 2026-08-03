/**
 * 경로 파라미터를 지원하는 최소 라우터.
 *
 * payments-api 는 `switch (path)` 방식이라 `/designs/:id/snapshots` 같은
 * 경로를 표현할 수 없어 이 워커에만 추가했다.
 *
 * 패턴 문법: '/designs/:designId/snapshots'  → { designId: '...' }
 * 와일드카드나 정규식은 지원하지 않는다 (필요해지면 그때 추가).
 */

/** 패턴을 세그먼트 배열로 1회 컴파일. */
function compile(pattern) {
  return pattern.split('/').filter((s) => s.length > 0);
}

/**
 * @returns {Object|null} 매치되면 params 객체(파라미터 없으면 {}), 아니면 null
 */
function matchSegments(patternSegs, pathSegs) {
  if (patternSegs.length !== pathSegs.length) return null;
  const params = {};
  for (let i = 0; i < patternSegs.length; i++) {
    const p = patternSegs[i];
    if (p.startsWith(':')) {
      const value = decodeURIComponent(pathSegs[i]);
      if (!value) return null;
      params[p.slice(1)] = value;
    } else if (p !== pathSegs[i]) {
      return null;
    }
  }
  return params;
}

export function createRouter(routes) {
  const compiled = routes.map((r) => ({ ...r, segs: compile(r.path) }));

  return {
    /**
     * @returns {{handler, params}|null|'method_mismatch'}
     *   경로는 맞지만 메서드가 다르면 'method_mismatch' 를 돌려주어
     *   호출부가 404 대신 405 를 줄 수 있게 한다.
     */
    resolve(method, pathname) {
      const pathSegs = pathname.split('/').filter((s) => s.length > 0);
      let pathMatchedButMethodDiffers = false;

      for (const route of compiled) {
        const params = matchSegments(route.segs, pathSegs);
        if (params === null) continue;
        if (route.method !== method) {
          pathMatchedButMethodDiffers = true;
          continue;
        }
        return { handler: route.handler, params, auth: route.auth };
      }
      return pathMatchedButMethodDiffers ? 'method_mismatch' : null;
    },
  };
}
