# ═══════════════════════════════════════════════════════════
# api/routers/api_dispatch.py
#  Send validated XMLs to an external API endpoint.
#  Supports: bearer / api-key / basic / oauth2 / none auth.
#  Retries up to 5 times on server errors (5xx / network).
# ═══════════════════════════════════════════════════════════
import json
import ssl
import time as _time
import base64
import urllib.request
import urllib.error
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import ApiDispatchConfig, ApiDispatchLog, GeneratedXml
from api.services.encryption import encrypt, decrypt

router = APIRouter()

MAX_RETRIES = 5
RETRY_WAIT_S = 2        # fixed 2-second gap between retries
RESPONSE_SIZE = 131072  # 128 KB max response body kept in DB

# ══════════════════════════════════════════════════════════════
# Pydantic schemas
# ══════════════════════════════════════════════════════════════

class DispatchConfigIn(BaseModel):
    endpoint_url:     Optional[str] = None
    method:           str = "POST"
    content_type:     str = "application/xml"
    auth_type:        str = "none"          # none|bearer|apikey|basic|oauth2
    auth_value:       Optional[str] = None  # plain — encrypted at rest
    auth_header_name: Optional[str] = None  # for apikey type
    extra_headers:    Optional[str] = None  # JSON string


class DispatchConfigOut(BaseModel):
    id:               Optional[int] = None
    endpoint_url:     Optional[str] = None
    method:           str = "POST"
    content_type:     str = "application/xml"
    auth_type:        str = "none"
    has_auth_value:   bool = False           # true if a token/password is stored
    auth_header_name: Optional[str] = None
    extra_headers:    Optional[str] = None


class DispatchLogOut(BaseModel):
    id:               int
    xml_id:           Optional[int]
    identifier_value: Optional[str]
    status:           str
    response_status:  Optional[int]
    response_body:    Optional[str]
    response_time_ms: Optional[int]
    retry_count:      int
    error_message:    Optional[str]
    sent_at:          Optional[str]


class XmlDispatchRow(BaseModel):
    xml_id:           int
    identifier_value: Optional[str]
    validation_status: Optional[str]   # pass|fail|None
    dispatch_status:  Optional[str]    # latest log status or None
    dispatch_log_id:  Optional[int]
    response_status:  Optional[int]
    response_time_ms: Optional[int]
    retry_count:      int = 0


# ══════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════

def _build_headers(cfg: ApiDispatchConfig) -> dict[str, str]:
    """Build request headers including Content-Type and auth."""
    hdrs: dict[str, str] = {
        "Content-Type": cfg.content_type or "application/xml",
        "Accept": "*/*",
        "User-Agent": "ClarityStudio/2.0",
    }
    auth_val = decrypt(cfg.auth_value_enc) or ""
    if cfg.auth_type == "bearer":
        if auth_val:
            hdrs["Authorization"] = f"Bearer {auth_val}"
    elif cfg.auth_type == "oauth2":
        if auth_val:
            hdrs["Authorization"] = f"Bearer {auth_val}"
    elif cfg.auth_type == "apikey":
        header_name = (cfg.auth_header_name or "X-API-Key").strip()
        if auth_val:
            hdrs[header_name] = auth_val
    elif cfg.auth_type == "basic":
        if auth_val:
            encoded = base64.b64encode(auth_val.encode()).decode()
            hdrs["Authorization"] = f"Basic {encoded}"
    # extra headers (JSON dict)
    if cfg.extra_headers:
        try:
            extra = json.loads(cfg.extra_headers)
            if isinstance(extra, dict):
                for k, v in extra.items():
                    hdrs[str(k)] = str(v)
        except Exception:
            pass
    return hdrs


