"""Runtime settings. Everything has a safe demo default so the app runs with no API keys."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    database_url: str = "sqlite:///./data/autopilot.db"
    demo_mode: bool = True
    upload_dir: str = "./data/uploads"
    max_upload_bytes: int = 10 * 1024 * 1024
    web_base_url: str = "http://localhost:3000"
    session_hours: int = 12
    # Optional shared code for the passwordless demo sign-in. Set it before sharing a demo link.
    demo_access_code: str | None = None

    # Demo payment provider (always simulated money).
    demo_webhook_secret: str = "demo-webhook-secret-change-me"

    # Gemini extraction / assistant routing (optional).
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"

    # Razorpay — test mode only in this MVP.
    razorpay_key_id: str | None = None
    razorpay_key_secret: str | None = None
    razorpay_webhook_secret: str | None = None

    # Meta WhatsApp Cloud API — inbound only.
    whatsapp_app_secret: str | None = None
    whatsapp_verify_token: str | None = None
    whatsapp_access_token: str | None = None
    whatsapp_graph_version: str = "v21.0"

    # ElevenLabs browser voice agent (optional).
    elevenlabs_api_key: str | None = None
    elevenlabs_agent_id: str | None = None
    voice_tool_secret: str | None = None
    voice_tool_merchant_id: str | None = None

    # Outbound customer messaging gate. The flag alone never enables sending.
    outbound_policy_approved: bool = False
    outbound_approved_message_types: str = ""

    @property
    def approved_message_types(self) -> set[str]:
        return {t.strip() for t in self.outbound_approved_message_types.split(",") if t.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
