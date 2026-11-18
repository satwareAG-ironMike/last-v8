// Test-side handle on the ONE published spark-plug silhouette, which lives in
// src/engine/plug.js: the channel law in test/heads.test.mjs gaps it against the
// rendered casting, the plug laws in test/view.test.mjs measure the drawn meshes
// against it, and src/render/plugs.js builds those meshes from it. This file is a
// re-export, not a second copy - a silhouette measured twice in two files is a
// silhouette that can disagree, and the product must not depend on test/.
export { segEndRadius, segRadius, plugStack, stackRadius, stackSamples } from '../../src/engine/plug.js';
