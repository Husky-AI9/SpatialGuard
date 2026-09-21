import json
import time
import pytest
from fastapi.testclient import TestClient
from urllib.error import HTTPError
from twinforge.fixture import synthetic_layout, replay
from twinforge.geometry import query_layout, validate_layout
from twinforge.models import Layout, PointQuery
from spatialguard_api.api import TEST_ACCOUNT_EMAIL, create_app
from spatialguard_api.engine import RING_FOV_DEGREES, relens
from spatialguard_api.store import cleanup_retention, dump, digest, Store
from spatialguard_api.worker import process_one


class Engine:
    """Stands in for TwinForge, running its real layout validation on every publish."""
    def __init__(self):
        self.saved={}
        self.fail=False
        self.down=False
        self.drafts={}
        self.versions={}
        self.assets={}
        self.jobs={}
        self.sites=0
        self.published={}
        self.deleted=[]
        self.vision_available=True
        self.vision_fails=False
    def request(self,path,method='GET',body=None,version=None):
        if path.endswith('/replay-fixture'):
            return {'observations': replay('site_demo','rev_demo')}
        if self.down: raise RuntimeError('engine unavailable')
        if path.endswith('/revisions') and method=='POST':
            layout=Layout.model_validate(body['layout'])
            if validate_layout(layout): raise HTTPError(path,422,'invalid_geometry',None,None)
            rid='rev_%d'%(len(self.drafts)+1)
            self.drafts[rid]=layout;self.versions[rid]=1
            return {'revision_id':rid,'version':1,'state':'draft','parent_revision_id':body['parent_revision_id']}
        if path.endswith('/publish') and method=='POST':
            rid=path.split('/')[3];layout=self.drafts[rid]
            assert version==self.versions[rid],'publish must pin the current draft version'
            if validate_layout(layout,True): raise HTTPError(path,422,'publish_blocked',None,None)
            self.versions[rid]+=1
            return {'revision_id':rid,'state':'published','version':self.versions[rid],'layout':layout.model_dump(mode='json')}
        if path.startswith('/v1/sites/') and method=='DELETE' and path.count('/')==3:
            self.deleted.append(path.split('/')[3])
            return None
        if path=='/v1/sites' and method=='POST':
            self.sites+=1
            return {'id':'site_traced_%d'%self.sites,'name':body['name']}
        if path.endswith('/assets') and method=='POST':
            import base64
            content=base64.b64decode(body['data_base64'],validate=True)
            assert body['consent']=='owner_approved' and body['license']
            aid='asset_%d'%(len(self.assets)+1)
            self.assets[aid]=(body['media_type'],content)
            return {'asset_id':aid,'name':body['name'],'media_type':body['media_type']}
        if path.endswith('/revisions') and method=='GET':
            site=path.split('/')[3]
            return [{'revision_id':r,'state':'published','version':2} for r in self.published.get(site,[])]
        if path.endswith('/fixture') and method=='POST':
            site=path.split('/')[3]
            rid='rev_fixture_%d'%(len(self.drafts)+1)
            self.drafts[rid]=synthetic_layout();self.versions[rid]=1
            self.published.setdefault(site,[]).append(rid)
            return {'revision_id':rid,'version':1,'state':'draft'}
        if path=='/v1/generation-options':
            return {'vision_available':self.vision_available}
        if path.endswith('/imports') and method=='POST':
            assert body['kind']=='floorplan_raster'
            jid='job_%d'%(len(self.jobs)+1)
            self.jobs[jid]={'job_id':jid,'state':'queued','output':None,'error':None,
                'asset':body['asset_id'],'height':body['ceiling_height_m'],'site':path.split('/')[3],
                'vision':body['vision_assisted']}
            return {'job_id':jid,'state':'queued'}
        if path.startswith('/v1/jobs/') and path.endswith('/cancel'):
            job=self.jobs[path.split('/')[3]]
            if job['state'] in ('queued','running'): job['state']='cancelled'
            return {'job_id':job['job_id'],'state':job['state']}
        if path.startswith('/v1/jobs/'):
            return self.run_job(self.jobs[path.split('/')[3]])
        if path.startswith('/v1/revisions/') and method=='GET':
            rid=path.split('/')[3]
            return {'revision_id':rid,'version':self.versions[rid],'state':'draft','layout':self.drafts[rid].model_dump(mode='json')}
        if path.startswith('/v1/revisions/') and path.endswith('/replay-fixture'):
            return {'observations': replay('site_demo','rev_demo')}
        if path.startswith('/v1/revisions/') and method=='PATCH':
            rid=path.split('/')[3]
            layout=Layout.model_validate(body)
            if validate_layout(layout): raise HTTPError(path,422,'invalid_geometry',None,None)
            self.drafts[rid]=layout;self.versions[rid]+=1
            return {'revision_id':rid,'version':self.versions[rid]}
        raise AssertionError('unexpected engine call: '+method+' '+path)

    def run_job(self,job):
        """Trace on demand with TwinForge's real generator, one poll after queueing."""
        if job['state']=='queued':
            job['state']='running'
            return dict(job,output=None)
        if job['state']=='running':
            from PIL import Image
            import io
            from twinforge.floorplan import generate_layout
            media_type,content=self.assets[job['asset']]
            with Image.open(io.BytesIO(content)) as image:
                layout,report=generate_layout(image,asset_id=job['asset'],ceiling_height_m=job['height'])
            rid='rev_traced_%d'%len(self.drafts)
            self.drafts[rid]=layout;self.versions[rid]=1
            if job['vision'] and not self.vision_fails:
                report.update(backend='openai_vision_v1',vision_status='completed',label_reader='vision')
            elif job['vision']:
                report.update(vision_status='failed',vision_error='The vision proposal could not be validated.',
                    warning='The vision proposal could not be validated. Local generation was used instead. ')
            job.update(state='needs_review',output={'revision_id':rid,**report})
        return job

    def asset(self,asset_id):
        return self.assets[asset_id]
    def observations(self,observations):
        if self.fail: raise RuntimeError('engine unavailable')
        for obs in observations:
            old=self.saved.setdefault(obs['observation_id'],obs)
            assert old==obs
    def query(self,revision,query):
        return query_layout(synthetic_layout(),PointQuery.model_validate(query))


