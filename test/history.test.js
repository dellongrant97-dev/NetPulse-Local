const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_RETENTION_DAYS,
  RETENTION_OPTIONS,
  SAMPLE_INTERVAL_MS,
  createSnapshot,
  pruneSnapshots,
  summarizeSnapshots,
  toCsv
} = require("../public/history");

test("history snapshots contain measured network counts and interface state", () => {
  const snapshot = createSnapshot({
    interfaces: [
      { name: "Wi-Fi", status: "Up", tunnel: false, addresses: ["192.168.1.20"] },
      { name: "WireGuard", status: "Down", tunnel: true, addresses: [] }
    ],
    ports: [
      { protocol: "TCP", port: 3000 },
      { protocol: "UDP", port: 5353 }
    ],
    routes: [{ active: true }, { active: false }]
  }, 1_800_000_000_000);

  assert.equal(snapshot.timestamp, 1_800_000_000_000);
  assert.equal(snapshot.interfaceCount, 2);
  assert.equal(snapshot.onlineInterfaces, 1);
  assert.equal(snapshot.offlineInterfaces, 1);
  assert.equal(snapshot.tunnelInterfaces, 1);
  assert.equal(snapshot.routeCount, 2);
  assert.equal(snapshot.activeRoutes, 1);
  assert.equal(snapshot.tcpEndpoints, 1);
  assert.equal(snapshot.udpEndpoints, 1);
  assert.equal(snapshot.listeningEndpoints, 2);
  assert.deepEqual(snapshot.interfaces[0].addresses, ["192.168.1.20"]);
});

test("history retention defaults to 30 days and removes expired snapshots", () => {
  const now = 2_000_000_000_000;
  const day = 24 * 60 * 60 * 1000;
  const snapshots = [
    { timestamp: now - 31 * day },
    { timestamp: now - 30 * day },
    { timestamp: now - 2 * day }
  ];

  assert.equal(DEFAULT_RETENTION_DAYS, 30);
  assert.deepEqual(RETENTION_OPTIONS, [7, 30, 90]);
  assert.deepEqual(pruneSnapshots(snapshots, 30, now), snapshots.slice(1));
  assert.deepEqual(pruneSnapshots(snapshots, 999, now), snapshots.slice(1));
  assert.equal(SAMPLE_INTERVAL_MS, 60_000);
});

test("history summary calculates averages and peak values", () => {
  const summary = summarizeSnapshots([
    { timestamp: 100, onlineInterfaces: 2, listeningEndpoints: 4, activeRoutes: 1 },
    { timestamp: 200, onlineInterfaces: 4, listeningEndpoints: 8, activeRoutes: 3 }
  ]);

  assert.equal(summary.sampleCount, 2);
  assert.equal(summary.averageOnlineInterfaces, 3);
  assert.equal(summary.averageListeningEndpoints, 6);
  assert.equal(summary.peakListeningEndpoints, 8);
  assert.equal(summary.averageActiveRoutes, 2);
  assert.equal(summary.latestTimestamp, 200);
  assert.equal(summarizeSnapshots([]), null);
});

test("history CSV escapes values and includes reportable metrics", () => {
  const csv = toCsv([{
    timestamp: Date.UTC(2026, 0, 1),
    interfaceCount: 2,
    onlineInterfaces: 1,
    offlineInterfaces: 1,
    tunnelInterfaces: 0,
    routeCount: 3,
    activeRoutes: 2,
    tcpEndpoints: 4,
    udpEndpoints: 5,
    listeningEndpoints: 9
  }]);

  assert.match(csv, /^timestamp,interfaces,online_interfaces/);
  assert.match(csv, /2026-01-01T00:00:00\.000Z,2,1,1,0,3,2,4,5,9/);
  assert.equal(toCsv([]).split("\r\n").length, 1);
});