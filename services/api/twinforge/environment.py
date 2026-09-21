"""Server-only local configuration; never returned by the API."""
import os
from pathlib import Path


def load_environment(path=None):
    path = Path(path) if path else Path(__file__).resolve().parents[3] / ".env"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and key in {"OPENAI_API_KEY", "TWINFORGE_VISION_MODEL"}:
            os.environ[key] = value.strip().strip("\"'")
