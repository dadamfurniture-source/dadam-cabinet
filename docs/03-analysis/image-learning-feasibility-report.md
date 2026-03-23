# 가구 이미지 학습 기반 생성 시스템 - 타당성 보고서

> 작성일: 2026-02-19
> 대상: 다담AI 가구 디자인 이미지 생성 파이프라인

---

## 1. 아이디어 요약

**목표**: Supabase에 수집한 실제 가구(싱크대, 쿡탑, 후드, 도어 등) 이미지를 학습/참조하여, 이미지 생성 시 더 정확하고 일관된 가구 디자인을 만들어내는 시스템.

**핵심 질문**: 수집된 가구 이미지를 활용해 생성 품질을 높일 수 있는가? 어떤 방식이 가장 효율적인가?

---

## 2. 접근 방식 비교

### 2-1. Flux LoRA Fine-tuning (커스텀 모델 학습)

| 항목 | 내용 |
|------|------|
| **원리** | 10~50장의 가구 이미지로 Flux.1 모델에 LoRA 어댑터를 학습시켜 "다담 스타일" 가구를 생성하도록 특화 |
| **플랫폼** | Replicate, fal.ai, Civitai |
| **비용** | 학습 1회: $1~2 (Replicate 기준 $1.85/20장/1000스텝) |
| **학습 시간** | 2~20분 (fal.ai fast: ~2분, Replicate: ~20분) |
| **필요 이미지** | 10~50장 (품목당) |
| **추론 비용** | $0.003~0.01/장 (Replicate) |
| **기존 사례** | InteriorDesigner-Flux (인테리어 특화 LoRA 모델 존재) |

**장점**:
- 학습 후 생성 결과가 가장 일관됨 (한번 학습하면 스타일 고정)
- 트리거 워드로 특정 가구 품목 호출 가능 (예: `DADAM_SINK`, `DADAM_HOOD`)
- 비용 매우 저렴 (학습 $2 미만, 추론 $0.01 미만)
- 품목별 LoRA 분리 학습 가능 → 조합 생성

**단점**:
- 현재 Grok(xAI) API는 fine-tuning 미지원 → 별도 Flux 추론 인프라 필요
- 이미지 수집 초기 노력 (품목당 10~50장)
- 새 디자인/트렌드 반영 시 재학습 필요
- LoRA 조합(싱크대+도어+카운터탑) 시 간섭 가능성

**효율성**: ★★★★★ | **정확도**: ★★★★☆ | **구현 난이도**: ★★★☆☆

---

### 2-2. Gemini Reference Images (참조 이미지 기반 생성)

| 항목 | 내용 |
|------|------|
| **원리** | 생성 요청 시 참조 이미지를 함께 전달하여 "이 스타일처럼" 생성하도록 유도 |
| **플랫폼** | Google Gemini API (Imagen 3), Firebase AI Logic |
| **비용** | 이미지 생성 API 호출 비용만 ($0.02~0.04/장) |
| **학습 시간** | 없음 (런타임에 참조) |
| **필요 이미지** | 1~14장 (요청당 최대 14장 참조 가능) |
| **기존 사례** | Imagen Style Customization (Google 공식 기능) |

**장점**:
- 사전 학습 불필요 → 즉시 적용 가능
- 이미지 추가/변경이 자유로움 (Supabase에서 동적 선택)
- 최대 14장까지 참조 가능 → 다양한 각도/스타일 혼합
- Gemini API가 이미 다담 파이프라인에 통합되어 있음

**단점**:
- 참조의 "해석"이 모호할 수 있음 (어떤 요소를 참조할지 제어 어려움)
- Gemini Imagen의 한국 빌트인 가구 이해도 불확실
- 참조 이미지 수에 따라 응답 시간 증가
- 현재 Grok 기반 파이프라인과 별도 (Gemini로 전환 필요)

**효율성**: ★★★★☆ | **정확도**: ★★★☆☆ | **구현 난이도**: ★★☆☆☆

