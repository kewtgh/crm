# v3.37.1 — Application brand icons

Browser tabs and bookmarks use the supplied text-free symbol at 16, 32 and 192 pixels.
Apple home-screen shortcuts use a dedicated 180-pixel icon. Open Graph and Twitter
previews use the matching 512-pixel symbol with square-image metadata.
The existing upper-left education wordmark is preserved.

Verification: all five existing sitewide visual tests passed under Node.js 24.22.0.
All five PNG assets match their selected source files exactly, and their dimensions
match the declared sizes. No browser session or production build was run for this
asset and metadata update.
