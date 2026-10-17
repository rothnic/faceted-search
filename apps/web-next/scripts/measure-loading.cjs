// Sequential Lighthouse + scripted actual-app lab measurements. No fixtures or app responses intercepted.
// PERF_TOOLS=/tmp/searchlab-perf-tools PERF_ORIGIN=http://127.0.0.1:15177 PERF_LABEL=baseline node scripts/measure-loading.cjs
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');
const tools = process.env.PERF_TOOLS;
const origin = process.env.PERF_ORIGIN;
const label = process.env.PERF_LABEL;
if (!tools || !origin || !label) throw new Error('Set PERF_TOOLS, PERF_ORIGIN and PERF_LABEL.');
const out = process.env.PERF_OUT || `/tmp/searchlab-loading-${label}`;
fs.mkdirSync(out, { recursive: true });
const profiles = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, rttMs: 40, throughputKbps: 10240, cpuSlowdownMultiplier: 1 }
};
const rows = [];
(async () => {
  const { default: lighthouse } = await import(pathToFileURL(path.join(tools, 'node_modules/lighthouse/core/index.js')));
  const launcher = await import(pathToFileURL(path.join(tools, 'node_modules/chrome-launcher/dist/index.js')));
  const chromePath = process.env.SEARCHLAB_CHROME || '/opt/google/chrome/chrome';
  for (const [device, p] of Object.entries(profiles)) {
    const chrome = await launcher.launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      for (let iteration = 1; iteration <= 3; iteration++) for (const cache of ['cold', 'warm']) {
        const name = `${device}-${iteration}-${cache}`;
        const result = await lighthouse(origin + '/search?q=garage', {
          port: chrome.port, output: ['json', 'html'], logLevel: 'error', onlyCategories: ['performance'],
          formFactor: device === 'mobile' ? 'mobile' : 'desktop',
          screenEmulation: { width:p.width, height:p.height, deviceScaleFactor:p.deviceScaleFactor, mobile:p.mobile, disabled:false },
          emulatedUserAgent: false, throttlingMethod: 'devtools',
          throttling: { rttMs:p.rttMs, throughputKbps:p.throughputKbps, requestLatencyMs:p.rttMs, downloadThroughputKbps:p.throughputKbps, uploadThroughputKbps:p.throughputKbps, cpuSlowdownMultiplier:p.cpuSlowdownMultiplier },
          disableStorageReset: cache === 'warm', maxWaitForLoad: 15000
        });
        fs.writeFileSync(path.join(out,name+'.json'), result.report[0]);
        fs.writeFileSync(path.join(out,name+'.html'), result.report[1]);
        const trace = result.artifacts.Trace;
        if (trace) fs.writeFileSync(path.join(out,name+'-trace.json'),JSON.stringify(trace));
        const a = result.lhr.audits;
        const audits = Object.fromEntries(['first-contentful-paint','largest-contentful-paint','cumulative-layout-shift','server-response-time','total-blocking-time','speed-index','bootup-time','mainthread-work-breakdown','total-byte-weight'].map(key=>[key,a[key]?.numericValue ?? null]));
        rows.push({kind:'lighthouse',device,iteration,cache,label,origin,lighthouseVersion:result.lhr.lighthouseVersion,settings:p,runtimeError:result.lhr.runtimeError ?? null,score:result.lhr.categories.performance.score,audits});
        fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(rows,null,2));
        console.log(JSON.stringify(rows.at(-1)));
      }
    } finally { await chrome.kill(); }
    const browser = await chromium.launch({ executablePath:chromePath, headless:true });
    try {
      for (let iteration=1;iteration<=3;iteration++) {
        const context = await browser.newContext({viewport:{width:p.width,height:p.height},isMobile:p.mobile,hasTouch:p.mobile});
        const page = await context.newPage(); const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:p.rttMs,downloadThroughput:p.throughputKbps*1024/8,uploadThroughput:p.throughputKbps*1024/8});
        await cdp.send('Emulation.setCPUThrottlingRate',{rate:p.cpuSlowdownMultiplier});
        await page.addInitScript(()=>{
          window.__loading = {longTasks:[],paint:[],lcp:[],cls:0,firstResults:null,firstSearchDispatch:null,queryStart:null};
          const x=window.__loading;
          for(const type of ['paint','largest-contentful-paint','layout-shift','longtask']) if(PerformanceObserver.supportedEntryTypes.includes(type)) new PerformanceObserver(list=>{for(const e of list.getEntries()){
            if(type==='paint') x.paint.push({name:e.name,startTime:e.startTime});
            if(type==='largest-contentful-paint')x.lcp.push(e.startTime);
            if(type==='layout-shift'&&!e.hadRecentInput)x.cls+=e.value;
            if(type==='longtask')x.longTasks.push({start:e.startTime,duration:e.duration});
          }}).observe({type,buffered:true});
          const fetchOriginal=window.fetch;
          window.fetch=function(...args){if(String(args[0]).includes('/api/search')&&x.firstSearchDispatch===null)x.firstSearchDispatch=performance.now();return fetchOriginal.apply(this,args)};
          new MutationObserver(()=>{if(x.firstResults===null&&document.querySelector('.result-select'))x.firstResults=performance.now()}).observe(document,{subtree:true,childList:true});
        });
        for (const cache of ['cold','warm']) {
          if(cache==='cold') await cdp.send('Network.clearBrowserCache');
          const network=[]; page.removeAllListeners('response');
          page.on('response',async response=>{if(response.url().endsWith('/api/search'))try{network.push(await response.json())}catch{}});
          await page.goto(origin+'/search?q=garage');
          await expectCount(page,18);
          await page.waitForTimeout(300);
          const initial=await page.evaluate(()=>({measurements:window.__loading,navigation:performance.getEntriesByType('navigation')[0].toJSON(),resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),hydrationMarker:performance.getEntriesByName('searchlab-hydrated')[0]?.startTime ?? null}));
          await page.evaluate(()=>{window.__loading.queryStart=performance.now()});
          await page.getByTestId('search-input').fill('pool');
          await page.waitForFunction(()=>document.querySelector('[data-testid="results-count"]')?.textContent==='31 matches'&&document.querySelector('.results-workspace')?.getAttribute('aria-busy')==='false');
          const queryVisible=await page.evaluate(()=>performance.now()-window.__loading.queryStart);
          const data=network.find(x=>x.provenance)?.provenance;
          if(data?.dataset?.databaseFingerprint!=='881e3b5660242affee21832c'||data.dataset.count!==126)throw new Error('Unexpected dataset identity');
          rows.push({kind:'scripted',device,iteration,cache,label,origin,settings:p,initial,queryVisibleMs:queryVisible,backend:network.map(x=>({total:x.totalHits,provenance:x.provenance,gatewayTimingMs:x.gatewayTimingMs,browserFetchMs:x.browserFetchMs}))});
          fs.writeFileSync(path.join(out,`${device}-${iteration}-${cache}-scripted.json`),JSON.stringify(rows.at(-1),null,2));
          fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(rows,null,2));
          await page.screenshot({path:path.join(out,`${device}-${iteration}-${cache}-scripted.png`)});
        }
        await context.close();
      }
    } finally { await browser.close(); }
  }
  console.log(JSON.stringify({label,out,runs:rows.length}));
})().catch(e=>{console.error(e);process.exit(1)});
async function expectCount(page,n){await page.waitForFunction(n=>document.querySelectorAll('.result-card').length===n,n)}