def _http_send(url: str, method: str, headers: dict, body: bytes) -> tuple[int, str, int]:
    """
    Send HTTP request. Returns (status_code, response_body, elapsed_ms).
    Raises urllib.error.HTTPError for non-2xx server errors.
    Raises Exception for network/SSL errors.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    t0 = _time.time()
    with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
        elapsed = int((_time.time() - t0) * 1000)
        resp_body = resp.read(RESPONSE_SIZE).decode("utf-8", errors="replace")
        return resp.status, resp_body, elapsed


def _send_with_retry(
    url: str, method: str, headers: dict, body: str
) -> tuple[str, int, str, int, int, Optional[str]]:
    """
    Returns: (status, http_code, response_body, elapsed_ms, retry_count, error_msg)
    Retries up to MAX_RETRIES on 5xx or network errors.
    Stops immediately on 4xx (client errors).
    """
    body_bytes = body.encode("utf-8")
    last_error: Optional[str] = None
    retries = 0

    for attempt in range(MAX_RETRIES):
        retries = attempt
        try:
            http_status, resp_body, elapsed = _http_send(url, method, headers, body_bytes)
            return "success", http_status, resp_body, elapsed, retries, None
        except urllib.error.HTTPError as e:
            elapsed = 0
            err_body = ""
            try:
                err_body = e.read(8192).decode("utf-8", errors="replace")
            except Exception:
                pass
            last_error = f"HTTP {e.code} {e.reason}"
            if e.code < 500:   # 4xx — don't retry
                return "fail", e.code, err_body, elapsed, retries, last_error
        except Exception as exc:
            last_error = str(exc)

        if attempt < MAX_RETRIES - 1:
            _time.sleep(RETRY_WAIT_S)

    return "fail", 0, "", 0, retries, last_error


def _cfg_to_out(cfg: ApiDispatchConfig) -> DispatchConfigOut:
    return DispatchConfigOut(
        id=cfg.id,
        endpoint_url=cfg.endpoint_url,
        method=cfg.method or "POST",
        content_type=cfg.content_type or "application/xml",
        auth_type=cfg.auth_type or "none",
        has_auth_value=bool(cfg.auth_value_enc),
        auth_header_name=cfg.auth_header_name,
        extra_headers=cfg.extra_headers,
    )


def _log_to_out(log: ApiDispatchLog) -> DispatchLogOut:
    return DispatchLogOut(
        id=log.id,
        xml_id=log.xml_id,
        identifier_value=log.identifier_value,
        status=log.status,
        response_status=log.response_status,
        response_body=log.response_body,
        response_time_ms=log.response_time_ms,
        retry_count=log.retry_count,
        error_message=log.error_message,
        sent_at=log.sent_at.isoformat() if log.sent_at else None,
    )


# ══════════════════════════════════════════════════════════════
# Config endpoints
# ══════════════════════════════════════════════════════════════

@router.get("/dispatch/{conn_id}/config", response_model=DispatchConfigOut)
def get_dispatch_config(conn_id: int, db: Session = Depends(get_db)):
    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if not cfg:
        return DispatchConfigOut()
    return _cfg_to_out(cfg)


@router.put("/dispatch/{conn_id}/config", response_model=DispatchConfigOut)
def save_dispatch_config(conn_id: int, body: DispatchConfigIn, db: Session = Depends(get_db)):
    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if not cfg:
        cfg = ApiDispatchConfig(conn_id=conn_id)
        db.add(cfg)

    cfg.endpoint_url     = (body.endpoint_url or "").strip() or None
    cfg.method           = body.method or "POST"
    cfg.content_type     = body.content_type or "application/xml"
    cfg.auth_type        = body.auth_type or "none"
    cfg.auth_header_name = body.auth_header_name or None
    cfg.extra_headers    = body.extra_headers or None

    # Only overwrite the encrypted value if a new one is provided
    if body.auth_value is not None:
        cfg.auth_value_enc = encrypt(body.auth_value) if body.auth_value.strip() else None

    db.commit()
    db.refresh(cfg)
    return _cfg_to_out(cfg)


# ══════════════════════════════════════════════════════════════
# XMLs list with latest dispatch status
# ══════════════════════════════════════════════════════════════

@router.get("/dispatch/{conn_id}/xmls", response_model=list[XmlDispatchRow])
def list_dispatch_xmls(conn_id: int, db: Session = Depends(get_db)):
    """Return all generated XMLs for this connection with their latest dispatch log."""
    xml_rows = (
        db.query(GeneratedXml)
        .filter(GeneratedXml.conn_id == conn_id)
        .order_by(GeneratedXml.id)
        .all()
    )

    # Latest log per xml_id
    all_logs = (
        db.query(ApiDispatchLog)
        .filter(ApiDispatchLog.conn_id == conn_id)
        .order_by(ApiDispatchLog.id.desc())
        .all()
    )
    latest_log: dict[int, ApiDispatchLog] = {}
    for log in all_logs:
        if log.xml_id and log.xml_id not in latest_log:
            latest_log[log.xml_id] = log

    result = []
    for x in xml_rows:
        log = latest_log.get(x.id)
        result.append(XmlDispatchRow(
            xml_id=x.id,
            identifier_value=x.identifier_value,
            validation_status=x.validation_status,
            dispatch_status=log.status if log else None,
            dispatch_log_id=log.id if log else None,
            response_status=log.response_status if log else None,
            response_time_ms=log.response_time_ms if log else None,
            retry_count=log.retry_count if log else 0,
        ))
    return result


# ══════════════════════════════════════════════════════════════
# Send single XML
# ══════════════════════════════════════════════════════════════

@router.post("/dispatch/{conn_id}/send/{xml_id}", response_model=DispatchLogOut)
def send_single(conn_id: int, xml_id: int, db: Session = Depends(get_db)):
    """Send one XML record to the configured API endpoint (up to 5 retries)."""
    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if not cfg or not cfg.endpoint_url:
        raise HTTPException(status_code=400, detail="No API endpoint configured. Save config first.")

    xml_row = db.query(GeneratedXml).filter(
        GeneratedXml.id == xml_id,
        GeneratedXml.conn_id == conn_id,
    ).first()
    if not xml_row:
        raise HTTPException(status_code=404, detail="XML record not found.")

    body = xml_row.xml_content or ""
    headers = _build_headers(cfg)

    status, http_code, resp_body, elapsed_ms, retries, err = _send_with_retry(
        url=cfg.endpoint_url,
        method=cfg.method or "POST",
        headers=headers,
        body=body,
    )

    log = ApiDispatchLog(
        conn_id=conn_id,
        xml_id=xml_id,
        identifier_value=xml_row.identifier_value,
        status=status,
        request_body=body[:65536],          # cap at 64 KB
        response_status=http_code or None,
        response_body=resp_body[:RESPONSE_SIZE] if resp_body else None,
        response_time_ms=elapsed_ms or None,
        retry_count=retries,
        error_message=err,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return _log_to_out(log)


# ══════════════════════════════════════════════════════════════
# Send all validated XMLs
# ══════════════════════════════════════════════════════════════

@router.post("/dispatch/{conn_id}/send-all")
def send_all(conn_id: int, db: Session = Depends(get_db)):
    """Send all XMLs with validation_status='pass' to the configured endpoint."""
    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if not cfg or not cfg.endpoint_url:
        raise HTTPException(status_code=400, detail="No API endpoint configured. Save config first.")

    xml_rows = (
        db.query(GeneratedXml)
        .filter(
            GeneratedXml.conn_id == conn_id,
            GeneratedXml.validation_status == "pass",
        )
        .order_by(GeneratedXml.id)
        .all()
    )
    if not xml_rows:
        raise HTTPException(
            status_code=400,
            detail="No validated XMLs found. Run Validation first to mark records as 'pass'.",
        )

    headers = _build_headers(cfg)
    results = []
    sent = failed = 0

    for x in xml_rows:
        body = x.xml_content or ""
        status, http_code, resp_body, elapsed_ms, retries, err = _send_with_retry(
            url=cfg.endpoint_url,
            method=cfg.method or "POST",
            headers=headers,
            body=body,
        )
        log = ApiDispatchLog(
            conn_id=conn_id,
            xml_id=x.id,
            identifier_value=x.identifier_value,
            status=status,
            request_body=body[:65536],
            response_status=http_code or None,
            response_body=resp_body[:RESPONSE_SIZE] if resp_body else None,
            response_time_ms=elapsed_ms or None,
            retry_count=retries,
            error_message=err,
        )
        db.add(log)
        if status == "success":
            sent += 1
        else:
            failed += 1
        results.append({
            "xml_id": x.id,
            "identifier_value": x.identifier_value,
            "status": status,
            "http_code": http_code,
            "retries": retries,
            "error": err,
        })

    db.commit()
    return {"sent": sent, "failed": failed, "total": len(xml_rows), "results": results}


# ══════════════════════════════════════════════════════════════
# Logs
# ══════════════════════════════════════════════════════════════

@router.get("/dispatch/{conn_id}/logs", response_model=list[DispatchLogOut])
def get_logs(conn_id: int, xml_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(ApiDispatchLog).filter(ApiDispatchLog.conn_id == conn_id)
    if xml_id is not None:
        q = q.filter(ApiDispatchLog.xml_id == xml_id)
    logs = q.order_by(ApiDispatchLog.id.desc()).limit(200).all()
    return [_log_to_out(l) for l in logs]


# ══════════════════════════════════════════════════════════════
# AI Configure  —  POST /api/dispatch/{conn_id}/ai-configure
# ══════════════════════════════════════════════════════════════

_AI_DISPATCH_SYSTEM = """You are an API integration expert assistant.
Your job is to help the user configure an HTTP API endpoint to receive XML data payloads.

