/* Exercise the extracted Windows app through its real loopback HTTP server. */
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert');
const origin=process.argv[2],out=path.resolve(process.argv[3]);
const fixtures=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../play/tests/legal-fixtures.json')));
const checks=[],errors=[],external=[];
let browser;
function check(name,pass,detail){
  checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})});
  console.log(name,!!pass);assert(pass,name+' '+JSON.stringify(detail));
}
function executable(){
  if(process.env.CHROME_PATH)return process.env.CHROME_PATH;
  for(const base of [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA]){
    if(!base)continue;
    for(const relative of ['Microsoft/Edge/Application/msedge.exe','Google/Chrome/Application/chrome.exe']){
      const candidate=path.join(base,relative);if(fs.existsSync(candidate))return candidate;
    }
  }
}
(async()=>{
  const exe=executable();browser=await chromium.launch({headless:true,...(exe?{executablePath:exe}:{})});
  const context=await browser.newContext({viewport:{width:1470,height:1000},reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(120000);
  page.on('pageerror',e=>errors.push(e.message));
  context.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url());});
  await page.goto(origin+'/?tutorial=0');await page.waitForSelector('#tiers .card');
  check('Bundled local page renders all public cards',await page.locator('#tiers .card').count()===12);
  check('Simple bot and all four local profiles appear',JSON.stringify(await page.locator('#opponent-select option').evaluateAll(xs=>xs.map(x=>x.value)))===JSON.stringify(['simple','easy','medium','hard','hell']));
  check('Original five gem companions retained',await page.evaluate(()=>COMPANIONS.length===5&&COMPANIONS.every(c=>c.styles.pet&&c.styles.classic)));
  check('Project and third-party licenses embedded',await page.evaluate(()=>JSON.parse(document.getElementById('third-party-notices').textContent).project_license.includes('Adam Jones')));
  for(const [profile,model,budget] of [['easy','s422-100M',0],['medium','s422-200M',0],['hard','PV422',128],['hell','PV422',256]]){
    await page.locator('#settings-btn').click();
    await page.locator('#opponent-select').selectOption(profile);
    await page.locator('input[name="seat"][value="1"]').check();
    await page.locator('#settings-form button[type="submit"]').click();
    await page.waitForFunction(()=>!aiThinking&&!humanBusy&&game.current()===humanSeat);
    const state=await page.evaluate(()=>({decision:lastPolicyDecision,error:gameError,session:sessionVersion,log:log.length}));
    check(profile+' makes a real legal move with exact model/budget',!state.error&&state.log>0&&state.decision?.session===state.session&&state.decision.model_id===model&&state.decision.simulations===budget,state);
  }
  // Test prompt independence through visible settings, then the visible hint button.
  await page.locator('#settings-btn').click();
  await page.locator('#opponent-select').selectOption('easy');
  await page.locator('#local-hint-select').selectOption('hell');
  await page.locator('input[name="seat"][value="0"]').check();
  await page.locator('#settings-form button[type="submit"]').click();
  await page.waitForFunction(()=>!aiThinking&&!humanBusy);
  const before=await page.evaluate(()=>JSON.stringify(currentState()));
  await page.locator('#companion-toggle').press('Enter');await page.locator('#hint-get').click();
  await page.waitForFunction(()=>!hintState.pending);
  check('Hell hint is independent of easy opponent and does not play',await page.evaluate(before=>opponentMode==='easy'&&hintState.result?.binding.policy==='hell'&&JSON.stringify(currentState())===before,before));
  check('Hint explains an identifiable action in Chinese',await page.locator('#hint-result').innerText().then(t=>/[取买购预留归还选择]/.test(t)));
  await page.screenshot({path:path.join(out,'windows-hint.png')});
  await page.locator('#companion-panel-close').click();
  await page.locator('#settings-btn').click();await page.locator('#local-hint-select').selectOption('off');await page.locator('#settings-cancel').click();
  check('Hints can be disabled without changing the opponent',await page.evaluate(()=>localHintProfile==='off'&&opponentMode==='easy'&&!companionCanHint()));
  // Use real replay states to check the wire adapter in every auxiliary action phase.
  for(const profile of ['medium','hard','hell'])for(const phase of ['pay','discard','noble']){
    const result=await page.evaluate(async({profile,f})=>{
      const g=new wasm_bindgen.WasmGame(2,BigInt(f.seed));
      try{
        for(const action of f.actions)g.apply_index(action);
        const actor=g.current(),phases=[];
        while(g.current()===actor&&g.phase()!=='Play'&&g.phase()!=='GameOver'&&phases.length<32){
          const observation=JSON.parse(g.observation_json(g.current())),mask=Array.from(g.mask());
          const binding={session:sessionVersion,revision:actionRevision,actor:g.current(),phase:g.phase()};
          const r=await requestLocalAction(profile,observation,mask,binding,'test');
          if(!mask[r.index])throw Error('Illegal local action');
          phases.push(g.phase());g.apply_index(r.index);
        }
        return {phases,ended:g.current()!==actor||g.phase()==='Play'||g.phase()==='GameOver'};
      }finally{g.free();}
    },{profile,f:fixtures[phase]});
    check(profile+' settles '+phase,result.ended&&result.phases.length>0,result);
  }
  // A complete game verifies repeated inference, visible UI updates and scoring.
  for(const profile of ['simple','medium']){
    await page.evaluate(profile=>{
      newGame(0,profile,0);
      // Fixed shuffle makes a CI failure reproducible across runs.
      game.free();game=new wasm_bindgen.WasmGame(2,9917000000000000n);
      cardArt.reset();refreshLegal();render();
    },profile);
    const result=await page.evaluate(async()=>{
      let moves=0;const deadline=performance.now()+180000;
      while(game.phase()!=='GameOver'&&!gameError&&moves<500&&performance.now()<deadline){
        if(game.current()!==humanSeat)throw Error('Opponent did not finish its turn');
        if(!applyHuman(game.greedy_index()))throw Error('Legal human fixture action failed');
        moves++;
        while(aiThinking||humanBusy)await new Promise(r=>setTimeout(r,5));
      }
      return {mode:opponentMode,moves,over:game.phase()==='GameOver',error:gameError,winners:Array.from(game.winners())};
    });
    check(profile+' completes a full local game',result.over&&!result.error,result);
  }
  await page.evaluate(()=>newGame(0,'simple',0));
  const payload=await page.evaluate(()=>({request_id:'http-tests',profile:'medium',
    observation:JSON.parse(game.observation_json(game.current())),legal_mask:Array.from(game.mask()),
    binding:{actor:game.current(),phase:game.phase(),session:sessionVersion,revision:actionRevision}}));
  const headers={'Content-Type':'application/json','Origin':origin,'X-Splendor-Local':'1'};
  const http=context.request;
  check('Model weights are not exposed as HTTP files',(await http.get(origin+'/models/weights/PV422-inference.pt')).status()===404);
  check('Foreign origin rejected',(await http.post(origin+'/api/infer',{headers:{...headers,Origin:'https://example.invalid'},data:payload})).status()===403);
  check('Missing local request header rejected',(await http.post(origin+'/api/infer',{headers:{'Origin':origin},data:payload})).status()===403);
  const bad=JSON.parse(JSON.stringify(payload));bad.observation.decks=[[],[],[]];
  check('Private observation fields rejected',(await http.post(origin+'/api/infer',{headers,data:bad})).status()===400);
  const invalid=JSON.parse(JSON.stringify(payload));invalid.profile='invalid-profile';
  check('Unknown model profile rejected',(await http.post(origin+'/api/infer',{headers,data:invalid})).status()===400);
  let cancelled=false;
  for(let attempt=0;attempt<3&&!cancelled;attempt++){
    const data={...payload,profile:'hell',request_id:'cancel-'+attempt};
    const pending=http.post(origin+'/api/infer',{headers,data});
    await new Promise(r=>setTimeout(r,100));
    const cancellation=await http.post(origin+'/api/cancel',{headers,data:{request_id:data.request_id}});
    const response=await pending;
    check('Cancellation endpoint accepts request '+attempt,cancellation.status()===200);
    cancelled=response.status()===409;
  }
  check('In-flight PV search is actually cancelled',cancelled);
  const stale=await page.evaluate(async()=>{
    setLocalHintProfile('hell');requestHint();newGame(0,'simple',0);
    await new Promise(r=>setTimeout(r,300));
    return !hintState.pending&&!hintState.result&&!gameError&&log.length===0;
  });
  check('New game discards an in-flight hint',stale);
  check('No external service is contacted',external.length===0,external);
  check('No browser script errors',errors.length===0,errors);
  const report={passed:true,browser:await browser.version(),checks,errors,external_requests:external};
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify(report,null,2));
  console.log('PASSED',checks.length,'local browser checks');
})().catch(error=>{
  fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({passed:false,checks,errors,external_requests:external,error:String(error)},null,2));
  console.error(error);process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close();});
