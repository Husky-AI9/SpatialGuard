import base64
import hashlib
import hmac
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from twinforge.fixture import synthetic_layout
from spatialguard_api.store import Store, digest, dump, now
from spatialguard_api.ring_service import (
    RingService, capability_summary, configuration_summary, hardware_model,
    subscription_summary,
)
from spatialguard_api.ring_provider import Provider, WindowsVault
from spatialguard_api.ring_gateway import create_gateway
from spatialguard_api.ring_worker import _candidate_incident, process_one
from twinforge.models import Observation
from spatialguard_api.api import create_app
from spatialguard_api.models import IncidentClassification


class FakeProvider:
    creds = {'hmac signature key':'test-signature'}
    def __init__(self): self.calls=[]; self.grants=0; self.streams=0; self.snapshots=0
    def grant(self, **fields):
        self.grants+=1
        return {'access_token':'access-secret-'+str(self.grants), 'refresh_token':'refresh-secret-'+str(self.grants), 'expires_in':14400}
    def api(self, token, path, method='GET', body=None):
        self.calls.append((path,method,body))
        if path=='/v1/users/me': return {'data':{'type':'users','id':'account-a'}}
        if path=='/v1/accounts/me/subscriptions':
            return {'data':[{'type':'subscriptions','id':'subscription-a','attributes':{
                'sub_type':'paid','status':'active','plan_id':'private-plan-id',
                'expires_at':'2027-01-01T00:00:00Z'}}]}
        if path.startswith('/v1/devices?'):
            return {'data':[{'type':'devices','id':'device-a','attributes':{'name':'Front camera'},'relationships':{
                        'status':{'data':{'type':'device-status','id':'status-a'}},
                        'capabilities':{'data':{'type':'device-capabilities','id':'capabilities-a'}},
                        'configurations':{'data':{'type':'device-configurations','id':'configurations-a'}},
                    }}],
                    'included':[
                        {'type':'device-status','id':'status-a','attributes':{'online':True}},
                        {'type':'device-capabilities','id':'capabilities-a','attributes':{
                            'video':{'max_resolution':1080}, 'motion_detection':{},
                            'components':{'items':[{'component_id':'0'}]},
                        }},
                        {'type':'device-configurations','id':'configurations-a','attributes':{
                            'motion_detection':{'enabled':'on','motion_zones':[],'component_id':'0'},
                            'image_enhancements':{'privacy_zones':[]},
                        }},
                    ]}
        return {}
    def stream(self, token, device, sdp):
        self.streams+=1
        return 'v=0\r\na=sendonly\r\n','/v1/devices/device-a/media/streaming/whep/sessions/one'
    def snapshot(self, token, device, component=None, start_timestamp=None):
        self.snapshots += 1
        return b'\xff\xd8snapshot\xff\xd9', 'image/jpeg', {'X-Media-Timestamp': '123'}
    def close(self, token, path): self.calls.append((path,'DELETE',None))


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_TOKEN_KEY', 'w10pB0xMzbZywwobXsZpnjMDlaWkMii75wPXHMAZnBE=')
    return RingService(Store(tmp_path/'db.sqlite'),FakeProvider())


