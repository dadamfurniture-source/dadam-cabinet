# DB 마이그레이션 (번호 파일)

DB 스키마를 바꾸는 일은 이 폴더의 번호 파일로만 한다. 무엇이 언제 적용됐는지는
라이브 DB 의 `public.schema_migrations` 표가 기억한다.

## 파일

| 파일                       | 뜻                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `0000_baseline.sql`        | 출발점. 2026-10-27 라이브 DB 스키마를 그대로 찍은 기준선. 라이브에는 돌리지 않고 「적용됨」으로만 적는다. |
| `0001_….sql` 부터          | 변경 하나에 파일 하나. 적용한 순서 그대로 번호가 붙는다.                                                  |
| `database/*.sql` (옛 파일) | 손으로 돌리던 시절의 기록. 역사로만 둔다 — 고치지 않고, 새 변경도 넣지 않는다.                            |

- 이름: `NNNN_무엇을_하는지.sql` — 네 자리 번호, 소문자 · 숫자 · `_` · `-`.
- 번호: 다음 번호 — 열려 있는 다른 DB PR 이 잡은 번호도 건너뛴다. 겹치는 번호는
  시험(`__tests__/db-migrations.test.js`)이 막는다. 앞 번호 PR 이 아직 머지되지
  않아 번호가 비는 것은 괜찮다 — 대신 `--apply` 는 빈 번호가 메워질 때까지 그 뒤
  번호를 적용하지 않는다.
- 적용한 파일은 다시 고치지 않는다. 고칠 일이 생기면 다음 번호 파일로 고친다
  (적용한 뒤 파일 내용이 바뀌면 `db-migrate` 가 체크섬으로 알아채고 아무것도
  돌리지 않는다).

## 새 변경 순서

1. **파일 만들기** — 다음 번호로 `database/migrations/NNNN_이름.sql`.
2. **다시 돌려도 되게** (되는 데까지): `CREATE TABLE IF NOT EXISTS`,
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
   `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` 다음 `CREATE POLICY`,
   `DROP TRIGGER IF EXISTS` 다음 `CREATE TRIGGER`, 버킷은
   `INSERT INTO storage.buckets … ON CONFLICT (id) DO …`.
3. **트랜잭션 문은 넣지 않는다** — `BEGIN` · `COMMIT` · `ROLLBACK` 은 도구가
   감싼다(넣으면 도구가 받지 않는다). 그래서 트랜잭션 안에서 못 도는
   문(`CREATE INDEX CONCURRENTLY`, `VACUUM` 등)은 쓸 수 없다.
4. **PR 로 올린다** (브랜치 `agent/db-*`).
5. **미리 보기** —
   `node scripts/db-migrate.mjs --dry database/migrations/NNNN_이름.sql` →
   라이브 DB 에서 한 트랜잭션 안에 돌려 보고 ROLLBACK 한다. 객체 수(테이블 · 열
   · 함수 · 정책 …)가 전후로 찍힌다. 돌리는 동안은 실제 잠금이 걸린다 — 잠금은
   5초까지만 기다리고 못 잡으면 멈춘다.
6. **승인** — 미리 보기 결과를 보고 승인을 받는다.
7. **적용** —
   `node scripts/db-migrate.mjs --apply database/migrations/NNNN_이름.sql` → 한
   트랜잭션: 파일을 돌리고 `schema_migrations` 에 번호 · 이름 · 시각 · 체크섬을
   적는다. 중간에 실패하면 아무것도 바뀌지 않는다. 맨 앞 대기 번호만 받는다
   (건너뛰기 · 거꾸로 적용 금지).
8. **확인** — `node scripts/db-migrate.mjs --status`

참고: 라이브 DB 에는 public 에 새 테이블이 생기면 RLS 를 자동으로 켜는 이벤트
트리거(`ensure_rls`)가 있다. 정책이 없는 테이블은 API(anon · authenticated)로
읽히지 않는다.

## 처음 한 번 — 기록 시작

`schema_migrations` 표는 아직 없다. 만드는 것도 DB 쓰기라 따로 미리 보고 승인
받은 뒤 한다.

1. `node scripts/db-migrate.mjs --baseline-mark --dry` — 할 일을 돌려 보고
   ROLLBACK (실행할 SQL 이 찍힌다)
