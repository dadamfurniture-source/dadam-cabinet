"""피드백 루프 MCP 도구 — RAG 검색, 가격 보정, 제약조건 관리"""

import json
import os
from datetime import datetime

import httpx
from claude_agent_sdk import create_sdk_mcp_server, tool

from shared.supabase_client import get_service_client as _get_client

EMBEDDING_MODEL = "text-embedding-3-small"


async def _get_embedding(text: str) -> list[float]:
    """OpenAI API로 텍스트 임베딩 생성 (Supabase pgvector 호환)"""
    # Anthropic은 아직 임베딩 API가 없으므로 OpenAI 사용
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise ValueError("OPENAI_API_KEY가 설정되지 않았습니다.")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": EMBEDDING_MODEL, "input": text},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]


# ===== RAG 루프 도구 =====


@tool(
    "search_similar_cases",
    "현재 프로젝트와 유사한 과거 시공 사례를 벡터 검색합니다. "
    "공간 분석 결과를 기반으로 유사한 공간의 배치, 스타일, 만족도를 조회합니다. "
    "Design Planner가 배치 계획 전에 반드시 호출하세요.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string", "description": "가구 카테고리"},
            "space_summary": {"type": "string", "description": "공간 요약 텍스트"},
            "style": {"type": "string", "description": "선호 스타일 (없으면 전체 검색)"},
            "min_rating": {"type": "number", "description": "최소 만족도 (기본 3.0)"},
            "limit": {"type": "integer", "description": "결과 수 (기본 5)"},
        },
        "required": ["category", "space_summary"],
    },
)
async def search_similar_cases(args: dict) -> dict:
    client = _get_client()

    search_text = f"카테고리: {args['category']}\n공간: {args['space_summary']}"
    if args.get("style"):
        search_text += f"\n스타일: {args['style']}"

    try:
        embedding = await _get_embedding(search_text)
    except Exception as e:
        # 임베딩 실패 시 텍스트 기반 폴백
        results = (
            client.table("case_embeddings")
            .select("*")
            .eq("category", args["category"])
            .gte("rating", args.get("min_rating", 3.0))
            .order("rating", desc=True)
            .limit(args.get("limit", 5))
            .execute()
        )
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "method": "text_fallback",
                            "cases": results.data,
                            "note": f"벡터 검색 불가 ({e}), 카테고리+평점 기반 결과",
                        },
                        ensure_ascii=False,
                    ),
                }
            ]
        }

    # Supabase RPC로 벡터 유사도 검색
    results = client.rpc(
        "search_similar_cases",
        {
            "query_embedding": embedding,
            "match_category": args["category"],
            "match_count": args.get("limit", 5),
            "min_rating": args.get("min_rating", 3.0),
        },
    ).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "method": "vector_search",
                        "cases_found": len(results.data),
                        "cases": results.data,
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "save_case_embedding",
    "완료된 프로젝트를 사례 DB에 저장합니다. 시뮬레이션 완료 또는 설치 완료 시 호출하세요.",
    {
        "type": "object",
        "properties": {
            "project_id": {"type": "string"},
            "category": {"type": "string"},
            "style": {"type": "string"},
            "space_summary": {"type": "string"},
            "layout_summary": {"type": "string"},
            "rating": {"type": "number", "description": "고객 평점 (없으면 null)"},
            "is_installed": {"type": "boolean"},
            "space_analysis_json": {"type": "object"},
            "layout_json": {"type": "object"},
        },
        "required": ["project_id", "category", "space_summary"],
    },
)
async def save_case_embedding(args: dict) -> dict:
    client = _get_client()

    embed_text = (
        f"카테고리: {args['category']}\n"
        f"스타일: {args.get('style', 'unknown')}\n"
        f"공간: {args['space_summary']}\n"
        f"배치: {args.get('layout_summary', '')}"
    )

    embedding = None
    try:
        embedding = await _get_embedding(embed_text)
    except Exception:
        pass  # 임베딩 없이도 텍스트 기반 검색 가능

    record = {
        "project_id": args["project_id"],
        "category": args["category"],
        "style": args.get("style"),
        "space_summary": args["space_summary"],
        "layout_summary": args.get("layout_summary"),
        "rating": args.get("rating"),
        "is_installed": args.get("is_installed", False),
        "space_analysis_json": args.get("space_analysis_json"),
        "layout_json": args.get("layout_json"),
    }
    if embedding:
        record["embedding"] = embedding

    client.table("case_embeddings").insert(record).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": f"사례 저장 완료 (임베딩: {'있음' if embedding else '없음'})",
            }
        ]
    }