---

### 2-3. IP-Adapter (스타일 전이 어댑터)

| 항목 | 내용 |
|------|------|
| **원리** | 참조 이미지에서 스타일/특징을 추출하여 생성 과정에 주입하는 경량 어댑터 |
| **플랫폼** | Hugging Face Diffusers, ComfyUI, Replicate |
| **비용** | 추론만: $0.01~0.03/장 |
| **학습 시간** | 없음 (사전 학습된 어댑터 사용) |
| **필요 이미지** | 1~4장 (요청당) |
| **기존 사례** | IP-Adapter + SDXL/Flux 조합으로 인테리어 스타일 전이 |

**장점**:
- 별도 학습 없이 참조 이미지의 스타일을 실시간 적용
- LoRA와 조합 가능 (LoRA로 품목 학습 + IP-Adapter로 스타일 적용)
- 스타일 강도(scale) 조절 가능 (0.0~1.0)
- Replicate/fal.ai에서 API로 바로 사용 가능

**단점**:
- Grok API에서는 사용 불가 → 별도 Flux/SDXL 추론 서버 필요
- 스타일"만" 전이하므로 구체적 가구 형상 재현은 약함
- 한국 빌트인 가구 특유의 디테일(몰딩, 걸레받이 등) 표현 한계

**효율성**: ★★★☆☆ | **정확도**: ★★★☆☆ | **구현 난이도**: ★★★☆☆

---

### 2-4. Multimodal RAG (이미지 벡터 검색 + 프롬프트 보강)

| 항목 | 내용 |
|------|------|
| **원리** | 수집 이미지를 벡터 임베딩으로 변환 → 생성 요청 시 유사 이미지 검색 → 프롬프트 또는 참조로 활용 |
| **플랫폼** | Supabase pgvector + CLIP/OpenCLIP 임베딩 |
| **비용** | 임베딩: $0.001/장, 검색: 거의 무료 |
| **학습 시간** | 없음 (임베딩 생성만) |
| **필요 이미지** | 많을수록 좋음 (100장+) |
| **기존 사례** | 다담AI 텍스트 RAG가 이미 Supabase에서 운영 중 |

**장점**:
- 기존 Supabase RAG 인프라를 그대로 활용 가능
- 텍스트 RAG + 이미지 RAG 통합 가능
- "이 카테고리에 가장 유사한 가구" 자동 검색
- 검색된 이미지를 Gemini 참조 / IP-Adapter / 프롬프트 설명으로 활용
- 이미지 추가 시 자동으로 검색 정확도 향상

**단점**:
- 단독으로는 이미지 생성 품질에 직접적 영향 제한적
- 다른 방식(2-1~2-3)과 조합해야 효과 극대화
- 이미지 임베딩 모델 선정 및 관리 필요

**효율성**: ★★★★☆ | **정확도**: ★★★☆☆ (단독) → ★★★★☆ (조합) | **구현 난이도**: ★★☆☆☆

---

## 3. 종합 비교

| 방식 | 학습 비용 | 추론 비용 | 정확도 | 구현 시간 | Grok 호환 | Supabase 활용 |
|------|-----------|-----------|--------|-----------|-----------|---------------|
| Flux LoRA | $2/품목 | $0.01/장 | ★★★★ | 1~2주 | X (별도 인프라) | 이미지 저장소 |
| Gemini Ref | $0 | $0.03/장 | ★★★ | 3~5일 | X (Gemini 전환) | 이미지 선택 |
| IP-Adapter | $0 | $0.02/장 | ★★★ | 1~2주 | X (별도 인프라) | 참조 선택 |
| Multimodal RAG | $0 | ~$0 | ★★★ | 3~5일 | O (프롬프트 보강) | 핵심 인프라 |

---

## 4. 추천 전략: 단계별 하이브리드 접근

### Phase A: Multimodal RAG 확장 (즉시 적용 가능)

