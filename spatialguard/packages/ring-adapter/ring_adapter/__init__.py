"""Ring Partner API adapter.

The only module that knows Ring exists. It maps a Ring device to a logical
TwinForge ``source_id``; Ring device identifiers and raw provider payloads
never reach the engine's camera model.

Credentials and tokens live under the ignored ``.data/`` directory and are
never logged. Provider response bodies are not surfaced to the UI.
"""
from .credentials import AppCredentials, load_credentials
from .tokens import TokenStore, Tokens, RingAuthError
from .client import RingClient, RingUnavailable

__all__ = [
    "AppCredentials", "load_credentials",
    "TokenStore", "Tokens", "RingAuthError",
    "RingClient", "RingUnavailable",
]