# ===== 가격 보정 루프 도구 =====


@tool(
    "get_price_calibration",
    "카테고리별 가격 보정 계수를 조회합니다. 견적 산출 시 이 보정 계수를 적용하세요.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string"},
            "module_type": {
                "type": "string",
                "description": "세부 모듈 유형 (없으면 카테고리 전체)",
            },
            "region": {"type": "string", "description": "지역 (기본: default)"},
        },
        "required": ["category"],
    },
)
async def get_price_calibration(args: dict) -> dict:
    client = _get_client()

    query = (
        client.table("price_calibrations")
        .select("*")
        .eq("category", args["category"])
        .eq("region", args.get("region", "default"))
    )

    if args.get("module_type"):
        query = query.eq("module_type", args["module_type"])

    result = query.execute()

    if not result.data:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {
                            "correction_factor": 1.0,
                            "sample_count": 0,
                            "note": "보정 데이터 없음. 기본 견적 사용.",
                        },
                        ensure_ascii=False,
                    ),
                }
            ]
        }

    cal = result.data[0]
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "correction_factor": cal["correction_factor"],
                        "sample_count": cal["sample_count"],
                        "avg_error_rate": cal["avg_error_rate"],
                        "last_calibrated": cal["last_calibrated_at"],
                        "note": f"보정 계수 {cal['correction_factor']}x 적용 (샘플 {cal['sample_count']}건 기반)",
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "recalibrate_prices",
    "실제 계약 금액과 AI 견적을 비교하여 보정 계수를 재계산합니다. "
    "정기적으로 (월 1회) 또는 새 거래 50건 누적 시 호출하세요.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string", "description": "카테고리 (없으면 전체)"},
        },
        "required": [],
    },
)
async def recalibrate_prices(args: dict) -> dict:
    client = _get_client()

    # 견적 정확도 뷰에서 데이터 조회
    query = client.table("quote_accuracy").select("*")
    if args.get("category"):
        query = query.eq("category", args["category"])

    accuracy_data = query.execute()

    if not accuracy_data.data or len(accuracy_data.data) < 10:
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"보정 불가: 데이터 {len(accuracy_data.data or [])}건 (최소 10건 필요)",
                }
            ]
        }

    # 카테고리별 보정 계수 계산
    from collections import defaultdict

    by_category = defaultdict(list)
    for row in accuracy_data.data:
        by_category[row["category"]].append(row["error_rate_pct"])

    results = []
    for cat, errors in by_category.items():
        avg_error = sum(errors) / len(errors)
        std_error = (sum((e - avg_error) ** 2 for e in errors) / len(errors)) ** 0.5
        # 보정 계수: 1 + (평균 오차율 / 100)
        correction = round(1 + (avg_error / 100), 4)

        # 저장/업데이트
        existing = (
            client.table("price_calibrations")
            .select("id, calibration_history")
            .eq("category", cat)
            .eq("region", "default")
            .is_("module_type", "null")
            .execute()
        )

        history_entry = {
            "date": datetime.utcnow().isoformat(),
            "factor": correction,
            "samples": len(errors),
            "avg_error": round(avg_error, 2),
        }

        if existing.data:
            old_history = existing.data[0].get("calibration_history") or []
            old_history.append(history_entry)
            client.table("price_calibrations").update(
                {
                    "correction_factor": correction,
                    "sample_count": len(errors),
                    "avg_error_rate": round(avg_error, 4),
                    "std_error_rate": round(std_error, 4),
                    "last_calibrated_at": datetime.utcnow().isoformat(),
                    "calibration_history": old_history,
                }
            ).eq("id", existing.data[0]["id"]).execute()
        else:
            client.table("price_calibrations").insert(
                {
                    "category": cat,
                    "region": "default",
                    "correction_factor": correction,
                    "sample_count": len(errors),
                    "avg_error_rate": round(avg_error, 4),
                    "std_error_rate": round(std_error, 4),
                    "calibration_history": [history_entry],
                }
            ).execute()

        results.append(
            {
                "category": cat,
                "correction_factor": correction,
                "avg_error_pct": round(avg_error, 2),
                "sample_count": len(errors),
            }
        )

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "calibrated_categories": len(results),
                        "results": results,
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


# ===== 제약조건 학습 루프 도구 =====