@pytest.fixture
def setup(tmp_path):
    engine=Engine();app=create_app(tmp_path/'sg.sqlite',engine);store=app.state.store
    site={'id':'site_demo','name':'Demo home','revision_id':'rev_demo','layout':synthetic_layout().model_dump(mode='json'),
        'monitoring':{'enabled':True,'camera_ids':['camera_front','camera_hall']},'evidence_mode':'replay','ring_status':'not_connected'}
    with store.connect() as db: db.execute('INSERT INTO sites VALUES (?,?,?)',('site_demo','local_owner',dump(site)))
    browser=TestClient(app,headers={'X-SpatialGuard-Local':'1','Origin':'http://127.0.0.1:8010'})
    assert browser.post('/v1/local-session').status_code==200
    return app,browser,store,engine


def run(setup,key='test-request-1234'):
    app,c,store,engine=setup
    r=c.post('/v1/sites/site_demo/replay',json={'request_id':key});assert r.status_code==202,r.text
    assert process_one(store,engine)
    result=c.get('/v1/sites/site_demo/runs/'+r.json()['id']).json()
    assert result['state']=='succeeded',result
    return result


def test_replay_persistence_review_and_evidence(setup):
    app,c,store,engine=setup;result=run(setup)
    i=c.get('/v1/incidents/'+result['incident_id']).json()
    assert len(i['observations'])==12 and len(i['associations'])==1
    assert i['associations'][0]['state']=='possible'
    assert sum(o['location']['kind']=='unknown' for o in i['observations'])==2
    assert i['calibration_ids']==[] and i['revision_id']=='rev_demo'
    assert c.get('/v1/evidence/'+i['evidence_ids'][0]+'/image').status_code==200
    assert c.post('/v1/incidents/'+i['id']+'/review',json={}).json()['status']=='reviewed'
    restarted=TestClient(create_app(store.path,engine),headers=c.headers,cookies=c.cookies)
    assert restarted.get('/v1/incidents/'+i['id']).json()['status']=='reviewed'
    assert restarted.get('/v1/sites/site_demo/incidents').json()['incidents'][0]['id']==i['id']


def test_duplicate_delivery_and_worker_recovery(setup):
    app,c,store,engine=setup;result=run(setup)
    assert c.post('/v1/sites/site_demo/replay',json={'request_id':'test-request-1234'}).json()['id']==result['id']
    with store.connect() as db: db.execute("UPDATE runs SET state='running',lease=0 WHERE id=?",(result['id'],))
    assert process_one(store,engine)
    assert len(engine.saved)==12
    assert len(c.get('/v1/sites/site_demo/incidents').json()['incidents'])==1
    events=c.get('/v1/sites/site_demo/events').json()
    assert len([e for e in events['events'] if e['kind']=='incident.created'])==1
    assert c.get('/v1/sites/site_demo/events?after='+str(events['cursor'])).json()['events']==[]


def test_monitoring_and_camera_selection(setup):
    app,c,store,engine=setup
    assert c.patch('/v1/sites/site_demo/monitoring',json={'enabled':True,'camera_ids':['foreign']}).status_code==422
    assert c.patch('/v1/sites/site_demo/monitoring',json={'enabled':False,'camera_ids':['camera_front']}).status_code==200
    assert c.post('/v1/sites/site_demo/replay',json={'request_id':'paused-request'}).status_code==409
    c.patch('/v1/sites/site_demo/monitoring',json={'enabled':True,'camera_ids':['camera_front']})
    result=run(setup)
    data=c.get('/v1/incidents/'+result['incident_id']).json()
    assert {o['source_id'] for o in data['observations']}=={'camera_front'}
    assert data['associations']==[]


def test_pause_queued_job(setup):
    app,c,store,engine=setup
    r=c.post('/v1/sites/site_demo/replay',json={'request_id':'pause-queued'}).json()
    c.patch('/v1/sites/site_demo/monitoring',json={'enabled':False,'camera_ids':['camera_front','camera_hall']})
    process_one(store,engine)
    assert c.get('/v1/sites/site_demo/runs/'+r['id']).json()['state']=='paused'
    assert not engine.saved


def test_pause_and_resume_does_not_resurrect_queued_authorization(setup):
    app,c,store,engine=setup
    r=c.post('/v1/sites/site_demo/replay',json={'request_id':'pause-resume'}).json()
    for enabled in [False,True]:
        c.patch('/v1/sites/site_demo/monitoring',json={'enabled':enabled,'camera_ids':['camera_front','camera_hall']})
    process_one(store,engine)
    assert c.get('/v1/sites/site_demo/runs/'+r['id']).json()['state']=='paused'
    assert not engine.saved


def pair(c):
    code=c.post('/v1/pairing').json()['code']
    r=c.post('/v1/pairing/redeem',json={'code':code,'name':'Test Android'})
    assert r.status_code==200
    return code,r.json()


def test_pairing_single_use_renewal_revocation(setup):
    app,c,store,engine=setup;code,data=pair(c)
    device=TestClient(app,headers={'Authorization':'Bearer '+data['token']})
    assert device.get('/v1/me').status_code==200
    assert c.post('/v1/pairing/redeem',json={'code':code}).status_code==401
    assert device.post('/v1/pairing').status_code==403
    renewed=device.post('/v1/sessions/renew').json()
    assert device.get('/v1/me').status_code==401
    device.headers['Authorization']='Bearer '+renewed['token']
    assert device.get('/v1/me').status_code==200
    c.delete('/v1/sessions/'+renewed['session']['id'])
    assert device.get('/v1/sites').status_code==401


def test_pairing_expiry_rate_limit_and_auth_boundaries(setup):
    app,c,store,engine=setup;code=c.post('/v1/pairing').json()['code']
    with store.connect() as db: db.execute('UPDATE pairing SET expires=0')
    assert c.post('/v1/pairing/redeem',json={'code':code}).status_code==401
    for _ in range(9): c.post('/v1/pairing/redeem',json={'code':'000000000000'})
    assert c.post('/v1/pairing/redeem',json={'code':'000000000000'}).status_code==429
    outsider=TestClient(app)
    assert outsider.get('/v1/sites').status_code==401
    assert outsider.post('/v1/local-session').status_code==403
    assert c.post('/v1/local-session',headers={'Origin':'https://evil.example'}).status_code==403
    assert c.get('/v1/sites',headers={'Host':'evil.example'}).status_code==400