**현재 시스템에 바로 적용 가능한 최소 변경 방안**

```
[Supabase]
├── design_rules (기존 텍스트 RAG) ← 운영 중
├── furniture_images (신규 테이블)
│   ├── id, category, subcategory
│   ├── image_url (Supabase Storage)
│   ├── embedding (pgvector - CLIP 임베딩)
│   ├── description (한국어 설명)
│   └── tags (material, color, style)
```

**작동 방식**:
1. 이미지 수집 → Supabase Storage 저장 + CLIP 임베딩 생성
2. 생성 요청 시 카테고리/스타일로 유사 이미지 검색
3. 검색된 이미지의 **설명(description)**을 프롬프트에 주입
4. 기존 Grok 파이프라인 변경 없이 프롬프트만 보강

**예상 효과**: 프롬프트 정확도 20~30% 향상 (구체적 가구 묘사 추가)
**구현 시간**: 3~5일
**비용**: Supabase 기존 플랜 내

---

### Phase B: Gemini 참조 이미지 통합 (중기)

**Grok 3단계 중 Furniture 생성을 Gemini로 전환하여 참조 이미지 활용**

```
현재:  Cleanup(Grok) → Furniture(Grok) → Open(Grok)
변경:  Cleanup(Grok) → Furniture(Gemini+참조) → Open(Grok)
```

**작동 방식**:
1. Phase A의 이미지 RAG로 가장 유사한 참조 이미지 3~5장 검색
2. Gemini API에 cleanup 이미지 + 참조 이미지 + 프롬프트 전달
3. 참조 이미지의 스타일/디테일을 반영한 가구 생성

**예상 효과**: 가구 디테일 정확도 40~50% 향상
**구현 시간**: 1~2주
**비용**: Gemini API $0.03/장 (현재 Grok과 유사)

---

### Phase C: Flux LoRA 품목별 특화 모델 (장기)

**가장 높은 정확도를 위한 커스텀 모델 학습**

```
[품목별 LoRA 모델]
├── dadam-sink-lora (싱크대/수전 20~30장 학습)
├── dadam-hood-lora (후드/쿡탑 20~30장 학습)
├── dadam-door-lora (도어 패널 30~50장 학습)
└── dadam-countertop-lora (상판 20장 학습)
```

**작동 방식**:
1. Supabase에서 품목별 이미지 수집 완료 후 LoRA 학습 (Replicate)
2. n8n에서 Cleanup → Flux LoRA 추론(가구 생성) → Open Door 순서
3. 트리거 워드로 품목 조합: `DADAM_SINK in kitchen, DADAM_DOOR white matte`

**예상 효과**: 가구 형상/스타일 정확도 70~80% 향상
**구현 시간**: 2~4주 (이미지 수집 기간 별도)
**비용**: 학습 $2/품목, 추론 $0.01/장

---

## 5. 이미지 수집 전략

| 소스 | 장수 | 용도 | 비용 |
|------|------|------|------|
| 기존 시공 사진 | 50~100장 | LoRA 학습 + RAG | 무료 |
| 가구 카탈로그 촬영 | 100~200장 | LoRA + 참조 | 촬영 비용 |
| 3D 렌더링 이미지 | 무제한 | LoRA 보충 + 참조 | 렌더링 비용 |
| 웹 수집 (한샘, 리바트 등) | 참고용 | 스타일 참조만 | 무료 (저작권 주의) |

**권장**: 실제 시공 사진 + 3D 렌더링 혼합이 가장 효과적. 품목당 최소 20장, 이상적으로 50장.

---

## 6. Supabase 스키마 제안

