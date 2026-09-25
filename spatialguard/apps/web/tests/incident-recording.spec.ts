import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

let script: string;
test.beforeAll(async () => {
  const root = path.resolve('../../..');
  const result = await build({absWorkingDir:root,bundle:true,write:false,format:'iife',jsx:'automatic',
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import IncidentRecording from './spatialguard/apps/web/src/IncidentRecording';
      const camera = {id:'camera-front',name:'Front',position_m:[0,0,2],heading_degrees:0,fov_degrees:110,range_m:8};
      function Harness() {
        const [markers,setMarkers]=useState([]); const [observation,setObservation]=useState('event-test');
        const [playback,setPlayback]=useState({seconds:0,duration:0});
        return <><button onClick={()=>setObservation('other-event')}>Other incident</button>
          <output aria-label="Path points">{markers.length}</output>
          <output aria-label="Person position">{JSON.stringify(markers.find(point=>point.selected)?.xy ?? null)}</output>
          <output aria-label="Timeline playback">{playback.seconds}</output>
          <IncidentRecording key={observation} incidentId="incident-test" observationId={observation} camera={camera} onMovement={setMarkers} onPlayback={setPlayback}/></>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `}});
  script = result.outputFiles[0].text;
});

for (const width of [1440,390]) test(`recording failure and retry playback at ${width}px`, async ({page}) => {
  const media = path.resolve('../../../TestRingVideo/RingVideo_DeliveryMan1.mov');
  test.skip(!fs.existsSync(media), 'Private consented test video is only available locally');
  await page.setViewportSize({width,height:850});
  let attempts = 0;
  await page.route('**/v1/incidents/incident-test/observations/event-test/clip', route => {
    attempts++;
    return attempts === 1 ? route.fulfill({status:425,json:{detail:'Ring is still preparing this recording. Try again shortly.'}})
      : route.fulfill({contentType:'video/mp4',headers:{'X-SpatialGuard-Clip-Digest':'a'.repeat(64)},body:fs.readFileSync(media)});
  });
  await page.route('**/v1/incidents/incident-test/observations/event-test/track?*', route => route.fulfill({json:{
    video_id:'event-test',detector:'fixture',points:Array.from({length:21},(_,i)=>({t_seconds:i*.5,
      foot_x_norm:.5,foot_y_norm:1-Math.min(i,20-i)/20,confidence:.9}))}}));
  await page.route('**/v1/incidents/incident-test/observations/other-event/clip', route=>route.fulfill({status:416,json:{detail:'No recording'}}));
  await page.goto('/landing');
  await page.setContent('<div id="root"></div>');
  await page.route('**/recording-test.js', r=>r.fulfill({contentType:'application/javascript',body:script}));
  await page.addScriptTag({url:'/recording-test.js'});
  await expect(page.getByRole('status').filter({hasText:'still preparing'})).toContainText('still preparing');
  await page.getByRole('button',{name:'Retry recording'}).click();
  const video = page.getByLabel('Recorded Ring event video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('controls','');
  await expect.poll(()=>video.evaluate((el:HTMLVideoElement)=>el.readyState)).toBeGreaterThanOrEqual(1);
  await video.evaluate((el:HTMLVideoElement)=>el.play());
  await expect.poll(()=>video.evaluate((el:HTMLVideoElement)=>el.currentTime)).toBeGreaterThan(0);
  const box = await video.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(width);
  expect(attempts).toBe(2);
  const position = page.getByLabel('Person position');
  await expect(position).not.toHaveText('null');
  await video.evaluate((el:HTMLVideoElement)=>{el.pause();el.currentTime=5;});
  await expect(page.getByLabel('Path points')).toHaveText('12');
  await expect(page.getByLabel('Timeline playback')).toHaveText('5');
  const forward = JSON.parse(await position.textContent() ?? 'null');
  await video.evaluate((el:HTMLVideoElement)=>{el.currentTime=10;});
  await expect(page.getByLabel('Path points')).toHaveText('22');
  const back = JSON.parse(await position.textContent() ?? 'null');
  expect(forward[0]).toBeGreaterThan(back[0]);
  await video.evaluate((el:HTMLVideoElement)=>{el.currentTime=12;});
  await expect(page.getByLabel('Movement playback status')).toContainText('path retained');
  await expect(position).toHaveText('null');
  await expect(page.getByLabel('Path points')).toHaveText('21');
  await video.evaluate((el:HTMLVideoElement)=>{el.currentTime=2;});
  await expect(page.getByLabel('Path points')).toHaveText('6');
  await expect(position).not.toHaveText('null');
  await page.getByRole('button',{name:'Other incident'}).click();
  await expect(page.getByLabel('Path points')).toHaveText('0');
});