def test_hosted_email_signup_signin_and_signout_use_a_same_origin_cookie(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    app = create_app(tmp_path/'hosted.sqlite', Engine())
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    })
    credentials = {'email': 'Owner@Example.com', 'password': 'correct-password'}
    signup = client.post('/v1/auth/signup', json=credentials)
    assert signup.status_code == 201, signup.text
    assert signup.json()['token'] is None
    assert signup.json()['session']['email'] == 'owner@example.com'
    assert 'Secure' in signup.headers['set-cookie']
    assert client.get('/v1/me').json()['email'] == 'owner@example.com'
    assert client.post('/v1/pairing').status_code == 200
    assert client.post('/v1/auth/signup', json=credentials).status_code == 409
    assert client.post('/v1/auth/signout').status_code == 204
    assert client.get('/v1/me').status_code == 401
    assert client.post('/v1/auth/signin', json={**credentials, 'password': 'wrong-password'}).status_code == 401
    signin = client.post('/v1/auth/signin', json={**credentials, 'email': 'OWNER@example.com'})
    assert signin.status_code == 200
    assert client.get('/v1/me').json()['email'] == 'owner@example.com'
    assert client.post('/v1/hosted-session', json={'access_code': 'old-code'}).status_code == 404


def test_password_reset_is_neutral_single_use_and_revokes_sessions(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    app = create_app(tmp_path/'reset.sqlite', Engine())
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    })
    credentials = {'email': 'owner@example.com', 'password': 'old-password'}
    assert client.post('/v1/auth/signup', json=credentials).status_code == 201
    unknown = client.post('/v1/auth/password/request', json={'email':'missing@example.com'})
    known = client.post('/v1/auth/password/request', json={'email':credentials['email']})
    assert known.json() == unknown.json()
    with app.state.store.connect() as db:
        row = db.execute("SELECT * FROM auth_tokens WHERE purpose='password_reset'").fetchone()
        assert row and len(row['digest']) == 64
        # Tests cannot reverse a digest; replace it with a known token digest.
        db.execute("UPDATE auth_tokens SET digest=? WHERE purpose='password_reset'", (digest('known-reset-token-value-123456'),))
    reset = client.post('/v1/auth/password/reset', json={
        'token':'known-reset-token-value-123456', 'password':'new-password',
    })
    assert reset.status_code == 200
    assert client.get('/v1/me').status_code == 401
    assert client.post('/v1/auth/password/reset', json={
        'token':'known-reset-token-value-123456', 'password':'another-password',
    }).status_code == 400
    assert client.post('/v1/auth/signin', json={
        'email':credentials['email'], 'password':'new-password',
    }).status_code == 200


def test_email_verification_token_is_hashed_single_use(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    app = create_app(tmp_path/'verify.sqlite', Engine())
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    })
    assert client.post('/v1/auth/signup', json={
        'email':'owner@example.com', 'password':'secure-password',
    }).status_code == 201
    assert client.get('/v1/account/verification').json()['verified'] is False
    with app.state.store.connect() as db:
        row = db.execute("SELECT * FROM auth_tokens WHERE purpose='email_verification'").fetchone()
        assert row and len(row['digest']) == 64
        db.execute("UPDATE auth_tokens SET digest=?", (digest('known-verification-token-1234'),))
    assert client.post('/v1/auth/email/verify', json={
        'token':'known-verification-token-1234',
    }).status_code == 200
    assert client.get('/v1/account/verification').json()['verified'] is True
    assert client.post('/v1/auth/email/verify', json={
        'token':'known-verification-token-1234',
    }).status_code == 400


def test_export_access_log_notification_controls_and_security_headers(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    app = create_app(tmp_path/'security.sqlite', Engine())
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    })
    assert client.post('/v1/auth/signup', json={'email':'owner@example.com','password':'secure-password'}).status_code == 201
    preferences = client.get('/v1/account/notifications').json()
    assert preferences['marketing'] is False
    preferences['weekly_summary'] = True
    assert client.put('/v1/account/notifications', json=preferences).json()['weekly_summary'] is True
    exported = client.get('/v1/account/export')
    assert exported.json()['format'] == 'spatialguard-account-export-v1'
    assert exported.json()['account']['email'] == 'owner@example.com'
    assert client.get('/v1/account/access-log').json() == []
    assert exported.headers['strict-transport-security'].startswith('max-age=')
    assert exported.headers['x-frame-options'] == 'DENY'
    assert 'camera=()' in exported.headers['permissions-policy']
    status = client.get('/status').json()
    assert status['application'] == 'SpatialGuard' and status['database'] == 'available'


def test_certification_profile_disables_optional_processing_server_side(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_RELEASE_PROFILE', 'certification')
    app = create_app(tmp_path/'certification.sqlite', Engine())
    client = TestClient(app)
    features = client.get('/v1/product-capabilities').json()
    assert features['profile'] == 'certification'
    assert features['synthetic_replay'] is True
    for name in ('classification','timelapse','uptime_history','offline_alerts','test_video'):
        assert features[name] is False


def test_reviewer_account_can_be_read_only_with_secret_operator_bypass(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    monkeypatch.setenv('SPATIALGUARD_ENABLE_TEST_ACCOUNT', 'true')
    monkeypatch.setenv('SPATIALGUARD_DEMO_READ_ONLY', 'true')
    monkeypatch.setenv('SPATIALGUARD_REVIEWER_KEY', 'operator-secret')
    app = create_app(tmp_path/'reviewer.sqlite', Engine())
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    })
    assert client.post('/v1/auth/signin', json={'email':TEST_ACCOUNT_EMAIL, 'password':'test12345'}).status_code == 200
    assert client.get('/v1/sites').status_code == 200
    assert client.post('/v1/sample-site').status_code == 403
    assert client.post('/v1/sample-site', headers={'X-SpatialGuard-Reviewer-Key':'operator-secret'}).status_code == 201


