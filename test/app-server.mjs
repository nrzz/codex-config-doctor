// A client for `codex app-server`, the JSON-RPC server that Codex's own clients talk to over standard input and output. The checks use it
// as an oracle that needs no model: `config/read` says which layers Codex loaded and where each key came from, `hooks/list` says
// which hooks it found and whether each is trusted, `configRequirements/read` says what an admin file enforces, and a thread
// started against the fake API shows the approval questions that `codex exec` never asks.
import { killTree, startCodex } from "./codex-sandbox.mjs";

export class AppServer {
  /**
   * @param sb     a sandbox (test/codex-sandbox.mjs)
   * @param opts   { args: extra arguments after `app-server`, pre: arguments before it (--profile x), env, cwd, path, online: true when no turn will be started }
   */
  constructor(sb, { args = [], pre = [], env = {}, cwd, path, online = false } = {}) {
    this.sb = sb;
    this.opts = { args, pre, env, cwd, path, online };
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.serverRequests = [];
    this.stderr = "";
    this.onServerRequest = null;
    this.buffer = "";
    this.closed = false;
  }

  /** Starts the server and completes the handshake. Resolves the `initialize` result. */
  async start() {
    const { args, pre, env, cwd, path, online } = this.opts;
    this.child = startCodex(this.sb, [...pre, "app-server", ...args], { env, cwd, path, online, stdin: "pipe" });
    this.child.stdout.on("data", (d) => this.#read(String(d)));
    this.child.stderr.on("data", (d) => { this.stderr += d; });
    this.exited = new Promise((resolve) => this.child.on("close", (code) => { this.closed = true; for (const [, p] of this.pending) p.reject(new Error(`app-server exited (${code}) before it answered`)); resolve(code); }));
    this.child.on("error", (e) => { this.stderr += String(e); });
    const result = await this.request("initialize", { clientInfo: { name: "codex-config-doctor-tests", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    this.notify("initialized");
    return result;
  }

  #read(chunk) {
    this.buffer += chunk;
    let i;
    while ((i = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, "");
      this.buffer = this.buffer.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.stderr += `[not json] ${line}\n`; continue; }
      this.#dispatch(msg);
    }
  }

  #dispatch(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) { const e = new Error(`${p.method}: ${msg.error.message || JSON.stringify(msg.error)}`); e.rpc = msg.error; p.reject(e); } else p.resolve(msg.result);
    } else if (msg.id !== undefined && msg.method) {
      this.serverRequests.push(msg);
      const answer = this.onServerRequest ? this.onServerRequest(msg) : undefined;
      if (answer !== undefined) this.#send({ id: msg.id, result: answer });
    } else if (msg.method) {
      this.notifications.push(msg);
      for (const w of [...(this.waiters || [])]) w(msg);
    }
  }

  #send(msg) { this.child.stdin.write(`${JSON.stringify(msg)}\n`); }

  request(method, params, timeout = 60000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer within ${timeout} ms`)); }, timeout);
      this.pending.set(id, { method, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.#send({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method, params) { this.#send({ method, ...(params === undefined ? {} : { params }) }); }

  /** Resolves with the first notification (already received or yet to come) whose method is `method` and that `test` accepts. */
  waitFor(method, test = () => true, timeout = 60000) {
    const have = this.notifications.find((n) => n.method === method && test(n));
    if (have) return Promise.resolve(have);
    return new Promise((resolve, reject) => {
      this.waiters = this.waiters || [];
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((w) => w !== check); reject(new Error(`no ${method} notification within ${timeout} ms`)); }, timeout);
      const check = (n) => { if (n.method === method && test(n)) { clearTimeout(timer); this.waiters = this.waiters.filter((w) => w !== check); resolve(n); } };
      this.waiters.push(check);
    });
  }

  async close() {
    if (this.closed) return;
    try { this.child.stdin.end(); } catch { /* closed */ }
    const gone = await Promise.race([this.exited, new Promise((r) => setTimeout(() => r(null), 3000))]);
    if (gone === null) { killTree(this.child); await Promise.race([this.exited, new Promise((r) => setTimeout(r, 3000))]); }
  }
}

/** Starts a server, runs `fn(server)` and closes the server whatever happens. */
export async function withAppServer(sb, opts, fn) {
  const server = new AppServer(sb, opts);
  try {
    await server.start();
    return await fn(server);
  } finally {
    await server.close();
  }
}
