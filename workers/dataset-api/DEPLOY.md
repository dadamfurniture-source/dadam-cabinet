# dataset-api 배포

학습 데이터셋 수집·내보내기 워커. 관리자 화면은 `admin/dataset.html`.

## 순서

### 1. SQL 먼저

Supabase 대시보드 → SQL Editor 에서 `database/dataset-schema.sql` 전체 실행.
재실행 안전이다 (표·컬럼은 IF NOT EXISTS, 축 CHECK 는 다시 건다).

만드는 것: `dataset_samples` · `dataset_reviews` · `dataset_ingest_state` ·
뷰 `dataset_exportable` · 트리거 둘, 그리고 기존 표에 컬럼 셋
(`collection_posts.design_id`, `.item_unique_id`, `.consent_training`, `generations.consent_training`).

`database/dataset-chain.sql` 도 이어서 실행한다 — 사슬(연출컷→도면→완성→피드백)을 잇는
컬럼 둘과, **시공 완료된 것만 내보내는** 뷰가 거기 있다.

### 2. 비공개 버킷

Storage → New bucket → 이름 `datasets`, **Public 체크 해제**.
내보내기 결과(`exports/{날짜}.jsonl`, `exports/latest.jsonl`)가 여기 쌓인다.
공개로 만들면 고객 사진 URL 목록이 그대로 열린다 — 반드시 비공개.

### 3. 시크릿

```bash
cd workers/dataset-api
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

원본 표를 통째로 읽고 RLS 를 지나치는 키다. 다른 워커와 공유하지 말 것
(generate-api 는 이미 자기 몫을 갖고 있다).

### 4. 배포

`main` 에 `workers/dataset-api/**` 가 올라가면 GitHub Actions 가 배포한다
(`.github/workflows/dataset-api-deploy.yml`). 수동은:

```bash
cd workers/dataset-api && npx wrangler deploy
```

### 5. 확인

```bash
curl https://dadam-dataset-api.dadamfurniture.workers.dev/health
```

`configured: true` 면 시크릿이 들어간 것이다. 그다음 `admin/dataset.html` 에서
**지금 수집** 을 눌러 첫 수집을 돌린다 (cron 을 기다리지 않아도 된다).

## cron

| 표현식 | 하는 일 |
|---|---|
| `*/10 * * * *` | 증분 수집 — `collection_posts` · `generations` 의 `updated_at` 워터마크 이후 |
| `30 18 * * *` | 내보내기 — KST 03:30. `dataset_exportable` → `datasets/exports/` |

cron 을 바꾸면 `src/worker.js` 의 야간 판정(`event.cron === '30 18 * * *'`)도 같이 고칠 것.

## 알아둘 것

- **동의가 없으면 넣지 않는다.** `consent_training = true` 인 행만 수집하고, 동의를
  내린 행은 이미 넣은 샘플을 지운다. 기존 데이터는 전부 NULL 이라 처음엔 0건이 정상이다 —
  업로드·생성 화면에 동의 체크박스가 붙어야 쌓이기 시작한다.
- **사람이 검수한 라벨은 덮어쓰지 않는다.** 원본 행이 다시 저장돼도 `label_source='human'`
  인 샘플은 건너뛴다.
- **실패하면 워터마크를 올리지 않는다.** 다음 실행이 같은 구간을 다시 읽는다.
  상태는 `dataset_ingest_state` 에서 본다 (`last_error` 포함).
- 처음부터 다시 읽히려면: `UPDATE dataset_ingest_state SET watermark = '1970-01-01';`
- **시공이 끝난 것만 내보낸다.** 판정은 `orders.status = 'completed'` 이고, 샘플은
  `design_id` 로 설계에 붙어 있어야 한다. 연결이 없으면(대부분의 옛 글) 내보내기에서 빠진다 —
  검수 큐에는 그대로 들어온다.
- 연출컷을 먼저 수집한 뒤 설계가 생기면, `designs` 를 따로 보는 `backfillDesignLinks` 가
  그 샘플의 `design_id`·`group_key` 를 뒤늦게 채운다 (`dataset_ingest_state.src_table='designs'`).
- 외부 수집물(동그라미하우스·업체 홈페이지)은 여기로 들어오지 않는다. 재배포 금지 자료라
  리포 밖 로컬(`ohouse-crawl` · `D:\ohouse`)에만 둔다.