```sql
-- 가구 이미지 테이블
CREATE TABLE furniture_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL,         -- 'sink', 'hood', 'door', 'countertop'
  subcategory TEXT,               -- 'single_bowl', 'island_hood', 'push_open'
  style TEXT,                     -- 'modern', 'classic', 'natural'
  material TEXT,                  -- 'matte_white', 'wood_grain', 'marble'
  color_hex TEXT,                 -- '#FFFFFF'
  description TEXT,               -- 한국어 상세 설명
  image_url TEXT NOT NULL,        -- Supabase Storage URL
  thumbnail_url TEXT,
  embedding vector(512),          -- CLIP ViT-B/32 임베딩
  tags TEXT[],
  source TEXT,                    -- 'photo', 'render', 'catalog'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 벡터 검색 인덱스
CREATE INDEX ON furniture_images
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 20);

-- 카테고리+스타일 검색 함수
CREATE OR REPLACE FUNCTION search_furniture_images(
  query_category TEXT,
  query_style TEXT DEFAULT NULL,
  query_embedding vector(512) DEFAULT NULL,
  match_count INT DEFAULT 5
) RETURNS SETOF furniture_images AS $$
  SELECT * FROM furniture_images
  WHERE category = query_category
    AND (query_style IS NULL OR style = query_style)
  ORDER BY
    CASE WHEN query_embedding IS NOT NULL
      THEN embedding <=> query_embedding
      ELSE 0 END
  LIMIT match_count;
$$ LANGUAGE sql;
```

---

## 7. 리스크 및 고려사항

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Grok API가 참조 이미지 미지원 | Phase B 불가 | Gemini 또는 Flux 전환 |
| LoRA 학습 이미지 부족 | 정확도 저하 | 3D 렌더링으로 보충 |
| 이미지 저작권 | 법적 리스크 | 자체 촬영/렌더링만 학습 |
| Replicate/fal.ai 서비스 중단 | 추론 불가 | 자체 GPU 서버 백업 |
| 한국 빌트인 가구 특수성 | 범용 모델 부족 | LoRA로 특화 학습 |

---

## 8. 결론 및 권장사항

### 즉시 실행 (Phase A): Multimodal RAG
- **투자**: 최소 (3~5일, 추가 비용 $0)
- **효과**: 프롬프트 품질 향상, 기존 시스템 100% 호환
- **위험**: 낮음

### 단기 목표 (Phase B): Gemini 참조 이미지
- **투자**: 중간 (1~2주, Gemini API 비용)
- **효과**: 가구 디테일 큰 폭 개선
- **전제**: 이미지 50장 이상 수집 완료

### 장기 목표 (Phase C): Flux LoRA 특화 모델
- **투자**: 높음 (2~4주 + 이미지 수집)
- **효과**: 가장 높은 정확도와 일관성
- **전제**: 품목당 20~50장 고품질 이미지

**최종 권장**: Phase A를 즉시 시작하면서 이미지 수집을 병행하고, 50장 이상 모이면 Phase B 또는 C를 선택 적용. Phase A → B → C 순서가 리스크 최소화하면서 점진적 품질 향상 가능.

---

## 참고 자료

- [xAI Image Generation API](https://docs.x.ai/docs/guides/image-generations) - Grok Flux 기반, fine-tuning 미지원
- [Replicate Flux LoRA Training](https://replicate.com/blog/fine-tune-flux) - $1.85/회, 20분
- [fal.ai Flux LoRA Fast Training](https://fal.ai/models/fal-ai/flux-lora-fast-training) - ~2분 초고속
- [InteriorDesigner-Flux](https://form-finder.squarespace.com/download-models/p/interiordesigner-flux) - 인테리어 특화 기존 LoRA
- [Gemini Image Generation](https://ai.google.dev/gemini-api/docs/image-generation) - 참조 이미지 최대 14장
- [Imagen Style Customization](https://firebase.google.com/docs/ai-logic/edit-images-imagen-style-customization) - 스타일 커스터마이징
- [IP-Adapter (Diffusers)](https://huggingface.co/docs/diffusers/en/using-diffusers/ip_adapter) - 스타일 전이 어댑터
- [Supabase AI & Vectors](https://supabase.com/docs/guides/ai) - pgvector 벡터 검색
