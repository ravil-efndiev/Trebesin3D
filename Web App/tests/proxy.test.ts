import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createServer as createVite } from "vite";

test("health and WebSocket proxy forward the service key and strip browser credentials", async (t) => {
  const seen: IncomingHttpHeaders[] = [];
  const upstream = createServer((req, res) => {
    seen.push(req.headers);
    res.end("ok");
  });
  upstream.on("upgrade", (req, socket) => {
    seen.push(req.headers);
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => upstream.close(() => resolve())));
  const key = randomUUID();
  const previous = process.env.CV_SERVICE_API_KEY;
  process.env.CV_SERVICE_API_KEY = key;
  t.after(() => {
    if (previous === undefined) delete process.env.CV_SERVICE_API_KEY;
    else process.env.CV_SERVICE_API_KEY = previous;
  });

  const vite = await createVite({
    logLevel: "silent", server: { port: 0, hmr: false },
    plugins: [{
      name: "test-cv-upstream",
      configResolved: (config) => {
        for (const proxy of Object.values(config.server.proxy ?? {})) {
          assert.equal(typeof proxy, "object");
          if (typeof proxy === "object") proxy.target = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
        }
      },
    }],
  });
  t.after(() => vite.close());
  await vite.listen();
  const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  for (const ws of [false, true]) {
    const headers = {
      origin, cookie: "sample", authorization: "sample", "proxy-authorization": "sample", "x-user-token": "sample", "x-api-key": "caller",
      ...(ws ? { connection: "Upgrade", upgrade: "websocket", "sec-websocket-protocol": "unused", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } : {}),
    };
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(origin + (ws ? "/api/v1/stream" : "/api/health/"), { headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.setTimeout(3000, () => req.destroy(new Error("Proxy test timed out")));
      req.end();
    });
    assert.equal(status, ws ? 403 : 200);
    const received = seen.shift()!;
    assert.equal(received["x-api-key"], key);
    assert.equal(received.origin, origin);
    for (const name of ["cookie", "authorization", "proxy-authorization", "x-user-token", "sec-websocket-protocol"]) assert.equal(received[name], undefined);
    if (ws) assert.equal(received["sec-websocket-key"], headers["sec-websocket-key"]);
  }
});