def nonce(service, stamp):
    return base64.urlsafe_b64encode(hmac.new(service.provider.creds['hmac signature key'].encode(), f'{stamp}:account-a'.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()


def connect(service, owner='owner'):
    service.exchange('one-time-code')
    stamp=str(int(time.time()*1000)-50)
    code=service.code(owner)['code']
    service.claim(code,nonce(service,stamp),stamp)
    return code,stamp


def mapped(service):
    connect(service)
    site={'id':'site_demo','name':'Home','revision_id':'rev_demo','layout':synthetic_layout().model_dump(mode='json'),
          'monitoring':{'enabled':True,'camera_ids':['camera_front']},'monitoring_version':0}
    with service.store.connect() as db:
        db.execute('INSERT INTO sites VALUES (?,?,?)',('site_demo','owner',dump(site)))
    service.devices('owner',True)
    service.mapping('owner','device-a','site_demo','camera_front')


def test_device_hardware_uses_product_artwork_not_owner_camera_names(service):
    assert hardware_model({'image_url': 'https://app-content.ring.com/devices/rvd_gen2_3x.png'}) == 'video_doorbell'
    assert hardware_model({'image_url': 'https://app-content.ring.com/devices/stick_up_cam_white.png'}) == 'stick_up_cam'
    assert hardware_model({'name': 'Doorbell'}) is None
    assert hardware_model({'image_url': 'https://other.example/rvd_gen2_3x.png'}) is None
    assert hardware_model({'image_url': 'https://app-content.ring.com/unknown.png'}) is None
    original_api = service.provider.api
    def api(*args, **kwargs):
        result = original_api(*args, **kwargs)
        if isinstance(result.get('data'), list):
            result['data'][0]['attributes']['image_url'] = 'https://app-content.ring.com/rvd_gen2_3x.png'
        return result
    service.provider.api = api
    mapped(service)
    assert service.devices('owner')[0]['hardware_model'] == 'video_doorbell'
    assert 'image_url' not in service.devices('owner')[0]
    with pytest.raises(HTTPException):
        service.devices('other')


def delivery(service, kind='motion_detected', rid='request-a', eid='event-a',
             device='device-a', at_ms=None):
    p={'meta':{'account_id':'account-a','request_id':rid},'data':{'id':eid,'type':kind,'attributes':{'source':device,'timestamp':at_ms or int(time.time()*1000),'sub_type':'motion'}}}
    raw=json.dumps(p).encode()
    sig='sha256='+hmac.new(service.provider.creds['hmac signature key'].encode(),raw,hashlib.sha256).hexdigest()
    return raw,sig


def test_dpapi_and_owner_authenticated_nonce_claim(service):
    code,stamp=connect(service)
    assert service.status('owner')['state']=='connected'
    assert service.status('other')['state']=='not_connected'
    with service.store.connect() as db:
        encrypted=db.execute('SELECT tokens FROM ring_accounts').fetchone()[0]
    assert b'access-secret' not in encrypted and b'refresh-secret' not in encrypted
    assert service.token('account-a').startswith('access-secret')
    assert [x[1] for x in service.provider.calls[-2:]]==['POST','PATCH']
    with pytest.raises(HTTPException):service.claim(code,nonce(service,stamp),stamp)


def test_rejects_wrong_owner_code_expired_future_and_forged_nonce(service):
    service.exchange('code')
    code=service.code('owner')['code']
    for stamp,n in [(str(int((time.time()-601)*1000)),None),(str(int((time.time()+100)*1000)),None),(str(int(time.time()*1000)),'x'*43)]:
        with pytest.raises(HTTPException):service.claim(code,n or nonce(service,stamp),stamp)
    with pytest.raises(HTTPException):service.claim('unknown','x'*43,str(int(time.time()*1000)))
    assert service.status('owner')['state']=='not_connected'


def test_gateway_has_no_owner_surface_and_validates_raw_signature(service):
    web=TestClient(create_gateway(service))
    for path in ['/','/v1/sites','/docs','/openapi.json','/v1/local-session']:
        assert web.get(path).status_code==404
    assert web.post('/v1/local-session',headers={'x-spatialguard-local':'1'}).status_code==404
    raw,sig=delivery(service)
    assert web.post('/ring/webhook',content=raw,headers={'x-signature':'sha256=bad'}).status_code==401
    assert web.post('/ring/webhook',content=raw,headers={'x-signature':sig}).status_code==200
    assert web.post('/ring/webhook',content=raw+b' ',headers={'x-signature':sig}).status_code==401
    assert web.post('/ring/token',content=b'x'*8200).status_code==413
    assert web.get('/ring/home').headers['cache-control']=='no-store'
    assert web.post('/ring/link',headers={'origin':'https://evil.test'}).status_code==403


def test_signed_malformed_webhook_is_rejected_before_queueing(service):
    raw=b'{"meta":{"account_id":"account-a"},"data":{"type":"motion_detected"}}'
    signature='sha256='+hmac.new(service.provider.creds['hmac signature key'].encode(),raw,hashlib.sha256).hexdigest()
    with pytest.raises(HTTPException, match='Malformed'):
        service.webhook(raw,signature)
    with service.store.connect() as db:
        assert db.execute('SELECT count(*) FROM ring_inbox').fetchone()[0]==0


def test_gateway_accepts_public_origin_behind_host_rewriting(service, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://spatialguard.example')
    web = TestClient(create_gateway(service))
    # Missing fields prove the request passed the origin check. Railway may
    # expose an internal Host while the browser uses the configured domain.
    assert web.post(
        '/ring/link',
        headers={'origin': 'https://spatialguard.example', 'host': 'internal.railway'},
    ).status_code == 400
    assert web.post(
        '/ring/link',
        headers={'origin': 'https://spatialguard.example', 'sec-fetch-site': 'cross-site'},
    ).status_code == 403


def test_hosted_app_exposes_ring_gateway_on_the_same_public_port(service):
    web = TestClient(create_app(service.store.path, ring_service=service))
    assert web.get('/ring/home').status_code == 200
    assert web.get('/ring/link').status_code == 200
    assert web.get('/ring/link').headers['referrer-policy'] == 'strict-origin'
    assert web.get('/health').headers['referrer-policy'] == 'no-referrer'


def test_hosted_link_form_claims_only_valid_signed_ring_account(service, monkeypatch):
    origin = 'https://spatialguard.example'
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', origin)
    monkeypatch.setenv('SPATIALGUARD_ALLOWED_HOSTS', 'spatialguard.example')
    web = TestClient(create_app(service.store.path, ring_service=service), base_url=origin)
    service.exchange('one-time-ring-grant')
    stamp = str(int(time.time()*1000)-50)
    data = {'code': service.code('owner')['code'], 'nonce': nonce(service, stamp), 'time': stamp}
    form = web.get('/ring/link', params={'nonce': data['nonce'], 'time': stamp})
    assert form.headers['referrer-policy'] == 'strict-origin'
    assert 'Open SpatialGuard to get a code' in form.text
    for bad_origin in ['null', 'http://spatialguard.example', 'https://evil.test']:
        assert web.post('/ring/link', data=data, headers={'origin': bad_origin}).status_code == 403
    assert service.status('owner')['state'] == 'not_connected'
    result = web.post('/ring/link', data=data, headers={'origin': origin, 'sec-fetch-site': 'same-origin'})
    assert result.status_code == 200
    assert 'Ring account connected' in result.text
    assert service.status('owner')['state'] == 'connected'
    assert service.status('owner')['public_url'] == origin
    assert web.post('/ring/link', data=data, headers={'origin': origin}).status_code == 401


def test_hosted_link_uses_one_time_signed_in_continuation(service, monkeypatch):
    origin = 'https://spatialguard.example'
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', origin)
    monkeypatch.setenv('SPATIALGUARD_ALLOWED_HOSTS', 'spatialguard.example')
    web = TestClient(create_app(service.store.path, ring_service=service), base_url=origin)
    browser_token = 'signed-in-browser-token'
    with service.store.connect() as db:
        db.execute('INSERT INTO accounts(id,email,password_hash,created,email_verified) VALUES (?,?,?,?,1)',
                   ('owner', 'owner@example.test', 'unused', now()))
        db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?)',
                   ('session-owner', 'owner', digest(browser_token), 'Browser', 'browser', time.time()+600))
    web.cookies.set('spatialguard_session', browser_token)
    service.exchange('one-time-ring-grant')
    stamp = str(int(time.time()*1000)-50)
    signed_nonce = nonce(service, stamp)
    form = web.get('/ring/link', params={'nonce': signed_nonce, 'time': stamp})
    assert 'owner@example.test' in form.text
    assert 'Continue and connect Ring' in form.text
    continuation = re.search(r'name="continuation" value="([^"]+)"', form.text).group(1)
    data = {'continuation': continuation, 'nonce': signed_nonce, 'time': stamp}
    result = web.post('/ring/link', data=data, headers={'origin': origin, 'sec-fetch-site': 'same-origin'})
    assert result.status_code == 200
    assert '/workspace?ring=connected' in result.text
    assert service.status('owner')['state'] == 'connected'
    replay = web.post('/ring/link', data=data, headers={'origin': origin, 'sec-fetch-site': 'same-origin'})
    assert replay.status_code == 401


def test_ring_transport_identifies_itself_and_allows_documented_device_query(monkeypatch):
    captured = {}

    class Response:
        headers = {}
        def read(self, limit): return b'{}'
        def __enter__(self): return self
        def __exit__(self, *args): pass

    class Opener:
        def open(self, request, timeout):
            captured['request'] = request
            return Response()

    monkeypatch.setattr('urllib.request.build_opener', lambda *args: Opener())
    provider = Provider({'client id':'id','client secret':'secret','hmac signature key':'hmac'})
    provider.send('https://oauth.ring.com/oauth/token', 'POST', b'grant',
                  content_type='application/x-www-form-urlencoded')
    assert captured['request'].get_header('User-agent') == 'SpatialGuard-Ring-Partner/1.0'

    provider.send = lambda *args, **kwargs: (b'{}', {})
    assert provider.api('token', '/v1/devices?include=status,capabilities,location') == {}
    with pytest.raises(ValueError):
        provider.api('token', 'https://evil.example/v1/devices')


def test_ring_whep_location_accepts_safe_relative_session_reference():
    provider = Provider({'client id':'id','client secret':'secret','hmac signature key':'hmac'})
    device = 'ava1.ring.device.example'
    collection = f'/v1/devices/{device}/media/streaming/whep/sessions'
    for location in (
        'session-one',
        collection + '/session-two',
        'https://api.amazonvision.com' + collection + '/session-three',
        'https://api.amazonvision.com' + collection + '/session-four?location=home-a',
    ):
        provider.send = lambda *args, location=location, **kwargs: (
            b'v=0\r\na=sendonly\r\n', {'Location': location}
        )
        _, path = provider.stream('token', device, 'v=0\r\nm=video')
        assert path.startswith(collection + '/')
        if 'location=' in location:
            assert path.endswith('?location=home-a')

    for location in (
        'https://evil.example/session',
        collection + '/session?token=secret',
        collection + '/nested/session',
        '../outside',
        '',
    ):
        provider.send = lambda *args, location=location, **kwargs: (
            b'v=0\r\na=sendonly\r\n', {'Location': location}
        )
        with pytest.raises(HTTPException, match='invalid media session'):
            provider.stream('token', device, 'v=0\r\nm=video')


def test_jsonapi_inventory_and_site_mapping_isolation(service):
    mapped(service)
    devices=service.devices('owner')
    assert devices[0]['status']['online'] is True
    assert devices[0]['camera_id']=='camera_front'
    assert devices[0]['support']=={
        'live_view': True, 'snapshots': True,
        'motion_events': True, 'multi_camera': False,
    }
    assert devices[0]['configuration']['privacy_zones']=='clear'
    status=service.status('owner')
    assert status['subscription']['state']=='active_paid'
    assert status['subscription']['eligible'] is True
    assert 'private-plan-id' not in json.dumps(status)
    with pytest.raises(HTTPException):service.devices('other')
    with pytest.raises(HTTPException):service.mapping('owner','device-a','wrong-site','camera_front')
    with pytest.raises(HTTPException):service.mapping('owner','device-a','site_demo','missing-camera')
    with pytest.raises(HTTPException):service.mapping('owner','unauthorized-device','site_demo','camera_hall')


def test_legacy_cached_device_refreshes_before_media_use(service):
    mapped(service)
    with service.store.connect() as db:
        row = db.execute("SELECT data FROM ring_devices WHERE device='device-a'").fetchone()
        legacy = json.loads(row['data'])
        legacy.pop('support')
        legacy.pop('configuration')
        legacy.pop('guidance')
        db.execute("UPDATE ring_devices SET data=? WHERE device='device-a'", (dump(legacy),))
    service.provider.calls.clear()

    device = service.devices('owner')[0]

    assert device['configuration']['privacy_zones'] == 'clear'
    assert device['support']['live_view'] is True
    assert any(path.startswith('/v1/devices?') for path, _, _ in service.provider.calls)
    answer = service.stream('owner', 'device-a', 'v=0\r\nm=video 9\r\na=recvonly')
    assert answer['sdp'].startswith('v=0')


def test_capability_and_privacy_state_fail_closed_for_media(service):
    assert capability_summary({})['live_view'] is False
    assert configuration_summary({})['privacy_zones']=='unknown'
    assert subscription_summary({'data':[]})['eligible'] is True
    mapped(service)
    with service.store.connect() as db:
        row=db.execute("SELECT data FROM ring_devices WHERE device='device-a'").fetchone()
        data=json.loads(row['data'])
        data['configuration']['privacy_zones']='active'
        db.execute("UPDATE ring_devices SET data=? WHERE device='device-a'",(dump(data),))
    with pytest.raises(HTTPException, match='privacy-zone'):
        service.snapshot('owner','site_demo','camera_front')
    stream = service.stream('owner','device-a','v=0\r\nm=video 9\r\na=recvonly')
    assert stream['sdp'].startswith('v=0')
    assert service.provider.snapshots==0 and service.provider.streams==1


def test_subscription_webhook_reconciles_authoritative_state(service):
    mapped(service); engine=Engine()
    original=service.provider.api
    def api(token,path,method='GET',body=None):
        if path=='/v1/accounts/me/subscriptions': return {'data':[]}
        return original(token,path,method,body)
    service.provider.api=api
    service.webhook(*delivery(service,kind='subscription_deactivated',rid='sub-off',eid='sub-off'))
    assert process_one(service,engine)
    assert service.status('owner')['subscription']['state']=='not_active'
    with service.store.connect() as db:
        row=db.execute("SELECT state,processed,error FROM ring_inbox WHERE kind='subscription_deactivated'").fetchone()
    assert row['state']=='succeeded' and row['processed'] and row['error'] is None


def test_operations_tracks_health_delay_recovery_and_saved_wall(service):
    mapped(service)
    initial = service.operations('owner')
    assert initial['devices'][0]['online'] is True
    assert initial['devices'][0]['uptime_percent'] == 100.0
    assert initial['wall'] == ['device-a']

    service.update_operations_preferences('owner', {
        'delay_seconds': 60, 'browser_enabled': True,
        'email_enabled': True, 'email': 'owner@example.test',
    })
    service.webhook(*delivery(service, kind='device_offline', rid='offline-a', eid='offline-a'))
    delayed = service.operations('owner')
    assert delayed['devices'][0]['online'] is False
    assert delayed['alerts'] == []

    # Recovery inside the selected delay suppresses the noisy offline alert.
    service.webhook(*delivery(service, kind='device_online', rid='online-a', eid='online-a'))
    recovered = service.operations('owner')
    assert recovered['devices'][0]['online'] is True
    assert recovered['alerts'] == []
    with service.store.connect() as db:
        assert db.execute("SELECT count(*) FROM ring_alerts WHERE kind='offline'").fetchone()[0] == 0

    service.webhook(*delivery(service, kind='device_offline', rid='offline-b', eid='offline-b'))
    with service.store.connect() as db:
        db.execute("UPDATE ring_alerts SET notify_at=? WHERE kind='offline'", (time.time() - 1,))
    assert service.operations('owner')['alerts'][0]['kind'] == 'offline'
    service.webhook(*delivery(service, kind='device_online', rid='online-b', eid='online-b'))
    assert [item['kind'] for item in service.operations('owner')['alerts'][:2]] == ['recovered', 'offline']

    service.save_camera_wall('owner', ['device-a', 'device-a'])
    assert service.operations('owner')['wall'] == ['device-a']
    with pytest.raises(HTTPException, match='unauthorized'):
        service.save_camera_wall('owner', ['device-other'])


def test_timelapse_project_captures_private_frame_and_builds_reel(service, tmp_path, monkeypatch):
    from PIL import Image
    from spatialguard_api import ring_service as module

    mapped(service)
    monkeypatch.setattr(module, 'DATA', tmp_path / 'private-data')
    project = service.create_timelapse('owner', {
        'device': 'device-a', 'site': 'site_demo', 'camera': 'camera_front',
        'name': 'Front garden', 'cadence_minutes': 60,
        'start_hour': 7, 'end_hour': 19, 'timezone': 'America/Phoenix',
    })
    frame = service.capture_timelapse('owner', project)
    with service.store.connect() as db:
        path = db.execute('SELECT path FROM timelapse_frames WHERE id=?', (frame,)).fetchone()['path']
    Image.new('RGB', (32, 18), '#5966a8').save(path, format='JPEG')
    payload, media_type = service.timelapse_frame('owner', project, frame)
    assert payload.startswith(b'\xff\xd8') and media_type == 'image/jpeg'
    assert service.timelapse_reel('owner', project).startswith(b'GIF8')
    assert service.operations('owner')['projects'][0]['frame_count'] == 1
    with pytest.raises(HTTPException):
        service.timelapse_frame('other', project, frame)
    service.delete_timelapse('owner', project)
    assert not (tmp_path / 'private-data' / 'timelapse' / project).exists()


def test_latest_snapshot_is_owner_scoped_and_short_lived_cached(service):
    mapped(service)
    first = service.snapshot('owner', 'site_demo', 'camera_front')
    second = service.snapshot('owner', 'site_demo', 'camera_front')
    assert first[0].startswith(b'\xff\xd8') and first[1] == 'image/jpeg'
    assert first[2]['X-Media-Timestamp'] == '123'
    assert second == first
    assert service.provider.snapshots == 1
    with pytest.raises(HTTPException):
        service.snapshot('other', 'site_demo', 'camera_front')
    with pytest.raises(HTTPException):
        service.snapshot('owner', 'site_demo', 'missing')


class Engine:
    def __init__(self):self.observed={}
    def observations(self, values):
        for o in values:
            old=self.observed.setdefault(o['observation_id'],o)
            assert old==o


def test_duplicate_events_survive_restart_unknown_location_preserved(service):
    mapped(service);engine=Engine()
    service.webhook(*delivery(service))
    service.webhook(*delivery(service,rid='redelivery'))
    restarted=RingService(service.store,service.provider)
    assert process_one(restarted,engine)
    assert not process_one(restarted,engine)
    with service.store.connect() as db:
        incidents=db.execute('SELECT data FROM incidents').fetchall()
        assert len(incidents)==1
        incident=json.loads(incidents[0][0])
        assert incident['evidence_mode']=='live' and not incident['evidence_ids']
        assert incident['observations'][0]['location']['kind']=='unknown'
        assert not incident['associations']
        assert db.execute("SELECT count(*) FROM events WHERE kind='incident.created'").fetchone()[0]==1


def test_pipeline_metrics_measure_ack_queue_incident_and_duplicate(service):
    mapped(service); engine=Engine()
    raw,signature=delivery(service)
    service.webhook(raw,signature)
    service.webhook(raw,signature)
    assert process_one(service,engine)
    token='metrics-session-token'
    with service.store.connect() as db:
        db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?)',
                   ('metrics-session','owner',digest(token),'Metrics test','android',time.time()+600))
    client=TestClient(create_app(service.store.path,ring_service=service),
                      headers={'authorization':'Bearer '+token})
    response=client.get('/v1/ring/pipeline-metrics')
    assert response.status_code==200
    metrics=response.json()
    assert metrics['sample_size']==1
    assert metrics['duplicates_suppressed']==1
    assert metrics['webhook_ack_latency_ms']['sample_size']==2
    assert metrics['queue_latency_ms']['sample_size']==1
    assert metrics['incident_creation_latency_ms']['sample_size']==1
    assert metrics['error_rate_percent']==0
    assert metrics['provider_session_leaks']==0


