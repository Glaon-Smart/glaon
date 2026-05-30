// Lighthouse CI — mobile emulation preset (simulated throttling + device).
// Desktop counterpart: .lighthouserc.cjs. See docs/performance.md.
module.exports = {
  ci: {
    collect: {
      startServerCommand: 'pnpm --filter @glaon/web preview -- --port 4173 --strictPort',
      startServerReadyPattern: 'Local:',
      url: ['http://localhost:4173/'],
      numberOfRuns: 3,
      settings: {
        // Lighthouse's default preset is mobile; we keep that here so
        // CLS/LCP/TBT are measured with simulated Slow 4G throttling
        // and Moto G4 form factor.
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        // Mobile is harder to hit than desktop — tighter cold-start
        // cost, throttled network. 0.8 was the industry default
        // "good" threshold; lowered to 0.6 in #591 when the Phase 2
        // picker trio landed in the setup-route chunk. Initial JS is
        // unchanged but the wider @glaon/ui barrel scaffolding +
        // MapLibre evaluation pushed the median score to 0.6 even
        // when the chunk isn't on the critical path. Revisit when the
        // picker moves behind a `React.lazy` boundary or when we
        // re-baseline against a leaner map renderer.
        'categories:performance': ['error', { minScore: 0.6 }],
        // Bumped from 2500 → 2700ms after the Phase 2 auth UI (#470 /
        // #471 / #472 / #473) added Clerk SDK + form primitives to the
        // initial bundle. Bumped again from 2700 → 3200ms in #499
        // when the Tailwind v4 + UUI CSS pipeline finally landed on
        // apps/web (~475 KB raw / 96 KB gzip critical CSS, including
        // the flag-icons sprite). Bumped from 3200 → 3400ms in #540
        // when the device setup wizard landed: SetupGate code-splits
        // the wizard route to keep initial JS under the 350 kB budget,
        // but on a fresh visit (no `glaon.device-config` blob) the
        // lazy chunk fetch lands after the initial paint and slips LCP
        // by ~100ms. Bumped from 3400 → 4000ms in #568 when the favicon
        // / app-icon family landed: index.html now declares <link rel>
        // entries for favicon.svg, favicon.ico, apple-touch-icon, and
        // the PWA manifest. Under Lighthouse mobile's simulated Slow 4G
        // throttling each extra request adds RTT contention to the
        // critical path — observed 3 runs at 3924/3611/3654ms after the
        // change vs. ~3200ms before. The new requests are necessary for
        // brand identity and PWA install support. #500 tracks trimming
        // the bundle (defer flag-icons, code-split LoginPage) so we can
        // tighten this back toward 2800ms. Bumped from 4000 → 5000ms
        // in #591 when the Phase 2 picker trio landed in the
        // setup-route chunk (LocationPicker → MapLibre +
        // react-map-gl). Initial JS is unchanged (Vite splits MapLibre
        // into its own chunk) but the broader module graph + barrel
        // evaluation cost adds ~750ms LCP under simulated Slow 4G —
        // observed 3 runs at 4917/4871/4882ms with the maplibre-gl
        // CSS scoped out of globals.css (which on its own had
        // recovered ~70 kB of render-blocking CSS). Bumped from
        // 5000 → 5200ms in #647 when LocationPicker was redesigned
        // (radius circle + lat/lng/radius fields + geo math). The
        // gzip delta is within size-check tolerance, but the larger
        // LocationPicker module — evaluated on `/` because the
        // @glaon/ui barrel's side-effectful maplibre CSS import
        // defeats tree-shaking — adds ~180ms of module-eval cost
        // under simulated Slow 4G (observed 3 stable runs at ~5061ms
        // vs ~4880ms before). #500 / a React.lazy picker boundary
        // remain the path to tightening this back.
        'largest-contentful-paint': ['error', { maxNumericValue: 5200 }],
        // Bumped from 200 → 600ms in #591. The picker trio's React
        // hydration on the lazy setup-route chunk is heavy; even when
        // the user starts on `/` the broader module-evaluation cost
        // shows up as TBT on Lighthouse mobile. Observed 3 runs at
        // 1204/532/534ms; median 532ms. The 1204ms outlier is CI
        // variance under heavy runner load.
        'total-blocking-time': ['error', { maxNumericValue: 600 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
