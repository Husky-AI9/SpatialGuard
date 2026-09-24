import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

let script: string;
test.beforeAll(async () => {
  const root = path.resolve('../../..');
  const result = await build({absWorkingDir:root,bundle:true,write:false,format:'iife',jsx:'automatic',
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import IncidentRecording from './spatialguard/apps/web/src/IncidentRecording';
      createRoot(document.getElementById('root')).render(<IncidentRecording incidentId="incident-test" observationId="event-test"/>);
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
      : route.fulfill({contentType:'video/mp4',body:fs.readFileSync(media)});
  });
  await page.goto('/landing');
  await page.setContent('<div id="root"></div>');
  await page.route('**/recording-test.js', r=>r.fulfill({contentType:'application/javascript',body:script}));
  await page.addScriptTag({url:'/recording-test.js'});
  await expect(page.getByRole('status')).toContainText('still preparing');
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
});
