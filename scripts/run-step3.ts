// Reuse the owned fixture, unchanged baseline files and failing-kick second app.
process.env.SILENT_RAVE_TEST_STEP3 = "1";
await import("./run-phase4");
export {};
