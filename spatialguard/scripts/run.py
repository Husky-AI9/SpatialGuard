"""Start the local SpatialGuard preview; run TwinForge on port 8000 first."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "spatialguard/services/api"
sys.path.insert(0, str(API))
sys.path.insert(0, str(ROOT / "packages/sdk-python"))
from spatialguard_api.engine import client
from spatialguard_api.store import Store, DATA

if not (ROOT / "spatialguard/apps/web/dist/index.html").exists():
    raise SystemExit("Build the frontend first: npm run build --workspace spatialguard-web")
Store()  # Create the local database; places are added by the owner, not at startup.
try:
    client().request("/v1/sites")
except Exception:
    raise SystemExit("TwinForge setup unavailable. Start scripts/run.py on port 8000, then retry SpatialGuard.") from None
env = {**os.environ, "PYTHONPATH": str(API) + os.pathsep + str(ROOT / "packages/sdk-python") + os.pathsep + str(ROOT / "services/api")}
processes = []
try:
    processes.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "spatialguard_api.api:create_app", "--factory", "--host", "127.0.0.1", "--port", "8010"], cwd=ROOT, env=env))
    processes.append(subprocess.Popen([sys.executable, "-m", "uvicorn", "spatialguard_api.ring_gateway:create_gateway", "--factory", "--host", "127.0.0.1", "--port", "8011", "--no-access-log", "--no-proxy-headers"], cwd=ROOT, env=env))
    processes.append(subprocess.Popen([sys.executable, "-m", "spatialguard_api.worker"], cwd=ROOT, env=env))
    (DATA / "runtime.json").write_text(json.dumps({"supervisor_pid": os.getpid(), "child_pids": [p.pid for p in processes]}))
    print("SpatialGuard: http://127.0.0.1:8010 — local replay preview", flush=True)
    while all(p.poll() is None for p in processes):
        time.sleep(.5)
finally:
    for process in processes:
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    (DATA / "runtime.json").unlink(missing_ok=True)
