import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Run with the local development server already listening. This is an audit:
// success means capture completed, not that the two backends have pixel parity.
const baseURL = process.env.AUDIT_BASE_URL
if (!baseURL) throw new Error('Set AUDIT_BASE_URL to the running Polymorphic server')
const repo = fileURLToPath(new URL('../', import.meta.url))
const book = JSON.parse(readFileSync(resolve(repo, 'book/data/effects.json')))
const ids = process.env.AUDIT_IDS?.split(',')
const selected = ids ? book.effects.filter(e => ids.includes(e.id)) : book.chapters.flatMap(c => {
  const effects = book.effects.filter(e => e.chapter === c.id)
  return effects.filter((_, i) => i % Math.max(1, Math.floor(effects.length / 4)) === 0).slice(0, 4)
})
if (ids && (selected.length !== ids.length || !selected.length)) throw new Error('AUDIT_IDS must name distinct effects in book/data/effects.json')
const dir = process.env.AUDIT_OUTPUT_DIR || resolve(repo, 'test-results/backend-audit')
mkdirSync(dir, { recursive: true })
const gpuArgs = ['--enable-gpu', '--ignore-gpu-blocklist']
if (process.platform === 'darwin') gpuArgs.push('--use-angle=metal')
const browser = await chromium.launch({ args: gpuArgs })
const results = []
try {
  const releaseURL = 'https://shaders.noisedeck.app/1/deployment-meta.json'
  const release = await (await fetch(releaseURL)).json()
  const pages = {}
  for (const backend of (process.env.AUDIT_CONTROLS ? ['webgl2', 'webgpu', 'webgl2-repeat', 'webgpu-repeat'] : ['webgl2', 'webgpu'])) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
    await page.goto(`${baseURL}/?backend=${backend.split('-')[0]}&dsl=${encodeURIComponent('search synth\nsolid().write(o0)\nrender(o0)')}`)
    await page.waitForFunction(() => window.__poly?.renderer?.inner?.pipeline)
    await page.evaluate(() => window.__poly.renderer.stop())
    const identity = await page.evaluate(async () => {
      const a = await navigator.gpu?.requestAdapter()
      return { wrapper: window.__poly.backend, pipeline: window.__poly.renderer.inner.pipeline.backend.getName(), adapter: a?.info && {vendor:a.info.vendor, architecture:a.info.architecture,isFallbackAdapter:a.info.isFallbackAdapter} }
    })
    if (identity.wrapper !== backend.split('-')[0] || identity.pipeline.toLowerCase() !== backend.split('-')[0]) throw new Error(`Requested ${backend} but got ${JSON.stringify(identity)}`)
    if (!identity.adapter || identity.adapter.isFallbackAdapter) throw new Error('A physical WebGPU adapter is required')
    const { version } = await page.evaluate(async () => ({version: (await import('/js/noisemaker/bundle.js')).VERSION}))
    const metadata = {backend, identity, engineVersion:version,release, browser: browser.version(), width:256,height:144,frames:12,normalizedTimeStep:1/60}
    writeFileSync(`${dir}/${backend}-metadata.json`,JSON.stringify(metadata,null,2))
    console.log(JSON.stringify(metadata))
    pages[backend] = page
  }
  for (const effect of selected) {
    const samples = {}
    for (const [backend, page] of Object.entries(pages)) {
      const errors = []
      const onConsole = message => { if (message.type() === 'error') errors.push(message.text()) }
      const onPageError = error => errors.push(error.message)
      page.on('console', onConsole)
      page.on('pageerror', onPageError)
      const timeout = setTimeout(() => page.close(), 60000)
      try {
      samples[backend] = await page.evaluate(async ({ program, expectedBackend }) => {
        const { PolymorphicRenderer } = await import('/js/noisemaker/renderer.js')
        const canvas = document.createElement('canvas')
        const renderErrors = []
        const renderer = new PolymorphicRenderer(canvas, {width:256,height:144,preferWebGPU:expectedBackend === 'webgpu',onError:error=>renderErrors.push(String(error?.message || error))})
        let device
        const onGpuError = event => renderErrors.push(event.error.message)
        try {
          await renderer.init()
          const compile = await renderer.compile(program)
          if (!compile.success) return { error: compile.error }
          const actualBackend = renderer.inner.pipeline.backend.getName().toLowerCase()
          if (actualBackend !== expectedBackend || renderer.backend !== expectedBackend) return {error:`Expected ${expectedBackend}, got ${actualBackend} / ${renderer.backend}`}
          device = renderer.inner.pipeline.backend.device
          device?.addEventListener('uncapturederror', onGpuError)
          const probe = document.createElement('canvas'); probe.width=256;probe.height=144
          const ctx=probe.getContext('2d')
          for (let frame=0;frame<12;frame++) {
            renderer.inner.render(frame / 60)
            await new Promise(requestAnimationFrame)
          }
          await device?.queue.onSubmittedWorkDone()
          ctx.drawImage(canvas,0,0)
          if (renderErrors.length) return {error:renderErrors.join('\n')}
          const pixels = [...ctx.getImageData(0,0,256,144).data]
          return {backend:renderer.backend,pixels,png:probe.toDataURL().split(',')[1]}
        } catch (e) {return {error:e.message}} finally {device?.removeEventListener('uncapturederror', onGpuError);renderer.dispose()}
      }, { ...effect, expectedBackend: backend.split('-')[0] })
      } finally {
        clearTimeout(timeout)
        page.off('console', onConsole)
        page.off('pageerror', onPageError)
      }
      if (errors.length) samples[backend] = {error:errors.join('\n')}
    }
    const row = {id:effect.id,program:effect.program}
    if (Object.values(samples).some(sample=>sample.error)) row.errors = Object.fromEntries(Object.entries(samples).filter(([,sample])=>sample.error).map(([key,sample])=>[key,sample.error]))
    else {
      let sum=0,max=0,changed=0;const a=samples.webgl2.pixels,b=samples.webgpu.pixels
      for(let i=0;i<a.length;i+=4){let pixel=0;for(let c=0;c<4;c++){const d=Math.abs(a[i+c]-b[i+c]);sum+=d;max=Math.max(max,d);pixel=Math.max(pixel,d)}if(pixel>5)changed++}
      if (process.env.AUDIT_CONTROLS) row.repeatMae = Object.fromEntries(['webgl2','webgpu'].map(key=>[key,samples[key].pixels.reduce((sum,v,i)=>sum+Math.abs(v-samples[key+'-repeat'].pixels[i]),0)/a.length]));
      row.mae=sum/a.length;row.max=max;row.changedFraction=changed/(a.length/4)
      row.range = Object.fromEntries(Object.entries(samples).map(([key,s])=>[key,Math.max(...s.pixels.filter((_,i)=>i%4!==3))-Math.min(...s.pixels.filter((_,i)=>i%4!==3))]))
      row.flat = Object.values(samples).some(sample=>sample.pixels.every((value,index)=>value===sample.pixels[index%4]))
      for(const [backend,sample] of Object.entries(samples)) writeFileSync(`${dir}/${effect.id.replace('/','-')}-${backend}.png`,Buffer.from(sample.png,'base64'))
    }
    results.push(row);writeFileSync(`${dir}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(row))
  }
  const finalRelease = await (await fetch(releaseURL)).json()
  if (release.git_hash !== finalRelease.git_hash) throw new Error('The shader CDN changed during the audit; repeat against one release')
  if(results.some(row=>row.errors)) process.exitCode=1
} finally {await browser.close()}
