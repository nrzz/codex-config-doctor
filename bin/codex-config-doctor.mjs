#!/usr/bin/env node
// codex-config-doctor: what Codex CLI will actually do with your configuration. All the work lives in src/cli.mjs;
// run `codex-config-doctor --help` for the commands.
import { main } from "../src/cli.mjs";

// `codex-config-doctor show | head` closes the pipe early: that is not an error.
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.exitCode = await main(process.argv.slice(2));
