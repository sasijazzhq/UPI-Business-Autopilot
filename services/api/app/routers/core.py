"""Auth, customers, invoices, uploads and invoice drafts."""
import hashlib
import hmac
import os
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from adapters.extraction import ExtractedInvoice
from domain import extraction_rules, ledger, reports
from domain.outbound_policy import current_consent
from workers.media_ingestion import run_extraction

from .. import clock
from ..auth import Principal, can_write, current_principal, issue_token, owned
from ..config import get_settings
from ..db import get_db
from ..models import (AuditEvent, Consent, Customer, Invoice, InvoiceDraft, InvoiceLine, Merchant, Payment,
                      PaymentAllocation, PaymentRequest, Promise, Upload, User)
from ..seed import DEMO_USERS

router = APIRouter(prefix="/v1")

ALLOWED_TYPES = {"image/jpeg": (b"\xff\xd8\xff", ".jpg"), "image/png": (b"\x89PNG", ".png"),
                 "image/webp": (b"RIFF", ".webp"), "application/pdf": (b"%PDF", ".pdf")}


# ---- auth ---------------------------------------------------------------------------------------
class DemoLogin(BaseModel):
    user_id: str
    access_code: str | None = Field(default=None, max_length=200)


@router.get("/auth/demo-config")
def demo_config():
    s = get_settings()
    return {"demo_mode": s.demo_mode, "access_code_required": bool(s.demo_mode and s.demo_access_code)}


@router.get("/auth/demo-users")
def demo_users(db: Session = Depends(get_db)):
    if not get_settings().demo_mode:
        raise HTTPException(404, "Demo login is disabled")
    merchants = dict(db.execute(select(Merchant.id, Merchant.name)).all())
    return [{"user_id": u, "name": n, "role": r, "merchant_name": merchants.get(m)} for u, m, n, _, r in DEMO_USERS
            if m in merchants]


@router.post("/auth/demo-login")
def demo_login(body: DemoLogin, db: Session = Depends(get_db)):
    """Demo-only passwordless login for the seeded users. Disabled when DEMO_MODE=false."""
    settings = get_settings()
    if not settings.demo_mode:
        raise HTTPException(404, "Demo login is disabled")
    if settings.demo_access_code and not hmac.compare_digest(settings.demo_access_code.encode(), (body.access_code or "").encode()):
        raise HTTPException(403, "Enter the demo access code to continue")
    user = db.get(User, body.user_id)
    if user is None or user.id not in {u[0] for u in DEMO_USERS}:
        raise HTTPException(404, "Unknown demo user")
    return {"token": issue_token(db, user), "user": {"id": user.id, "name": user.name, "role": user.role}}


