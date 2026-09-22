"""Guard the public TwinForge/SpatialGuard service boundary.

SpatialGuard may share immutable contract types and call the TwinForge SDK. It
must never import TwinForge persistence internals or discover its database.
"""
import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPATIALGUARD_API = ROOT / "spatialguard" / "services" / "api" / "spatialguard_api"


def test_spatialguard_uses_only_twinforge_contracts_and_public_sdk():
    forbidden_imports = []
    forbidden_storage_references = []
    allowed = {"twinforge.models", "twinforge.fixture", "twinforge_sdk"}
    for path in SPATIALGUARD_API.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [item.name for item in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            for name in names:
                if name.startswith("twinforge") and not any(
                    name == item or name.startswith(item + ".") for item in allowed
                ):
                    forbidden_imports.append((path.name, name))
        lowered = source.lower()
        for marker in ("twinforge.sqlite", ".data/twinforge", ".data\\\\twinforge"):
            if marker in lowered:
                forbidden_storage_references.append((path.name, marker))
    assert forbidden_imports == []
    assert forbidden_storage_references == []


def test_spatialguard_engine_adapter_calls_sdk_instead_of_database():
    source = (SPATIALGUARD_API / "engine.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported = {
        node.module for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert "twinforge_sdk" in imported
    assert "sqlite3" not in imported

