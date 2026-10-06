// Netlify treats every entry-module export as a lifecycle event.
export { onBuild, onPostBuild } from "./integration.mjs";