@router.get("/me")
def me(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return {"user_id": p.user_id, "name": p.name, "role": p.role, "merchant_id": p.merchant_id,
            "merchant_name": db.get(Merchant, p.merchant_id).name, "demo_mode": get_settings().demo_mode,
            "today": clock.today_ist().isoformat()}


# ---- serialisers --------------------------------------------------------------------------------
def invoice_dict(db: Session, inv: Invoice, names: dict[str, str] | None = None) -> dict:
    due = ledger.invoice_due(db, inv)
    return {"id": inv.id, "number": inv.number, "customer_id": inv.customer_id,
            "customer_name": (names or {}).get(inv.customer_id) or db.get(Customer, inv.customer_id).name,
            "invoice_date": inv.invoice_date.isoformat(), "currency": inv.currency,
            "subtotal_paise": inv.subtotal_paise, "tax_paise": inv.tax_paise, "total_paise": inv.total_paise,
            "allocated_paise": inv.total_paise - due, "due_paise": due,
            "status": ledger.invoice_status(inv.total_paise, due), "created_at": clock.iso(inv.created_at)}


def payment_dict(db: Session, p: Payment, names: dict[str, str]) -> dict:
    d = reports.payment_brief(p, names)
    d.update({"provider_payment_id": p.provider_payment_id, "payment_request_id": p.payment_request_id,
              "intended_invoice_id": p.intended_invoice_id, "evidence_type": p.evidence_type, "note": p.note,
              "currency": p.currency, "allocated_paise": ledger.payment_allocated(db, p.id),
              "unallocated_paise": ledger.payment_unallocated(db, p)})
    return d


def audit_dicts(db: Session, merchant_id: str, entity_type: str, entity_ids: list[str]) -> list[dict]:
    rows = db.scalars(select(AuditEvent).where(AuditEvent.merchant_id == merchant_id, AuditEvent.entity_type == entity_type,
                                               AuditEvent.entity_id.in_(entity_ids))
                      .order_by(AuditEvent.created_at, AuditEvent.id)).all()
    return [{"id": a.id, "actor": a.actor, "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id,
             "data": a.data, "created_at": clock.iso(a.created_at)} for a in rows]


def customer_names(db: Session, merchant_id: str) -> dict[str, str]:
    return dict(db.execute(select(Customer.id, Customer.name).where(Customer.merchant_id == merchant_id)).all())


# ---- customers ----------------------------------------------------------------------------------
class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    preferred_method: str | None = Field(default=None, pattern="^(cash|upi|other)$")
    preference_note: str | None = Field(default=None, max_length=500)


class ConsentIn(BaseModel):
    channel: str = Field(pattern="^(demo_inbox|whatsapp|voice_call)$")
    status: str = Field(pattern="^(opt_in|opt_out)$")
    evidence: str = Field(min_length=3, max_length=1000)


def _customer_dict(db: Session, c: Customer, merchant_id: str) -> dict:
    promised = sum(p.amount_paise for p in db.scalars(select(Promise).where(
        Promise.merchant_id == merchant_id, Promise.customer_id == c.id, Promise.status == "open")))
    return {"id": c.id, "name": c.name, "phone": c.phone, "preferred_method": c.preferred_method,
            "preference_note": c.preference_note,
            "outstanding_paise": reports.total_outstanding(db, merchant_id, c.id), "promised_open_paise": promised,
            "consents": {ch: current_consent(db, merchant_id, c.id, ch) for ch in ("demo_inbox", "whatsapp", "voice_call")}}


@router.get("/customers")
def list_customers(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(Customer).where(Customer.merchant_id == p.merchant_id).order_by(Customer.name)).all()
    return [_customer_dict(db, c, p.merchant_id) for c in rows]


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, p: Principal = Depends(can_write), db: Session = Depends(get_db)):
    c = Customer(merchant_id=p.merchant_id, **body.model_dump())
    db.add(c)
    db.flush()
    ledger.audit(db, p.merchant_id, p.user_id, "customer.created", "customer", c.id, name=c.name)
    return _customer_dict(db, c, p.merchant_id)


@router.patch("/customers/{customer_id}")
def update_customer(customer_id: str, body: CustomerIn, p: Principal = Depends(can_write), db: Session = Depends(get_db)):
    c = owned(db, Customer, customer_id, p.merchant_id)
    before = {"preferred_method": c.preferred_method, "preference_note": c.preference_note}
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    ledger.audit(db, p.merchant_id, p.user_id, "customer.updated", "customer", c.id, before=before, after=body.model_dump())
    return _customer_dict(db, c, p.merchant_id)


@router.post("/customers/{customer_id}/consents", status_code=201)
def record_consent(customer_id: str, body: ConsentIn, p: Principal = Depends(can_write), db: Session = Depends(get_db)):
    c = owned(db, Customer, customer_id, p.merchant_id)
    db.add(Consent(merchant_id=p.merchant_id, customer_id=c.id, recorded_by=p.user_id, **body.model_dump()))
    db.flush()
    ledger.audit(db, p.merchant_id, p.user_id, f"consent.{body.status}", "customer", c.id, channel=body.channel,
                 evidence=body.evidence)
    return _customer_dict(db, c, p.merchant_id)


