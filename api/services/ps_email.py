"""
ps_email.py — SMTP email send service for PS workflows and chat.
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def send_email(smtp_host: str, smtp_port: int, smtp_user: str | None,
               smtp_pass: str | None, from_address: str,
               to: str, subject: str, body: str, use_tls: bool = True) -> dict:
    """
    Send an email via SMTP. body is plain text or HTML.
    Returns {"ok": True} or raises an exception.
    """
    msg = MIMEMultipart("alternative")
    msg["From"]    = from_address
    msg["To"]      = to
    msg["Subject"] = subject

    # Attach as both plain text and HTML so clients render properly
    plain = body.replace("<br>", "\n").replace("<br/>", "\n")
    # Strip basic HTML tags for plaintext version
    import re
    plain = re.sub(r"<[^>]+>", "", plain)
    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(body if "<" in body else body.replace("\n", "<br>"), "html"))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
        server.ehlo()
        if use_tls:
            server.starttls()
            server.ehlo()
        if smtp_user and smtp_pass:
            server.login(smtp_user, smtp_pass)
        server.sendmail(from_address, to, msg.as_string())

    return {"ok": True, "to": to, "subject": subject}
