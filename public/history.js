(() => {
  "use strict";

  const DB_NAME = "netpulse-local-history";
  const DB_VERSION = 1;
  const STORE_NAME = "snapshots";
  const DEFAULT_RETENTION_DAYS = 30;
  const RETENTION_OPTIONS = [7, 30, 90];
  const SAMPLE_INTERVAL_MS = 60_000;

  function createSnapshot(data, timestamp = Date.now()) {
    const interfaces = Array.isArray(data.interfaces) ? data.interfaces : [];
    const ports = Array.isArray(data.ports) ? data.ports : [];
    const routes = Array.isArray(data.routes) ? data.routes : [];
    const activeInterfaces = interfaces.filter((item) => item.status === "Up");
    const activeRoutes = routes.filter((item) => item.active !== false);
    const tcp = ports.filter((item) => item.protocol === "TCP");
    const udp = ports.filter((item) => item.protocol === "UDP");

    return {
      timestamp,
      interfaceCount: interfaces.length,
      onlineInterfaces: activeInterfaces.length,
      offlineInterfaces: interfaces.length - activeInterfaces.length,
      tunnelInterfaces: interfaces.filter((item) => item.tunnel).length,
      routeCount: routes.length,
      activeRoutes: activeRoutes.length,
      tcpEndpoints: tcp.length,
      udpEndpoints: udp.length,
      listeningEndpoints: ports.length,
      interfaces: interfaces.map((item) => ({
        name: String(item.name || "Unknown"),
        status: String(item.status || "Unknown"),
        tunnel: Boolean(item.tunnel),
        addresses: Array.isArray(item.addresses) ? item.addresses.map(String) : []
      }))
    };
  }

  function pruneSnapshots(snapshots, retentionDays, now = Date.now()) {
    const days = RETENTION_OPTIONS.includes(Number(retentionDays))
      ? Number(retentionDays) : DEFAULT_RETENTION_DAYS;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    return snapshots.filter((item) => Number(item.timestamp) >= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  function toCsv(snapshots) {
    const columns = [
      ["timestamp", (item) => new Date(item.timestamp).toISOString()],
      ["interfaces", (item) => item.interfaceCount],
      ["online_interfaces", (item) => item.onlineInterfaces],
      ["offline_interfaces", (item) => item.offlineInterfaces],
      ["vpn_tunnel_interfaces", (item) => item.tunnelInterfaces],
      ["routes", (item) => item.routeCount],
      ["active_routes", (item) => item.activeRoutes],
      ["tcp_endpoints", (item) => item.tcpEndpoints],
      ["udp_endpoints", (item) => item.udpEndpoints],
      ["listening_endpoints", (item) => item.listeningEndpoints]
    ];
    const escape = (value) => {
      const text = value == null ? "" : String(value);
      return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    return [
      columns.map(([name]) => name).join(","),
      ...snapshots.map((item) => columns.map(([, value]) => escape(value(item))).join(","))
    ].join("\r\n");
  }

  function summarizeSnapshots(snapshots) {
    if (!snapshots.length) return null;
    const average = (key) => Number((snapshots.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / snapshots.length).toFixed(1));
    const latest = snapshots[snapshots.length - 1];
    const first = snapshots[0];
    return {
      sampleCount: snapshots.length,
      firstTimestamp: first.timestamp,
      latestTimestamp: latest.timestamp,
      averageOnlineInterfaces: average("onlineInterfaces"),
      averageListeningEndpoints: average("listeningEndpoints"),
      peakListeningEndpoints: Math.max(...snapshots.map((item) => Number(item.listeningEndpoints) || 0)),
      averageActiveRoutes: average("activeRoutes"),
      latest
    };
  }

  function openDatabase(indexedDBApi = globalThis.indexedDB) {
    if (!indexedDBApi) return Promise.reject(new Error("This browser does not support local history storage."));
    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "timestamp" });
          store.createIndex("timestamp", "timestamp", { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Unable to open local history storage."));
      request.onblocked = () => reject(new Error("Local history storage is busy in another tab."));
    });
  }

  function withStore(mode, operation, indexedDBApi) {
    return openDatabase(indexedDBApi).then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try { result = operation(store); } catch (error) { database.close(); reject(error); return; }
      transaction.oncomplete = () => { database.close(); resolve(result && result.result !== undefined ? result.result : result); };
      transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Local history transaction failed.")); };
      transaction.onabort = () => { database.close(); reject(transaction.error || new Error("Local history transaction was cancelled.")); };
    }));
  }

  function saveSnapshot(snapshot, indexedDBApi) {
    return withStore("readwrite", (store) => store.put(snapshot), indexedDBApi);
  }

  function getSnapshots(indexedDBApi) {
    return withStore("readonly", (store) => {
      const request = store.getAll();
      return request;
    }, indexedDBApi).then((items) => items.sort((a, b) => a.timestamp - b.timestamp));
  }

  async function pruneDatabase(retentionDays, now = Date.now(), indexedDBApi) {
    const snapshots = await getSnapshots(indexedDBApi);
    const kept = pruneSnapshots(snapshots, retentionDays, now);
    const keep = new Set(kept.map((item) => item.timestamp));
    await withStore("readwrite", (store) => {
      for (const item of snapshots) if (!keep.has(item.timestamp)) store.delete(item.timestamp);
    }, indexedDBApi);
    return kept.length;
  }

  const api = {
    DB_NAME, STORE_NAME, DEFAULT_RETENTION_DAYS, RETENTION_OPTIONS, SAMPLE_INTERVAL_MS,
    createSnapshot, pruneSnapshots, toCsv, summarizeSnapshots,
    saveSnapshot, getSnapshots, pruneDatabase
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NetPulseHistory = api;
})();