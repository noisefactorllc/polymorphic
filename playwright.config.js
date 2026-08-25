import { defineConfig } from '@playwright/test'

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
const gpuArgs = process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--enable-unsafe-swiftshader']

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  // Boot compiles a real WebGL shader + fetches handfish, so give each test
  // headroom on a cold or loaded machine.
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3017',
    launchOptions: { args: gpuArgs },
  },
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
