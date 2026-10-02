// Optional real-Chrome audit. Start npm run serve first; install Playwright separately.
// PLAYWRIGHT_MODULE / CHROME_PATH can point to an existing installation.
// node tools/verify-sustain-transitions.cjs [output-directory] [baseline-git-ref]
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const Core = require("../js/music-core.js")
const project = path.resolve(__dirname, "..")
const out = path.resolve(process.argv[2] || path.join(project, "output/sustain-review"))
const baseline = process.argv[3]
const SR = Number(process.env.SAMPLE_RATE) || 48000
fs.mkdirSync(out, { recursive: true })
const cases = [
  { name: "violin-long", label: "바이올린 긴 솔", id: "violin", end: 6, notes: [[0,67]] },
  { name: "cello-long", label: "첼로 긴 솔", id: "cello", end: 6, notes: [[0,67]] },
  { name: "violin-change", label: "바이올린 솔 → 라", id: "violin", end: 3, notes: [[0,55],[1,57]] },
  { name: "violin-tremor", label: "바이올린 솔·라 경계 떨림", id: "violin", end: 3, notes: [[0,55], ...Array.from({length:40},(_,i)=>[.5+i*.05,i%2?55:57])] },
  { name: "haegeum-phrase", label: "해금 솔 → 도 → 미 → 라", id: "haegeum", end: 5, notes: [[0,55],[1,60],[2,64],[3,57]] },
  { name: "viola-low-g", label: "비올라 맨 아래 솔 (조율 검토 중)", id: "viola", end: 5, notes: [[0,55]] },
  { name: "viola-high-f", label: "비올라 위쪽 파 (조율 검토 중)", id: "viola", end: 5, notes: [[0,77]] },
]

