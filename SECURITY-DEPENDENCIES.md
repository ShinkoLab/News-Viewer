# Dependency security review (2026-11-03)

This update pins Next.js and eslint-config-next to the released 16.4.4 version,
resolves sharp 0.35.5, updates compatible transitive dependencies, and pins the
PostCSS override to 8.5.32. The lockfile and third-party notices are regenerated.
It does not use `npm audit fix --force` or a prerelease.

## Critical image optimization advisory

[GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
affects Next.js through 16.4.0 and is fixed in 16.4.1 or with sharp >=0.35.5.
The previous lock used Next.js 16.2.10 and sharp 0.34.5. The production image uses
`node:22-bookworm-slim` (glibc Linux), which matches the advisory's platform.
The vulnerable path requires processing SVG through image optimization. The
current source does not use `next/image` and does not configure remote image
patterns; this reduces observed exposure but is not a substitute for updating.
The local Intel macOS smoke test verifies application compatibility, not Linux
exploitability. CI builds the Linux container.

## Audit results and remaining work

The original lock, shared by main and the CSS-only PWA PR #15, reported 37 findings
(22 moderate, 14 high, 1 critical). The updated lock reports 21 moderate findings,
with zero high/critical. `npm audit --omit=dev` reports six moderate findings.
Counts include packages affected through dependencies; they are not counts of
independent exploitable defects.

Remaining advisories are:

- [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249):
  minimatch globparts amplification, versions <11.0.1. ESLint/plugins use older
  major APIs. Forcing minimatch 11 globally or accepting the audit suggestion to
  downgrade ESLint to 4.0.0 would be an unvalidated breaking change.
- [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4):
  glob AbortSignal cancellation bypass through 14.0.1. Runtime installation
  includes glob 10 through rimraf 5 in google-gax and the gaxios dependency of
  gcp-metadata. Firestore currently constrains google-gax to major 5. This update
  uses the compatible 5.0.8 / gcp-metadata 8.1.4 versions. The application has no
  direct glob/rimraf calls and supplies no user-controlled filesystem glob to
  these APIs; a production exploit path has not been demonstrated. Runtime
  installation findings are retained here, not dismissed as development-only.

Upstream compatible fixes remain to be evaluated. Re-run `npm audit` and
`npm audit --omit=dev` before release. The
[announced November security release](https://nextjs.org/blog/upcoming-nextjs-security-release-november-2026)
was not published when 16.4.4 was checked as the npm latest version. Recheck that
announcement before deployment; this PR does not claim to address unpublished
advisories.

## Validation

Use `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and
`npm run notices`. Test `.next/standalone/server.js` with a synthetic SQLite DB.
Production Firestore/IAP and the iPhone home-screen PWA require separate checks.
No database migration is required by this dependency update.
