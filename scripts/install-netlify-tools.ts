import { copyFile, mkdir } from "node:fs/promises";
const destination = ".test-runtime/netlify-tools";
await mkdir(destination, { recursive: true });
for (const file of ["package.json", "package-lock.json"]) await copyFile(`tools/netlify/${file}`, `${destination}/${file}`);
const child = Bun.spawn(["npm", "ci", "--prefix", destination, "--ignore-scripts", "--no-audit", "--no-fund"], { stdout: "inherit", stderr: "inherit" });
if (await child.exited) throw new Error("Locked verification-tool installation failed");
