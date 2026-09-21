"""Durable OAuth token storage with rotation-safe writes.

Ring rotates the refresh token on every refresh and invalidates the previous
one, so losing the newest token means re-linking the account. Every write
lands on disk before the old token is discarded.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

TOKEN_URL = "https://oauth.ring.com/oauth/token"
# Refresh early: an access token that expires mid-request is a failed poll.
REFRESH_MARGIN_SECONDS = 600


class RingAuthError(Exception):
    """Linking or refresh failed. The owner must link the account again."""


@dataclass
class Tokens:
    access_token: str
    refresh_token: str
    expires_at: float
    obtained_at: float

    @property
    def stale(self) -> bool:
        return time.time() >= self.expires_at - REFRESH_MARGIN_SECONDS

    def __repr__(self) -> str:  # Secrets must not reach logs or tracebacks.
        return f"Tokens(expires_in={int(self.expires_at - time.time())}s)"


class TokenStore:
    """Holds one account's tokens on disk and keeps them fresh."""

    def __init__(self, path, credentials, opener=None):
        self.path = Path(path)
        self.credentials = credentials
        # Injectable so tests never reach the network.
        self._opener = opener or self._post

    def read(self):
        if not self.path.exists():
            return None
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return Tokens(**data)

    def write(self, tokens: Tokens):
        """Write atomically so a crash cannot leave a truncated token file."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(asdict(tokens)), encoding="utf-8")
        os.replace(temporary, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass  # Best effort; Windows ACLs differ.

    def clear(self):
        self.path.unlink(missing_ok=True)

    def _post(self, fields):
        body = urllib.parse.urlencode(fields).encode()
        request = urllib.request.Request(
            TOKEN_URL, data=body, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    def _call(self, fields):
        """Run the grant request. A 4xx means the grant is dead, whatever the
        transport; the provider's response body never leaves this adapter."""
        try:
            return self._opener(fields)
        except urllib.error.HTTPError as error:
            if 400 <= error.code < 500:
                raise RingAuthError("Ring rejected the grant; link the account again") from None
            raise

    def _store(self, payload) -> Tokens:
        if not payload.get("access_token") or not payload.get("refresh_token"):
            raise RingAuthError("Ring did not return a usable token pair")
        now = time.time()
        tokens = Tokens(
            access_token=payload["access_token"],
            refresh_token=payload["refresh_token"],
            # Default to the documented ~4 hours when the field is absent.
            expires_at=now + float(payload.get("expires_in", 14400)),
            obtained_at=now,
        )
        self.write(tokens)  # Persist before returning: the old token is now dead.
        return tokens

    def exchange(self, code, redirect_uri=None, code_verifier=None) -> Tokens:
        """Trade a one-time authorization code for the first token pair."""
        fields = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": self.credentials.client_id,
            "client_secret": self.credentials.client_secret,
        }
        if redirect_uri:
            fields["redirect_uri"] = redirect_uri
        if code_verifier:
            fields["code_verifier"] = code_verifier
        return self._store(self._call(fields))

    def refresh(self) -> Tokens:
        current = self.read()
        if not current:
            raise RingAuthError("No Ring account is linked")
        return self._store(self._call({
            "grant_type": "refresh_token",
            "refresh_token": current.refresh_token,
            "client_id": self.credentials.client_id,
            "client_secret": self.credentials.client_secret,
        }))

    def access_token(self) -> str:
        """Current access token, refreshed when it is close to expiring."""
        current = self.read()
        if not current:
            raise RingAuthError("No Ring account is linked")
        if current.stale:
            current = self.refresh()
        return current.access_token