async function audit(page, variant) {
  await page.goto((process.env.STUDIO_URL || "http://127.0.0.1:4173/studio.html"))
  await page.waitForFunction(()=>window.AudioEngine && window.SoundDrawing)
  await page.evaluate((sr)=>{
    window.audit = { sr, decode: new OfflineAudioContext(1,sr,sr), cache: new Map() }
    audit.get = async (src) => {
      if (!audit.cache.has(src)) audit.cache.set(src, fetch(src).then(r=>{if(!r.ok)throw Error(src);return r.arrayBuffer()}).then(b=>audit.decode.decodeAudioData(b)))
      return audit.cache.get(src)
    }
    audit.base64 = (data) => {
      const bytes = new Uint8Array(data.buffer,data.byteOffset,data.byteLength)
      let str = ""
      for(let i=0;i<bytes.length;i+=8192)str+=String.fromCharCode(...bytes.subarray(i,i+8192))
      return btoa(str)
    }
    audit.y = (midi)=>1-([55,57,59,60,62,64,65,67,69,71,72,74,76,77,79].indexOf(midi)+.5)/15
    audit.fixture = async (item) => {
      const recipe={duration:item.end, atmosphere:"none", instrument:item.id, style:item.id==="haegeum"?"gugak":"bright", version:"balanced", mode:"melody",
        strokes:[item.notes.concat([[item.end,item.notes.at(-1)[1]]]).map(([t,m])=>({x:t/item.end,y:audit.y(m)}))],strokeInstruments:[item.id]}
      const engine=new AudioEngine(), plan=engine.resolvePlan(recipe,[]), asset=plan.melodyAsset
      const events=item.notes.map(([time,uiMidi])=>({time,uiMidi,midi:SDAudioPlan.playbackMidiForInstrument(uiMidi,plan.instrument,asset),velocity:.7}))
      plan.strokeSegments=[{start:0,end:item.end,duration:item.end,events}]
      const buffers={melody:null,melodySamples:{}}
      for(const ev of events){const seg=SDAudioPlan.nearestSampleSegment(asset,ev.midi);const src=asset.sampleMode==="multi"?seg.src:asset.src;const buf=await audit.get(src);buffers.melodySamples[seg.midi]=buf;buffers.melody=buf;engine.decodedCache.set(src,buf)}
      return {recipe,engine,plan,buffers}
    }
    audit.render = async (item) => {
      const {engine,plan,buffers}=await audit.fixture(item), sr=audit.sr
      if(item.uncalibrated)plan.melodyAsset=Object.assign({},plan.melodyAsset,{sampleMap:plan.melodyAsset.sampleMap.map(s=>Object.assign({},s,{tuningCents:0}))})
      const ctx=new OfflineAudioContext(1,Math.ceil((item.end+.1)*sr),sr), sources=[], nodes=[]
      const create=ctx.createBufferSource.bind(ctx)
      ctx.createBufferSource=()=>{const src=create(),start=src.start.bind(src),record={};src.start=(...args)=>{record.start=args;start(...args)};sources.push(record);return src}
      engine.scheduleSampleStrokes(ctx,ctx.destination,plan,plan.strokeSegments,buffers,0,n=>nodes.push(n))
      const pcm=(await ctx.startRendering()).getChannelData(0)
      const seeks=[]
      if(item.id==="haegeum")for(const cut of [1.09,1.25,2.12,4.5]){
        const seek=engine.seekPlan(plan,cut), oc=new OfflineAudioContext(1,Math.ceil((item.end+.1-cut)*sr),sr)
        engine.scheduleSampleStrokes(oc,oc.destination,seek,seek.sourceStrokeSegments,buffers,0,()=>{})
        const data=(await oc.startRendering()).getChannelData(0)
        let error=0,energy=0,step=0
        for(let i=Math.round(.08*sr);i<Math.min(data.length-.01*sr,.6*sr);i++){const k=Math.round(cut*sr)+i;error+=(data[i]-pcm[k])**2;energy+=pcm[k]**2;step+=(pcm[k+1]-pcm[k])**2}
        seeks.push({cut,relativeError:Math.sqrt(error/energy),oneSampleChange:Math.sqrt(step/energy)})
      }
      // A controlled pair of orthogonal tones isolates envelope loss from source dynamics.
      let powerDipDb=null
      if(item.name==="violin-change"){
        const oc=new OfflineAudioContext(1,3*sr,sr), tones={}
        for(const [m,hz]of [[55,1000],[57,2000]]){const b=oc.createBuffer(1,2*sr,sr),x=b.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=.1*Math.sin(2*Math.PI*hz*i/sr);tones[m]=b}
        const synthetic=Object.assign({},plan,{instrument:{id:"test",group:"서양"},melodyAsset:{sampleMode:"multi",src:"test",sampleMap:[{midi:55,src:"g"},{midi:57,src:"a"}]}})
        const ss=[];engine.scheduleSampleStrokes(oc,oc.destination,synthetic,plan.strokeSegments,{melody:tones[55],melodySamples:tones},0,n=>ss.push(n))
        const data=(await oc.startRendering()).getChannelData(0), transition=1+(SDAudioPlan.DRAWING_PITCH_SETTLE_SECONDS||0)
        const power=(a,b)=>{let e=0;for(let i=Math.round(a*sr);i<Math.round(b*sr);i++)e+=data[i]**2;return e/Math.round((b-a)*sr)}
        powerDipDb=10*Math.log10(power(transition+.017,transition+.023)/power(.7,.9))
      }
      return {name:item.name,sourceCount:sources.length,starts:sources.map(s=>s.start),seeks,powerDipDb,pcm:audit.base64(pcm)}
    }
  }, SR)
  const reports=[]
  for(const item of cases){
    const result=await page.evaluate(item=>audit.render(item),item)
    const raw=Buffer.from(result.pcm,"base64"), data=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4)
    fs.writeFileSync(path.join(out,`${variant}-${item.name}.f32`),raw)
    fs.writeFileSync(path.join(out,`${variant}-${item.name}.wav`),Buffer.from(Core.encodeWav({sampleRate:SR,numberOfChannels:1,length:data.length,getChannelData:()=>data})))
    delete result.pcm;reports.push(result)
    if(variant==="after" && item.id==="viola"){
      const comparison=await page.evaluate(item=>audit.render(Object.assign({},item,{uncalibrated:true})),item)
      const raw=Buffer.from(comparison.pcm,"base64"), data=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4)
      fs.writeFileSync(path.join(out,`untuned-${item.name}.wav`),Buffer.from(Core.encodeWav({sampleRate:SR,numberOfChannels:1,length:data.length,getChannelData:()=>data})))
    }
  }
  const live=await page.evaluate(async()=>{
    const item={id:"violin",end:3,notes:[[0,55],[1,57]]}, {engine,recipe}=await audit.fixture(item)
    const ctx=engine.ensureContext();await ctx.resume()
    let sources=0;const create=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{sources++;return create()}
    await engine.liveDrawingStart(recipe,audit.y(55))
    await new Promise(r=>setTimeout(r,150))
    for(let i=0;i<40;i++){await engine.liveDrawingMove(recipe,audit.y(i%2?55:57));await new Promise(r=>setTimeout(r,45))}
    const tremorSources=sources
    await engine.liveDrawingMove(recipe,audit.y(57));await new Promise(r=>setTimeout(r,100))
    const settledSources=sources
    await engine.liveDrawingMove(recipe,audit.y(59));engine.liveDrawingEnd();await new Promise(r=>setTimeout(r,150))
    const endedSources=sources, pending=!!engine.livePending
    engine.stopLivePreview(true);await ctx.close()
    return {tremorSources,settledSources,endedSources,pending}
  })
  const exported=await page.evaluate(async()=>{
    const {engine,recipe}=await audit.fixture({id:"violin",end:2,notes:[[0,55]]})
    const blob=await engine.renderCompressedAudioBlob(recipe,[])
    const raw=new Uint8Array(await blob.arrayBuffer())
    await engine.ctx.close()
    return {type:blob.type,size:blob.size,pcm:audit.base64(raw)}
  })
  fs.writeFileSync(path.join(out,`${variant}-first-note.webm`),Buffer.from(exported.pcm,"base64"));delete exported.pcm
  const canvas=[]
  if(variant==="after")for(const mode of ["picture","sound"]){
    const rect=await page.evaluate(mode=>{
      SoundDrawing.stop();SoundDrawing.loadRecipe({duration:30,atmosphere:"none",instrument:"violin",style:"bright",version:"balanced",mode:"melody",strokes:[],strokeInstruments:[],path:[]})
      SoundDrawing.setStep(2);SoundDrawing.setDrawingInputMode(mode)
      window.drawSourceCount=0
      if(!window.originalSamplePreview){window.originalSamplePreview=AudioEngine.prototype._createSampleLivePreview;AudioEngine.prototype._createSampleLivePreview=function(...args){if(this===SoundDrawing.engine)window.drawSourceCount++;return window.originalSamplePreview.apply(this,args)}}
      const r=SoundDrawing.draw.canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}
    },mode)
    await page.mouse.move(rect.x+20,rect.y+rect.height*(1-.5/15));await page.mouse.down()
    await page.waitForFunction(()=>SoundDrawing.engine.livePreview && SoundDrawing.engine.livePreview.kind==="sample")
    for(let i=0;i<40;i++){await page.mouse.move(rect.x+22+i*2,rect.y+rect.height*(14/15)+(i%2?2:-2));await page.waitForTimeout(25)}
    const held=await page.evaluate(()=>({sources:window.drawSourceCount,midi:SoundDrawing.engine.livePreview.midi}))
    await page.mouse.up();await page.waitForTimeout(160)
    const ended=await page.evaluate(async()=>{
      const engine=SoundDrawing.engine,recipe=SoundDrawing.buildRecipe(),plan=engine.resolvePlan(recipe,[]),ctx=new OfflineAudioContext(1,48000,48000),sources=[]
      const buffers=await engine.preload(ctx,plan)
      engine.scheduleSampleStrokes(ctx,ctx.destination,plan,plan.strokeSegments,buffers,0,n=>sources.push(n))
      return {released:engine.livePreview===null,playSources:sources.length,strokeCount:recipe.strokes.length}
    })
    canvas.push({mode,...held,...ended})
  }
  return {variant,sampleRate:SR,reports,live,exported,canvas}
}

