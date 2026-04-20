"""다담 SaaS FastAPI 서버"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api.middleware.error_handler import register_error_handlers
from api.middleware.logging_mw import RequestLoggingMiddleware
from api.middleware.rate_limit import RateLimitMiddleware
from api.middleware.security_headers import SecurityHeadersMiddleware
from api.routes import (
    accounting,
    admin,
    enterprise,
    exports,
    feedback,
    orders,
    payments,
    payments_toss,
    projects,
    references,
)
from shared.config import settings

# Sentry 에러 추적 (DSN이 설정된 경우에만 활성화)
if settings.sentry_dsn:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            integrations=[StarletteIntegration(), FastApiIntegration()],
            environment=settings.environment,
            traces_sample_rate=0.1 if settings.is_production else 1.0,
        )
    except ImportError:
        logging.getLogger(__name__).warning("sentry-sdk not installed, skipping Sentry integration")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

STATIC_DIR = Path(__file__).parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger(__name__).info("다담 SaaS API 서버 시작 (env=%s)", settings.environment)
    yield
    logging.getLogger(__name__).info("다담 SaaS API 서버 종료")


app = FastAPI(
    title="다담 SaaS API",
    description="AI 주문제작 가구 시뮬레이션 & 견적 플랫폼",
    version="0.1.0",
    lifespan=lifespan,
)

# 미들웨어 (역순으로 등록 = 먼저 등록한 것이 바깥 레이어)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-API-Key",
        "stripe-signature",
        "tosspayments-signature",
    ],
)

# 글로벌 에러 핸들러
register_error_handlers(app)

# 라우터 등록
app.include_router(projects.router, prefix="/api/v1")
app.include_router(orders.router, prefix="/api/v1")
app.include_router(accounting.router, prefix="/api/v1")
app.include_router(feedback.router, prefix="/api/v1")
app.include_router(exports.router, prefix="/api/v1")
app.include_router(payments.router, prefix="/api/v1")
app.include_router(payments_toss.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(enterprise.router, prefix="/api/v1")
app.include_router(references.router, prefix="/api/v1")


@app.get("/api/v1/config")
async def frontend_config():
    """프론트엔드에 필요한 공개 설정값 (Supabase URL, anon key)"""
    return {
        "supabase_url": settings.supabase_url,
        "supabase_anon_key": settings.supabase_anon_key,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "dadam-saas", "version": "0.1.0"}


@app.get("/debug/blender")
async def debug_blender():
    """Check if Blender is available and functional."""
    import asyncio
    import os
    import shutil

    result = {
        "use_blender_env": os.environ.get("USE_BLENDER", "true"),
        "blender_in_path": shutil.which("blender") is not None,
        "blender_path": shutil.which("blender"),
    }

    # Try running blender --version
    try:
        proc = await asyncio.create_subprocess_exec(
            "blender",
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
        result["blender_version"] = stdout.decode().strip().split("\n")[0]
        result["blender_rc"] = proc.returncode
    except Exception as e:
        result["blender_error"] = str(e)

    # Try a minimal render with full stdout/stderr capture
    try:
        import json as json_mod
        import tempfile
        import uuid

        run_id = uuid.uuid4().hex[:8]
        input_path = os.path.join(tempfile.gettempdir(), f"debug_input_{run_id}.json")
        output_path = os.path.join(tempfile.gettempdir(), f"debug_output_{run_id}.png")

        scene_config = {
            "modules": [
                {"type": "cabinet", "width": 450, "is_2door": False, "position_x": 0},
            ],
            "wall_width": 450,
            "category": "sink",
            "style": "modern",
            "door_state": "closed",
            "camera_params": {},
            "resolution": [512, 384],
            "output_path": output_path,
        }
        with open(input_path, "w") as f:
            json_mod.dump(scene_config, f)

        script_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "agents", "blender", "scene_builder.py"
        )
        result["script_exists"] = os.path.exists(script_path)
        result["script_path"] = script_path

        proc = await asyncio.create_subprocess_exec(
            "blender",
            "--background",
            "--factory-startup",
            "--python",
            script_path,
            "--",
            input_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)

        result["render_rc"] = proc.returncode
        result["render_stdout"] = stdout.decode(errors="replace")[-1000:]
        result["render_stderr"] = stderr.decode(errors="replace")[-1000:]
        result["output_exists"] = os.path.exists(output_path)

        if os.path.exists(output_path):
            result["render_test"] = "success"
            result["output_size"] = os.path.getsize(output_path)
        else:
            result["render_test"] = "no_output"

        # Cleanup
        for p in (input_path, output_path):
            try:
                os.unlink(p)
            except OSError:
                pass

    except Exception as e:
        result["render_test"] = "exception"
        result["render_error"] = str(e)

    return result


# Static files & HTML pages
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/{page}.html")
async def serve_page(page: str):
    if "/" in page or "\\" in page or ".." in page:
        return FileResponse(STATIC_DIR / "index.html")
    file_path = STATIC_DIR / f"{page}.html"
    if file_path.exists() and file_path.resolve().parent == STATIC_DIR.resolve():
        return FileResponse(file_path)
    return FileResponse(STATIC_DIR / "index.html")
