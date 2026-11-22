"""Daily report computed only from recorded events. Promises (expected) and receipts (received) are
never added together, and receipts are split by how they were confirmed."""
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import clock
from app.models import ContactEvent, Customer, Invoice, Mismatch, Payment, PaymentAllocation, Promise

DEFINITIONS = {
    "outstanding": "Sum of (invoice total - confirmed allocations) over all issued invoices. Promises do not reduce it.",
    "provider_verified": "Payments confirmed by a signed provider webhook, received on this IST day. In demo mode the provider is a simulator and no real money moved.",
    "merchant_confirmed": "Manual receipts (e.g. cash) that an owner confirmed after their own reconciliation. Not provider-verified.",
    "unverified_claims": "Manual claims (cash note, screenshot, SMS, verbal) not yet confirmed. Not counted as received.",
    "expected_today": "Sum of open customer-stated promises dated this day. An intention, not money.",
    "contacted": "Customers with a recorded outbound message this day. Simulated activity is counted separately and labelled.",
    "replied": "Customers with a recorded inbound message this day.",
    "movement": "For the chosen day: owed at start + new invoices issued that day - verified money applied to invoices that day (reversals add back) = owed at end of day.",
    "cash_pickups": "Open cash promises where the customer confirmed a pickup window. Unconfirmed availability is not listed.",
}


def _names(db: Session, merchant_id: str) -> dict[str, str]:
    return dict(db.execute(select(Customer.id, Customer.name).where(Customer.merchant_id == merchant_id)).all())


def promise_dict(p: Promise, names: dict[str, str]) -> dict:
    return {"id": p.id, "customer_id": p.customer_id, "customer_name": names.get(p.customer_id),
            "invoice_id": p.invoice_id, "amount_paise": p.amount_paise, "promised_date": p.promised_date.isoformat(),
            "method": p.method, "pickup_window": p.pickup_window, "status": p.status,
            "evidence_source": p.evidence_source, "evidence_text": p.evidence_text, "simulated": p.simulated,
            "created_at": clock.iso(p.created_at)}


def payment_brief(p: Payment, names: dict[str, str]) -> dict:
    return {"id": p.id, "customer_id": p.customer_id, "customer_name": names.get(p.customer_id),
            "amount_paise": p.amount_paise, "state": p.state, "mode": p.mode, "provider": p.provider,
            "method": p.method, "received_at": clock.iso(p.received_at)}


def total_outstanding(db: Session, merchant_id: str, customer_id: str | None = None) -> int:
    inv = select(func.coalesce(func.sum(Invoice.total_paise), 0)).where(Invoice.merchant_id == merchant_id)
    alc = (select(func.coalesce(func.sum(PaymentAllocation.amount_paise), 0))
           .join(Invoice, Invoice.id == PaymentAllocation.invoice_id).where(Invoice.merchant_id == merchant_id))
    if customer_id:
        inv, alc = inv.where(Invoice.customer_id == customer_id), alc.where(Invoice.customer_id == customer_id)
    return int(db.scalar(inv)) - int(db.scalar(alc))


def _contact_summary(db: Session, merchant_id: str, kind: str, start, end, names) -> dict:
    rows = db.execute(select(ContactEvent.customer_id, ContactEvent.simulated).where(
        ContactEvent.merchant_id == merchant_id, ContactEvent.kind == kind,
        ContactEvent.occurred_at >= start, ContactEvent.occurred_at < end)).all()
    real = {c for c, sim in rows if not sim}
    simulated = {c for c, sim in rows if sim} - real
    return {"count": len(real), "simulated_count": len(simulated),
            "customers": [{"customer_id": c, "customer_name": names.get(c), "simulated": c in simulated}
                          for c in sorted(real | simulated, key=lambda c: names.get(c) or "")]}


