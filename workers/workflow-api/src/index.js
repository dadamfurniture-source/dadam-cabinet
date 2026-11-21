/**
 * dadam-workflow-api 들머리 (wrangler main).
 *
 *   default      HTTP · cron — src/worker.js 그대로
 *   NtsGateway   서비스 바인딩 RPC — account-api 만 부른다 (wrangler [[services]] entrypoint = "NtsGateway").
 *                이 워커에 등록된 국세청 키로 상태조회 · 진위확인을 대신 부른다 (src/nts-gateway.js). 공개 주소가 없다.
 *
 * 시험(node --test)은 cloudflare:workers 를 못 읽으므로 이 파일을 거치지 않고 worker.js · nts-gateway.js 를 바로 부른다.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import worker from './worker.js';
import { ntsGatewayPost } from './nts-gateway.js';

export class NtsGateway extends WorkerEntrypoint {
  /** (kind: 'status' | 'validate', payload) → 공공데이터포털 응답 본문 | null */
  async post(kind, payload) {
    return ntsGatewayPost(this.env, kind, payload);
  }
}

export default worker;