@router.get("/customers/{customer_id}/ledger")
def customer_ledger(customer_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    c = owned(db, Customer, customer_id, p.merchant_id)
    names = {c.id: c.name}
    invoices = db.scalars(select(Invoice).where(Invoice.merchant_id == p.merchant_id, Invoice.customer_id == c.id)
                          .order_by(Invoice.invoice_date.desc())).all()
    payments = db.scalars(select(Payment).where(Payment.merchant_id == p.merchant_id, Payment.customer_id == c.id)
                          .order_by(Payment.received_at.desc())).all()
    promises = db.scalars(select(Promise).where(Promise.merchant_id == p.merchant_id, Promise.customer_id == c.id)
                          .order_by(Promise.promised_date)).all()
    consents = db.scalars(select(Consent).where(Consent.merchant_id == p.merchant_id, Consent.customer_id == c.id)
                          .order_by(Consent.recorded_at.desc())).all()
    by_state: dict[str, int] = {}
    for pay in payments:
        by_state[pay.state] = by_state.get(pay.state, 0) + pay.amount_paise
    return {
        "customer": _customer_dict(db, c, p.merchant_id),
        "totals": {"invoiced_paise": sum(i.total_paise for i in invoices),
                   "outstanding_paise": reports.total_outstanding(db, p.merchant_id, c.id),
                   "provider_verified_paise": by_state.get("provider_verified", 0),
                   "merchant_confirmed_paise": by_state.get("merchant_confirmed", 0),
                   "unverified_claims_paise": by_state.get("manual_unverified", 0),
                   "disputed_paise": by_state.get("disputed", 0),
                   "promised_open_paise": sum(x.amount_paise for x in promises if x.status == "open")},
        "invoices": [invoice_dict(db, i, names) for i in invoices],
        "payments": [payment_dict(db, x, names) for x in payments],
        "promises": [reports.promise_dict(x, names) for x in promises],
        "consent_history": [{"channel": x.channel, "status": x.status, "evidence": x.evidence,
                             "recorded_at": clock.iso(x.recorded_at)} for x in consents],
        "audit": audit_dicts(db, p.merchant_id, "customer", [c.id]),
    }


# ---- invoices -----------------------------------------------------------------------------------
@router.get("/invoices")
def list_invoices(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    names = customer_names(db, p.merchant_id)
    rows = db.scalars(select(Invoice).where(Invoice.merchant_id == p.merchant_id)
                      .order_by(Invoice.invoice_date.desc(), Invoice.number.desc())).all()
    return [invoice_dict(db, i, names) for i in rows]


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    inv = owned(db, Invoice, invoice_id, p.merchant_id)
    names = customer_names(db, p.merchant_id)
    lines = db.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == inv.id).order_by(InvoiceLine.position)).all()
    allocs = db.scalars(select(PaymentAllocation).where(PaymentAllocation.invoice_id == inv.id)
                        .order_by(PaymentAllocation.created_at, PaymentAllocation.id)).all()
    pay_ids = {a.payment_id for a in allocs}
    payments = db.scalars(select(Payment).where(Payment.merchant_id == p.merchant_id).where(
        (Payment.id.in_(pay_ids)) | (Payment.intended_invoice_id == inv.id)).order_by(Payment.received_at)).all()
    requests = db.scalars(select(PaymentRequest).where(PaymentRequest.invoice_id == inv.id)
                          .order_by(PaymentRequest.created_at)).all()
    promises = db.scalars(select(Promise).where(Promise.merchant_id == p.merchant_id, Promise.invoice_id == inv.id)
                          .order_by(Promise.promised_date)).all()
    d = invoice_dict(db, inv, names)
    d.update({
        "draft_id": inv.draft_id,
        "lines": [{"description": l.description, "quantity": l.quantity, "unit_price_paise": l.unit_price_paise,
                   "line_total_paise": l.line_total_paise} for l in lines],
        "allocations": [{"id": a.id, "payment_id": a.payment_id, "amount_paise": a.amount_paise, "kind": a.kind,
                         "reason": a.reason, "created_by": a.created_by, "created_at": clock.iso(a.created_at)} for a in allocs],
        "payments": [payment_dict(db, x, names) for x in payments],
        "payment_requests": [request_dict(r) for r in requests],
        "promises": [reports.promise_dict(x, names) for x in promises],
        "promised_open_paise": sum(x.amount_paise for x in promises if x.status == "open"),
        "audit": audit_dicts(db, p.merchant_id, "invoice", [inv.id]),
    })
    return d


