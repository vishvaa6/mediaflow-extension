const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
const bridge=fs.readFileSync(path.join(root,'src/pages/injectedMain/index.js'),'utf8');

(async()=>{
  const {t:domains}=await import('../assets/js/domains.DYqUrMEj.js');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const matches=manifest.content_scripts.find(script=>script.js?.includes('src/pages/injectedMain/index.js')).matches;
  for(const domain of domains)assert.ok(matches.includes(`https://*.${domain}/*`),`${domain} must load the player bridge`);
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:640,height:480}});
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><title>Player fixture</title><video id="__global_video_player__0" width="320" height="180"></video><flt-glass-pane></flt-glass-pane><script>window.GPPlayer={_slots:[{video:document.querySelector('video'),source:'https://cdn.test/drama/hls/example/2/play.m3u8'}]};document.querySelector('flt-glass-pane').attachShadow({mode:'open'}).innerHTML='<flt-paragraph>Fixture</flt-paragraph><flt-paragraph>第2集| Episode</flt-paragraph>';</script><script>${bridge}</script>`}));
    const request=()=>page.evaluate(()=>new Promise(resolve=>{
      document.addEventListener('video-downloader:huangdou:response',event=>resolve(JSON.parse(event.detail)),{once:true});
      document.dispatchEvent(new Event('video-downloader:huangdou:request'));
    }));
    for(const domain of domains){
      await page.goto(`https://${domain}/watch`);
      const result=await request();
      assert.equal(result?.pageUrl,`https://${domain}/watch`);
      assert.equal(result?.videoUrl,'https://cdn.test/drama/hls/example/2/play.m3u8');
      assert.match(result?.title,/02/);
    }
    await page.evaluate(()=>{document.querySelector('flt-glass-pane').shadowRoot.querySelectorAll('flt-paragraph')[1].textContent='第3集| Episode';});
    assert.equal(await page.evaluate(()=>document.querySelector('flt-glass-pane').shadowRoot.querySelectorAll('flt-paragraph')[1].textContent),'第3集| Episode');
    assert.equal(await request(),null,'a player from a different episode must not be offered');
    await page.evaluate(()=>{document.querySelector('flt-glass-pane').shadowRoot.querySelectorAll('flt-paragraph')[1].textContent='第2集| Episode';window.GPPlayer._slots[0].source='javascript:alert(1)';});
    assert.equal(await request(),null,'unsafe media URLs must not be offered');
    console.log(`PASS: Huangdou player bridge on ${domains.length} configured domain aliases, including episode and URL validation.`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
