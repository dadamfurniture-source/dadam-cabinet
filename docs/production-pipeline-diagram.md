# 다담AI 프로덕션 파이프라인 시각화

## 1. 전체 시스템 아키텍처

```mermaid
graph LR
    subgraph CLIENT["프론트엔드"]
        U["사용자"] --> |사진 업로드| FE["ai-design.html"]
        FE --> |POST| WH["n8n Webhook"]
    end

    subgraph N8N["n8n Cloud"]
        WH --> PIPE["v10 파이프라인<br/>15노드"]
    end

    subgraph APIS["외부 API"]
        PIPE --> |벽분석| G1["Gemini 2.5 Flash"]
        PIPE --> |이미지생성| G2["Gemini 2.5 Flash Image"]
        PIPE --> |RAG| SB["Supabase"]
    end

    subgraph FUTURE["향후 통합"]
        PIPE -.-> |ControlNet| RP["Replicate SDXL"]
        RP -.-> |LoRA| LORA["12개 LoRA 모델"]
    end

    PIPE --> |3장 이미지| FE
```

## 2. n8n v10 파이프라인 상세

```mermaid
flowchart TD
    WH["🔗 Webhook<br/>/dadam-interior-v4<br/>POST"] --> PI["📋 Parse Input<br/>category, style,<br/>room_image, kitchen_layout"]

    PI --> WA["🔍 Wall Analysis<br/>Code 노드<br/>Gemini API body 생성"]
    WA --> GWV["🤖 Gemini Wall Vision<br/>gemini-2.5-flash-lite<br/>벽면 구조 + 배관 분석"]
    GWV --> PWD["📊 Parse Wall Data<br/>water_supply %, exhaust %<br/>wall_width, wall_height"]

    PWD --> BAP["⚙️ Build All Prompts<br/>distributeModules()<br/>colorMap + finishMap<br/>compressedPrompt < 300자<br/>+ layoutDesc (linear/L/U/peninsula)"]

    BAP --> GF["🎨 Gemini Furniture<br/>gemini-2.5-flash-image<br/>compressedPrompt + room_image<br/>→ closedImage"]

    GF --> VF["✅ Validate & Fix<br/>gemini-2.5-flash (텍스트)<br/>CHECKLIST 검증<br/>최대 3회 재시도"]

    VF --> PF["📦 Parse Furniture<br/>+ Build Open Body<br/>openPrompt 생성"]

    PF --> HCI{닫힌문<br/>이미지?}

    HCI -->|Yes| GOD["🚪 Gemini Open Door<br/>gemini-2.5-flash-image<br/>closedImage → openImage"]
    HCI -->|No| FRC["Format Response<br/>(Closed Only)"]

    GOD --> FRB["Format Response<br/>(Both)"]

    FRB --> R1["✅ Respond<br/>3장: background + closed + open"]
    FRC --> R2["⚠️ Respond<br/>closed only"]

    style WH fill:#4CAF50,color:white
    style GWV fill:#9C27B0,color:white
    style GF fill:#9C27B0,color:white
    style GOD fill:#9C27B0,color:white
    style VF fill:#FF9800,color:white
    style BAP fill:#2196F3,color:white
    style R1 fill:#4CAF50,color:white
```

## 3. 프론트엔드 사용자 플로우

```mermaid
flowchart LR
    A["🍳 카테고리 선택<br/>싱크대/붙박이장/냉장고장<br/>화장대/신발장/수납장"] --> B["📷 사진 업로드<br/>현장 벽면 사진"]

    B --> C{"싱크대?"}
    C -->|Yes| D["📐 레이아웃 선택<br/>━ 1자형<br/>┗ ㄱ자형<br/>┗┛ ㄷ자형<br/>╋ 대면형"]
    C -->|No| E["🎨 스타일 선택"]
    D --> E

    E --> F["✨ AI 디자인 생성<br/>POST /webhook/dadam-interior-v4"]
    F --> G["🖼️ 결과 표시<br/>닫힌문 + 열린문"]
```

## 4. Gemini 모델 매핑

```mermaid
graph TD
    subgraph MODELS["Gemini 모델"]
        M1["gemini-2.5-flash-lite<br/>텍스트 전용"]
        M2["gemini-2.5-flash-image<br/>이미지 생성"]
        M3["gemini-2.5-flash<br/>텍스트 검증"]
    end

    subgraph NODES["n8n 노드"]
        N1["Gemini Wall Vision"] --> M1
        N2["Gemini Furniture"] --> M2
        N3["Validate & Fix"] --> M3
        N4["Gemini Open Door"] --> M2
    end
```

