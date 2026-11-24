from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Splity API"
    environment: Literal["development", "test", "production"] = "development"

    database_url: str = "postgresql://splity:splity@localhost:5432/splity"

    jwt_secret: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60 * 24 * 7

    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    # Sign-in throttling (per client IP).
    login_rate_limit: int = 10
    login_rate_window_seconds: int = 15 * 60

    # ── AI ──────────────────────────────────────────────────────────────────
    # Any LiteLLM model string, e.g. "gemini/gemini-3.8-flash" or "anthropic/claude-haiku-4-5".
    llm_model: str = "gemini/gemini-3.8-flash"
    # Tried in order if the primary model fails before producing output (e.g. 503 "high demand").
    llm_fallback_models: list[str] = ["gemini/gemini-3.7-flash", "gemini/gemini-3.6-flash"]
    gemini_api_key: str | None = None
    llm_timeout_seconds: float = 30
    llm_max_retries: int = 1
    agent_max_steps: int = 6
    pending_action_ttl_minutes: int = 10
    ai_rate_limit_per_minute: int = 30
    currency_symbol: str = "₹"

    # ── observability ───────────────────────────────────────────────────────
    # -- OCR / voice / RAG ------------------------------------------------------
    upload_dir: str = "uploads"
    max_receipt_bytes: int = 8 * 1024 * 1024
    max_audio_bytes: int = 10 * 1024 * 1024
    embedding_model: str = "gemini/gemini-embedding-001"
    rag_top_k: int = 6
    rag_rerank: bool = True
    sql_max_rows: int = 200
    sql_timeout_ms: int = 3000

    admin_emails: list[str] = []  # can open the AI Ops dashboard
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = Field(
        default="https://cloud.langfuse.com", validation_alias=AliasChoices("LANGFUSE_HOST", "LANGFUSE_BASE_URL")
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
