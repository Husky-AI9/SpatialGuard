from spatialguard_api import mail


class FakeSes:
    def __init__(self):
        self.request = None

    def send_email(self, **request):
        self.request = request
        return {"MessageId": "test-message"}


def test_ses_https_delivery_is_preferred_over_smtp(monkeypatch):
    fake = FakeSes()
    captured = {}

    def client(service, **options):
        captured.update(service=service, **options)
        return fake

    monkeypatch.setenv("SPATIALGUARD_SMTP_FROM", "SpatialGuard <no-reply@spatialguards.click>")
    monkeypatch.setenv("SPATIALGUARD_SES_REGION", "us-east-1")
    monkeypatch.setenv("SPATIALGUARD_SES_ACCESS_KEY_ID", "test-access")
    monkeypatch.setenv("SPATIALGUARD_SES_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("SPATIALGUARD_SMTP_HOST", "smtp-must-not-be-used.example")
    monkeypatch.setattr(mail.boto3, "client", client)

    assert mail.send("Verify", "owner@example.com", "Follow the link") is True
    assert captured == {
        "service": "sesv2",
        "region_name": "us-east-1",
        "aws_access_key_id": "test-access",
        "aws_secret_access_key": "test-secret",
    }
    assert fake.request["Destination"] == {"ToAddresses": ["owner@example.com"]}
    assert fake.request["Content"]["Simple"]["Subject"]["Data"] == "Verify"


def test_mail_is_disabled_without_a_sender(monkeypatch):
    monkeypatch.delenv("SPATIALGUARD_SMTP_FROM", raising=False)
    assert mail.send("Verify", "owner@example.com", "Follow the link") is False