def test_live_multicamera_events_share_fixed_five_minute_incident(service):
    mapped(service);engine=Engine()
    with service.store.connect() as db:
        site=json.loads(db.execute('SELECT data FROM sites WHERE id=?',('site_demo',)).fetchone()[0])
        side=dict(site['layout']['cameras'][0])
        side.update(id='camera_side',name='Side camera',configuration_hash='side-fixture')
        site['layout']['cameras'].append(side)
        site['monitoring']['camera_ids']=['camera_front','camera_hall','camera_side']
        db.execute('UPDATE sites SET data=? WHERE id=?',(dump(site),'site_demo'))
        for device,camera in [('device-b','camera_hall'),('device-c','camera_side')]:
            db.execute('INSERT INTO ring_devices(account,device,data,site,camera) VALUES (?,?,?,?,?)',
                       ('account-a',device,dump({'id':device,'name':camera}),'site_demo',camera))

    # The fixed window is the complete incident span, not five minutes after
    # every new event. Exactly 300 seconds stays together; 301 starts anew.
    base=int((time.time()-700)*1000)
    for index,(device,offset) in enumerate([
        # Deliver the first three out of chronological order to match webhook reality.
        ('device-c',300),('device-a',0),('device-b',150),('device-a',301)
    ]):
        service.webhook(*delivery(
            service,rid=f'multi-request-{index}',eid=f'multi-event-{index}',
            device=device,at_ms=base+offset*1000,
        ))
    while process_one(service,engine):
        pass

    with service.store.connect() as db:
        rows=db.execute('SELECT data FROM incidents ORDER BY seq').fetchall()
        emitted=db.execute("SELECT kind,resource FROM events WHERE kind LIKE 'incident.%' ORDER BY seq").fetchall()
    assert len(rows)==2
    grouped=json.loads(rows[0][0])
    assert [o['source_id'] for o in grouped['observations']]==[
        'camera_front','camera_hall','camera_side'
    ]
    assert len(grouped['associations'])==2
    assert all(a['state']=='possible' for a in grouped['associations'])
    assert [a['unobserved_gap_seconds'] for a in grouped['associations']]==[150,150]
    assert 'fixed five-minute window' in grouped['rule']
    assert json.loads(rows[1][0])['observations'][0]['source_id']=='camera_front'
    assert [e['kind'] for e in emitted]==[
        'incident.created','incident.updated','incident.updated','incident.created'
    ]


