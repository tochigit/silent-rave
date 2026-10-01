// Explicit .env loader for tests that don't import helpers.ts (bun normally
// auto-loads .env; this makes it robust regardless of runner flags).
import { readFileSync } from "node:fs";

try {
  const text = readFileSync(".env", "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  /* ambient environment */
}
