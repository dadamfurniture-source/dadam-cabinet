/**
 * dadam-assistant-api 들머리 (wrangler main).
 *
 *   default            HTTP — src/worker.js (비서 대화 주소)
 *   AssistantSession   대화마다 Durable Object (src/session.js)
 *   ExtractJob         사진마다 Durable Object — 영수증 · 명세표 읽기 (src/extract/job.js)
 *   GuideSession       안내 모드 — 사람마다 Durable Object, 미국 콜로에서 Claude 를 부르고 답을 흘려보낸다 (src/guide.js)
 *   LedgerExtract      서비스 바인딩 RPC — workflow-api 만 부른다 (wrangler [[services]] entrypoint = "LedgerExtract").
 *                      공개 주소가 없어 바깥에서 부를 수 없다.
 *
 * 시험(node --test)은 cloudflare:workers 를 못 읽으므로 이 파일을 거치지 않고 worker.js · extract/job.js 를 바로 부른다.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import worker from './worker.js';
import { queueExtract } from './extract/job.js';

export { AssistantSession } from './session.js';
export { ExtractJob } from './extract/job.js';
export { GuideSession } from './guide.js';

export class LedgerExtract extends WorkerEntrypoint {
  /** { documentId, again } → { ok, queued } — 사진 읽기를 맡기고 바로 돌아온다 */
  async extract(input) {
    return queueExtract(this.env, input);
  }
}

export default worker;