def request_dict(r: PaymentRequest) -> dict:
    return {"id": r.id, "invoice_id": r.invoice_id, "customer_id": r.customer_id, "amount_paise": r.amount_paise,
            "status": r.status, "provider": r.provider, "mode": r.mode, "provider_ref": r.provider_ref,
            "link_url": r.link_url, "approved_at": clock.iso(r.approved_at), "created_at": clock.iso(r.created_at)}


# ---- uploads + drafts ---------------------------------------------------------------------------
@router.post("/uploads", status_code=201)
def create_upload(file: UploadFile = File(...), source: str = Form("web"), p: Principal = Depends(can_write),
                  db: Session = Depends(get_db)):
    settings = get_settings()
    if source not in ("web", "whatsapp_demo"):
        raise HTTPException(422, "source must be 'web' or 'whatsapp_demo'")
    spec = ALLOWED_TYPES.get(file.content_type or "")
    if spec is None:
        raise HTTPException(415, "Upload a JPEG, PNG or WebP photo, or a PDF.")
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, "File is larger than 10 MB.")
    if not data.startswith(spec[0]):
        raise HTTPException(415, "File content does not match its type.")
    up = Upload(merchant_id=p.merchant_id, filename=os.path.basename(file.filename or "bill")[:200],
                content_type=file.content_type, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                source=source, created_by=p.user_id)
    db.add(up)
    db.flush()
    folder = os.path.join(settings.upload_dir, p.merchant_id)
    os.makedirs(folder, exist_ok=True)
    up.storage_path = os.path.join(folder, up.id + spec[1])
    with open(up.storage_path, "wb") as fh:
        fh.write(data)
    ledger.audit(db, p.merchant_id, p.user_id, "upload.created", "upload", up.id, source=source, sha256=up.sha256)
    return {"id": up.id, "filename": up.filename, "content_type": up.content_type, "source": up.source}