## 5. LoRA 모델 현황

```mermaid
graph TD
    subgraph SINK["싱크대 (SDXL LoRA)"]
        S1["DADAM_I_TYPE_SINK<br/>1자형 50장"]
        S2["DADAM_L_TYPE_SINK<br/>ㄱ자형 50장"]
        S3["DADAM_U_TYPE_SINK<br/>ㄷ자형 40장"]
        S4["DADAM_PENINSULA_SINK<br/>대면형 30장"]
    end

    subgraph OTHER["기타 카테고리 (Flux LoRA)"]
        O1["DADAM_WARDROBE<br/>붙박이장 50장"]
        O2["DADAM_SHOE_CABINET<br/>신발장 50장"]
        O3["DADAM_VANITY<br/>화장대 50장"]
        O4["DADAM_FRIDGE_CABINET<br/>냉장고장 44장"]
        O5["DADAM_L_SHAPED_SINK<br/>ㄱ자싱크 50장"]
        O6["DADAM_PENINSULA_SINK<br/>반도형 50장"]
        O7["DADAM_ISLAND_KITCHEN<br/>아일랜드 50장"]
        O8["DADAM_STORAGE_CABINET<br/>수납장 50장"]
    end

    style SINK fill:#E3F2FD
    style OTHER fill:#FFF3E0
```

## 6. 데이터 플로우 (API 요청 → 응답)

```mermaid
sequenceDiagram
    participant U as 사용자
    participant FE as ai-design.html
    participant N8N as n8n Cloud
    participant GV as Gemini Vision
    participant GI as Gemini Image
    participant SB as Supabase

    U->>FE: 사진 업로드 + 카테고리 + 스타일
    FE->>N8N: POST /webhook/dadam-interior-v4

    Note over N8N: Parse Input
    N8N->>GV: 벽면 분석 요청 (gemini-2.5-flash-lite)
    GV-->>N8N: 배관위치 + 벽크기

    Note over N8N: Build All Prompts<br/>distributeModules()<br/>compressedPrompt < 300자

    N8N->>GI: Furniture 생성 (gemini-2.5-flash-image)
    GI-->>N8N: closedImage (base64)

    Note over N8N: Validate & Fix (최대 3회)

    N8N->>GI: Open Door 생성
    GI-->>N8N: openImage (base64)

    N8N-->>FE: {background, closed, open}
    FE-->>U: 결과 이미지 3장 표시
```

---

## Claude 채팅용 복사 텍스트

아래 텍스트를 Claude 채팅에 붙여넣으면 전체 시스템을 이해할 수 있습니다:

```
다담AI 프로덕션 시스템 요약:

[아키텍처]
- 프론트엔드: ai-design.html (정적 HTML)
- 백엔드: n8n Cloud (워크플로우 자동화)
- AI: Gemini API (벽분석 + 이미지 생성)
- DB: Supabase (PostgreSQL + Vector + Storage)
- LoRA: Replicate (12개 가구 카테고리 학습 완료)

[n8n v10 파이프라인 - 15노드]
Webhook → Parse Input → Wall Analysis → Gemini Wall Vision(gemini-2.5-flash-lite)
→ Parse Wall Data → Build All Prompts(distributeModules, compressedPrompt<300자)
→ Gemini Furniture(gemini-2.5-flash-image) → Validate & Fix(최대 3회)
→ Parse Furniture → Has Closed? → Gemini Open Door → Format Response → Respond

[입력] room_image(base64), category, kitchen_layout, design_style
[출력] generated_image: { background, closed, open } (각 base64)

[주방 레이아웃]
- i_type: 1자형 (직선형)
- l_type: ㄱ자형 (L자형)
- u_type: ㄷ자형 (U자형)
- peninsula: 대면형 (11자형)

[Gemini 모델]
- gemini-2.5-flash-lite: 벽 분석 (텍스트+비전)
- gemini-2.5-flash-image: 이미지 생성 (Furniture + Open Door)
- gemini-2.5-flash: 검증 (Validate & Fix)

[LoRA 모델 - Replicate]
싱크대 4종(SDXL): i_type/l_type/u_type/peninsula
기타 8종(Flux): wardrobe/shoe/vanity/fridge/l_shaped/peninsula/island/storage
```