def test_signup_claims_only_the_authenticated_legacy_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    app = create_app(tmp_path/'claim.sqlite', Engine())
    store = app.state.store
    with store.connect() as db:
        db.execute('INSERT INTO sites VALUES (?,?,?)', ('legacy_site', 'hosted_owner', '{}'))
        db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?)',
                   ('legacy_session', 'hosted_owner', digest('legacy-token'), 'Legacy', 'browser', time.time()+1000))
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    }, cookies={'spatialguard_session': 'legacy-token'})
    response = client.post('/v1/auth/signup', json={'email': 'owner@example.com', 'password': 'correct-password'})
    assert response.status_code == 201, response.text
    with store.connect() as db:
        account = db.execute('SELECT id FROM accounts WHERE email=?', ('owner@example.com',)).fetchone()
        assert db.execute('SELECT owner FROM sites WHERE id=?', ('legacy_site',)).fetchone()['owner'] == account['id']
        assert db.execute('SELECT 1 FROM sessions WHERE id=?', ('legacy_session',)).fetchone() is None


def test_opt_in_test_account_is_hashed_and_isolated(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    monkeypatch.delenv('SPATIALGUARD_ENABLE_TEST_ACCOUNT', raising=False)
    monkeypatch.setenv('RAILWAY_ENVIRONMENT_ID', 'test-environment')
    app = create_app(tmp_path/'test-account.sqlite', Engine())
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    })
    response = client.post('/v1/auth/signin', json={'email': 'test12345@gmail.com', 'password': 'test12345'})
    assert response.status_code == 200, response.text
    assert client.get('/v1/sites').json() == []
    with app.state.store.connect() as db:
        stored = db.execute('SELECT password_hash FROM accounts WHERE email=?', ('test12345@gmail.com',)).fetchone()[0]
        assert stored != 'test12345' and stored.startswith('scrypt$')


def test_account_privacy_consent_and_permanent_deletion(tmp_path, monkeypatch):
    monkeypatch.setenv('SPATIALGUARD_ORIGIN', 'https://testserver')
    engine = Engine()
    app = create_app(tmp_path/'privacy.sqlite', engine)
    client = TestClient(app, base_url='https://testserver', headers={
        'Origin': 'https://testserver', 'Sec-Fetch-Site': 'same-origin',
    })
    credentials = {'email': 'privacy@example.com', 'password': 'correct-password'}
    assert client.post('/v1/auth/signup', json=credentials).status_code == 201
    defaults = client.get('/v1/account/preferences').json()
    assert defaults == {
        'onboarding_completed': False, 'ring_data_consent': False,
        'classification_consent': False, 'incident_retention_days': 90,
        'audit_retention_days': 365, 'consent_updated_at': None,
    }
    assert client.post('/v1/ring/sign-in-code').status_code == 409
    with app.state.store.connect() as db:
        owner = db.execute('SELECT id FROM accounts WHERE email=?', ('privacy@example.com',)).fetchone()['id']
        site = {'id':'private_site','name':'Home','revision_id':'rev_demo',
            'layout':synthetic_layout().model_dump(mode='json'),
            'monitoring':{'enabled':True,'camera_ids':['camera_front'],'classification_enabled':False},
            'monitoring_version':0,'evidence_mode':'replay','ring_status':'not_connected'}
        db.execute('INSERT INTO sites VALUES (?,?,?)', ('private_site', owner, dump(site)))
    blocked = client.patch('/v1/sites/private_site/monitoring', json={
        'enabled': True, 'camera_ids': ['camera_front'], 'classification_enabled': True,
    })
    assert blocked.status_code == 409
    saved = client.patch('/v1/account/preferences', json={
        **defaults, 'onboarding_completed': True, 'ring_data_consent': True,
        'classification_consent': True, 'incident_retention_days': 30,
        'audit_retention_days': 90,
    })
    assert saved.status_code == 200 and saved.json()['consent_updated_at']
    assert client.post('/v1/ring/sign-in-code').status_code == 200
    assert client.patch('/v1/sites/private_site/monitoring', json={
        'enabled': True, 'camera_ids': ['camera_front'], 'classification_enabled': True,
    }).status_code == 200
    assert client.request('DELETE', '/v1/account', json={
        'password': 'wrong-password', 'confirmation': 'DELETE',
    }).status_code == 401
    deleted = client.request('DELETE', '/v1/account', json={
        'password': credentials['password'], 'confirmation': 'DELETE',
    })
    assert deleted.status_code == 200
    receipt = client.get('/v1/deletion-receipts/' + deleted.json()['reference'])
    assert receipt.status_code == 200 and 'Ring connection' in receipt.json()['categories']
    assert engine.deleted == ['private_site']
    with app.state.store.connect() as db:
        assert db.execute('SELECT 1 FROM accounts WHERE id=?', (owner,)).fetchone() is None
        assert db.execute('SELECT 1 FROM sites WHERE owner=?', (owner,)).fetchone() is None
        assert db.execute('SELECT 1 FROM sessions WHERE owner=?', (owner,)).fetchone() is None


def test_retention_removes_expired_incident_evidence_and_audit(setup):
    app, client, store, _ = setup
    result = run(setup, 'retention-test')
    incident = client.get('/v1/incidents/' + result['incident_id']).json()
    incident['created_at'] = '2020-01-01T00:00:00+00:00'
    with store.connect() as db:
        db.execute('UPDATE incidents SET data=? WHERE id=?', (dump(incident), incident['id']))
        db.execute("INSERT OR REPLACE INTO account_preferences(owner,incident_retention_days,audit_retention_days) VALUES (?,?,?)",
                   ('local_owner', 30, 90))
        db.execute("INSERT INTO audit(owner,action,resource,at) VALUES (?,?,?,?)",
                   ('local_owner', 'old.action', 'old', '2020-01-01T00:00:00+00:00'))
    removed = cleanup_retention(store)
    assert removed['incidents'] == 1 and removed['audit_records'] >= 1
    with store.connect() as db:
        assert db.execute('SELECT 1 FROM incidents WHERE id=?', (incident['id'],)).fetchone() is None
        for evidence_id in incident['evidence_ids']:
            assert db.execute('SELECT 1 FROM evidence WHERE id=?', (evidence_id,)).fetchone() is None


def test_cross_owner_and_evidence_isolation(setup):
    app,c,store,engine=setup;result=run(setup)
    with store.connect() as db: db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?)',('other','other_owner',digest('other-token'),'Other','android',time.time()+1000))
    other=TestClient(app,headers={'Authorization':'Bearer other-token'})
    assert other.get('/v1/sites').json()==[]
    for path in ['/v1/sites/site_demo/cameras','/v1/sites/site_demo/events','/v1/sites/site_demo/incidents','/v1/incidents/'+result['incident_id']]:
        assert other.get(path).status_code==404
    i=c.get('/v1/incidents/'+result['incident_id']).json()
    assert other.get('/v1/evidence/'+i['evidence_ids'][0]+'/image').status_code==404
    assert other.post('/v1/incidents/'+i['id']+'/review',json={}).status_code==404


