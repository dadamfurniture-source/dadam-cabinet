# LIVE 골든 마스터 export 가이드 — 사장님용

**목적**: M5(BOM 마이그레이션 검증) 단계에서 **"바꾸기 전 결과"** 와 **"바꾼 후 결과"** 를 비교할 수 있도록, 현재 LIVE 데이터 100건의 스냅샷을 안전하게 빼내는 절차.

작성일: 2026-05-04
대상: 다담AI 사장님 (Supabase 관리자 권한 보유자)
소요시간: 약 30분~1시간

---

## 한 줄 요약

> 손님 설계 데이터 100건을 **읽기만** 해서 **JSON 파일 한 개**로 저장한 뒤, 개인정보(이메일·이름)만 가린 상태로 안전한 곳에 보관해주세요.

---

## 단계 1 — Supabase Studio 접속

1. 브라우저에서 `https://supabase.com/dashboard` 접속
2. 다담AI 프로젝트 선택
3. 좌측 메뉴에서 **Table Editor** 또는 **SQL Editor** 선택

---

## 단계 2 — 데이터 추출 (SQL Editor 권장)

**SQL Editor**가 편합니다. 다음 쿼리를 그대로 복사해서 붙여넣고 **Run** 눌러주세요.

```sql
-- 최근 6개월 내 가장 활발히 편집된 손님 설계 100건 + 모든 모듈/스펙 데이터
SELECT
  d.id,
  d.title,
  d.design_type,
  d.style,
  d.status,
  d.created_at,
  d.updated_at,
  -- 개인정보 마스킹: 사용자 ID는 해시로 대체
  encode(digest(d.user_id::text, 'sha256'), 'hex') AS user_id_hash,
  -- 모든 design_items를 JSON 배열로
  (
    SELECT json_agg(
      json_build_object(
        'unique_id', i.unique_id,
        'category', i.category,
        'name', i.name,
        'width', i.width,
        'height', i.height,
        'depth', i.depth,
        'specs', i.specs,
        'modules', i.modules
      )
    )
    FROM design_items i
    WHERE i.design_id = d.id
  ) AS items
FROM designs d
WHERE d.created_at >= NOW() - INTERVAL '6 months'
  AND d.status IN ('completed', 'submitted', 'draft')
ORDER BY d.updated_at DESC
LIMIT 100;
```

**왜 이런 쿼리인가**:
- `user_id_hash`로 사용자 식별자 익명화 (sha256 해시는 원본 복원 불가, 같은 사용자 식별만 가능)
- `title`은 손님이 직접 입력한 자유 텍스트 → 만약 이름·전화번호·주소가 들어 있을 가능성 있다면 이 필드도 가려야 함 (단계 4 참조)
- `description`, `user_memo`, `original_image`는 비교에 불필요해서 제외 (BOM은 specs/modules만 영향)

---

## 단계 3 — JSON으로 export

쿼리 실행 후, 결과 표 위쪽의 **Download** 또는 **Export** 버튼을 누르고 **JSON** 형식 선택.

만약 Download 버튼이 없으면:
1. 결과 표 우상단의 **⋯** 메뉴 → **Download as CSV** 선택
2. (또는) SQL Editor에서 결과를 마우스로 전체 선택 → 복사 → 텍스트 파일로 저장

파일명 권장: `golden-master-v1-2026-05-04.json` (날짜는 export하신 날로)

---

## 단계 4 — 개인정보 한 번 더 점검

JSON 파일을 열어서 **Ctrl+F** 로 다음 단어들을 검색해보세요:

- `@` (이메일 흔적)
- `010-`, `010 `, `+82` (전화번호)
- 한글 성씨 패턴: `김`, `이`, `박`, `최` 등이 `title`에 들어 있는지

발견되면 일반 텍스트 편집기(메모장 등)에서 일괄 치환:
- 이메일 → `[masked-email]`
- 전화번호 → `[masked-phone]`
- 이름 → `손님A`, `손님B`, ...

---

## 단계 5 — 안전한 위치에 저장

### 옵션 A — 저장소 git에 직접 (권장, 100건 = 약 100KB~1MB)

저장 위치: `__tests__/golden-master/v1-2026-05-04.json`

```bash
mkdir -p __tests__/golden-master
mv ~/Downloads/golden-master-v1-2026-05-04.json __tests__/golden-master/
```

`.gitignore`에 다음 한 줄 추가하시거나, 마스킹이 완료된 파일임이 확실하면 그대로 commit.

### 옵션 B — 별도 클라우드 (PII가 완전히 마스킹 됐는지 확신이 없을 때)

- Google Drive, Dropbox 등에 비공개 폴더로 저장
- 저장소에는 경로/링크만 메모 (`docs/04-report/golden-master-location.md` 같은 파일)
- M5 작업자에게 별도로 공유

---

## 단계 6 — 확인 후 알려주세요

저장 완료 후 다음 셋 중 하나로 알려주세요:

1. **"git에 올렸어" + 파일 경로** → 제가 자동 비교 도구를 그 경로 기준으로 작성
2. **"클라우드에 보관 중"** → 비교 시점에 별도로 공유받음
3. **"export 했는데 어디 두는 게 좋을지 모르겠다"** → 같이 결정

---

## 참고 — 이 데이터로 무엇을 하나

M5(BOM 마이그레이션 검증) 단계에서:

1. 새 코드(다중 공간 floorplan 모델)로 같은 100건을 다시 BOM 산출
2. 자재별로 **수량/치수 차이**를 표로 정리 (자동 비교 스크립트)
3. 차이 발생 시:
   - "기존이 틀렸고 새 코드가 맞다" → 패치 노트
   - "기존이 맞고 새 코드가 틀렸다" → 새 코드 수정
   - "둘 다 일리 있다" → 도메인 전문가(사장님) 판정
4. 모든 차이가 화이트리스트에 들어가야 LIVE 배포 가능

→ 이 골든 마스터 없이는 BOM 변경의 정확성을 보장할 수 없습니다. **사활 1순위 위험 대응 자료**입니다.

---

## 보안 체크리스트

- [ ] sha256으로 user_id 해시 처리됨
- [ ] title/description에 이름·전화·주소 없음 확인
- [ ] 파일을 공개 저장소에 올리는 경우, 마스킹 한 번 더 검증
- [ ] 클라우드에 둘 경우, 공유 링크가 비공개임 확인

---

## 문제가 생기면

- 쿼리 실행 시 "permission denied" → Supabase에서 사장님 계정의 RLS 정책 확인 (admin 권한 필요)
- 결과가 0건 → `status` 조건을 빼고 다시 시도
- 결과가 100건보다 적음 → `INTERVAL '6 months'` 를 `'12 months'` 로 늘리기

각 단계에서 막히시면 해당 단계 번호와 에러 메시지/스크린샷 주시면 도와드리겠습니다.