@router.get("/uploads/{upload_id}/file")
def upload_file(upload_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    up = owned(db, Upload, upload_id, p.merchant_id)
    if not up.storage_path or not os.path.exists(up.storage_path):
        raise HTTPException(404, "File is not available")
    return FileResponse(up.storage_path, media_type=up.content_type, headers={"Cache-Control": "private, no-store"})


class ExtractIn(BaseModel):
    upload_id: str


class DraftPatch(BaseModel):
    payload: ExtractedInvoice
    customer_id: str | None = None


class ApproveIn(BaseModel):
    acknowledge_warnings: bool = False


def draft_dict(db: Session, d: InvoiceDraft) -> dict:
    up = db.get(Upload, d.upload_id)
    return {"id": d.id, "status": d.status, "extraction_source": d.extraction_source, "extraction_error": d.extraction_error,
            "payload": d.payload, "customer_id": d.customer_id, "invoice_id": d.invoice_id,
            "computed": extraction_rules.compute_totals(d.payload or {}),
            "computed_lines": extraction_rules.compute_lines(d.payload or {}),
            "issues": extraction_rules.review_draft(db, d) if d.status == "needs_review" else [],
            "upload": {"id": up.id, "filename": up.filename, "content_type": up.content_type, "source": up.source,
                       "has_file": bool(up.storage_path)},
            "created_at": clock.iso(d.created_at)}


@router.post("/invoice-drafts/extract", status_code=201)
def extract(body: ExtractIn, p: Principal = Depends(can_write), db: Session = Depends(get_db)):
    up = owned(db, Upload, body.upload_id, p.merchant_id)
    draft = run_extraction(db, get_settings(), up, actor=p.user_id)
    return draft_dict(db, draft)


@router.get("/invoice-drafts")
def list_drafts(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    rows = db.scalars(select(InvoiceDraft).where(InvoiceDraft.merchant_id == p.merchant_id)
                      .order_by(InvoiceDraft.created_at.desc())).all()
    return [draft_dict(db, d) for d in rows]


@router.get("/invoice-drafts/{draft_id}")
def get_draft(draft_id: str, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return draft_dict(db, owned(db, InvoiceDraft, draft_id, p.merchant_id))


def _reviewable(db: Session, draft_id: str, merchant_id: str) -> InvoiceDraft:
    d = owned(db, InvoiceDraft, draft_id, merchant_id)
    if d.status != "needs_review":
        raise HTTPException(409, f"Draft is already {d.status}")
    return d


@router.patch("/invoice-drafts/{draft_id}")
def patch_draft(draft_id: str, body: DraftPatch, p: Principal = Depends(can_write), db: Session = Depends(get_db)):
    d = _reviewable(db, draft_id, p.merchant_id)
    if body.customer_id:
        owned(db, Customer, body.customer_id, p.merchant_id)
    d.payload = {**body.payload.model_dump(), "needs_human_review": True}
    d.customer_id = body.customer_id
    ledger.audit(db, p.merchant_id, p.user_id, "draft.edited", "draft", d.id)
    db.flush()
    return draft_dict(db, d)


@router.post("/invoice-drafts/{draft_id}/reject")
def reject_draft(draft_id: str, p: Principal = Depends(can_write), db: Session = Depends(get_db)):
    d = _reviewable(db, draft_id, p.merchant_id)
    d.status = "rejected"
    ledger.audit(db, p.merchant_id, p.user_id, "draft.rejected", "draft", d.id)
    return draft_dict(db, d)


@router.post("/invoice-drafts/{draft_id}/approve")
def approve_draft(draft_id: str, body: ApproveIn, p: Principal = Depends(can_write), db: Session = Depends(get_db)):
    """The only way an invoice comes into existence from a bill: explicit approval by an authenticated merchant user."""
    d = _reviewable(db, draft_id, p.merchant_id)
    issues = extraction_rules.review_draft(db, d)
    blocking = [i for i in issues if i["severity"] == "blocking"]
    if blocking:
        raise HTTPException(409, {"message": "Fix the highlighted fields before approving.", "issues": blocking})
    warnings = [i for i in issues if i["severity"] == "warning"]
    if warnings and not body.acknowledge_warnings:
        raise HTTPException(409, {"message": "Confirm you have checked the warnings.", "issues": warnings})
    totals = extraction_rules.compute_totals(d.payload)
    if totals is None or totals["total_paise"] <= 0:
        raise HTTPException(409, {"message": "Invoice total must be greater than zero.", "issues": []})

    if d.customer_id:
        customer = owned(db, Customer, d.customer_id, p.merchant_id)
    else:
        customer = Customer(merchant_id=p.merchant_id, name=d.payload["customer_name"].strip()[:200])
        db.add(customer)
        db.flush()
        ledger.audit(db, p.merchant_id, p.user_id, "customer.created", "customer", customer.id, name=customer.name,
                     via="draft_approval")
    merchant = db.execute(select(Merchant).where(Merchant.id == p.merchant_id).with_for_update()).scalar_one()
    number = f"INV-{merchant.next_invoice_seq:04d}"
    merchant.next_invoice_seq += 1
    inv = Invoice(merchant_id=p.merchant_id, customer_id=customer.id, number=number,
                  invoice_date=date.fromisoformat(d.payload["invoice_date"]), subtotal_paise=totals["subtotal_paise"],
                  tax_paise=totals["tax_paise"], total_paise=totals["total_paise"], draft_id=d.id, approved_by=p.user_id)
    db.add(inv)
    db.flush()
    for i, (item, total) in enumerate(zip(d.payload["items"], totals["line_totals_paise"])):
        db.add(InvoiceLine(merchant_id=p.merchant_id, invoice_id=inv.id, position=i, description=item["description"].strip()[:300],
                           quantity=str(item["quantity"]).strip(), unit_price_paise=item["unit_price_paise"], line_total_paise=total))
    d.status, d.invoice_id, d.customer_id = "approved", inv.id, customer.id
    ledger.audit(db, p.merchant_id, p.user_id, "invoice.approved", "invoice", inv.id, number=number, draft_id=d.id,
                 total_paise=inv.total_paise, extraction_source=d.extraction_source,
                 acknowledged_warnings=[w["code"] for w in warnings])
    db.flush()
    return {"invoice": invoice_dict(db, inv), "draft": draft_dict(db, d)}
