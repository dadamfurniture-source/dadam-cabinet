# LoRA 학습 파이프라인 셋업 가이드

이 문서는 admin/gallery.html 의 "🤖 LoRA 학습" 기능을 활성화하기 위한 1회성 셋업 절차입니다.

## 1. Supabase RLS · Storage 적용

Supabase 대시보드 → SQL Editor 에서 다음 두 파일을 순서대로 실행:

1. `database/fix-admin-rls-recursion.sql` (이미 실행돼 있으면 스킵 — `public.is_admin()` 함수 정의)
2. `database/fix-lora-models-admin-rls.sql` (이번 PR 추가) — `lora_models` 관리자 쓰기 + `training-zips` 버킷 생성·RLS

확인: SQL Editor 에서
```sql
SELECT * FROM storage.buckets WHERE id = 'training-zips';
SELECT policyname FROM pg_policies WHERE tablename = 'lora_models';
```

## 2. mcp-server 환경변수

Railway 대시보드 → `agent-api-production-523d` 프로젝트 → Variables 에 다음 추가 (또는 확인):

| Key | Value |
|---|---|
| `REPLICATE_API_KEY` | Replicate 대시보드 → Account → API Tokens 에서 복사 (`r8_...`) |
| `SUPABASE_URL` | 이미 있음 |
| `SUPABASE_ANON_KEY` | 이미 있음 |

## 3. mcp-server 재배포

이번 PR 의 mcp-server 변경사항(lora.route.ts, lora-training.service.ts, archiver dep) 이 Railway 에 자동 배포되도록 main 머지 후:

- Railway 가 main 브랜치를 watch 한다면 자동 빌드·배포
- 그렇지 않다면 Railway 대시보드 → Deployments → Trigger Deploy

배포 확인:
```
curl https://agent-api-production-523d.up.railway.app/health
```
출력에 `status: "ok"` 가 보이면 정상. 신규 엔드포인트는 인증 필요.

## 4. 학습용 이미지 마킹

`admin/gallery.html` 에서:
1. 냉장고장 카테고리 필터 적용
2. 고품질 설치 사례 이미지를 선택 → "학습용으로 전환" (또는 업로드 시 학습용 체크)
3. 최소 **10장**, 권장 **20~50장** 마킹

너무 적으면 LoRA 가 일반화 못 함. 너무 많으면 비용 + 시간 ↑ (100장 cap).

## 5. 학습 시작

1. `admin/gallery.html` 에서 카테고리 필터를 **냉장고장** (`fridge_cabinet` 또는 `fridge`) 선택
2. 상단에 "🤖 LoRA 학습 (냉장고장)" 패널 노출됨
3. "학습 시작" 클릭 → 확인 다이얼로그
4. mcp-server 가 자동으로:
   - 학습용 이미지 다운로드 + zip 패키징 (~30초)
   - Supabase `training-zips` 버킷에 업로드
   - Replicate Flux LoRA 트레이너 트리거
   - `lora_models` 테이블에 `status='training'` 행 INSERT
5. 패널의 "새로고침" 으로 진행 상태 확인 (~20분 후 `ready`)

## 6. 학습된 모델 확인

- `lora_models` 테이블에서 `status='ready'` 인 행의 `model_version` 컬럼이 Replicate 의 사용 가능한 LoRA 모델 ID
- 다음 PR (Phase 2) 에서 이 모델을 `/api/generate` 의 추천 이미지 생성 단계에 연결 예정

## 7. 트러블슈팅

| 증상 | 원인 | 조치 |
|---|---|---|
| 패널이 안 뜸 | 카테고리 필터 미적용 | 냉장고장 선택 |
| "학습 시작" 비활성 | 이미지 < 10장 또는 학습 진행 중 | 학습용 추가 마킹 / 기존 작업 완료 대기 |
| `403` | requireAdmin 차단 | admin_roles 테이블에 본인 user_id 등록 |
| `500` `REPLICATE_API_KEY not set` | Railway 환경변수 누락 | Variables 에 추가 후 재배포 |
| `학습 이미지 부족` | is_training=true 가 10 미만 | 더 마킹 |
| 30분 지나도 status='training' | Replicate 학습 지연 | https://replicate.com/dashboard 에서 직접 확인 |
| `zip 업로드 실패 403` | training-zips 버킷 RLS 미적용 | Step 1 SQL 재실행 |