def test_live_incidents_never_correlate_across_ring_accounts(service):
    mapped(service); engine=Engine()
    service.webhook(*delivery(service))
    assert process_one(service, engine)
    with service.store.connect() as db:
        incident = json.loads(db.execute('SELECT data FROM incidents').fetchone()[0])
        observation = Observation.model_validate(incident['observations'][0])
        same_id, _ = _candidate_incident(db, 'site_demo', 'rev_demo', observation, 'account-a')
        other_id, _ = _candidate_incident(db, 'site_demo', 'rev_demo', observation, 'account-b')
        assert same_id == incident['id']
        assert other_id is None
        stored = db.execute('SELECT account_digest FROM live_incident_accounts').fetchone()[0]
        assert stored == digest('account-a') and 'account-a' not in stored


def test_live_grouping_is_site_scoped_and_new_evidence_reopens_review(service):
    mapped(service);engine=Engine()
    with service.store.connect() as db:
        first=json.loads(db.execute('SELECT data FROM sites WHERE id=?',('site_demo',)).fetchone()[0])
        second={**first,'id':'site_other','name':'Other home'}
        db.execute('INSERT INTO sites VALUES (?,?,?)',('site_other','owner',dump(second)))
        db.execute('INSERT INTO ring_devices(account,device,data,site,camera) VALUES (?,?,?,?,?)',
                   ('account-a','device-other',dump({'id':'device-other'}),'site_other','camera_front'))

    stamp=int((time.time()-60)*1000)
    service.webhook(*delivery(service,rid='site-a',eid='site-a',at_ms=stamp))
    assert process_one(service,engine)
    with service.store.connect() as db:
        row=db.execute("SELECT id,data FROM incidents WHERE site_id='site_demo'").fetchone()
        reviewed=json.loads(row['data']);reviewed['status']='reviewed';reviewed['reviewed_at']=now()
        db.execute('UPDATE incidents SET data=? WHERE id=?',(dump(reviewed),row['id']))

    service.webhook(*delivery(service,rid='site-b',eid='site-b',device='device-other',at_ms=stamp+1000))
    assert process_one(service,engine)
    with service.store.connect() as db:
        assert db.execute('SELECT count(*) FROM incidents').fetchone()[0]==2

    service.webhook(*delivery(service,rid='site-a-followup',eid='site-a-followup',at_ms=stamp+2000))
    assert process_one(service,engine)
    with service.store.connect() as db:
        incident=json.loads(db.execute("SELECT data FROM incidents WHERE site_id='site_demo'").fetchone()[0])
    assert incident['status']=='needs_review' and incident['reviewed_at'] is None
    assert len(incident['observations'])==2