def today_report(db: Session, merchant_id: str, day: date) -> dict:
    start, end = clock.ist_day_bounds(day)
    names = _names(db, merchant_id)

    payments = db.scalars(select(Payment).where(Payment.merchant_id == merchant_id, Payment.received_at >= start,
                                                Payment.received_at < end).order_by(Payment.received_at)).all()
    by_state: dict[str, int] = {}
    by_mode: dict[str, int] = {}
    for p in payments:
        by_state[p.state] = by_state.get(p.state, 0) + p.amount_paise
        if p.state == "provider_verified":
            by_mode[p.mode] = by_mode.get(p.mode, 0) + p.amount_paise
    verified = by_state.get("provider_verified", 0)
    confirmed = by_state.get("merchant_confirmed", 0)

    open_promises = db.scalars(select(Promise).where(Promise.merchant_id == merchant_id, Promise.status == "open")
                               .order_by(Promise.promised_date, Promise.created_at)).all()
    due_today = [p for p in open_promises if p.promised_date == day]
    made_today = db.scalars(select(Promise).where(Promise.merchant_id == merchant_id, Promise.created_at >= start,
                                                  Promise.created_at < end).order_by(Promise.created_at)).all()
    pickups = [p for p in open_promises if p.method == "cash" and p.pickup_window
               and day <= p.promised_date <= day + timedelta(days=7)]
    expected = sum(p.amount_paise for p in due_today)

    disputes = db.scalars(select(Payment).where(Payment.merchant_id == merchant_id, Payment.state == "disputed")).all()
    mismatches = db.scalars(select(Mismatch).where(Mismatch.merchant_id == merchant_id, Mismatch.status == "open")
                            .order_by(Mismatch.created_at.desc())).all()
    open_invoices = sum(1 for inv_id, total in db.execute(
        select(Invoice.id, Invoice.total_paise).where(Invoice.merchant_id == merchant_id)).all()
        if total - int(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.amount_paise), 0))
                                 .where(PaymentAllocation.invoice_id == inv_id))) > 0)

    # Day movement: how outstanding changed on this IST day. Derived from the same ledger rows:
    # outstanding_at_end = outstanding_at_start + new invoices - net allocations (reversals add back).
    new_invoices = db.execute(select(func.count(), func.coalesce(func.sum(Invoice.total_paise), 0)).where(
        Invoice.merchant_id == merchant_id, Invoice.created_at >= start, Invoice.created_at < end)).one()
    applied = int(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.amount_paise), 0)).where(
        PaymentAllocation.merchant_id == merchant_id, PaymentAllocation.created_at >= start,
        PaymentAllocation.created_at < end)))
    later_invoices = int(db.scalar(select(func.coalesce(func.sum(Invoice.total_paise), 0)).where(
        Invoice.merchant_id == merchant_id, Invoice.created_at >= end)))
    later_applied = int(db.scalar(select(func.coalesce(func.sum(PaymentAllocation.amount_paise), 0)).where(
        PaymentAllocation.merchant_id == merchant_id, PaymentAllocation.created_at >= end)))
    outstanding_now = total_outstanding(db, merchant_id)
    closing = outstanding_now - later_invoices + later_applied
    movement = {"opening_outstanding_paise": closing - int(new_invoices[1]) + applied,
                "new_invoice_count": int(new_invoices[0]), "new_invoices_paise": int(new_invoices[1]),
                "verified_applied_paise": applied, "closing_outstanding_paise": closing}

    return {
        "date": day.isoformat(), "timezone": "Asia/Kolkata",
        "outstanding_paise": outstanding_now, "open_invoice_count": open_invoices, "movement": movement,
        "received": {
            "provider_verified_paise": verified, "provider_verified_by_mode": by_mode,
            "merchant_confirmed_paise": confirmed,
            "confirmed_total_paise": verified + confirmed,
            "unverified_claims_paise": by_state.get("manual_unverified", 0),
            "disputed_paise": by_state.get("disputed", 0),
            "payments": [payment_brief(p, names) for p in payments],
        },
        "expected_today_paise": expected,
        "cash_in_vs_expected": {"expected_paise": expected, "confirmed_received_paise": verified + confirmed},
        "promises_due_today": [promise_dict(p, names) for p in due_today],
        "promises_made_today": [promise_dict(p, names) for p in made_today],
        "contacted": _contact_summary(db, merchant_id, "contacted", start, end, names),
        "replied": _contact_summary(db, merchant_id, "replied", start, end, names),
        "cash_pickups": [promise_dict(p, names) for p in pickups],
        "disputes": [payment_brief(p, names) for p in disputes],
        "open_mismatches": [{"id": m.id, "kind": m.kind, "detail": m.detail, "payment_id": m.payment_id,
                             "created_at": clock.iso(m.created_at)} for m in mismatches],
        "definitions": DEFINITIONS,
    }
