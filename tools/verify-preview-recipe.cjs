// Optional Chrome benchmark: start npm run serve first.
// node tools/verify-preview-recipe.cjs [baseline-git-ref]
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const project = path.resolve(__dirname, "..")
const baseline = process.argv[2] || "579aa6c"

;(async function () {
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,headless:true,args:["--mute-audio"]})
  const reports = []
  try {
    for (const variant of ["before", "after"]) {
      const page = await browser.newPage()
      if (variant === "before") for (const file of ["audio-plan.js", "studio.js"]) {
        const body = execFileSync("git",["show",`${baseline}:js/${file}`],{cwd:project,encoding:"utf8"})
        await page.route(`**/js/${file}*`,route=>route.fulfill({body,contentType:"text/javascript"}))
      }
      await page.goto(process.env.STUDIO_URL || "http://127.0.0.1:4173/studio.html")
      const result = await page.evaluate(() => {
        const sd = SoundDrawing, core = MusicCore
        const instruments = Array.from({length:12},(_,i)=>["violin","viola","cello","flute"][i%4])
        const strokes = instruments.map((_,voice)=>Array.from({length:343},(_,i)=>({x:i/342,y:.5+.31*Math.sin(i*.121+voice*.23)})))
        sd.loadRecipe({duration:30,atmosphere:"none",instrument:"violin",style:"bright",version:"balanced",mode:"melody",strokes,strokeInstruments:instruments})
        const actualPoints = sd.draw.getStrokes().reduce((sum,s)=>sum+s.length,0)
        let queries = 0, pitches = 0, latest
        const originalPitch = core.quantizePitch
        core.quantizePitch = function (...args) { pitches++; return originalPitch.apply(this,args) }
        const restores = []
        for (const name of ["getStrokes","getPath","getStrokeInstruments"]) {
          const original = sd.draw[name]
          restores.push(()=>{sd.draw[name]=original})
          sd.draw[name] = function (...args) { queries++; return original.apply(this,args) }
        }
        const move = sd.engine.liveDrawingMove
        // Measure the actual UI callback and plan construction, excluding asynchronous I/O/audio nodes.
        sd.engine.liveDrawingMove = recipe => { latest=sd.engine.resolvePlan(recipe,[]); return Promise.resolve() }
        const times = []
        for(let i=0;i<10;i++)sd.draw.onPreview({x:.5,y:.9})
        queries=0; pitches=0
        const batchStart=performance.now()
        for(let i=0;i<80;i++) {
          const start=performance.now()
          sd.draw.onPreview({x:.5,y:i%2?.9:.96})
          times.push(performance.now()-start)
        }
        const meanMs=(performance.now()-batchStart)/80
        sd.engine.liveDrawingMove=move
        restores.forEach(restore=>restore());core.quantizePitch=originalPitch
        times.sort((a,b)=>a-b)
        const recipe=sd.buildSharedRecipe(), encoded=core.encodeRecipe(recipe), decoded=core.decodeRecipe(encoded)
        const link=new URL(location.href);link.search="";link.hash="r="+encoded
        const countRuns = plan => plan.strokeSegments.map(s=>SDAudioPlan.sampleVoiceRuns(s.events,s.end,.07).map(r=>r.midi))
        const plan=sd.engine.resolvePlan(recipe,[])
        const raw=sd.engine.resolvePlan(Object.assign({},recipe,{strokes}),[])
        return {actualPoints,meanMs,medianMs:times[40],p95Ms:times[76],queriesPerMove:queries/80,pitchesPerMove:pitches/80,
          previewStrokeCount:latest.strokeSegments.length,linkCharacters:link.href.length,
          storedPoints:recipe.strokes.reduce((sum,s)=>sum+s.length,0),
          sameMidiSequence:JSON.stringify(countRuns(plan))===JSON.stringify(countRuns(raw)),
          codecRoundtrip:JSON.stringify(decoded)===JSON.stringify(recipe)}
      })
      reports.push({variant,...result})
      console.log(JSON.stringify(reports.at(-1)))
      await page.close()
    }
  } finally { await browser.close() }
  const directory=path.join(project,"output/preview-recipe-review")
  fs.mkdirSync(directory,{recursive:true})
  fs.writeFileSync(path.join(directory,"results.json"),JSON.stringify(reports,null,2))
  const after=reports[1]
  if(after.queriesPerMove!==0 || after.pitchesPerMove!==0 || after.previewStrokeCount!==0 || !after.sameMidiSequence || !after.codecRoundtrip || after.linkCharacters>=reports[0].linkCharacters)process.exitCode=1
})().catch(error=>{console.error(error);process.exitCode=1})