def test_engine_failure_is_bounded_and_media_denied(setup):
    app,c,store,engine=setup;engine.fail=True
    r=c.post('/v1/sites/site_demo/replay',json={'request_id':'failed-replay'}).json()
    for _ in range(3):
        process_one(store,engine)
        with store.connect() as db: db.execute('UPDATE runs SET lease=0')
    assert c.get('/v1/sites/site_demo/runs/'+r['id']).json()['state']=='failed'
    assert c.get('/v1/sites/site_demo/incidents').json()['incidents']==[]
    assert c.post('/v1/sites/site_demo/sessions?camera_id=camera_front').json()['state']=='denied'


def add_camera(c,**fields):
    body={'name':'Side gate','position_m':[2.0,6.0,2.2],'heading_degrees':180,'range_m':5}
    body.update(fields)
    return c.post('/v1/sites/site_demo/cameras',json=body)


def test_camera_add_aim_and_remove_publishes_new_revisions(setup):
    app,c,store,engine=setup
    r=add_camera(c);assert r.status_code==201,r.text
    site=r.json();added=site['layout']['cameras'][-1]
    assert site['revision_id']!='rev_demo' and len(site['layout']['cameras'])==3
    assert added['name']=='Side gate' and added['heading_degrees']==180
    assert added['provenance']['kind']=='manual' and added['provenance']['confirmed']
    # Placement is not authorization: a new camera joins replay only when selected.
    assert added['id'] not in site['monitoring']['camera_ids']
    moved=c.patch('/v1/sites/site_demo/cameras/'+added['id'],json={'heading_degrees':45,'position_m':[3.5,6.5,2.4]})
    assert moved.status_code==200,moved.text
    camera=next(x for x in moved.json()['layout']['cameras'] if x['id']==added['id'])
    assert camera['heading_degrees']==45 and camera['position_m']==[3.5,6.5,2.4]
    assert camera['name']=='Side gate' and camera['range_m']==5, 'untouched fields survive'
    assert moved.json()['revision_id'] not in {'rev_demo',site['revision_id']}
    gone=c.delete('/v1/sites/site_demo/cameras/'+added['id'])
    assert gone.status_code==200 and len(gone.json()['layout']['cameras'])==2
    restarted=TestClient(create_app(store.path,engine),headers=c.headers,cookies=c.cookies)
    assert restarted.get('/v1/sites').json()[0]['revision_id']==gone.json()['revision_id']


def test_recorded_incidents_keep_their_own_revision(setup):
    app,c,store,engine=setup;result=run(setup)
    assert c.get('/v1/incidents/'+result['incident_id']).json()['revision_id']=='rev_demo'
    assert add_camera(c).status_code==201
    assert c.get('/v1/incidents/'+result['incident_id']).json()['revision_id']=='rev_demo'
    assert c.get('/v1/sites').json()[0]['revision_id']!='rev_demo'


def test_removing_a_monitored_camera_drops_it_and_pauses_queued_replay(setup):
    app,c,store,engine=setup
    queued=c.post('/v1/sites/site_demo/replay',json={'request_id':'camera-removed-1'}).json()
    site=c.delete('/v1/sites/site_demo/cameras/camera_hall')
    assert site.status_code==200 and site.json()['monitoring']['camera_ids']==['camera_front']
    assert process_one(store,engine)
    assert c.get('/v1/sites/site_demo/runs/'+queued['id']).json()['state']=='paused'
    assert not engine.saved
    assert 'layout.changed' in {e['kind'] for e in c.get('/v1/sites/site_demo/events').json()['events']}


def test_camera_limits_and_engine_failure_leave_the_revision_pinned(setup):
    app,c,store,engine=setup
    assert c.patch('/v1/sites/site_demo/cameras/camera_front',json={}).status_code==422
    assert c.patch('/v1/sites/site_demo/cameras/nope',json={'range_m':3}).status_code==404
    assert c.delete('/v1/sites/site_demo/cameras/nope').status_code==404
    assert add_camera(c,fov_degrees=100).status_code==422, 'the lens is not an owner setting'
    assert c.patch('/v1/sites/site_demo/cameras/camera_front',json={'fov_degrees':100}).status_code==422
    assert add_camera(c,position_m=[0,0,900]).status_code==422
    for i in range(6):
        assert add_camera(c,name='Extra %d'%i).status_code==201
    assert len(c.get('/v1/sites').json()[0]['layout']['cameras'])==8
    assert add_camera(c,name='Ninth').status_code==409
    pinned=c.get('/v1/sites').json()[0]['revision_id']
    engine.down=True
    assert c.patch('/v1/sites/site_demo/cameras/camera_front',json={'range_m':9}).status_code==503
    assert c.get('/v1/sites').json()[0]['revision_id']==pinned


def test_camera_edits_require_the_local_owner_browser(setup):
    app,c,store,engine=setup
    anonymous=TestClient(app)
    assert anonymous.post('/v1/sites/site_demo/cameras',json={'position_m':[1,1,2]}).status_code==403
    assert anonymous.delete('/v1/sites/site_demo/cameras/camera_front').status_code==403
    with store.connect() as db:
        db.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?)',('s_other','other',digest('other-token'),'Other','browser',time.time()+600))
    other=TestClient(app,headers={'Authorization':'Bearer other-token'})
    assert other.delete('/v1/sites/site_demo/cameras/camera_front').status_code==404


def test_every_camera_carries_the_ring_lens_field_of_view(setup):
    app,c,store,engine=setup
    # The synthetic fixture ships generic optics; SpatialGuard states one Ring lens.
    assert {c_['fov_degrees'] for c_ in synthetic_layout().model_dump(mode='json')['cameras']}=={70,65}
    with store.connect() as db:
        stored=json.loads(db.execute("SELECT data FROM sites WHERE id='site_demo'").fetchone()[0])
    site=relens(store,engine,stored)
    assert {c_['fov_degrees'] for c_ in site['layout']['cameras']}=={RING_FOV_DEGREES}
    assert site['revision_id']!='rev_demo', 'normalising the lens publishes a revision'
    assert relens(store,engine,dict(site))['revision_id']==site['revision_id'], 'already normalised, no republish'
    added=add_camera(c).json()['layout']['cameras']
    assert {c_['fov_degrees'] for c_ in added}=={RING_FOV_DEGREES} and len(added)==3


