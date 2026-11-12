const assert = require("node:assert/strict");
const { once } = require("node:events");
const test = require("node:test");
const { createApp } = require("../src/app");
const { parseLinuxIpv6Routes, parseLinuxRoutes, parseSsOutput, isTunnel } = require("../src/system-inspector");

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("API exposes read-only interfaces, ports, and routes", async () => {
  const inspector = {
    getInterfaces: async () => [{ name: "Wi-Fi", status: "Up" }],
    getPorts: async () => [{ protocol: "TCP", port: 3000, pid: 42 }],
    getRoutes: async () => [{ destination: "0.0.0.0/0" }]
  };
  await withServer(createApp(inspector), async (base) => {
    const [interfaces, ports, routes] = await Promise.all(
      ["interfaces", "ports", "routes"].map((name) => fetch(`${base}/api/${name}`))
    );
    assert.deepEqual(await interfaces.json(), [{ name: "Wi-Fi", status: "Up" }]);
    assert.deepEqual(await ports.json(), [{ protocol: "TCP", port: 3000, pid: 42 }]);
    assert.deepEqual(await routes.json(), [{ destination: "0.0.0.0/0" }]);
    const unsupportedMethod = await fetch(`${base}/api/ports`, { method: "POST" });
    assert.equal(unsupportedMethod.status, 405);
    assert.equal(unsupportedMethod.headers.get("allow"), "GET");
    assert.equal((await fetch(`${base}/api/other`)).status, 404);
  });
});

test("inspection errors return a clear service error", async () => {
  await withServer(createApp({
    getInterfaces: async () => { throw new Error("collector failed"); }
  }), async (base) => {
    const response = await fetch(`${base}/api/interfaces`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Unable to inspect local network data" });
  });
});

test("Linux route parser converts little-endian IPv4 addresses", () => {
  const routes = parseLinuxRoutes([
    "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT",
    "eth0 00000000 0101A8C0 0003 0 0 100 00000000 0 0 0"
  ].join("\n"));
  assert.deepEqual(routes, [{
    destination: "0.0.0.0/0",
    gateway: "192.168.1.1",
    interface: "eth0",
    metric: 100,
    active: true
  }]);
});

test("ss parser retains protocol, local endpoint, and owning PID", () => {
  assert.deepEqual(parseSsOutput(
    'LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=52,fd=19))',
    "TCP"
  ), [{ protocol: "TCP", address: "127.0.0.1", port: 3000, pid: 52 }]);
});

test("Linux IPv6 route parser formats destination and gateway", () => {
  const routes = parseLinuxIpv6Routes([
    "00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000064 00000000 00000000 00000003 eth0"
  ].join("\n"));
  assert.deepEqual(routes, [{
    destination: "::/0",
    gateway: "fe80::1",
    interface: "eth0",
    metric: 100,
    active: true
  }]);
});

test("tunnel detection recognizes common VPN adapter names", () => {
  assert.equal(isTunnel("Tailscale"), true);
  assert.equal(isTunnel("Ethernet"), false);
});
