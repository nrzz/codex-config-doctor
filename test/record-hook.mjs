// A hook command for the real-binary checks: appends one JSON line to a log file with what Codex gave it (the hook event it was
// registered for, its arguments, the CODEX_* variables of its environment and the JSON on its standard input), and then answers as
// the third argument says.
//   node record-hook.mjs <event> <log file> [allow | deny | ask | block | exit2 | junk]
import fs from "node:fs";

// `node --test` also runs every file under test/: without the event and the log file this is not a hook run, so do nothing (reading stdin
// would block)
if (process.argv.length < 4) process.exit(0);

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { stdin += c; });
process.stdin.on("end", () => {
  const [event, log, mode = "allow"] = process.argv.slice(2);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^CODEX/i.test(k)));
  fs.appendFileSync(log, `${JSON.stringify({ event, argv: process.argv.slice(2), env, stdin })}\n`);
  if (mode === "deny") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "recorded deny" } }));
  } else if (mode === "ask") {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "recorded ask" } }));
  } else if (mode === "block") {
    process.stdout.write(JSON.stringify({ decision: "block", reason: "recorded block" }));
  } else if (mode === "exit2") {
    process.stderr.write("recorded exit 2");
    process.exit(2);
  } else if (mode === "junk") {
    process.stdout.write("not json");
  }
  process.exit(0);
});