def plan_png():
    """The same simple three-space drawing TwinForge's tracer tests use."""
    import base64, io
    from PIL import Image, ImageDraw
    WALL, DOOR = 6, 46
    image = Image.new("L", (800, 600), 255)
    pen = ImageDraw.Draw(image)
    pen.rectangle([40, 40, 760, 560], outline=0, width=WALL)
    pen.line([(400, 40), (400, 250)], fill=0, width=WALL)
    pen.line([(400, 250 + DOOR), (400, 560)], fill=0, width=WALL)
    pen.arc([400 - DOOR, 250, 400 + DOOR, 250 + 2 * DOOR], 180, 270, fill=0, width=2)
    pen.line([(400, 250), (400 - DOOR, 250)], fill=0, width=2)
    pen.line([(400, 300), (560, 300)], fill=0, width=WALL)
    pen.line([(560 + DOOR, 300), (760, 300)], fill=0, width=WALL)
    pen.arc([560, 300 - DOOR, 560 + 2 * DOOR, 300 + DOOR], 90, 180, fill=0, width=2)
    pen.line([(560, 300), (560, 300 - DOOR)], fill=0, width=2)
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def start_plan(c, **fields):
    body = {"name": "Traced home", "media_type": "image/png", "data_base64": plan_png(), "ceiling_height_m": 2.8}
    body.update(fields)
    return c.post("/v1/plans", json=body)


def accept(c, job_id, state, **fields):
    """Accept using the drawing's own proportions unless a test overrides them."""
    body = {"width_m": state["traced_width_m"], "depth_m": state["traced_depth_m"]}
    body.update(fields)
    return c.post(f"/v1/plans/{job_id}/accept", json=body)


def trace_to_review(c):
    job = start_plan(c)
    assert job.status_code == 202, job.text
    job_id = job.json()["job_id"]
    for _ in range(4):
        state = c.get("/v1/plans/" + job_id).json()
        if state["state"] == "needs_review":
            return job_id, state
    raise AssertionError("tracing never reached review: " + state["state"])


def test_floor_plan_traces_to_a_reviewable_draft_then_publishes_on_accept(setup):
    app, c, store, engine = setup
    job_id, state = trace_to_review(c)
    assert state["rooms"] >= 2 and state["layout"]["rooms"], state
    assert state["layout"]["scale_status"] == "unknown"
    # Nothing is published or added to the workspace while it is still a draft.
    assert all(not r["provenance"]["confirmed"] for r in state["layout"]["rooms"])
    assert len(c.get("/v1/sites").json()) == 1
    assert state["traced_width_m"] > 0 and state["traced_depth_m"] > 0
    site = accept(c, job_id, state, width_m=14.4, depth_m=round(14.4 * state["traced_depth_m"] / state["traced_width_m"], 2))
    assert site.status_code == 200, site.text
    data = site.json()
    assert data["name"] == "Traced home" and data["id"].startswith("site_traced")
    # Publishing requires measured scale; the owner's two dimensions are recorded.
    assert data["layout"]["scale_status"] == "verified"
    assert [a["distance_m"] for a in data["layout"]["scale_anchors"]][0] == 14.4
    xs = [p[0] for r in data["layout"]["rooms"] for p in r["polygon_xy_m"]]
    assert abs((max(xs) - min(xs)) - 14.4) < 0.05, "geometry is rescaled onto the measurement"
    assert len(data["layout"]["rooms"]) == state["rooms"]
    # Acceptance records the owner's review without claiming the geometry is measured.
    for room in data["layout"]["rooms"]:
        assert room["provenance"]["confirmed"] and room["provenance"]["kind"] == "inferred"
        assert "accepted by the site owner" in room["provenance"]["explanation"]
        assert "Tracer evidence:" in room["provenance"]["explanation"]
    # A traced place starts with no cameras and monitoring off; placement stays explicit.
    assert data["layout"]["cameras"] == [] and data["monitoring"] == {
        "enabled": False,
        "camera_ids": [],
        "classification_enabled": False,
    }
    assert {s["id"] for s in c.get("/v1/sites").json()} == {"site_demo", data["id"]}
    assert c.get(f"/v1/plans/{job_id}").status_code == 404, "the job is consumed"


def test_traced_place_serves_its_drawing_and_accepts_cameras(setup):
    app, c, store, engine = setup
    job_id, state = trace_to_review(c)
    site_id = accept(c, job_id, state).json()["id"]
    image = c.get(f"/v1/sites/{site_id}/floor-plan")
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    assert c.get("/v1/sites/site_demo/floor-plan").status_code == 404
    added = c.post(f"/v1/sites/{site_id}/cameras", json={"name": "Porch", "position_m": [1.0, 1.0, 2.2]})
    assert added.status_code == 201, added.text
    assert added.json()["layout"]["cameras"][0]["fov_degrees"] == RING_FOV_DEGREES


def test_plan_can_be_discarded_and_bad_input_is_rejected(setup):
    app, c, store, engine = setup
    job = start_plan(c)
    job_id = job.json()["job_id"]
    assert c.delete("/v1/plans/" + job_id).status_code == 204
    assert c.get("/v1/plans/" + job_id).status_code == 404
    assert len(c.get("/v1/sites").json()) == 1, "discarding adds no place"
    assert start_plan(c, media_type="image/gif").status_code == 422
    assert start_plan(c, ceiling_height_m=0).status_code == 422
    assert start_plan(c, name="").status_code == 422
    # A draft that is not yet traced cannot be accepted.
    pending = start_plan(c).json()["job_id"]
    assert c.post(f"/v1/plans/{pending}/accept", json={"width_m": 10, "depth_m": 8}).status_code == 409


def test_plans_are_owner_scoped_and_bounded(setup):
    app, c, store, engine = setup
    mine = start_plan(c).json()["job_id"]
    with store.connect() as db:
        db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)",
                   ("s_other", "other", digest("other-token"), "Other", "browser", time.time() + 600))
    other = TestClient(app, headers={"Authorization": "Bearer other-token"})
    assert other.get("/v1/plans/" + mine).status_code == 404
    assert other.delete("/v1/plans/" + mine).status_code == 404
    assert other.post(f"/v1/plans/{mine}/accept", json={"width_m": 10, "depth_m": 8}).status_code == 404
    start_plan(c)
    start_plan(c)
    assert start_plan(c).status_code == 409, "pending plans are capped"


