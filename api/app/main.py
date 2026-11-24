import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.tracing import configure_langfuse
from app.api.routes import ai, analytics, auth, expenses, friends, groups, notifications, users
from app.core.config import get_settings
from app.core.errors import register_error_handlers


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for noisy in ("LiteLLM", "litellm", "httpx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    import litellm

    litellm.suppress_debug_info = True
    configure_langfuse()

    app = FastAPI(title=settings.app_name, version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    register_error_handlers(app)

    @app.get("/api/health", tags=["meta"])
    async def health():
        return {"status": "ok"}

    for module in (auth, users, friends, groups, expenses, notifications, analytics, ai):
        app.include_router(module.router, prefix="/api")
    return app


app = create_app()