def test_enabled_luna_classifier_labels_event_without_storing_snapshot(service):
    mapped(service);engine=Engine()
    with service.store.connect() as db:
        site=json.loads(db.execute('SELECT data FROM sites').fetchone()[0])
        site['monitoring']['classification_enabled']=True
        db.execute('UPDATE sites SET data=?',(dump(site),))
    service.webhook(*delivery(service,eid='classified-event',rid='classified-request'))
    calls=[]
    def classify(image, media_type):
        calls.append((image,media_type))
        return IncidentClassification(
            label='delivery_activity',display_label='Possible delivery',confidence='medium',
            summary='A person appears to place a parcel near the entrance.',
            visible_evidence=['Parcel-shaped object'],uncertainty='Uniform is not readable.',
            model='gpt-5.6-luna',response_id='resp_fixture',analyzed_at='2026-09-19T00:00:00Z')
    assert process_one(service,engine,classify)
    with service.store.connect() as db:
        raw=db.execute('SELECT data FROM incidents').fetchone()[0]
        incident=json.loads(raw)
    assert calls==[(b'\xff\xd8snapshot\xff\xd9','image/jpeg')]
    assert incident['title']=='Possible delivery'
    assert incident['classification_status']=='completed'
    assert incident['classification']['label']=='delivery_activity'
    assert incident['evidence_ids']==[]
    assert 'data:image' not in raw.lower()
    assert 'jpeg-bytes' not in raw.lower()