def test_traced_scale_must_be_measured_and_self_consistent(setup):
    app, c, store, engine = setup
    job_id, state = trace_to_review(c)
    assert state["layout"]["scale_status"] == "unknown", "tracing never establishes metres"
    # A depth that contradicts the drawing's proportions is refused, and nothing is published.
    wrong = accept(c, job_id, state, width_m=14.4, depth_m=3.0)
    assert wrong.status_code == 422 and "disagree with the drawing" in wrong.json()["detail"]
    assert len(c.get("/v1/sites").json()) == 1
    assert accept(c, job_id, state, width_m=0).status_code == 422
    # The same job still accepts a consistent pair afterwards.
    ratio = state["traced_depth_m"] / state["traced_width_m"]
    good = accept(c, job_id, state, width_m=20.0, depth_m=round(20.0 * ratio, 2))
    assert good.status_code == 200, good.text
    ys = [p[1] for r in good.json()["layout"]["rooms"] for p in r["polygon_xy_m"]]
    assert abs((max(ys) - min(ys)) - round(20.0 * ratio, 2)) < 0.4


def test_vision_tracing_is_opt_in_and_reports_which_engine_produced_the_geometry(setup):
    app, c, store, engine = setup
    assert c.get("/v1/generation-options").json() == {"vision_available": True}
    # Default is local: a drawing is not sent to a third party unless asked.
    local_id = start_plan(c).json()["job_id"]
    assert engine.jobs[local_id]["vision"] is False
    assert c.get("/v1/plans/" + local_id).json()["vision_status"] is None
    c.delete("/v1/plans/" + local_id)
    job_id = start_plan(c, vision_assisted=True).json()["job_id"]
    assert engine.jobs[job_id]["vision"] is True
    for _ in range(4):
        state = c.get("/v1/plans/" + job_id).json()
        if state["state"] == "needs_review":
            break
    assert state["vision_status"] == "completed" and state["label_reader"] == "vision"
    with store.connect() as db:
        actions = [r[0] for r in db.execute("SELECT action FROM audit WHERE action LIKE 'plan.started%'")]
    assert actions == ["plan.started", "plan.started.vision"], "the upload choice is audited"


def test_vision_failure_falls_back_to_local_tracing_and_says_so(setup):
    app, c, store, engine = setup
    engine.vision_fails = True
    job_id = start_plan(c, vision_assisted=True).json()["job_id"]
    for _ in range(4):
        state = c.get("/v1/plans/" + job_id).json()
        if state["state"] == "needs_review":
            break
    assert state["vision_status"] == "failed" and state["vision_error"]
    # The fallback still produces a reviewable map rather than an error.
    assert state["rooms"] >= 2 and state["layout"]["scale_status"] == "unknown"
    assert accept(c, job_id, state).status_code == 200


def test_vision_choice_is_hidden_when_the_server_has_no_key(setup):
    app, c, store, engine = setup
    engine.vision_available = False
    assert c.get("/v1/generation-options").json() == {"vision_available": False}


def test_the_largest_unlabelled_space_is_offered_as_the_living_room(setup):
    app, c, store, engine = setup
    job_id, state = trace_to_review(c)
    names = [r["name"] for r in state["layout"]["rooms"]]
    assert "Living room" in names, names
    assert not any(n.startswith("Space 0") and n == "Living room" for n in names)
    from spatialguard_api.engine import polygon_area
    rooms = {r["name"]: polygon_area(r["polygon_xy_m"]) for r in state["layout"]["rooms"]}
    assert rooms["Living room"] == max(rooms.values()), "the biggest space gets the name"
    living = next(r for r in state["layout"]["rooms"] if r["name"] == "Living room")
    # The name is a guess from size, and says so rather than claiming the drawing said it.
    assert "largest unlabelled space" in living["provenance"]["explanation"]
    assert "the drawing did not say so" in living["provenance"]["explanation"]
    # The published map matches what was previewed.
    site = accept(c, job_id, state)
    assert site.status_code == 200
    assert "Living room" in [r["name"] for r in site.json()["layout"]["rooms"]]


def test_a_fresh_workspace_is_empty_until_the_owner_adds_a_place(tmp_path):
    engine = Engine()
    app = create_app(tmp_path / "fresh.sqlite", engine)
    c = TestClient(app, headers={"X-SpatialGuard-Local": "1", "Origin": "http://127.0.0.1:8010"})
    assert c.post("/v1/local-session").status_code == 200
    # Nothing is seeded at startup; the owner chooses their own plan or the sample.
    assert c.get("/v1/sites").json() == []
    assert c.get("/v1/preferences").json() == {"active_site_id": None}
    sample = c.post("/v1/sample-site")
    assert sample.status_code == 201, sample.text
    site = sample.json()
    assert site["name"] == "Demo home" and len(site["layout"]["cameras"]) == 2
    assert {c_["fov_degrees"] for c_ in site["layout"]["cameras"]} == {RING_FOV_DEGREES}
    # Loading it makes it the remembered place, and asking twice reuses the same one.
    assert c.get("/v1/preferences").json() == {"active_site_id": site["id"]}
    assert c.post("/v1/sample-site").json()["id"] == site["id"]
    assert len(c.get("/v1/sites").json()) == 1