@tool(
    "get_active_constraints",
    "카테고리에 적용 중인 학습된 제약조건 목록을 조회합니다. "
    "Design Planner가 배치 계획 시 반드시 이 규칙을 확인하세요.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string"},
        },
        "required": ["category"],
    },
)
async def get_active_constraints(args: dict) -> dict:
    client = _get_client()

    result = (
        client.table("learned_constraints")
        .select("id, rule_text, rule_json, severity, source_count, confidence")
        .eq("category", args["category"])
        .eq("status", "applied")
        .order("severity")  # error > warning > info
        .execute()
    )

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "constraints_count": len(result.data),
                        "constraints": result.data,
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "analyze_as_patterns",
    "A/S 이력을 분석하여 반복 패턴을 감지하고 새 제약조건 후보를 생성합니다. "
    "동일 원인이 3건 이상 발생한 패턴을 제약조건으로 제안합니다.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string", "description": "분석할 카테고리 (없으면 전체)"},
            "min_occurrences": {"type": "integer", "description": "최소 발생 횟수 (기본 3)"},
        },
        "required": [],
    },
)
async def analyze_as_patterns(args: dict) -> dict:
    client = _get_client()

    # A/S 패턴 분석 뷰 조회
    query = client.table("as_pattern_analysis").select("*")
    if args.get("category"):
        query = query.eq("category", args["category"])

    patterns = query.execute()

    if not patterns.data:
        return {
            "content": [
                {
                    "type": "text",
                    "text": "반복 패턴이 감지되지 않았습니다.",
                }
            ]
        }

    # 기존 제약조건과 중복 확인
    existing = (
        client.table("learned_constraints")
        .select("rule_text, source_tickets")
        .in_("status", ["proposed", "approved", "applied"])
        .execute()
    )
    {c["rule_text"] for c in existing.data}

    new_patterns = []
    for pattern in patterns.data:
        if pattern["occurrence_count"] >= args.get("min_occurrences", 3):
            new_patterns.append(
                {
                    "as_type": pattern["as_type"],
                    "category": pattern["category"],
                    "count": pattern["occurrence_count"],
                    "ticket_ids": pattern["ticket_ids"],
                    "descriptions": pattern["descriptions"][:3],  # 상위 3개 설명
                }
            )

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "patterns_found": len(new_patterns),
                        "patterns": new_patterns,
                        "existing_constraints": len(existing.data),
                        "instruction": "각 패턴에 대해 구체적인 제약조건 rule_text를 생성하고 "
                        "propose_constraint 도구로 등록하세요.",
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "propose_constraint",
    "새 제약조건을 제안합니다. 관리자 승인 후 Design Planner에 적용됩니다.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string"},
            "rule_text": {"type": "string", "description": "규칙 설명 (한국어)"},
            "rule_json": {
                "type": "object",
                "description": "구조화된 규칙 (프로그래밍적 적용용)",
            },
            "severity": {"type": "string", "enum": ["info", "warning", "error"]},
            "source_type": {
                "type": "string",
                "enum": ["as_pattern", "installer_feedback", "measurement_gap", "manual"],
            },
            "source_tickets": {
                "type": "array",
                "items": {"type": "string"},
                "description": "근거 A/S 티켓 ID 목록",
            },
            "confidence": {"type": "number", "description": "신뢰도 0.0~1.0"},
        },
        "required": ["category", "rule_text", "source_type"],
    },
)
async def propose_constraint(args: dict) -> dict:
    client = _get_client()

    client.table("learned_constraints").insert(
        {
            "category": args["category"],
            "rule_text": args["rule_text"],
            "rule_json": args.get("rule_json"),
            "severity": args.get("severity", "warning"),
            "source_type": args["source_type"],
            "source_tickets": args.get("source_tickets", []),
            "source_count": len(args.get("source_tickets", [])),
            "confidence": args.get("confidence", 0.5),
            "status": "proposed",
        }
    ).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": f"제약조건 제안됨: [{args.get('severity', 'warning')}] {args['rule_text']} "
                f"(신뢰도: {args.get('confidence', 0.5)}, 근거: {len(args.get('source_tickets', []))}건)",
            }
        ]
    }


# ===== LoRA 재학습 루프 도구 =====


