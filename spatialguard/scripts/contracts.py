import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'spatialguard/services/api'))
from spatialguard_api.api import create_app
target=ROOT/'spatialguard/packages/contracts/openapi.json'
target.parent.mkdir(parents=True,exist_ok=True)
target.write_text(json.dumps(create_app().openapi(),indent=2),encoding='utf-8')
print('SpatialGuard OpenAPI generated')
from spatialguard_api.ring_gateway import create_gateway
gateway_target=ROOT/'spatialguard/packages/contracts/ring-gateway-openapi.json'
gateway_target.write_text(json.dumps(create_gateway().openapi(),indent=2),encoding='utf-8')
print('Public Ring gateway OpenAPI generated (documentation endpoint is not exposed)')
