# ═══════════════════════════════════════════════════════════
# api/routers/api_dispatch.py
#  Dispatch generated output to:
#    • API   — HTTP endpoint (bearer / api-key / basic / oauth2 / none)
#    • SFTP  — SSH file transfer (paramiko, optional)
#    • Azure Blob — Azure Storage (azure-storage-blob, optional)
# ═══════════════════════════════════════════════════════════
import io
import json
import ssl
import time as _time
import base64
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Form, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.database import get_db
from api.models import ApiDispatchConfig, ApiDispatchLog, GeneratedXml
from api.services.encryption import encrypt, decrypt

from api.dependencies import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])

MAX_RETRIES    = 2        # reduced: 1 attempt + 1 retry
RETRY_WAIT_S   = 1        # 1-second gap between retries
HTTP_TIMEOUT_S = 10       # per-request HTTP timeout (was 30s)
DISPATCH_WORKERS = 10     # parallel dispatch threads
RESPONSE_SIZE  = 131072   # 128 KB max response body kept in DB

# ══════════════════════════════════════════════════════════════
# Pydantic schemas
# ══════════════════════════════════════════════════════════════

class DispatchConfigIn(BaseModel):
    dispatch_type:    str           = "api"   # api|sftp|azure_blob
    # ── API fields ──────────────────────────────────────────
    endpoint_url:     Optional[str] = None
    method:           str           = "POST"
    content_type:     str           = "application/xml"
    auth_type:        str           = "none"          # none|bearer|apikey|basic|oauth2
    auth_value:       Optional[str] = None            # plain — encrypted at rest
    auth_header_name: Optional[str] = None            # for apikey type
    extra_headers:    Optional[str] = None            # JSON string
    # ── SFTP fields ──────────────────────────────────────────
    sftp_host:        Optional[str] = None
    sftp_port:        Optional[int] = 22
    sftp_username:    Optional[str] = None
    sftp_password:    Optional[str] = None            # plain — encrypted at rest
    sftp_remote_path: Optional[str] = None            # e.g. /uploads/{identifier}.xml
    # ── Azure Blob fields ────────────────────────────────────
    azure_conn_str:   Optional[str] = None            # plain — encrypted at rest
    azure_container:  Optional[str] = None
    azure_blob_prefix:Optional[str] = None            # e.g. "output/{identifier}"


class DispatchConfigOut(BaseModel):
    id:               Optional[int]  = None
    dispatch_type:    str            = "api"
    # API
    endpoint_url:     Optional[str]  = None
    method:           str            = "POST"
    content_type:     str            = "application/xml"
    auth_type:        str            = "none"
    has_auth_value:   bool           = False
    auth_header_name: Optional[str]  = None
    extra_headers:    Optional[str]  = None
    # SFTP
    sftp_host:        Optional[str]  = None
    sftp_port:        Optional[int]  = 22
    sftp_username:    Optional[str]  = None
    has_sftp_password:bool           = False
    sftp_remote_path: Optional[str]  = None
    # Azure Blob
    has_azure_conn_str: bool         = False
    azure_container:  Optional[str]  = None
    azure_blob_prefix:Optional[str]  = None


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
# Helpers — HTTP dispatch
# ══════════════════════════════════════════════════════════════

def _build_headers(cfg: ApiDispatchConfig) -> dict[str, str]:
    """Build request headers including Content-Type and auth."""
    hdrs: dict[str, str] = {
        "Content-Type": cfg.content_type or "application/xml",
        "Accept": "*/*",
        "User-Agent": "ClarityStudio/2.0",
    }
    auth_val = decrypt(cfg.auth_value_enc) or "" if cfg.auth_value_enc else ""
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
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    t0 = _time.time()
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S, context=ctx) as resp:
        elapsed = int((_time.time() - t0) * 1000)
        resp_body = resp.read(RESPONSE_SIZE).decode("utf-8", errors="replace")
        return resp.status, resp_body, elapsed


