"""Small SMTP adapter suitable for Railway-hosted transactional email."""
import os
import smtplib
import ssl
from email.message import EmailMessage


def send(subject: str, recipient: str, text: str) -> bool:
    host = os.environ.get("SPATIALGUARD_SMTP_HOST")
    sender = os.environ.get("SPATIALGUARD_SMTP_FROM")
    if not host or not sender:
        return False
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text)
    port = int(os.environ.get("SPATIALGUARD_SMTP_PORT", "587"))
    user = os.environ.get("SPATIALGUARD_SMTP_USER")
    password = os.environ.get("SPATIALGUARD_SMTP_PASSWORD")
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        if user:
            smtp.login(user, password or "")
        smtp.send_message(message)
    return True
