"""Load media-free examples from the authenticated tenant's private data directory."""

import hashlib
from pathlib import Path
from pydantic import ValidationError
from .models import LocalExample
from .geometry import validate_layout


def example_directory(data_dir: Path, tenant: str) -> Path:
    # Tenant IDs cannot become filesystem paths.
    return data_dir / "examples" / hashlib.sha256(tenant.encode()).hexdigest()


def local_examples(data_dir: Path, tenant: str) -> dict[str, LocalExample]:
    examples = {}
    for path in sorted(example_directory(data_dir, tenant).glob("*.json")):
        if path.is_symlink() or path.stat().st_size > 2_000_000:
            continue
        try:
            example = LocalExample.model_validate_json(path.read_text(encoding="utf-8"))
            layout = example.layout
            entities = layout.rooms + layout.zones + layout.portals + layout.cameras
            # Assets need site ownership and cannot be copied into a new site.
            if layout.asset_ids or layout.floor_plan or any(e.provenance.source_ids for e in entities):
                continue
            if validate_layout(layout):
                continue
            examples[example.id] = example
        except (OSError, ValueError, ValidationError):
            continue
    return examples
