# Deploy contract

The site at `https://michael.wegener.engineering/projects/last-v12/poc/` embeds
a synced copy of this repo. This file is the canonical statement the sync may rely on.

| Fact | Value |
|---|---|
| Web entry | `public/index.html`; `scripts/serve.mjs` maps `/` to it with the repo root as web root |
| Modules | `src/**` ES modules, no build step, no bundler |
| Vendor | `three` (`^0.187.0`) is the only dependency, served by the import map in `public/index.html` from `/node_modules/three/build/three.module.js` |
| Provenance | the site sync pins a commit sha of this repo plus vendor hashes; the `v12.0.0` tag is the anchor (squash commit `1dcde50` on main; `v1.0.0` is the historical Last V8 anchor) |
| Narrative | the page at `projects/last-v8/` is a separate Starlight project maintained by the michael/learn team - not served from this repo |

Rule: a change to the served layout (entry path, module roots, dependency list)
must update this file in the same PR. Breaking the layout without a note here
breaks the published demo.
