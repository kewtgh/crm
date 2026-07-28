import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";
import { stopProcessTree } from "../scripts/lib/bounded-process.mjs";

const npmCli = process.env.npm_execpath;
let server;
let port;
let serverOutput = "";

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function request(pathname, { host, forwardedProto } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Connection: "close" };
    if (host) headers.Host = host;
    if (forwardedProto) headers["X-Forwarded-Proto"] = forwardedProto;
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: "GET",
      headers,
    }, (response) => {
      response.resume();
      response.once("end", () => resolve({
        status: response.statusCode,
        location: response.headers.location,
      }));
    });
    request.setTimeout(3_000, () => request.destroy(new Error("request timed out")));
    request.once("error", reject);
    request.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`production server exited with ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const health = await request("/api/health");
      if (health.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`production server did not become ready within 30 seconds\n${serverOutput}`);
}

before(async () => {
  assert.ok(npmCli, "run this test through an npm script so npm_execpath is available");
  port = await reservePort();
  server = spawn(
    process.execPath,
    [npmCli, "run", "start", "--", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, APP_URL: `http://127.0.0.1:${port}` },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  const recordOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-8_000);
  };
  server.stdout.on("data", recordOutput);
  server.stderr.on("data", recordOutput);
  await waitForServer();
});

after(() => {
  stopProcessTree(server);
});

test("root redirect stays relative for local, proxied HTTPS, and non-production hosts", async () => {
  const cases = [
    { name: "local HTTP", host: `localhost:${port}` },
    { name: "external HTTPS proxy", host: "edge.example.test", forwardedProto: "https" },
    { name: "non-production HTTPS proxy", host: "staging.example.test", forwardedProto: "https" },
  ];

  for (const requestCase of cases) {
    const root = await request("/", requestCase);
    assert.ok([307, 308].includes(root.status), `${requestCase.name}: unexpected status ${root.status}`);
    assert.equal(root.location, "/login", `${requestCase.name}: redirect must be origin-independent`);
    assert.ok(!root.location.startsWith(`http://${requestCase.host}`));

    const login = await request(root.location, requestCase);
    assert.equal(login.status, 200, `${requestCase.name}: /login should be the single final hop`);
    assert.equal(login.location, undefined, `${requestCase.name}: /login must not redirect to itself`);
  }
});

test("login is directly accessible without a redirect", async () => {
  const login = await request("/login", {
    host: "direct.example.test",
    forwardedProto: "https",
  });
  assert.equal(login.status, 200);
  assert.equal(login.location, undefined);
});
