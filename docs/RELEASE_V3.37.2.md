# v3.37.2 — White-background website and shortcut icons

All active brand PNGs have opaque white backgrounds, including the preserved
upper-left education wordmark. A real 16/32/48-pixel ICO replaces the legacy
favicon redirect. A public site manifest provides 192/512-pixel website icons
and a dashboard start URL for browser homepage shortcuts. Icon metadata uses
versioned URLs to help refresh cached artwork.

The production asset checker validates the ICO, manifest and current sharing
assets. New icon regression tests run with the existing standard test commands.

Verification completed before the version bump: production build, eight icon and
sitewide visual tests, targeted lint, production HTTP checks for 26 CSS/JS assets,
seven PNGs, ICO and manifest, and six Chromium revision 1248 public-page checks.
Private browser evidence is retained under the ignored
`work/browser-qa-chromium-1248/white-brand-icons/` directory.
Release metadata and its regression tests are checked after the version bump.

The local checks do not verify the deployed website or an existing browser
shortcut's cache. Deployment is required; a previously saved shortcut may need
to be removed and saved again afterward.
