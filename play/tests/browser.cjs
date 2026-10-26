const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const OUT=path.resolve(__dirname,'../../output/browser-validation'),FILE=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
fs.mkdirSync(OUT,{recursive:true});
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'legal-fixtures.json')));
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1470,height:1000},reducedMotion:'reduce',offline:true});
 const page=await context.newPage(),checks=[],errors=[],requests=[],games=[];
 page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
 const check=(name,pass,detail)=>{console.log(name,!!pass);checks.push({name,pass:!!pass,detail});if(!pass)throw Error(name+' '+JSON.stringify(detail))};
 await page.goto(pathToFileURL(FILE).href+'?tutorial=0');await page.waitForSelector('#tiers .card');
 check('Game opens from file path offline',await page.locator('#tiers .card').count()===12);
 check('Exactly three required opponent labels',JSON.stringify(await page.locator('#opponent-select option').allTextContents())===JSON.stringify(['简单机器人','AI模型简单','AI模型中等']));
 check('New users default to simple bot; model decoding is lazy',await page.evaluate(()=>opponentMode==='simple'&&policyClients.size===0&&!hintState.worker));
 check('Codex product credit is visible',await page.locator('.product-credit').innerText()==='Built with Codex · VibeCoding');
 check('Standalone HTML retains project and dependency licenses',await page.evaluate(()=>{const el=document.getElementById('third-party-notices'),n=JSON.parse(el.textContent);return el.type==='application/json'&&n.project_license.includes('Adam Jones')&&n.rust_dependencies.packages.length>0&&Object.keys(n.rust_license_texts).length>0&&!el.textContent.includes('<');}));
 check('Both exact frozen models embedded and hint binds independently to 200M',await page.evaluate(()=>Object.keys(POLICY_BUNDLES).length===2&&POLICY_BUNDLES.transformer100m.metadata.cumulative_samples===100000000&&POLICY_BUNDLES.transformer200m.metadata.cumulative_samples===200000000&&HINT_POLICY_META.model_id===POLICY_BUNDLES.transformer200m.metadata.model_id));
 // Record the actual asynchronous AI choices for independent CPU re-evaluation.
 await page.evaluate(()=>{window.releaseDecisions=[];const original=choosePolicyAction;choosePolicyAction=async function(key,observation,mask,binding){const result=await original(key,observation,mask,binding);releaseDecisions.push({key,observation:Array.from(observation),mask:Array.from(mask),action:result,phase:binding.phase,model_id:binding.model_id});return result;};});
 for(const mode of ['simple','transformer100m','transformer200m'])for(const seat of [0,1]){
  await page.locator('#settings-btn').click();const old=await page.evaluate(()=>opponentMode);await page.locator('#opponent-select').selectOption(mode);await page.locator(`input[name="seat"][value="${seat}"]`).check();
  check(mode+'/seat'+seat+' settings only apply when starting a new game',await page.evaluate(old=>opponentMode===old,old));
  await page.locator('#settings-form button[type="submit"]').click();await page.waitForFunction(()=>!aiThinking&&!humanBusy);
  const result=await page.evaluate(async()=>{
   let moves=0;const started=performance.now();
   while(game.phase()!=='GameOver'&&!gameError&&moves<500&&performance.now()-started<120000){
    if(game.current()!==humanSeat)throw Error('AI failed to return turn');
    if(!applyHuman(game.greedy_index()))throw Error('Human fixture rejected a legal action');moves++;
    while(aiThinking||humanBusy)await new Promise(r=>setTimeout(r,2));
   }
   return {mode:opponentMode,seat:humanSeat,over:game.phase()==='GameOver',moves,error:gameError,winners:Array.from(game.winners()),round:game.round(),lastDecision:lastPolicyDecision};
  });
  games.push(result);check(mode+'/seat'+seat+' completes full offline game',result.over&&!result.error,result);
  if(mode!=='simple')check(mode+' really uses matching checkpoint',result.lastDecision?.model_id===(mode==='transformer100m'?'original-transformer160x4-s422-t100000000':'original-transformer160x4-s422-t200000000'));
 }
 // Every non-Play phase is exercised against both real AI weights, from legal replays.
 for(const mode of ['transformer100m','transformer200m'])for(const phase of ['pay','discard','noble']){
  const result=await page.evaluate(async({mode,f})=>{
   const g=new wasm_bindgen.WasmGame(2,BigInt(f.seed));for(const a of f.actions)g.apply_index(a);
   const actor=g.current(),phases=[];let legal=true;
   while(g.current()===actor&&g.phase()!=='Play'&&g.phase()!=='GameOver'&&phases.length<32){
    const m=POLICY_BUNDLES[mode].metadata,binding={session:sessionVersion,revision:actionRevision,actor,phase:g.phase(),model_id:m.model_id,weights_sha256:m.weights_sha256};
    const action=await choosePolicyAction(mode,g.encode(),g.mask(),binding);phases.push(g.phase());
    if(!Array.from(g.legal_indices()).includes(action)){legal=false;break;}g.apply_index(action);
   }
   const ended=g.current()!==actor||g.phase()==='Play'||g.phase()==='GameOver';g.free();return {legal,phases,ended};
  },{mode,f:fixtures[phase]});check(mode+' settles '+phase,result.legal&&result.ended&&result.phases.length>0,result);
 }
 await page.evaluate(()=>newGame(0,'transformer100m',0));
 await page.locator('#companion-toggle').press('Enter');const before=await page.evaluate(()=>JSON.stringify(currentState()));
 await page.locator('#hint-get').click();await page.waitForFunction(()=>!hintState.pending);
 check('Hint always uses 200M with 100M opponent and does not play',await page.evaluate(before=>hintState.result?.binding.policy===POLICY_BUNDLES.transformer200m.metadata.model_id&&JSON.stringify(currentState())===before,before));
 const serial=await page.evaluate(()=>hintState.requestSerial);await page.locator('#hint-get').click();check('Same-state hint cache remains valid',await page.evaluate(n=>hintState.requestSerial===n,serial));
 await page.screenshot({path:path.join(OUT,'offline-transformer-hint.png')});await page.locator('#companion-panel-close').click();
 await page.locator('#settings-btn').click();for(const style of ['classic','pet'])for(const id of ['jade','ruby','amber','sapphire','violet']){await page.locator(`[data-companion-style="${style}"]`).click();await page.locator(`[data-companion="${id}"]`).click();}
 check('All gem companion styles switch without changing model or valid hint',await page.evaluate(()=>companionPrefs.character==='violet'&&companionPrefs.style==='pet'&&opponentMode==='transformer100m'&&hintIsCurrent(hintState.result.binding)));
 await page.screenshot({path:path.join(OUT,'offline-transformer-settings.png')});await page.locator('#settings-cancel').click();
 const responsiveness=await page.evaluate(async()=>{
  const meta=POLICY_BUNDLES.transformer200m.metadata,binding={session:sessionVersion,revision:actionRevision,actor:game.current(),phase:game.phase(),model_id:meta.model_id,weights_sha256:meta.weights_sha256};
  let ticks=0;const interval=setInterval(()=>ticks++,10),client=policyClients.get('transformer200m');
  await Promise.all(Array.from({length:20},()=>choosePolicyAction('transformer200m',game.encode(),game.mask(),binding)));
  clearInterval(interval);return {ticks,cached:policyClients.get('transformer200m')===client};
 });check('Repeated inference stays in cached Worker while UI timers run',responsiveness.ticks>10&&responsiveness.cached,responsiveness);
 const cancelled=await page.evaluate(async()=>{
  const m=POLICY_BUNDLES.transformer200m.metadata;
  const p=choosePolicyAction('transformer200m',game.encode(),game.mask(),{session:sessionVersion,revision:actionRevision,actor:game.current(),phase:game.phase(),model_id:m.model_id,weights_sha256:m.weights_sha256}).then(()=>false,()=>true);
  newGame(0,'simple',0);return await p;
 });check('New game cancels in-flight opponent calculation',cancelled&&await page.evaluate(()=>opponentMode==='simple'&&!gameError&&log.length===0));
 const staleHint=await page.evaluate(()=>{requestHint();const old=hintState.worker,binding={...hintState.pending};newGame(0,'simple',0);old.onmessage({data:{type:'hint',binding,steps:[{index:15}],initialMask:Array.from(game.mask()),lines:['STALE']}});return !hintState.pending&&!hintState.result&&!$('hint-result').textContent.includes('STALE');});check('Late hint cannot cross sessions',staleHint);
 // The same stale-session rule protects the application AI loop, not only its client.
 await page.evaluate(()=>{newGame(1,'transformer200m',0);newGame(0,'simple',0);});await page.waitForTimeout(250);
 check('Replacing AI-first game leaves the new board untouched',await page.evaluate(()=>!gameError&&!aiThinking&&!humanBusy&&game.current()===humanSeat&&log.length===0));
 const timer=await context.newPage();timer.on('pageerror',e=>errors.push(e.message));await timer.clock.install();await timer.goto(pathToFileURL(FILE).href);await timer.waitForSelector('#tiers .card');
 await timer.evaluate(()=>{newGame(0,'simple',5);requestHint();});await timer.clock.fastForward(5100);await timer.waitForFunction(()=>!humanBusy&&!aiThinking);
 check('Timeout cancels hints and completes turn',await timer.evaluate(()=>log.some(l=>l.verb==='回合超时')&&!hintState.pending&&!hintState.result&&!gameError));await timer.close();
 fs.writeFileSync(path.join(OUT,'actual-browser-decisions.json'),JSON.stringify(await page.evaluate(()=>releaseDecisions)));
 for(const [legacy,expected] of [['transformer40m','transformer100m'],['transformer100m','transformer200m'],['policy','transformer200m'],['simple','simple'],['unknown-removed-model','simple']]){
  await page.evaluate(legacy=>{localStorage.removeItem(opponentPrefKey);localStorage.setItem('splendor-opponent-v1',legacy);},legacy);await page.reload();await page.waitForSelector('#tiers .card');
  check('Legacy difficulty migration '+legacy,await page.evaluate(expected=>opponentMode===expected&&localStorage.getItem(opponentPrefKey)===expected,expected));
 }
 await page.evaluate(()=>{localStorage.setItem(opponentPrefKey,'transformer100m');localStorage.setItem('splendor-opponent-v1','transformer100m');});await page.reload();await page.waitForSelector('#tiers .card');
 check('New 100M simple preference never migrates again',await page.evaluate(()=>opponentMode==='transformer100m'));
 await page.evaluate(()=>localStorage.setItem(opponentPrefKey,'unknown-removed-model'));await page.reload();await page.waitForSelector('#tiers .card');check('Invalid current preference returns to simple bot',await page.evaluate(()=>opponentMode==='simple'));
 check('No HTTP/HTTPS requests in offline game test',requests.length===0,requests);check('No page errors',errors.length===0,errors);
 fs.writeFileSync(path.join(OUT,'package-validation.json'),JSON.stringify({checks,games,errors,requests},null,2));console.log('PASSED',checks.length);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
