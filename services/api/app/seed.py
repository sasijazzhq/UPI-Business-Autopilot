"""Deterministic demo data. Run: `python -m app.seed` (applies migrations, seeds if empty) or
`python -m app.seed --reset`. Seeded receipts go through the real signed-webhook pipeline using the
demo provider, so they are labelled simulated end to end."""
import sys
from datetime import date, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from adapters.payments import DemoPaymentProvider
from domain import ledger, reconciliation

from . import clock
from .config import Settings, get_settings
from .db import Base
from .models import (AuthSession, Consent, ContactEvent, Customer, Invoice, InvoiceLine, Merchant, MerchantProviderAccount, Message,
                     Payment, PaymentAllocation, PaymentRequest, Promise, User)

DEMO_USERS = [
    ("usr_owner_a", "mer_demo_a", "Lakshmi (owner)", "owner@srilakshmi.example", "owner"),
    ("usr_staff_a", "mer_demo_a", "Ravi (staff)", "staff@srilakshmi.example", "staff"),
    ("usr_viewer_a", "mer_demo_a", "Auditor (view only)", "viewer@srilakshmi.example", "viewer"),
    ("usr_owner_b", "mer_demo_b", "Farid (owner, second tenant)", "owner@coastal.example", "owner"),
]


def _next_weekday(today: date, weekday: int) -> date:
    return today + timedelta(days=(weekday - today.weekday() - 1) % 7 + 1)


def _invoice(db: Session, inv_id: str, merchant_id: str, customer_id: str, number: str, day: date,
             lines: list[tuple[str, str, int]]) -> Invoice:
    from domain.money import line_total_paise
    totals = [line_total_paise(q, u) for _, q, u in lines]
    inv = Invoice(id=inv_id, merchant_id=merchant_id, customer_id=customer_id, number=number, invoice_date=day,
                  subtotal_paise=sum(totals), tax_paise=0, total_paise=sum(totals), approved_by="demo_seed",
                  created_at=clock.ist_at(day, 11))
    db.add(inv)
    db.flush()
    for i, ((desc, qty, unit), total) in enumerate(zip(lines, totals)):
        db.add(InvoiceLine(merchant_id=merchant_id, invoice_id=inv_id, position=i, description=desc, quantity=qty,
                           unit_price_paise=unit, line_total_paise=total))
    ledger.audit(db, merchant_id, "demo_seed", "invoice.seeded", "invoice", inv_id, number=number, total_paise=sum(totals))
    return inv


def _verified_payment(db: Session, settings: Settings, req_id: str, inv: Invoice, amount: int, pay_id: str, when) -> None:
    provider = DemoPaymentProvider(settings)
    db.add(PaymentRequest(id=req_id, merchant_id=inv.merchant_id, invoice_id=inv.id, customer_id=inv.customer_id,
                          amount_paise=amount, status="approved", provider="demo", mode="simulated",
                          provider_ref=f"demo_plink_{req_id}", proposed_by="demo_seed", approved_by="demo_seed",
                          approved_at=when, created_at=when))
    db.flush()
    body, sig, _ = provider.build_event(event_type="payment.captured", account_id="acc_demo_a", payment_id=pay_id,
                                        amount_paise=amount, payment_request_id=req_id,
                                        created_at=int(when.replace(tzinfo=clock.timezone.utc).timestamp()))
    res = reconciliation.ingest_webhook(db, settings, "demo", body, sig, f"evt_seed_{pay_id}")
    assert res.status == "processed", res
    # Seed-only backdating so history reads as if it was posted when the payment arrived. Done with a
    # table-level statement because ledger rows are immutable through the application.
    paid = db.scalar(select(Payment.id).where(Payment.provider_payment_id == pay_id))
    db.execute(update(PaymentAllocation.__table__).where(PaymentAllocation.payment_id == paid).values(created_at=when))


