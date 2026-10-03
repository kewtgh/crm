# Bounded local braces fork

This is a local fork of the MIT-licensed `braces@3.0.3` source, retaining its
CommonJS API and upstream LICENSE. `3.0.4-lumina.1` identifies our patch;
it is not an upstream npm release.

Addresses [CVE-2026-93687 / GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):

- The parser rejects brace/parenthesis nesting beyond 128 levels before recursive processing.
- Compile, expand and stringify bound every recursive AST descent, including direct AST input.
- Array flattening uses an iterative stack instead of recursive calls.
- Limits cannot be disabled through caller options. Excessive nesting produces a deterministic
  `SyntaxError`, rather than exhausting the JavaScript call stack.

Normal glob compilation, expansion, ranges, escaping and existing range limits
keep upstream behavior. The root npm override installs this source for every
`braces` consumer; no advisory is suppressed and the CI audit threshold stays moderate.
Replace this fork with an official patched release when available.
