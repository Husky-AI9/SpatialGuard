import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";

let script: string;
const root = path.resolve("../../..");
test.beforeAll(async () => {
  const layout = JSON.parse(fs.readFileSync(path.join(root, "fixtures/synthetic-home/layout.json"), "utf8"));
  const result = await build({absWorkingDir: root, bundle: true, write: false, format: "iife", jsx: "automatic",
    stdin: {resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import IncidentReview from './spatialguard/apps/web/src/IncidentReview';
      import Map2D from './packages/spatial-view/Map2D';
      const layout=${JSON.stringify(layout)};
      const observations=[0,1,2].map((i)=>({observation_id:'event-'+i, source_id:layout.cameras[i===2?1:0].id,
        observed_at:'2026-09-24T15:29:0'+(i*3)+'Z',category:'person',location:i===1?{kind:'unknown'}:{kind:'point',point_m:[1,1,0]}}));
      function Demo(){
        const [step,setStep]=useState(0), [open,setOpen]=useState(true), [reviewed,setReviewed]=useState(false);
        const incident={id:'review-fixture',title:'Activity observed near the entry',created_at:observations[0].observed_at,
          evidence_mode:'replay',status:reviewed?'reviewed':'needs_review',revision_id:'revision_test_448e0d',
          rule:'Activity in a monitored zone',observations,classification:null,associations:[{
            from_observation_id:'event-0',to_observation_id:'event-2',unobserved_gap_seconds:6,reason:'Adjacent cameras; identity unconfirmed.'}]};
        return <div className="app-shell"><aside className="sidebar">Pathlight</aside><div className="workspace">
          <header className="topbar">Home</header><main className="content"><div className="monitor-bar">Tracking on</div>
          {open?<IncidentReview incident={incident} cameras={layout.cameras} step={step} onSelect={setStep}
            onClose={()=>setOpen(false)} onReview={()=>setReviewed(true)} onAnalyze={()=>{}} onMovement={()=>{}}
            map={<section className="map-panel"><div className="panel-heading"><h2>Ground floor</h2></div><div className="map-area"><Map2D layout={layout} /></div><div className="map-caption">Synthetic replay · estimated map positions</div></section>}
            image={step===1?'':'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="%23343654"/><text x="220" y="180" fill="white">Synthetic replay</text></svg>'}
            imageError="" consent={false} busy={false} online={true} error=""/>
          :<button onClick={()=>setOpen(true)}>Open incident</button>}
          </main></div></div>;
      } createRoot(document.getElementById('root')).render(<Demo/>);
    `}});
  script = result.outputFiles[0].text;
});

async function openReview(page: import("@playwright/test").Page, width: number) {
  await page.setViewportSize({width, height: 844});
  await page.goto("/landing");
  await page.setContent('<div id="root"></div>');
  for (const file of ["style.css", "incident-review.css"]) await page.addStyleTag({content:fs.readFileSync(path.join(root,"spatialguard/apps/web/src",file),"utf8")});
  await page.route("**/incident-ui-test.js", route => route.fulfill({contentType:"application/javascript",body:script}));
  await page.addScriptTag({url:"/incident-ui-test.js"});
}

test("desktop places timeline below map, evidence beside it, and preserves review and gaps", async ({page}) => {
  await openReview(page,1440);
  const map = await page.locator('.map-panel').boundingBox();
  const timeline = await page.getByRole('region',{name:'Event timeline'}).boundingBox();
  const details = await page.locator('.incident-review-detail').boundingBox();
  expect(timeline!.y).toBeGreaterThan(map!.y + map!.height);
  expect(details!.x).toBeGreaterThan(map!.x + map!.width);
  await page.getByRole('button',{name:/Unknown · coverage gap/}).click();
  await expect(page.getByRole('status')).toContainText('Location unknown');
  await page.getByRole('button',{name:'Mark reviewed'}).click();
  await expect(page.getByRole('button',{name:'Reviewed',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:/Observed ·/}).first().click();
  await expect(page.getByRole('img',{name:/Demo illustration/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).include('.incident-review').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({path:path.join(root,'.data/spatialguard/incident-review-desktop.png'),fullPage:true});
});

test("phone separates evidence, timeline and map while keeping review reachable", async ({page}) => {
  const errors: string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await openReview(page,390);
  await expect(page.getByRole('tabpanel',{name:'Evidence',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Timeline',exact:true}).click();
  await expect(page.getByRole('tabpanel',{name:'Evidence',exact:true})).toBeHidden();
  await page.getByRole('button',{name:/Unknown · coverage gap/}).click();
  await expect(page.getByRole('status')).toContainText('Location unknown');
  const action = await page.getByRole('button',{name:'Mark reviewed'}).boundingBox();
  expect(action!.y+action!.height).toBeLessThanOrEqual(844);
  await page.getByRole('tab',{name:'Map',exact:true}).click();
  await expect(page.locator('.spatial-map')).toHaveCount(1);
  await expect(page.locator('.spatial-map')).toBeVisible();
  await page.getByRole('tab',{name:'Evidence',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Timeline',exact:true})).toBeFocused();
  await expect(page.getByRole('tab',{name:'Timeline',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:/Observed ·/}).first().click();
  await page.getByRole('tab',{name:'Evidence',exact:true}).click();
  await page.screenshot({path:path.join(root,'.data/spatialguard/incident-review-mobile.png'),fullPage:true});
  expect((await new AxeBuilder({page}).include('.incident-review').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Mark reviewed'}).click();
  await expect(page.getByRole('button',{name:'Reviewed',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Back to all visits'}).click();
  await expect(page.getByRole('button',{name:'Open incident'})).toBeVisible();
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  await page.getByRole('button',{name:'Open incident'}).click();
  await expect(page.getByRole('button',{name:'Reviewed',exact:true})).toBeDisabled();
  await page.setViewportSize({width:1024,height:768});
  await expect(page.locator('.spatial-map')).toHaveCount(1);
  await expect(page.getByRole('tab',{name:'Evidence',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