def _send_with_retry(
    url: str, method: str, headers: dict, body: str
) -> tuple[str, int, str, int, int, Optional[str]]:
    """Returns: (status, http_code, response_body, elapsed_ms, retry_count, error_msg)"""
    body_bytes = body.encode("utf-8")
    last_error: Optional[str] = None
    retries = 0
    for attempt in range(MAX_RETRIES):
        retries = attempt
        try:
            http_status, resp_body, elapsed = _http_send(url, method, headers, body_bytes)
            return "success", http_status, resp_body, elapsed, retries, None
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read(8192).decode("utf-8", errors="replace")
            except Exception:
                pass
            last_error = f"HTTP {e.code} {e.reason}"
            if e.code < 500:
                return "fail", e.code, err_body, 0, retries, last_error
        except Exception as exc:
            last_error = str(exc)
        if attempt < MAX_RETRIES - 1:
            _time.sleep(RETRY_WAIT_S)
    return "fail", 0, "", 0, retries, last_error


# ══════════════════════════════════════════════════════════════
# Helpers — SFTP dispatch
# ══════════════════════════════════════════════════════════════

def _sftp_send(cfg: ApiDispatchConfig, content: str,
               identifier_value: Optional[str]) -> tuple[str, Optional[str]]:
    """
    Upload content via SFTP. Returns (status, error_message).
    Uses paramiko. If not installed, returns ("fail", "paramiko not installed").
    """
    try:
        import paramiko  # type: ignore
    except ImportError:
        return "fail", "paramiko not installed. Run: pip install paramiko"

    host     = cfg.sftp_host or ""
    port     = cfg.sftp_port or 22
    username = cfg.sftp_username or ""
    password = decrypt(cfg.sftp_password_enc) if cfg.sftp_password_enc else ""
    raw_path = cfg.sftp_remote_path or "/upload/{identifier}.dat"

    # Substitute {identifier} placeholder in remote path
    safe_id = (identifier_value or "record").replace("/", "_").replace("\\", "_")
    remote_path = raw_path.replace("{identifier}", safe_id)

    try:
        transport = paramiko.Transport((host, int(port)))
        transport.connect(username=username, password=password)
        sftp = paramiko.SFTPClient.from_transport(transport)

        # Ensure parent directory exists
        parent = remote_path.rsplit("/", 1)[0]
        if parent and parent != remote_path:
            try:
                sftp.makedirs(parent)
            except Exception:
                pass  # directory may already exist

        with sftp.file(remote_path, "w") as fh:
            fh.write(content)

        sftp.close()
        transport.close()
        return "success", None
    except Exception as exc:
        return "fail", str(exc)


# ══════════════════════════════════════════════════════════════
# Helpers — Azure Blob dispatch
# ══════════════════════════════════════════════════════════════

def _azure_send(cfg: ApiDispatchConfig, content: str,
                identifier_value: Optional[str],
                fmt: str = "xml") -> tuple[str, Optional[str]]:
    """
    Upload content to Azure Blob Storage. Returns (status, error_message).
    Uses azure-storage-blob. If not installed, returns ("fail", "...").
    """
    try:
        from azure.storage.blob import BlobServiceClient  # type: ignore
    except ImportError:
        return "fail", "azure-storage-blob not installed. Run: pip install azure-storage-blob"

    conn_str  = decrypt(cfg.azure_conn_str_enc) if cfg.azure_conn_str_enc else ""
    container = cfg.azure_container or ""
    prefix    = cfg.azure_blob_prefix or "{identifier}"
    ext_map   = {"xml": ".xml", "json": ".json", "text": ".txt", "sql": ".sql"}
    ext       = ext_map.get(fmt, ".dat")

    if not conn_str:
        return "fail", "Azure connection string not configured."
    if not container:
        return "fail", "Azure container name not configured."

    safe_id  = (identifier_value or "record").replace("/", "_").replace("\\", "_")
    blob_name = prefix.replace("{identifier}", safe_id) + ext

    try:
        client = BlobServiceClient.from_connection_string(conn_str)
        blob   = client.get_blob_client(container=container, blob=blob_name)
        blob.upload_blob(content.encode("utf-8"), overwrite=True)
        return "success", None
    except Exception as exc:
        return "fail", str(exc)


# ══════════════════════════════════════════════════════════════
# Helpers — serialization
# ══════════════════════════════════════════════════════════════