2. 승인
3. `node scripts/db-migrate.mjs --baseline-mark`
   - `public.schema_migrations` 표를 만든다 (RLS 켬, PUBLIC · anon ·
     authenticated · service_role 권한 없음)
   - `0000_baseline.sql` 을 「적용됨」으로 적는다 — 파일은 실행하지 않는다
   - 그 전에 라이브 스키마를 다시 덤프해 기준선 본문과 견준다. 다르면 멈춘다 →
     기준선을 다시
     찍어(`node scripts/db-dump-schema.mjs --baseline --out database/migrations/0000_baseline.sql`)
     PR 로 올린 뒤 기록한다. 기록한 뒤에는 기준선을 다시 찍지 않는다.

## 도구

| 명령                                                                            | 하는 일                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `node scripts/db-dump-schema.mjs [--out 파일]`                                  | 라이브 스키마 덤프 (읽기 전용 · 행 데이터 없음 · 두 번 찍어도 같다)                                |
| `node scripts/db-dump-schema.mjs --baseline --out …`                            | 기준선 머리말(찍은 날)을 붙여 덤프                                                                 |
| `node scripts/db-migrate.mjs --status`                                          | 적용됨 · 대기 · 바뀜 · 파일 없음 목록 (읽기 전용)                                                  |
| `node scripts/db-migrate.mjs --dry 파일`                                        | 돌려 보고 ROLLBACK, 객체 수 전후                                                                   |
| `node scripts/db-migrate.mjs --apply 파일`                                      | 한 트랜잭션으로 적용 + 기록                                                                        |
| `node scripts/db-migrate.mjs --baseline-mark [--dry]`                           | 기록 표 만들기 + 0000 을 적용됨으로                                                                |
| `node scripts/rls-probe.mjs --probe database/probes/….json [--migration 파일]…` | 역할별(anon · 고객 · 구성원 · 관리자 …) 읽기 · 쓰기 표 — 가짜 계정 · 행으로 시험하고 끝에 ROLLBACK |

- 접속: `pg` 패키지는 `mcp-server/node_modules` 에서 싣는다
  (`cd mcp-server && npm ci`). 접속값은 환경 변수 또는 `mcp-server/.env` 의
  `SUPABASE_URL` · `SUPABASE_DB_PASSWORD` (세션 모드 풀러
  `aws-1-ap-northeast-2.pooler.supabase.com:5432`, 사용자
  `postgres.<프로젝트 ref>`). 다른 곳의 `.env` 를 쓰려면
  `node --env-file=경로 scripts/db-….mjs …`.
- 체크섬: 파일 내용의 sha256. BOM 은 빼고 줄바꿈은 LF 로 맞춰 계산한다 (Windows
  CRLF 작업본과 같은 값).
- 라이브가 파일들과 어긋났는지 보려면: 덤프를 `tmp/` 같은 곳에 찍어
  `git diff --no-index` 로 견준다.

## 덤프에 들어가는 것 · 빠지는 것

- 들어감 (public 스키마): 확장(`CREATE EXTENSION IF NOT EXISTS`), 타입, 시퀀스,
  테이블(열 · 기본값 · NOT NULL), 제약(CHECK · PK · UNIQUE · FK 와 ON DELETE),
  인덱스, 뷰(`security_invoker` 같은 옵션), 함수(SECURITY DEFINER · search_path
  포함), 트리거, RLS 켜짐, 정책, 권한(PUBLIC · anon · authenticated ·
  service_role, 열 단위 포함), 설명(COMMENT)
- 들어감 (public 밖에서 앱이 만든 것): storage 버킷 정의, storage 정책,
  `auth.users` 에 건 트리거, public 함수를 부르는 이벤트 트리거
- 빠짐: 행 데이터 전부 (시퀀스는 1부터), Supabase 가 관리하는 스키마의 자체
  객체, 확장이 만든 객체, 소유자(OWNER), 기본 권한(ALTER DEFAULT PRIVILEGES —
  Supabase 기본값)

기준선 파일은 빈 Supabase 프로젝트에 postgres 역할로 돌리면 찍은 날의 스키마가
다시 만들어지도록 쓰여 있다 (새 DB 를 만들 때 `0000` → `0001` … 차례.
`db-migrate` 는 `0000` 을 돌리지 않으니 이때는 직접 돌린다).
