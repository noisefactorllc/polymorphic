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
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  // Boot compiles a real WebGL shader + fetches handfish, so give each test
  // headroom on a cold or loaded machine.
  timeout: 60000,
  use: { baseURL: 'http://localhost:3017' },
  webServer: {
    command: 'npx serve public -l 3017',
    url: 'http://localhost:3017',
    reuseExistingServer: true,
    timeout: 30000,
  },
})
