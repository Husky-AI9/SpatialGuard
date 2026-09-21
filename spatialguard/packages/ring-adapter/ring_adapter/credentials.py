"""Load the app credentials Ring issues once, at app creation."""
import csv
from dataclasses import dataclass
from pathlib import Path

# The console exports a two-column key/value CSV.
FIELDS = {
    "client id": "client_id",
    "client secret": "client_secret",
    "hmac signature key": "hmac_signing_key",
    "hmac key": "hmac_signing_key",
}


@dataclass(frozen=True)
class AppCredentials:
    client_id: str
    client_secret: str
    hmac_signing_key: str

    @property
    def staging(self) -> bool:
        """Test apps are issued a ``test_`` client id."""
        return self.client_id.startswith("test_")

    def __repr__(self) -> str:  # Never let a secret reach a log or traceback.
        return f"AppCredentials(client_id={self.client_id!r}, staging={self.staging})"


def load_credentials(path) -> AppCredentials:
    """Read the Download CSV from the Ring developer console."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"No Ring credentials at {path}. Create an app in the Ring developer "
            "console and save its Download CSV there."
        )
    found = {}
    # utf-8-sig: the console's export carries a BOM.
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.reader(handle):
            if len(row) < 2:
                continue
            key = FIELDS.get(row[0].strip().lower())
            if key and row[1].strip():
                found[key] = row[1].strip()
    missing = {"client_id", "client_secret", "hmac_signing_key"} - found.keys()
    if missing:
        raise ValueError(
            "Ring credentials file is missing: " + ", ".join(sorted(missing))
        )
    return AppCredentials(**found)