;(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,headless:true,args:["--autoplay-policy=no-user-gesture-required","--mute-audio"]})
  const results=[]
  try {
    for(const variant of baseline?["before","after"]:["after"]){
      const page=await browser.newPage(),errors=[]
      page.on("pageerror",e=>errors.push(e.message))
      if(variant==="before")for(const file of ["music-core.js","audio-plan.js","audio-engine.js","sample-calibration.js","drawing.js","studio-utils.js","studio.js"]){
        const body=execFileSync("git",["show",`${baseline}:js/${file}`],{cwd:project,encoding:"utf8",maxBuffer:2**22})
        await page.route(`**/js/${file}*`,route=>route.fulfill({body,contentType:"text/javascript"}))
      }
      const result=await audit(page,variant);result.errors=errors;results.push(result)
      await page.close();console.log(JSON.stringify(result))
    }
  } finally {await browser.close()}
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(results,null,2))
  const rows=cases.concat([{name:"first-note",label:"내보낸 곡의 첫 음",extension:"webm"}])
  const body=rows.map(c=>`<section><h2>${c.label}</h2>${results.map(r=>`<label>${r.variant==="before"?"수정 전":"수정 후"}<audio controls preload="none" src="${r.variant}-${c.name}.${c.extension||"wav"}"></audio></label>`).join("")}${c.id==="viola"?`<label>조율 보정 끔 (검토용)<audio controls preload="none" src="untuned-${c.name}.wav"></audio></label>`:""}</section>`).join("")
  fs.writeFileSync(path.join(out,"index.html"),`<!doctype html><html lang="ko"><meta charset="utf-8"><title>지속음 수정 전후 비교</title><style>body{max-width:900px;margin:40px auto;font:18px system-ui;background:#f6f4ee;color:#222}section{padding:18px;background:white;margin:18px 0;border-radius:12px}h2{font-size:20px}label{display:inline-block;margin-right:28px}audio{display:block;width:360px;margin-top:8px}p{line-height:1.6}</style><h1>지속음 수정 전후 비교</h1><p>같은 볼륨에서 차례로 들어보세요. 경계 떨림의 끊김, 현악기의 자연스러운 출렁임, 해금의 미끄러짐, 곡 첫머리의 활·숨 소리를 비교합니다. 비올라 두 음은 기존 조율 후보값을 유지했으며, 보정을 끈 비교음도 함께 두었습니다.</p>${body}</html>`)
  const after=results.at(-1)
  if(after.errors.length || after.live.tremorSources!==1 || after.live.settledSources!==2 || after.live.endedSources!==2 || after.live.pending || after.canvas.some(c=>c.sources!==1||!c.released||c.playSources!==1) || after.reports.find(r=>r.name==="violin-tremor").sourceCount!==1 || Math.abs(after.reports.find(r=>r.powerDipDb!=null).powerDipDb)>.5 || after.reports.some(r=>r.seeks.some(s=>s.relativeError>s.oneSampleChange+.005)))process.exitCode=1
})().catch(e=>{console.error(e);process.exitCode=1})
