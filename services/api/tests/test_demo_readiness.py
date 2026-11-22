"""Day movement on the report, reset keeping sessions, and the demo access code."""
from sqlalchemy import func, select

from app.models import Invoice, PaymentAllocation

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def movement(client, h):
    return client.get("/v1/reports/today", headers=h).json()


def test_movement_explains_outstanding_before_and_after_the_demo_story(client, owner):
    r = movement(client, owner)
    m = r["movement"]
    assert m == {"opening_outstanding_paise": 3_590_000, "new_invoice_count": 0, "new_invoices_paise": 0,
                 "verified_applied_paise": 1_000_000, "closing_outstanding_paise": 2_590_000}
    assert m["closing_outstanding_paise"] == r["outstanding_paise"]

    # The guided-demo story: one new ₹5,300 bill, then a verified ₹5,000 on INV-0001.
    up = client.post("/v1/uploads", headers=owner, files={"file": ("bill.png", PNG, "image/png")}).json()
    d = client.post("/v1/invoice-drafts/extract", headers=owner, json={"upload_id": up["id"]}).json()
    p = d["payload"]
    p["items"][1]["line_total_paise"] = 80000
    p["items"][2].update(quantity="1", line_total_paise=210000)
    p.update(subtotal_paise=None, total_paise=530000, uncertain_fields=[])
    client.patch(f"/v1/invoice-drafts/{d['id']}", headers=owner, json={"payload": p, "customer_id": d["customer_id"]})
    assert client.post(f"/v1/invoice-drafts/{d['id']}/approve", headers=owner, json={"acknowledge_warnings": True}).status_code == 200
    req = client.post("/v1/payment-intents", headers=owner, json={"invoice_id": "inv_demo_0001", "amount_paise": 500_000}).json()
    client.post(f"/v1/payment-intents/{req['id']}/approve", headers=owner, json={"provider": "demo"})
    client.post("/v1/demo/simulate-payment-event", headers=owner, json={"payment_request_id": req["id"]})

    r = movement(client, owner)
    m = r["movement"]
    assert m == {"opening_outstanding_paise": 3_590_000, "new_invoice_count": 1, "new_invoices_paise": 530_000,
                 "verified_applied_paise": 1_500_000, "closing_outstanding_paise": 2_620_000}
    assert m["opening_outstanding_paise"] + m["new_invoices_paise"] - m["verified_applied_paise"] == r["outstanding_paise"]

    # A dispute takes the money back out of "applied" (compensating entry), and the identity still holds.
    pay = [x for x in client.get("/v1/payments", headers=owner).json() if x["payment_request_id"] == req["id"]][0]
    client.post(f"/v1/payments/{pay['id']}/dispute", headers=owner, json={"note": "customer reversed it"})
    r = movement(client, owner)
    assert r["movement"]["verified_applied_paise"] == 1_000_000 and r["outstanding_paise"] == 3_120_000
    assert r["movement"]["closing_outstanding_paise"] == r["outstanding_paise"]


def test_movement_matches_the_ledger_for_a_past_day(client, owner, db):
    past = client.get("/v1/reports/today?date=2026-11-11", headers=owner).json()["movement"]
    # 11 Nov: only INV-0001 (₹20,000, issued 8 Nov) existed; the first ₹5,000 was applied that day.
    assert past == {"opening_outstanding_paise": 2_000_000, "new_invoice_count": 0, "new_invoices_paise": 0,
                    "verified_applied_paise": 500_000, "closing_outstanding_paise": 1_500_000}
    issued = client.get("/v1/reports/today?date=2026-11-12", headers=owner).json()["movement"]  # INV-0002 issued
    assert issued["new_invoices_paise"] == 1_250_000 and issued["opening_outstanding_paise"] == 1_500_000
    total = int(db.scalar(select(func.coalesce(func.sum(Invoice.total_paise), 0)).where(Invoice.merchant_id == "mer_demo_a")))
    applied = int(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.amount_paise), 0)).where(PaymentAllocation.merchant_id == "mer_demo_a")))
    today = client.get("/v1/reports/today", headers=owner).json()
    assert today["outstanding_paise"] == total - applied


def test_reset_is_owner_only_and_keeps_everyone_signed_in(client, owner, staff, viewer, other_owner):
    assert client.post("/v1/demo/reset", headers=staff).status_code == 403
    assert client.post("/v1/demo/reset", headers=viewer).status_code == 403
    assert client.post("/v1/demo/reset").status_code == 401
    client.post("/v1/customers", headers=owner, json={"name": "Temp Shop"})
    for _ in range(3):  # repeated resets
        assert client.post("/v1/demo/reset", headers=owner).status_code == 200
        for h in (owner, staff, viewer, other_owner):  # nobody is left holding a dead token
            assert client.get("/v1/me", headers=h).status_code == 200
    names = [c["name"] for c in client.get("/v1/customers", headers=owner).json()]
    assert "Temp Shop" not in names and len(names) == 3
    assert client.get("/v1/reports/today", headers=owner).json()["outstanding_paise"] == 2_590_000


def test_demo_access_code_gates_sign_in(client, settings, monkeypatch):
    assert client.get("/v1/auth/demo-config").json() == {"demo_mode": True, "access_code_required": False}
    monkeypatch.setattr(settings, "demo_access_code", "kirana-2026")
    assert client.get("/v1/auth/demo-config").json()["access_code_required"] is True
    assert client.post("/v1/auth/demo-login", json={"user_id": "usr_owner_a"}).status_code == 403
    assert client.post("/v1/auth/demo-login", json={"user_id": "usr_owner_a", "access_code": "wrong"}).status_code == 403
    ok = client.post("/v1/auth/demo-login", json={"user_id": "usr_owner_a", "access_code": "kirana-2026"})
    assert ok.status_code == 200 and ok.json()["token"]
    monkeypatch.setattr(settings, "demo_mode", False)
    assert client.post("/v1/auth/demo-login", json={"user_id": "usr_owner_a", "access_code": "kirana-2026"}).status_code == 404
    assert client.post("/v1/demo/reset", headers={"Authorization": f"Bearer {ok.json()['token']}"}).status_code == 404
