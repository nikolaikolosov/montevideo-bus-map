import { chromium } from '@playwright/test';
const browser = await chromium.launch();

// Mobile: header geometry + hover:none + view preservation
const m = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
await m.goto('http://127.0.0.1:8776/?v=' + Date.now());
await m.waitForFunction(() => window.__mvdGetRenderState && document.getElementById('loader').style.display === 'none');

const geo = await m.evaluate(() => {
  const cy = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return +((b.top+b.bottom)/2).toFixed(1); };
  const box = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1) }; };
  const panel = document.getElementById('ui-panel').getBoundingClientRect();
  const header = box('.panel-header'); const search = box('.search-box');
  return {
    titleCy: cy('.title-link'), langCy: cy('.lang-switcher'), themeCy: cy('.theme-toggle'),
    aboveHeader: +(header.top - (panel.top + 10)).toFixed(1),  // 10 = panel padding-top
    belowHeader: +(search.top - header.bottom).toFixed(1),
    hoverNone: matchMedia('(hover: none)').matches, hoverHover: matchMedia('(hover: hover)').matches,
    panelRatio: +(panel.height / 812).toFixed(3),
  };
});
console.log('MOBILE-GEO', JSON.stringify(geo));

// hover on mobile ctx: bg stays base
await m.hover('.home-control');
const mobBg = await m.evaluate(() => getComputedStyle(document.querySelector('.home-control')).backgroundColor);
console.log('MOBILE home bg after hover:', mobBg);

// view preservation: set known center+zoom on a line, click home
await m.evaluate(() => window.__mvdSelectLine('405'));
await m.waitForFunction(() => window.__mvdGetRenderState().sections > 0);
await m.evaluate(() => window.__mvdMap.setView([-34.9, -56.19], 15, { animate: false }));
const before = await m.evaluate(() => ({ z: window.__mvdMap.getZoom(), c: window.__mvdMap.getCenter() }));
await m.click('.home-control');
await m.waitForFunction(() => window.__mvdGetRenderState().stops > 4000);
const after = await m.evaluate(() => ({ z: window.__mvdMap.getZoom(), c: window.__mvdMap.getCenter() }));
console.log('VIEW before', JSON.stringify(before), 'after', JSON.stringify(after));
await m.close();

// Desktop: hover DOES change bg
const d = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await d.goto('http://127.0.0.1:8776/?v=' + Date.now());
await d.waitForFunction(() => window.__mvdGetRenderState && document.getElementById('loader').style.display === 'none');
const dBase = await d.evaluate(() => getComputedStyle(document.querySelector('.home-control')).backgroundColor);
await d.hover('.home-control');
const dHover = await d.evaluate(() => getComputedStyle(document.querySelector('.home-control')).backgroundColor);
console.log('DESKTOP home bg base:', dBase, 'hover:', dHover, 'hoverHover:', await d.evaluate(()=>matchMedia('(hover:hover)').matches));
await d.close();
await browser.close();
