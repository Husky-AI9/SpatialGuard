"""Transactional email through SES HTTPS or an SMTP fallback."""
import os
import smtplib
import ssl
from email.message import EmailMessage

import boto3


def _ses_send(subject: str, recipient: str, text: str, sender: str) -> bool:
    region = os.environ.get("SPATIALGUARD_SES_REGION")
    access_key = os.environ.get("SPATIALGUARD_SES_ACCESS_KEY_ID")
    secret_key = os.environ.get("SPATIALGUARD_SES_SECRET_ACCESS_KEY")
    if not region or not access_key or not secret_key:
        return False
    client = boto3.client(
        "sesv2",
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )
    client.send_email(
        FromEmailAddress=sender,
        Destination={"ToAddresses": [recipient]},
        Content={"Simple": {
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": text, "Charset": "UTF-8"}},
        }},
    )
    return True


def send(subject: str, recipient: str, text: str) -> bool:
    sender = os.environ.get("SPATIALGUARD_SMTP_FROM")
    if not sender:
        return False
    if os.environ.get("SPATIALGUARD_SES_REGION"):
        return _ses_send(subject, recipient, text, sender)
    host = os.environ.get("SPATIALGUARD_SMTP_HOST")
    if not host:
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
