// Bundle the official Stremio Core web worker for the no-build companion.
// The package expects CommonJS modules and a WASM asset URL; esbuild emits
// both as static files that companion/serve.js can serve directly.
require('@stremio/stremio-core-web/worker.js');