def test_pause_and_resume_cancels_queued_live_incident(service):
    mapped(service);service.webhook(*delivery(service))
    with service.store.connect() as db:
        site=json.loads(db.execute('SELECT data FROM sites').fetchone()[0]);site['monitoring_version']=2
        db.execute('UPDATE sites SET data=?',(dump(site),))
    assert process_one(service,Engine())
    with service.store.connect() as db:assert db.execute('SELECT count(*) FROM incidents').fetchone()[0]==0


def test_revocation_blocks_stream_and_pending_incident(service):
    mapped(service);service.webhook(*delivery(service))
    stream=service.stream('owner','device-a','v=0\r\nm=video 9 RTP/AVP 96\r\na=recvonly\r\n')
    service.webhook(*delivery(service,kind='app_integration_removed',eid='removed',rid='removed'))
    assert service.status('owner')['state']=='revoked'
    with pytest.raises(HTTPException):service.token('account-a')
    with service.store.connect() as db:
        assert db.execute('SELECT tokens FROM ring_accounts').fetchone()[0] is None
        assert db.execute('SELECT state FROM ring_streams WHERE id=?',(stream['id'],)).fetchone()[0]=='revoked'
    process_one(service,Engine())
    with service.store.connect() as db:assert db.execute('SELECT count(*) FROM incidents').fetchone()[0]==0


