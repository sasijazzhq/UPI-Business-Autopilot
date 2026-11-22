import os
import tempfile
from datetime import date, datetime

_tmp = tempfile.mkdtemp(prefix="autopilot-test-")
os.environ.update({
    "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.db"), "UPLOAD_DIR": f"{_tmp}/uploads", "DEMO_MODE": "true",
    "DEMO_WEBHOOK_SECRET": "test-secret", "GEMINI_API_KEY": "", "RAZORPAY_KEY_ID": "", "ELEVENLABS_API_KEY": "",
    "WHATSAPP_APP_SECRET": "wa-secret", "WHATSAPP_VERIFY_TOKEN": "wa-verify", "WHATSAPP_ACCESS_TOKEN": "",
    "OUTBOUND_POLICY_APPROVED": "false", "DEMO_ACCESS_CODE": "", "VOICE_TOOL_SECRET": "voice-secret", "VOICE_TOOL_MERCHANT_ID": "mer_demo_a",
})

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import clock  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import reset  # noqa: E402

TODAY = date(2026, 11, 18)  # a Wednesday
NOW = datetime(2026, 11, 18, 6, 30)  # 12:00 IST, naive UTC


@pytest.fixture(autouse=True)
def fresh_db():
    clock.freeze(NOW)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        reset(db, get_settings(), TODAY)
        db.commit()
    yield
    clock.freeze(None)


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    return TestClient(app)


def _login(client, user_id):
    token = client.post("/v1/auth/demo-login", json={"user_id": user_id}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def owner(client):
    return _login(client, "usr_owner_a")


@pytest.fixture
def staff(client):
    return _login(client, "usr_staff_a")


@pytest.fixture
def viewer(client):
    return _login(client, "usr_viewer_a")


@pytest.fixture
def other_owner(client):
    return _login(client, "usr_owner_b")


@pytest.fixture
def settings():
    return get_settings()
