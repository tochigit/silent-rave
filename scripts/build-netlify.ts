import { sanitizedBuildEnvironment, assertEnvironmentFreeCheckout } from "./build-netlify-env";
assertEnvironmentFreeCheckout();
const child = Bun.spawn([process.execPath, "run", "build"], { env: sanitizedBuildEnvironment(process.env), stdout: "inherit", stderr: "inherit" });
const code = await child.exited;
if (code !== 0) throw new Error("Netlify application build failed.");