def test_device_removal_closes_media_and_worker_records_lifecycle(service):
    mapped(service); engine=Engine()
    stream=service.stream('owner','device-a','v=0\r\nm=video 9\r\na=recvonly')
    service.webhook(*delivery(service,kind='device_removed',eid='device-removed',rid='device-removed'))
    with service.store.connect() as db:
        assert db.execute("SELECT 1 FROM ring_devices WHERE device='device-a'").fetchone() is None
        assert db.execute('SELECT expires FROM ring_streams WHERE id=?',(stream['id'],)).fetchone()['expires']==0
    assert process_one(service,engine)
    with service.store.connect() as db:
        assert db.execute("SELECT state FROM ring_inbox WHERE kind='device_removed'").fetchone()['state']=='succeeded'


def test_worker_failure_has_bounded_retries_and_dead_letter_metric(service):
    mapped(service)
    class FailingEngine:
        def observations(self, values): raise RuntimeError('private payload must not escape')
    service.webhook(*delivery(service,eid='poison-event',rid='poison-request'))
    for _ in range(3):
        assert process_one(service,FailingEngine())
        with service.store.connect() as db:
            db.execute("UPDATE ring_inbox SET lease=0 WHERE id=?",(digest('account-a:poison-event'),))
    assert not process_one(service,FailingEngine())
    with service.store.connect() as db:
        row=db.execute("SELECT state,attempts,error FROM ring_inbox WHERE id=?",(digest('account-a:poison-event'),)).fetchone()
        metric=db.execute("SELECT count FROM ring_telemetry WHERE account=? AND name='dead_letters'",('account-a',)).fetchone()
    assert row['state']=='failed' and row['attempts']==3
    assert row['error']=='Processing failed; retry is bounded'
    assert metric['count']==1