The configuration fields are:
- endpoint_url (string): Full URL, e.g. "https://api.example.com/v1/xml-import"
- method (string): HTTP method — POST, PUT, or PATCH
- content_type (string): Content-Type header — "application/xml", "text/xml", or "application/json"
- auth_type (string): one of: none | bearer | apikey | basic | oauth2
- auth_value (string|null):
  - For bearer/oauth2: the token value
  - For apikey: the API key value
  - For basic: "username:password" string
  - For none: null
- auth_header_name (string|null): Only for apikey — the header name (e.g. "X-API-Key", "Authorization")
- extra_headers (string|null): JSON string of additional headers, e.g. '{"X-Client-Id": "123"}'

When the user describes their API or provides documentation:
1. Explain what you understood about the API configuration.
2. Return a CONFIG_JSON block at the end (always include it, even if partially filled):

CONFIG_JSON:
{
  "endpoint_url": "https://...",
  "method": "POST",
  "content_type": "application/xml",
  "auth_type": "bearer",
  "auth_value": "your-token-here",
  "auth_header_name": null,
  "extra_headers": null
}

If you cannot determine a value, use null. Always include CONFIG_JSON.
Be concise — focus on what you identified and ask if anything is unclear.
"""


def _extract_text_from_upload(raw_bytes: bytes, filename: str) -> str:
    import io, csv
    name = filename.lower()
    try:
        if name.endswith(".pdf"):
            try:
                import pdfplumber
                with pdfplumber.open(io.BytesIO(raw_bytes)) as pdf:
                    return "\n".join(p.extract_text() or "" for p in pdf.pages)
            except ImportError:
                pass
        elif name.endswith(".docx"):
            try:
                import docx as _docx
                doc = _docx.Document(io.BytesIO(raw_bytes))
                return "\n".join(p.text for p in doc.paragraphs)
            except ImportError:
                pass
        elif name.endswith((".xlsx", ".xls")):
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
                lines = []
                for ws in wb.worksheets:
                    lines.append(f"[Sheet: {ws.title}]")
                    for row in ws.iter_rows(max_row=200, values_only=True):
                        if any(c is not None for c in row):
                            lines.append("\t".join(str(c) if c is not None else "" for c in row))
                return "\n".join(lines)
            except ImportError:
                pass
        elif name.endswith(".csv"):
            decoded = raw_bytes.decode("utf-8", errors="replace")
            reader = csv.reader(decoded.splitlines())
            return "\n".join("\t".join(row) for row in reader)
    except Exception:
        pass
    return raw_bytes.decode("utf-8", errors="replace")


@router.post("/dispatch/{conn_id}/ai-configure")
async def ai_configure(
    conn_id: int,
    message:  Optional[str] = Form(None),
    history:  Optional[str] = Form("[]"),
    file:     Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """AI chat to help configure the API dispatch settings."""
    from api.config import settings as app_settings
    api_key = app_settings.OPENAI_API_KEY.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")

    parts: list[str] = []
    if file and file.filename:
        raw = await file.read()
        extracted = _extract_text_from_upload(raw, file.filename)
        parts.append(f"[Attached file: {file.filename}]\n{extracted[:8000]}")

    if message and message.strip():
        parts.append(message.strip())

    if not parts:
        raise HTTPException(status_code=422, detail="Provide a message or file.")

    user_content = "\n\n".join(parts)

    try:
        hist = json.loads(history or "[]")
    except Exception:
        hist = []

    # Include current config as context
    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if cfg and cfg.endpoint_url:
        current = (
            f"\n\n[Current config: url={cfg.endpoint_url}, method={cfg.method}, "
            f"auth_type={cfg.auth_type}]"
        )
        user_content += current

    messages = [{"role": "system", "content": _AI_DISPATCH_SYSTEM}]
    for h in hist[-10:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": user_content})

    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.2,
        max_tokens=2000,
    )
    full_reply = (completion.choices[0].message.content or "").strip()

    # Parse CONFIG_JSON block
    config_out: dict = {}
    reply_text = full_reply
    marker = "CONFIG_JSON:"
    if marker in full_reply:
        idx = full_reply.index(marker)
        reply_text = full_reply[:idx].strip()
        json_part = full_reply[idx + len(marker):].strip()
        try:
            parsed = json.loads(json_part)
            config_out = {
                "endpoint_url":     parsed.get("endpoint_url"),
                "method":           parsed.get("method", "POST"),
                "content_type":     parsed.get("content_type", "application/xml"),
                "auth_type":        parsed.get("auth_type", "none"),
                "auth_value":       parsed.get("auth_value"),
                "auth_header_name": parsed.get("auth_header_name"),
                "extra_headers":    parsed.get("extra_headers"),
            }
        except Exception:
            pass

    return {"reply": reply_text, "config": config_out}