def seed(db: Session, settings: Settings, today: date | None = None) -> None:
    today = today or clock.today_ist()
    now = clock.now()
    day_start, _ = clock.ist_day_bounds(today)
    earlier_today = max(day_start, now - timedelta(hours=2))

    db.add_all([Merchant(id="mer_demo_a", name="Sri Lakshmi Traders", next_invoice_seq=4),
                Merchant(id="mer_demo_b", name="Coastal Wholesale", next_invoice_seq=2)])
    db.flush()
    db.add_all([MerchantProviderAccount(merchant_id="mer_demo_a", provider="demo", account_id="acc_demo_a"),
                MerchantProviderAccount(merchant_id="mer_demo_b", provider="demo", account_id="acc_demo_b")])
    db.add_all([User(id=i, merchant_id=m, name=n, email=e, role=r) for i, m, n, e, r in DEMO_USERS])
    db.add_all([
        Customer(id="cus_murugan", merchant_id="mer_demo_a", name="Murugan Stores", phone="+91 90000 00001", preferred_method="upi",
                 preference_note="Stated by customer: prefers UPI."),
        Customer(id="cus_anbu", merchant_id="mer_demo_a", name="Anbu Provision Store", phone="+91 90000 00002"),
        Customer(id="cus_kavitha", merchant_id="mer_demo_a", name="Kavitha Supermarket", phone="+91 90000 00003", preferred_method="cash",
                 preference_note="Stated by customer: cash on pickup, evenings."),
        Customer(id="cus_bay", merchant_id="mer_demo_b", name="Bay Retail", phone="+91 90000 00009"),
    ])
    db.flush()

    inv1 = _invoice(db, "inv_demo_0001", "mer_demo_a", "cus_murugan", "INV-0001", today - timedelta(days=10),
                    [("Ponni rice 25 kg bag", "10", 120000), ("Sunflower oil 5 L can", "20", 40000)])  # ₹20,000
    _invoice(db, "inv_demo_0002", "mer_demo_a", "cus_anbu", "INV-0002", today - timedelta(days=6),
             [("Atta 10 kg bag", "25", 50000)])  # ₹12,500
    _invoice(db, "inv_demo_0003", "mer_demo_a", "cus_kavitha", "INV-0003", today - timedelta(days=3),
             [("Tea dust 1 kg", "12", 70000)])  # ₹8,400
    _invoice(db, "inv_demo_b001", "mer_demo_b", "cus_bay", "INV-0001", today - timedelta(days=2),
             [("Detergent 5 kg", "8", 45000)])  # ₹3,600 (other tenant)

    # INV-0001: ₹20,000 -> ₹5,000 -> ₹10,000 => ₹5,000 remaining.
    _verified_payment(db, settings, "prq_seed_1", inv1, 500000, "pay_demo_seed_1", clock.ist_at(today - timedelta(days=7), 15))
    _verified_payment(db, settings, "prq_seed_2", inv1, 1000000, "pay_demo_seed_2", earlier_today)

    for cid in ("cus_murugan", "cus_anbu"):
        db.add(Consent(merchant_id="mer_demo_a", customer_id=cid, channel="demo_inbox", status="opt_in",
                       evidence="Demo seed: customer agreed in person to receive invoice/payment messages.",
                       recorded_by="demo_seed"))

    yesterday = clock.ist_at(today - timedelta(days=1), 17)
    m1 = Message(id="msg_seed_anbu", merchant_id="mer_demo_a", customer_id="cus_anbu", direction="inbound", channel="demo_inbox",
                 body="₹3,000 on Friday, ₹2,000 on Monday", status="received", simulated=True, created_at=yesterday)
    m2 = Message(id="msg_seed_kavitha", merchant_id="mer_demo_a", customer_id="cus_kavitha", direction="inbound", channel="demo_inbox",
                 body="Will give ₹4,000 cash today. Shop is open for pickup 4 to 6 pm.", status="received", simulated=True,
                 created_at=earlier_today)
    db.add_all([m1, m2,
                ContactEvent(merchant_id="mer_demo_a", customer_id="cus_anbu", kind="replied", channel="demo_inbox",
                             message_id=m1.id, simulated=True, occurred_at=yesterday),
                ContactEvent(merchant_id="mer_demo_a", customer_id="cus_kavitha", kind="replied", channel="demo_inbox",
                             message_id=m2.id, simulated=True, occurred_at=earlier_today)])

    def promise(pid, cid, inv, amount, day, method, text, source="demo_inbox", msg=None, window=None, at=yesterday):
        db.add(Promise(id=pid, merchant_id="mer_demo_a", customer_id=cid, invoice_id=inv, amount_paise=amount,
                       promised_date=day, method=method, pickup_window=window, evidence_source=source,
                       evidence_text=text, source_message_id=msg, simulated=True, recorded_by="demo_seed", created_at=at))

    promise("prm_seed_1", "cus_anbu", "inv_demo_0002", 300000, _next_weekday(today, 4), "upi", m1.body, msg=m1.id)
    promise("prm_seed_2", "cus_anbu", "inv_demo_0002", 200000, _next_weekday(today, 0), "cash", m1.body, msg=m1.id)
    promise("prm_seed_3", "cus_kavitha", "inv_demo_0003", 400000, today, "cash", m2.body, msg=m2.id, window="4 pm - 6 pm",
            at=earlier_today)
    promise("prm_seed_4", "cus_murugan", "inv_demo_0001", 500000, today, "upi",
            "Demo seed: said in person he will clear the last ₹5,000 by UPI today.", source="demo_seed", at=earlier_today)

    db.add(Payment(id="pay_seed_claim", merchant_id="mer_demo_a", customer_id="cus_kavitha", provider="manual",
                   provider_payment_id="manual_seed_claim", intended_invoice_id="inv_demo_0003", amount_paise=200000,
                   state="manual_unverified", mode="manual", method="upi_claim", evidence_type="screenshot",
                   note="Customer sent a GPay screenshot. A screenshot is not proof of receipt.",
                   received_at=earlier_today, created_at=earlier_today))
    ledger.audit(db, "mer_demo_a", "demo_seed", "payment.manual_recorded", "payment", "pay_seed_claim",
                 amount_paise=200000, evidence_type="screenshot")
    db.flush()


def reset(db: Session, settings: Settings, today: date | None = None) -> None:
    """Restore the seeded data. Sign-in sessions of the seeded users survive, so whoever pressed
    reset (and anyone else in the demo) stays signed in and no request is left holding a dead token."""
    sessions = [dict(r._mapping) for r in db.execute(select(AuthSession.__table__))]
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    seed(db, settings, today)
    seeded = {u[0] for u in DEMO_USERS}
    keep = [s for s in sessions if s["user_id"] in seeded]
    if keep:
        db.execute(AuthSession.__table__.insert(), keep)


def main() -> None:
    from alembic import command
    from alembic.config import Config

    from .db import SessionLocal
    command.upgrade(Config("alembic.ini"), "head")
    settings = get_settings()
    with SessionLocal() as db:
        if "--reset" in sys.argv:
            reset(db, settings)
            print("Demo data reset.")
        elif db.scalar(select(Merchant.id).limit(1)) is None:
            seed(db, settings)
            print("Demo data seeded.")
        else:
            print("Database already has data; use --reset to reseed.")
        db.commit()


if __name__ == "__main__":
    main()