def test_stream_authorization_concurrency_and_expiry_cleanup(service):
    mapped(service)
    with pytest.raises(HTTPException):service.stream('other','device-a','v=0\r\nm=video 9\r\na=recvonly')
    with pytest.raises(HTTPException):service.stream('owner','device-a','v=0\r\nm=audio 9\r\na=recvonly')
    r=service.stream('owner','device-a','v=0\r\nm=video 9\r\na=recvonly')
    assert r['expires_at']<time.time()+26
    with pytest.raises(HTTPException):service.stream('owner','device-a','v=0\r\nm=video 9\r\na=recvonly')
    with pytest.raises(HTTPException):service.close_stream('other',r['id'])
    with service.store.connect() as db:db.execute('UPDATE ring_streams SET expires=0')
    replacement=service.stream('owner','device-a','v=0\r\nm=video 9\r\na=recvonly')
    assert replacement['id']!=r['id']
    service.cleanup()
    assert service.provider.calls[-1][1]=='DELETE'


def test_owner_api_refuses_forwarded_auto_login_and_cross_owner_access(service):
    mapped(service)
    app=create_app(service.store.path,ring_service=service)
    c=TestClient(app)
    assert c.post('/v1/local-session',headers={'x-spatialguard-local':'1','x-forwarded-for':'1.2.3.4'}).status_code==403
    assert c.get('/v1/ring').status_code==401
    c.headers['x-spatialguard-local']='1'
    assert c.post('/v1/local-session').status_code==200
    assert c.get('/v1/ring').json()['state']=='not_connected'
    assert c.get('/v1/ring/devices').status_code==409


def test_request_logs_and_errors_redact_customer_and_ring_data(service, caplog):
    app=create_app(service.store.path,ring_service=service)
    client=TestClient(app)
    secrets_in_request={
        'email':'private-owner@example.test',
        'password':'password-secret-value',
    }
    with caplog.at_level('INFO', logger='spatialguard.request'):
        response=client.post('/v1/auth/signin?device=ava1.ring.device.secret',json=secrets_in_request,
                             headers={'x-spatialguard-client':'android','x-request-id':'bad@email'})
    combined='\n'.join(record.getMessage() for record in caplog.records)
    assert response.status_code==401
    for private in (*secrets_in_request.values(),'ava1.ring.device.secret','bad@email'):
        assert private not in combined
        assert private not in response.text
    record=json.loads(caplog.records[-1].getMessage())
    assert record['route']=='/v1/auth/signin' and record['status']==401
    assert set(record)=={'event','method','route','status','duration_ms','request_id'}


def test_maintenance_mode_preserves_health_and_blocks_application(service, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_MAINTENANCE_MODE','true')
    client=TestClient(create_app(service.store.path,ring_service=service))
    assert client.get('/health').status_code==200
    blocked=client.get('/v1/ring')
    assert blocked.status_code==503 and blocked.headers['retry-after']=='300'
    assert 'maintenance' in blocked.json()['detail'].lower()


def test_refresh_rotation_is_persisted_and_deduplicated(service):
    connect(service)
    with service.store.connect() as db:
        r=db.execute('SELECT tokens FROM ring_accounts').fetchone()
        t=service.vault.open(r[0]);t['expires_at']=0
        db.execute('UPDATE ring_accounts SET tokens=?',(service.vault.seal(t),))
    assert service.token('account-a')=='access-secret-2'
    assert RingService(service.store,service.provider).token('account-a')=='access-secret-2'
    assert service.provider.grants==2