def test_hosted_demo_bundle_is_tenant_scoped_when_twinforge_is_offline(tmp_path):
    class OfflineEngine:
        def request(self, *args, **kwargs):
            raise OSError("offline")

    app = create_app(tmp_path / "offline-demo.sqlite", OfflineEngine())
    client = TestClient(app)

    def android_owner(email):
        signup = client.post(
            "/v1/auth/signup",
            headers={"X-SpatialGuard-Client": "android"},
            json={"email": email, "password": "SpatialGuard-test-12345"},
        )
        assert signup.status_code == 201, signup.text
        token = signup.json()["token"]
        return TestClient(app, headers={"Authorization": "Bearer " + token})

    first, second = android_owner("first@example.test"), android_owner("second@example.test")
    first_site = first.post("/v1/sample-site")
    second_site = second.post("/v1/sample-site")
    assert first_site.status_code == second_site.status_code == 201
    assert first_site.json()["id"] != second_site.json()["id"]
    assert len(first_site.json()["layout"]["cameras"]) == 2
    assert first.get("/v1/sites").json()[0]["id"] == first_site.json()["id"]
    assert second.get("/v1/sites").json()[0]["id"] == second_site.json()["id"]

    replay = first.post(
        f"/v1/sites/{first_site.json()['id']}/replay",
        json={"request_id": "offline-demo-replay"},
    )
    assert replay.status_code == 202, replay.text
    with app.state.store.connect() as db:
        payload = json.loads(db.execute(
            "SELECT payload FROM runs WHERE id=?", (replay.json()["id"],)
        ).fetchone()[0])
    assert len(payload["observations"]) == 12
    assert {item["site_id"] for item in payload["observations"]} == {first_site.json()["id"]}


def test_the_last_opened_place_is_remembered_across_sessions(setup):
    app, c, store, engine = setup
    job_id, state = trace_to_review(c)
    traced = accept(c, job_id, state).json()
    # Accepting does not itself pick the place; the client records the choice.
    assert c.put("/v1/preferences", json={"active_site_id": traced["id"]}).status_code == 200
    restarted = TestClient(create_app(store.path, engine), headers=c.headers, cookies=c.cookies)
    assert restarted.get("/v1/preferences").json() == {"active_site_id": traced["id"]}
    # A place from another owner can never be selected, and an unknown one is refused.
    assert c.put("/v1/preferences", json={"active_site_id": "site_missing"}).status_code == 404
    assert c.put("/v1/preferences", json={"active_site_id": None}).json() == {"active_site_id": None}
    assert c.get("/v1/preferences").json() == {"active_site_id": None}


def test_a_remembered_place_that_disappears_is_forgotten(setup):
    app, c, store, engine = setup
    assert c.put("/v1/preferences", json={"active_site_id": "site_demo"}).status_code == 200
    with store.connect() as db:
        db.execute("DELETE FROM sites WHERE id='site_demo'")
    assert c.get("/v1/preferences").json() == {"active_site_id": None}


def test_discarding_a_plan_deletes_the_uploaded_drawing(setup):
    app, c, store, engine = setup
    job = start_plan(c).json()
    created = engine.jobs[job["job_id"]]["site"]
    assert c.delete("/v1/plans/" + job["job_id"]).status_code == 204
    # The drawing must not linger in TwinForge after the owner discards it.
    assert created in engine.deleted, engine.deleted
    assert c.get("/v1/plans/" + job["job_id"]).status_code == 404


def test_removing_a_place_takes_its_map_drawing_and_incidents_with_it(setup):
    app, c, store, engine = setup
    result = run(setup)
    assert c.get("/v1/incidents/" + result["incident_id"]).status_code == 200
    c.put("/v1/preferences", json={"active_site_id": "site_demo"})
    assert c.delete("/v1/sites/site_demo").status_code == 204
    assert "site_demo" in engine.deleted
    assert c.get("/v1/sites").json() == []
    assert c.get("/v1/incidents/" + result["incident_id"]).status_code == 404
    assert c.get("/v1/preferences").json() == {"active_site_id": None}
    with store.connect() as db:
        for table in ("incidents", "evidence", "runs", "events"):
            assert db.execute(f"SELECT count(*) FROM {table} WHERE site_id='site_demo'").fetchone()[0] == 0
    assert c.delete("/v1/sites/site_demo").status_code == 404


def test_a_place_can_only_be_removed_by_its_owner(setup):
    app, c, store, engine = setup
    with store.connect() as db:
        db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)",
                   ("s_other", "other", digest("other-token"), "Other", "browser", time.time() + 600))
    other = TestClient(app, headers={"Authorization": "Bearer other-token"})
    assert other.delete("/v1/sites/site_demo").status_code == 404
    assert engine.deleted == [], "nothing upstream is touched for a place you do not own"
    assert len(c.get("/v1/sites").json()) == 1


def test_spaces_and_cameras_can_be_renamed_without_touching_geometry(setup):
    app, c, store, engine = setup
    before = c.get("/v1/sites").json()[0]["layout"]
    room = c.patch("/v1/sites/site_demo/rooms/room_study", json={"name": "Nursery"})
    assert room.status_code == 200, room.text
    layout = room.json()["layout"]
    renamed = next(r for r in layout["rooms"] if r["id"] == "room_study")
    original = next(r for r in before["rooms"] if r["id"] == "room_study")
    assert renamed["name"] == "Nursery"
    assert renamed["polygon_xy_m"] == original["polygon_xy_m"], "renaming moves nothing"
    # The name is owner evidence; the geometry's own provenance kind is untouched.
    assert renamed["provenance"]["kind"] == original["provenance"]["kind"]
    assert 'Named "Nursery" by the site owner' in renamed["provenance"]["explanation"]
    assert original["provenance"]["explanation"] in renamed["provenance"]["explanation"]
    camera = c.patch("/v1/sites/site_demo/cameras/camera_front", json={"name": "Porch"})
    assert camera.status_code == 200
    moved = next(x for x in camera.json()["layout"]["cameras"] if x["id"] == "camera_front")
    assert moved["name"] == "Porch"
    assert moved["position_m"] == next(
        x for x in before["cameras"] if x["id"] == "camera_front")["position_m"]


def test_renaming_rejects_unknown_spaces_empty_names_and_no_op_renames(setup):
    app, c, store, engine = setup
    assert c.patch("/v1/sites/site_demo/rooms/room_missing", json={"name": "X"}).status_code == 404
    assert c.patch("/v1/sites/site_demo/rooms/room_study", json={"name": ""}).status_code == 422
    assert c.patch("/v1/sites/site_demo/rooms/room_study", json={"name": "x" * 101}).status_code == 422
    # A rename to the current name would publish a revision for nothing.
    assert c.patch("/v1/sites/site_demo/rooms/room_study", json={"name": "Study"}).status_code == 409
    with store.connect() as db:
        db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?)",
                   ("s_other", "other", digest("other-token"), "Other", "browser", time.time() + 600))
    other = TestClient(app, headers={"Authorization": "Bearer other-token"})
    assert other.patch("/v1/sites/site_demo/rooms/room_study", json={"name": "Theirs"}).status_code == 404
