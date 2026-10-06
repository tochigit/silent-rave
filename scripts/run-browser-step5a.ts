process.env.SILENT_RAVE_TEST_STEP3 = "1";
process.env.SILENT_RAVE_TEST_STEP4 = "1";
process.env.SILENT_RAVE_TEST_STEP5C1 = "1";
process.env.SILENT_RAVE_TEST_STEP5A = "1";
process.env.SILENT_RAVE_BROWSER_STEP5A = "1";
process.argv.push("tests/step5a/browser.test.ts");
await import("./run-phase4");
export {};