@tool(
    "queue_training_image",
    "시공 완료 사진을 LoRA 재학습 대기열에 등록합니다.",
    {
        "type": "object",
        "properties": {
            "image_url": {"type": "string"},
            "category": {"type": "string"},
            "style": {"type": "string"},
            "quality_grade": {"type": "string", "enum": ["low", "normal", "high", "excellent"]},
            "source": {
                "type": "string",
                "enum": ["installation_photo", "customer_upload", "crawled", "manual"],
            },
            "project_id": {"type": "string"},
            "customer_rating": {"type": "number"},
        },
        "required": ["image_url", "category", "source"],
    },
)
async def queue_training_image(args: dict) -> dict:
    client = _get_client()

    client.table("training_queue").insert(
        {
            "image_url": args["image_url"],
            "category": args["category"],
            "style": args.get("style"),
            "quality_grade": args.get("quality_grade", "normal"),
            "source": args["source"],
            "project_id": args.get("project_id"),
            "customer_rating": args.get("customer_rating"),
            "status": "pending",
        }
    ).execute()

    # 해당 카테고리 대기열 현황 확인
    pending = (
        client.table("training_queue")
        .select("id", count="exact")
        .eq("category", args["category"])
        .eq("status", "pending")
        .execute()
    )

    count = pending.count or 0
    trigger_msg = ""
    if count >= 50:
        trigger_msg = f" ⚠️ {count}장 누적 — 재학습 트리거 조건 충족!"

    return {
        "content": [
            {
                "type": "text",
                "text": f"학습 대기열 등록: {args['category']} ({args.get('quality_grade', 'normal')})"
                f" / 현재 대기: {count}장{trigger_msg}",
            }
        ]
    }


@tool(
    "get_active_lora_model",
    "카테고리의 현재 활성 LoRA 모델 정보를 조회합니다.",
    {
        "type": "object",
        "properties": {
            "category": {"type": "string"},
        },
        "required": ["category"],
    },
)
async def get_active_lora_model(args: dict) -> dict:
    client = _get_client()

    result = (
        client.table("lora_model_versions")
        .select("*")
        .eq("category", args["category"])
        .eq("is_active", True)
        .single()
        .execute()
    )

    if not result.data:
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(
                        {"model": None, "note": "활성 모델 없음"}, ensure_ascii=False
                    ),
                }
            ]
        }

    model = result.data
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "model_id": model["replicate_model_id"],
                        "trigger_word": model["trigger_word"],
                        "version": model["version"],
                        "training_images": model["training_images_count"],
                        "avg_rating": model.get("avg_customer_rating"),
                        "activated_at": model.get("activated_at"),
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


# ===== 고객 피드백 도구 =====


@tool(
    "save_customer_feedback",
    "고객 피드백을 저장합니다. 피드백은 모든 루프의 입력 데이터가 됩니다.",
    {
        "type": "object",
        "properties": {
            "project_id": {"type": "string"},
            "order_id": {"type": "string"},
            "user_id": {"type": "string"},
            "overall_rating": {"type": "integer", "description": "전체 만족도 1~5"},
            "design_rating": {"type": "integer"},
            "image_rating": {"type": "integer"},
            "quote_rating": {"type": "integer"},
            "install_rating": {"type": "integer"},
            "selected_style": {"type": "string"},
            "comment": {"type": "string"},
            "installation_photos": {
                "type": "array",
                "items": {"type": "string"},
            },
            "feedback_type": {
                "type": "string",
                "enum": ["simulation", "installation", "as"],
            },
        },
        "required": ["user_id", "overall_rating", "feedback_type"],
    },
)
async def save_customer_feedback(args: dict) -> dict:
    client = _get_client()

    client.table("customer_feedback").insert(
        {
            "project_id": args.get("project_id"),
            "order_id": args.get("order_id"),
            "user_id": args["user_id"],
            "overall_rating": args["overall_rating"],
            "design_rating": args.get("design_rating"),
            "image_rating": args.get("image_rating"),
            "quote_rating": args.get("quote_rating"),
            "install_rating": args.get("install_rating"),
            "selected_style": args.get("selected_style"),
            "comment": args.get("comment"),
            "installation_photos": args.get("installation_photos", []),
            "feedback_type": args["feedback_type"],
        }
    ).execute()

    return {
        "content": [
            {
                "type": "text",
                "text": f"피드백 저장: 만족도 {args['overall_rating']}/5 ({args['feedback_type']})",
            }
        ]
    }


# MCP 서버 생성
feedback_server = create_sdk_mcp_server(
    name="feedback",
    version="1.0.0",
    tools=[
        # RAG
        search_similar_cases,
        save_case_embedding,
        # 가격 보정
        get_price_calibration,
        recalibrate_prices,
        # 제약조건
        get_active_constraints,
        analyze_as_patterns,
        propose_constraint,
        # LoRA
        queue_training_image,
        get_active_lora_model,
        # 피드백
        save_customer_feedback,
    ],
)
