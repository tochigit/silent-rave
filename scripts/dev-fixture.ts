import { runCommand, startFixture } from "./fixture";

// The fixture stays alive only while this dev command runs; it never writes .env.
const fixture = await startFixture();
try {
  console.log("Starting isolated fixture app on localhost:3000; Ctrl+C stops it.");
  await runCommand([process.execPath, "--no-env-file", "node_modules/next/dist/bin/next", "dev", "--port", "3000"], fixture.env);
} finally {
  await fixture.cleanup();
}
