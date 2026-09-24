import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { placeMapLabels } from "../../../../packages/spatial-view/mapLabels";

test("crowded edge labels fit the viewport without covering each other", () => {
  const result = placeMapLabels([
    {id:"camera", kind:"camera", name:"Front door camera with a long name", x:295, y:8, selected:true},
    {id:"person", kind:"actor", name:"Delivery worker", x:290, y:14, selected:true},
  ], {x:0,y:0,width:320,height:300}, 1, [{x:220,y:40,width:90,height:28}]);
  for (const {box} of result) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(320);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y+box.height).toBeLessThanOrEqual(300);
  }
  const [a,b] = result.map(r=>r.box);
  expect(a.x+a.width <= b.x || b.x+b.width <= a.x || a.y+a.height <= b.y || b.y+b.height <= a.y).toBeTruthy();
  expect(result.find(r=>r.id==="camera")?.name).toContain("long name");
  expect(result.find(r=>r.id==="camera")?.text).toContain("…");
});

let script: string;
test.beforeAll(async () => {
  const root = path.resolve("../../..");
  const layout = JSON.parse(fs.readFileSync(path.join(root,"fixtures/synthetic-home/layout.json"),"utf8"));
  layout.cameras.push({...layout.cameras[0],id:"camera_porch",name:"Porch camera",position_m:[8.4,5.5,2.2]});
  const bundled = await build({
    absWorkingDir:root, bundle:true,write:false,format:"iife",jsx:"automatic",
    stdin:{resolveDir:root,loader:"tsx",contents:`
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Map2D from './packages/spatial-view/Map2D';
      function Demo() {
        const [selected,setSelected]=React.useState('camera_front');
        return <Map2D layout={${JSON.stringify(layout)}} selected={selected} onSelect={setSelected} fitBuilding
          markers={[{id:'courier',xy:[8.8,4.7],selected:true,approximate:true,actorKind:'delivery',actorLabel:'Delivery worker'},
          {id:'package',xy:[8.3,4.4],persistent:true,approximate:true,actorKind:'package',actorLabel:'Package'}]} />;
      }
      createRoot(document.getElementById('map-root')).render(<Demo/>);`},
  });
  script = bundled.outputFiles[0].text;
});

for (const width of [1440,390]) test(`map labels remain legible and selectable at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:850});
  await page.goto('/landing');
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(node=>(node as HTMLLinkElement).href));
  await page.setContent(`${styles.map(href=>`<link rel="stylesheet" href="${href}">`).join('')}
    <div id="map-root" style="width:100%;height:650px"></div>`);
  await page.route('**/map-label-test.js', route => route.fulfill({contentType:'application/javascript',body:script}));
  await page.addScriptTag({url:'/map-label-test.js'});
  await expect(page.locator('.camera-label')).toHaveCount(3);
  await expect(page.locator('.actor-label')).toHaveCount(2);
  await expect(page.locator('.camera-label rect')).toHaveCount(0);
  await expect(page.locator('.actor-label rect').first()).toHaveAttribute('fill','#23253F');
  await expect(page.locator('.camera-coverage').first()).toHaveAttribute('fill','#5B4FE8');
  await expect(page.locator('.camera-coverage').first()).toHaveAttribute('fill-opacity','0.24');
  const fontPixels = () => page.locator('.camera-label text').first().evaluate(el =>
    Number(el.getAttribute('font-size')) * (el as SVGGraphicsElement).getScreenCTM()!.a);
  await expect.poll(fontPixels).toBeCloseTo(12,1);
  const boxes = await page.locator('.map-name-tags text').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));
  for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j];
    expect(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top).toBeTruthy();
  }
  await page.getByRole('button',{name:'Hallway camera',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Hallway camera',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('.spatial-map').hover();
  await page.mouse.wheel(0,-400);
  await expect.poll(fontPixels).toBeCloseTo(12,1);
  await page.screenshot({path:path.resolve(`../../../.data/spatialguard/map-labels-${width}.png`)});
});
