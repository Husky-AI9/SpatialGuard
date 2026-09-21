"""Run an opt-in Cloudflare Quick Tunnel for ONLY the Ring gateway on 8011."""
import hashlib
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'spatialguard/services/api'))
from spatialguard_api.store import Store, DATA

VERSION='2026.9.1'
SHA256='2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712'
target=DATA/'tools/cloudflared.exe'
target.parent.mkdir(parents=True,exist_ok=True)
if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest()!=SHA256:
    print('Downloading the pinned Cloudflare tunnel client...',flush=True)
    temp=target.with_suffix('.download')
    urllib.request.urlretrieve(f'https://github.com/cloudflare/cloudflared/releases/download/{VERSION}/cloudflared-windows-amd64.exe',temp)
    if hashlib.sha256(temp.read_bytes()).hexdigest()!=SHA256:
        raise SystemExit('Cloudflare client checksum mismatch; refusing to execute')
    temp.replace(target)

# Fail closed if the dedicated gateway is unavailable. Never switch to the owner port.
with urllib.request.urlopen('http://127.0.0.1:8011/ring/home',timeout=3) as r:
    if b'SpatialGuard' not in r.read(): raise SystemExit('Ring gateway not available')

runtime=DATA/'ring-tunnel.json'
log=DATA/'ring-tunnel-client.log'
store=Store()
process=None
try:
    with log.open('w',encoding='utf-8') as output:
        process=subprocess.Popen([str(target),'tunnel','--url','http://127.0.0.1:8011','--no-autoupdate','--protocol','http2'],
            cwd=ROOT,stdout=output,stderr=output,creationflags=subprocess.CREATE_NO_WINDOW)
    runtime.write_text(json.dumps({'pid':process.pid,'supervisor_pid':__import__('os').getpid(),'url':None}))
    url=None
    for _ in range(120):
        if process.poll() is not None: raise SystemExit('Cloudflare exited; see the private tunnel client log')
        match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',log.read_text(encoding='utf-8'))
        if match:
            url=match.group(0);break
        time.sleep(.5)
    if not url: raise SystemExit('Timed out obtaining the development tunnel URL')
    with store.connect() as db:
        db.execute("INSERT OR REPLACE INTO settings VALUES ('ring_public_url',?)",(url,))
    runtime.write_text(json.dumps({'pid':process.pid,'supervisor_pid':__import__('os').getpid(),'url':url}))
    print('Ring gateway: '+url,flush=True)
    for label,path in [('Account Link','link'),('App Homepage','home'),('Token Exchange','token'),('Webhook','webhook')]:
        print(label+': '+url+'/ring/'+path,flush=True)
    process.wait()
finally:
    if process and process.poll() is None: process.terminate()
    with store.connect() as db: db.execute("DELETE FROM settings WHERE key='ring_public_url'")
    runtime.unlink(missing_ok=True)
