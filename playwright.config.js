import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { chromium } from 'playwright'

// Browser tests for Polymorphic. The static `public/` dir is served for the run
// (reused if a server is already up). These verify the page boots, the renderer
// comes up, and the shared <tempo-bar> component drives tempo without page or
// console errors.
//
// Pre-release: set HANDFISH_LOCAL=../handfish/dist (or an absolute path) to serve
// the handfish CDN from a local build so components not yet on the CDN — like
// <tempo-bar> — can be exercised. With the env var unset, tests run against the
// real CDN. No machine path is ever committed (see tests/tempo.spec.js).
// Real GPU where one is available. Chromium's headless default is SwiftShader,
// a software rasterizer, and these suites compile real shaders: filter/octaveWarp
// never finished booting inside 45s under SwiftShader and boots in 1s on ANGLE
// Metal. Software GL also fails to represent what a reader's machine does. macOS
// gets Metal; anywhere else falls back to SwiftShader so the run still works.
// The webgpu receiver suites also need the software WebGPU adapter, which
// Chromium only exposes under --enable-unsafe-webgpu, and whose readbacks only
// complete when Dawn runs over ANGLE Vulkan. --use-angle=vulkan changes WebGL
// rasterization for every test in the run (SVG-in-canvas specs regress), so the
// Vulkan stack applies only to the webgpu receiver spec through its own
// project. On Linux without a system Vulkan driver (and without an
// operator-provided ICD) that project runs over the SwiftShader driver bundled
// with Chromium; with a system ICD the real driver is kept and the flag stays
// inert.
function systemVulkanIcdPresent() {
    for (const dir of ['/usr/share/vulkan/icd.d', '/etc/vulkan/icd.d']) {
        try {
            if (fs.readdirSync(dir).some(name => name.endsWith('.json'))) return true
        } catch { /* No system Vulkan discovery on this machine. */ }
    }
    return false
}
const systemIcd = systemVulkanIcdPresent()
const operatorIcd = Boolean(process.env.VK_DRIVER_FILES || process.env.VK_ICD_FILENAMES)
let bundledIcd = null
if (process.platform === 'linux' && !systemIcd && !operatorIcd) {
    try {
        const icd = path.join(path.dirname(chromium.executablePath()), 'vk_swiftshader_icd.json')
        bundledIcd = fs.existsSync(icd) ? icd : null
    } catch { bundledIcd = null }
}
const softwareVulkan = operatorIcd || Boolean(bundledIcd)
const baseArgs = process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-unsafe-swiftshader', '--enable-unsafe-webgpu']
const vulkanArgs = process.platform === 'darwin'
  ? baseArgs
  : [...baseArgs, '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox']

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  // Boot compiles a real WebGL shader + fetches handfish, so give each test
  // headroom on a cold or loaded machine.
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3017',
    launchOptions: { args: baseArgs },
  },
  // Without software Vulkan one run covers every spec on the launch args above
  // (or Metal on macOS). With it, only the webgpu receiver spec moves to the
  // ANGLE Vulkan project so its legs execute; every other spec keeps the
  // launch behavior it has always had.
  projects: softwareVulkan ? [
    {
      name: 'chromium',
      testIgnore: /sync-native-webgpu\.spec\.js/,
      use: { baseURL: 'http://localhost:3017', launchOptions: { args: baseArgs } },
    },
    {
      name: 'sync-native-webgpu',
      testMatch: /sync-native-webgpu\.spec\.js/,
      use: {
        baseURL: 'http://localhost:3017',
        launchOptions: bundledIcd
          ? { args: vulkanArgs, env: { ...process.env, VK_ICD_FILENAMES: bundledIcd } }
          : { args: vulkanArgs },
      },
    },
  ] : undefined,
  webServer: {
    // scripts/serve-book.mjs, not `npx serve public`: the book builds to
    // dist/book/ and is mounted at /book, which is the layout the deploy
    // produces. Serving public/ alone would 404 every book URL.
    command: 'npm run build && node scripts/serve-book.mjs 3017',
    url: 'http://localhost:3017',
    reuseExistingServer: true,
    timeout: 120000,
  },
})