def _cfg_to_out(cfg: ApiDispatchConfig) -> DispatchConfigOut:
    return DispatchConfigOut(
        id=cfg.id,
        dispatch_type=cfg.dispatch_type or "api",
        endpoint_url=cfg.endpoint_url,
        method=cfg.method or "POST",
        content_type=cfg.content_type or "application/xml",
        auth_type=cfg.auth_type or "none",
        has_auth_value=bool(cfg.auth_value_enc),
        auth_header_name=cfg.auth_header_name,
        extra_headers=cfg.extra_headers,
        sftp_host=cfg.sftp_host,
        sftp_port=cfg.sftp_port or 22,
        sftp_username=cfg.sftp_username,
        has_sftp_password=bool(cfg.sftp_password_enc),
        sftp_remote_path=cfg.sftp_remote_path,
        has_azure_conn_str=bool(cfg.azure_conn_str_enc),
        azure_container=cfg.azure_container,
        azure_blob_prefix=cfg.azure_blob_prefix,
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


def _dispatch_one(cfg: ApiDispatchConfig, xml_row: GeneratedXml, fmt: str = "xml"
                  ) -> tuple[str, int, str, int, int, Optional[str]]:
    """
    Route dispatch to the correct handler based on cfg.dispatch_type.
    Returns: (status, http_code, response_body, elapsed_ms, retry_count, error_msg)
    http_code / elapsed_ms / retry_count are 0 for non-HTTP transports.
    """
    dt  = (cfg.dispatch_type or "api").lower()
    body = xml_row.xml_content or ""

    if dt == "sftp":
        t0 = _time.time()
        status, err = _sftp_send(cfg, body, xml_row.identifier_value)
        elapsed = int((_time.time() - t0) * 1000)
        resp = "OK" if status == "success" else (err or "Unknown error")
        return status, 0, resp, elapsed, 0, err

    if dt == "azure_blob":
        t0 = _time.time()
        status, err = _azure_send(cfg, body, xml_row.identifier_value, fmt)
        elapsed = int((_time.time() - t0) * 1000)
        resp = "OK" if status == "success" else (err or "Unknown error")
        return status, 0, resp, elapsed, 0, err

    # Default: API / HTTP
    if not cfg.endpoint_url:
        return "fail", 0, "", 0, 0, "No API endpoint configured."
    headers = _build_headers(cfg)
    return _send_with_retry(
        url=cfg.endpoint_url,
        method=cfg.method or "POST",
        headers=headers,
        body=body,
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

    cfg.dispatch_type    = body.dispatch_type or "api"
    cfg.endpoint_url     = (body.endpoint_url or "").strip() or None
    cfg.method           = body.method or "POST"
    cfg.content_type     = body.content_type or "application/xml"
    cfg.auth_type        = body.auth_type or "none"
    cfg.auth_header_name = body.auth_header_name or None
    cfg.extra_headers    = body.extra_headers or None

    if body.auth_value is not None:
        cfg.auth_value_enc = encrypt(body.auth_value) if body.auth_value.strip() else None

    # SFTP
    cfg.sftp_host        = (body.sftp_host or "").strip() or None
    cfg.sftp_port        = body.sftp_port or 22
    cfg.sftp_username    = (body.sftp_username or "").strip() or None
    cfg.sftp_remote_path = (body.sftp_remote_path or "").strip() or None
    if body.sftp_password is not None:
        cfg.sftp_password_enc = encrypt(body.sftp_password) if body.sftp_password.strip() else None

    # Azure Blob
    cfg.azure_container   = (body.azure_container or "").strip() or None
    cfg.azure_blob_prefix = (body.azure_blob_prefix or "").strip() or None
    if body.azure_conn_str is not None:
        cfg.azure_conn_str_enc = encrypt(body.azure_conn_str) if body.azure_conn_str.strip() else None

    db.commit()
    db.refresh(cfg)
    return _cfg_to_out(cfg)


# ══════════════════════════════════════════════════════════════
# XMLs list with latest dispatch status
# ══════════════════════════════════════════════════════════════

@router.get("/dispatch/{conn_id}/xmls", response_model=list[XmlDispatchRow])
def list_dispatch_xmls(conn_id: int, limit: int = 200, offset: int = 0, db: Session = Depends(get_db)):
    from sqlalchemy import text as _sa_text

    # Fetch only the lightweight columns — never load xml_content
    xml_rows = (
        db.query(
            GeneratedXml.id,
            GeneratedXml.identifier_value,
            GeneratedXml.validation_status,
        )
        .filter(GeneratedXml.conn_id == conn_id)
        .order_by(GeneratedXml.id)
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Latest dispatch log per xml_id — single SQL query with ROW_NUMBER
    if xml_rows:
        xml_ids = [r[0] for r in xml_rows]
        # Use a subquery to get the latest log per xml_id in one round-trip
        latest_logs = (
            db.query(
                ApiDispatchLog.xml_id,
                ApiDispatchLog.id,
                ApiDispatchLog.status,
                ApiDispatchLog.response_status,
                ApiDispatchLog.response_time_ms,
                ApiDispatchLog.retry_count,
            )
            .filter(
                ApiDispatchLog.conn_id == conn_id,
                ApiDispatchLog.xml_id.in_(xml_ids),
            )
            .order_by(ApiDispatchLog.xml_id, ApiDispatchLog.id.desc())
            .all()
        )
        latest_log: dict[int, tuple] = {}
        for log in latest_logs:
            if log.xml_id not in latest_log:
                latest_log[log.xml_id] = log
    else:
        latest_log = {}

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
# Send single record
# ══════════════════════════════════════════════════════════════

@router.post("/dispatch/{conn_id}/send/{xml_id}", response_model=DispatchLogOut)
def send_single(conn_id: int, xml_id: int, db: Session = Depends(get_db)):
    """Send one generated record to the configured destination."""
    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if not cfg:
        raise HTTPException(status_code=400, detail="No dispatch config saved. Configure dispatch first.")

    xml_row = db.query(GeneratedXml).filter(
        GeneratedXml.id == xml_id,
        GeneratedXml.conn_id == conn_id,
    ).first()
    if not xml_row:
        raise HTTPException(status_code=404, detail="Record not found.")

    from api.models import XmlTemplate as _XmlTpl
    _tpl = (db.query(_XmlTpl).filter(_XmlTpl.conn_id == conn_id)
              .order_by(_XmlTpl.id.desc()).first())
    fmt = (_tpl.format_type or "xml") if _tpl else "xml"

    status, http_code, resp_body, elapsed_ms, retries, err = _dispatch_one(cfg, xml_row, fmt)

    log = ApiDispatchLog(
        conn_id=conn_id,
        xml_id=xml_id,
        identifier_value=xml_row.identifier_value,
        status=status,
        request_body=(xml_row.xml_content or "")[:65536],
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
# Send all records
# ══════════════════════════════════════════════════════════════

@router.post("/dispatch/{conn_id}/send-all")
def send_all(conn_id: int, db: Session = Depends(get_db)):
    """Send generated output to the configured destination.
    For XML format: only sends records with validation_status='pass'.
    For other formats (JSON/text/SQL): sends all generated records.
    """
    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if not cfg:
        raise HTTPException(status_code=400, detail="No dispatch config saved. Configure dispatch first.")

    # Determine format from template to decide filtering strategy
    from api.models import XmlTemplate as _XmlTpl
    _tpl = (db.query(_XmlTpl).filter(_XmlTpl.conn_id == conn_id)
              .order_by(_XmlTpl.id.desc()).first())
    fmt     = (_tpl.format_type or "xml") if _tpl else "xml"
    is_xml  = (fmt == "xml")
    dt      = (cfg.dispatch_type or "api").lower()

    # For API dispatch: validate config
    if dt == "api":
        from api.services.validation_guard import validate_api_config
        _headers: dict = {}
        try:
            _headers = json.loads(cfg.extra_headers or "{}")
        except Exception:
            pass
        _vr = validate_api_config(cfg.endpoint_url or "", cfg.method, _headers, cfg.auth_type or "none")
        if not _vr.passed:
            raise HTTPException(status_code=422, detail={
                "message": "API config failed validation", "errors": _vr.errors})
    elif dt == "sftp":
        if not cfg.sftp_host:
            raise HTTPException(status_code=400, detail="SFTP host not configured.")
    elif dt == "azure_blob":
        if not cfg.azure_conn_str_enc:
            raise HTTPException(status_code=400, detail="Azure connection string not configured.")

    q = db.query(GeneratedXml).filter(GeneratedXml.conn_id == conn_id)
    if is_xml:
        q = q.filter(GeneratedXml.validation_status == "pass")
    xml_rows = q.order_by(GeneratedXml.id).all()

    if not xml_rows:
        if is_xml:
            raise HTTPException(
                status_code=400,
                detail="No validated XMLs found. Run Validation first to mark records as 'pass'.",
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="No generated output found. Run 'Generate All' in the Output tab first.",
            )

    results = []
    sent = failed = 0

    for x in xml_rows:
        status, http_code, resp_body, elapsed_ms, retries, err = _dispatch_one(cfg, x, fmt)
        log = ApiDispatchLog(
            conn_id=conn_id,
            xml_id=x.id,
            identifier_value=x.identifier_value,
            status=status,
            request_body=(x.xml_content or "")[:65536],
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
            "xml_id":           x.id,
            "identifier_value": x.identifier_value,
            "status":           status,
            "http_code":        http_code,
            "retries":          retries,
            "error":            err,
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
Your job is to help the user configure a dispatch destination to send generated data.

Dispatch types:
- "api"        → HTTP API endpoint
- "sftp"       → SFTP file transfer
- "azure_blob" → Azure Blob Storage

Configuration fields depend on dispatch_type:

For "api":
- endpoint_url, method (POST/PUT/PATCH), content_type, auth_type (none/bearer/apikey/basic/oauth2),
  auth_value, auth_header_name, extra_headers (JSON string)

For "sftp":
- sftp_host, sftp_port (default 22), sftp_username, sftp_password, sftp_remote_path
  (e.g. "/uploads/{identifier}.xml" — {identifier} is substituted per record)

For "azure_blob":
- azure_conn_str (Azure Storage connection string), azure_container, azure_blob_prefix
  (e.g. "output/{identifier}" — extension added automatically)

When the user describes their integration:
1. Explain what you understood.
2. Return a CONFIG_JSON block:

CONFIG_JSON:
{
  "dispatch_type": "api",
  "endpoint_url": "https://...",
  "method": "POST",
  "content_type": "application/xml",
  "auth_type": "bearer",
  "auth_value": null,
  "auth_header_name": null,
  "extra_headers": null,
  "sftp_host": null,
  "sftp_port": 22,
  "sftp_username": null,
  "sftp_password": null,
  "sftp_remote_path": null,
  "azure_conn_str": null,
  "azure_container": null,
  "azure_blob_prefix": null
}

Always include CONFIG_JSON even when partially filled. Use null for unknown values.
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
    """AI chat to help configure the dispatch settings."""
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

    cfg = db.query(ApiDispatchConfig).filter(ApiDispatchConfig.conn_id == conn_id).first()
    if cfg:
        current = (
            f"\n\n[Current config: type={cfg.dispatch_type or 'api'}, "
            f"url={cfg.endpoint_url}, sftp_host={cfg.sftp_host}, "
            f"azure_container={cfg.azure_container}]"
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

    config_out: dict = {}
    reply_text = full_reply
    marker = "CONFIG_JSON:"
    if marker in full_reply:
        idx = full_reply.index(marker)
        reply_text = full_reply[:idx].strip()
        json_part = full_reply[idx + len(marker):].strip()
        try:
            parsed = json.loads(json_part)
            config_out = {k: parsed.get(k) for k in (
                "dispatch_type", "endpoint_url", "method", "content_type",
                "auth_type", "auth_value", "auth_header_name", "extra_headers",
                "sftp_host", "sftp_port", "sftp_username", "sftp_password", "sftp_remote_path",
                "azure_conn_str", "azure_container", "azure_blob_prefix",
            )}
        except Exception:
            pass

    return {"reply": reply_text, "config": config_out}
