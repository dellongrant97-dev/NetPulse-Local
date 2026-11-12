(() => {
  "use strict";

  const History = window.NetPulseHistory;
  if (!History) return;

  const DEMO_MODE = window.location.hostname.endsWith(".github.io") ||
    new URLSearchParams(window.location.search).get("demo") === "1";
  const RETENTION_KEY = "netpulse-history-retention-days";
  let snapshots = [];
  let latestData = null;
  let lastCaptureAt = 0;
  let historyReady = false;
  let historyError = false;
  let captureInFlight = false;
  let selectedHours = 168;
  let retentionDays = History.DEFAULT_RETENTION_DAYS;
  let resizeFrame = 0;

  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => {
    const element = byId(id);
    if (element) element.textContent = String(value);
  };

  function readRetention() {
    try {
      const saved = Number(localStorage.getItem(RETENTION_KEY));
      return History.RETENTION_OPTIONS.includes(saved) ? saved : History.DEFAULT_RETENTION_DAYS;
    } catch (_) {
      return History.DEFAULT_RETENTION_DAYS;
    }
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function renderTopology(data) {
    const interfaces = Array.isArray(data.interfaces) ? data.interfaces : [];
    const routes = Array.isArray(data.routes) ? data.routes.filter((route) => route.active !== false) : [];
    const validGateway = (value) => value && !["0.0.0.0", "::", "0:0:0:0:0:0:0:0", "On-link"].includes(value);
    const gateways = [...new Set(routes.map((route) => route.gateway).filter(validGateway))];
    setText("topology-interface-count", interfaces.length + " interfaces");
    setText("topology-route-count", routes.length + " active routes");
    setText("topology-gateway-count", gateways.length + " gateways");

    const container = byId("topology-branches");
    if (!container) return;
    container.replaceChildren();

    if (!interfaces.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No network interfaces were returned by the local API.";
      container.append(empty);
      return;
    }

    interfaces.forEach((item) => {
      const branch = document.createElement("article");
      branch.className = "topology-branch";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "topology-interface";
      button.setAttribute("aria-expanded", "false");
      const dot = document.createElement("i");
      dot.className = "topology-status " + (item.status === "Up" ? "is-up" : "is-down");
      const heading = document.createElement("strong");
      heading.textContent = item.name || "Unnamed interface";
      const state = document.createElement("span");
      state.textContent = (item.status || "Unknown") + (item.tunnel ? " · VPN / tunnel" : "");
      button.append(dot, heading, state);

      const details = document.createElement("div");
      details.className = "topology-details";
      details.hidden = true;
      const addressLabel = document.createElement("span");
      addressLabel.className = "topology-detail-label";
      addressLabel.textContent = "ASSIGNED ADDRESSES";
      const addresses = document.createElement("p");
      addresses.textContent = (item.addresses || []).join(" · ") || "No assigned addresses";
      details.append(addressLabel, addresses);

      const relatedRoutes = routes.filter((route) => route.interface === item.name);
      if (relatedRoutes.length) {
        const routeLabel = document.createElement("span");
        routeLabel.className = "topology-detail-label";
        routeLabel.textContent = "RELATED ROUTES";
        details.append(routeLabel);
        relatedRoutes.forEach((route) => {
          const routeLine = document.createElement("p");
          routeLine.textContent = (route.destination || "Unknown destination") + " → " +
            (route.gateway || "On-link") + " · metric " + (route.metric ?? "—");
          details.append(routeLine);
        });
      }
      button.addEventListener("click", () => {
        const expanded = button.getAttribute("aria-expanded") !== "true";
        button.setAttribute("aria-expanded", String(expanded));
        details.hidden = !expanded;
        branch.classList.toggle("is-expanded", expanded);
      });
      branch.append(button, details);
      container.append(branch);
    });
  }

  function drawChart(items) {
    const canvas = byId("history-chart");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = Math.max(320, canvas.clientWidth || 640);
    const height = 220;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const left = 38, right = 14, top = 15, bottom = 28;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxValue = Math.max(4, ...items.map((item) => Math.max(item.onlineInterfaces || 0, item.listeningEndpoints || 0))) * 1.15;

    context.font = "10px Inter, system-ui, sans-serif";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let line = 0; line <= 4; line++) {
      const y = top + (plotHeight * line / 4);
      context.strokeStyle = "rgba(135,155,184,.16)";
      context.lineWidth = 1;
      context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
      context.fillStyle = "#8191a8";
      context.fillText(String(Math.round(maxValue * (4 - line) / 4)), left - 9, y);
    }

    const drawSeries = (key, color) => {
      if (!items.length) return;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      items.forEach((item, index) => {
        const x = left + (items.length === 1 ? plotWidth / 2 : plotWidth * index / (items.length - 1));
        const y = top + plotHeight - (Math.max(0, Number(item[key]) || 0) / maxValue) * plotHeight;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
    };
    drawSeries("onlineInterfaces", "#55d7a8");
    drawSeries("listeningEndpoints", "#75aaff");

    context.fillStyle = "#8191a8";
    context.textAlign = "left";
    context.fillText(items.length ? formatTime(items[0].timestamp) : "No samples", left, height - 9);
    context.textAlign = "right";
    context.fillText(items.length ? formatTime(items[items.length - 1].timestamp) : "", width - right, height - 9);
  }

  function renderHistory() {
    const now = Date.now();
    const visible = snapshots.filter((item) => item.timestamp >= now - selectedHours * 60 * 60 * 1000);
    const summary = History.summarizeSnapshots(visible);
    const empty = byId("history-empty");
    if (empty) empty.hidden = visible.length > 0;
    setText("history-meta", visible.length
      ? visible.length + " local samples · latest " + formatTime(visible[visible.length - 1].timestamp)
      : DEMO_MODE ? "Sample preview · historical collection is disabled" : "Waiting for the first local snapshot");
    setText("history-average-online", summary ? summary.averageOnlineInterfaces : "—");
    setText("history-average-endpoints", summary ? summary.averageListeningEndpoints : "—");
    setText("history-peak-endpoints", summary ? summary.peakListeningEndpoints : "—");
    setText("history-status", historyError ? "STORAGE UNAVAILABLE" : DEMO_MODE ? "SAMPLE PREVIEW" : historyReady ? "LOCAL HISTORY" : "COLLECTING HISTORY");
    drawChart(visible);
    renderReport();
  }

  function renderReport() {
    const summary = History.summarizeSnapshots(snapshots);
    const report = byId("report-summary");
    if (!report) return;
    report.replaceChildren();
    if (!summary) {
      const message = document.createElement("p");
      message.textContent = DEMO_MODE
        ? "The public preview does not store historical data. Run NetPulse locally to generate reports from real measurements."
        : "Reports become available after NetPulse has collected historical snapshots.";
      report.append(message);
      setText("report-period", "No historical samples are available yet.");
      return;
    }
    setText("report-period", summary.sampleCount + " samples · " + formatTime(summary.firstTimestamp) + " to " + formatTime(summary.latestTimestamp));
    const facts = [
      ["Samples collected", summary.sampleCount],
      ["Average online interfaces", summary.averageOnlineInterfaces],
      ["Average listening endpoints", summary.averageListeningEndpoints],
      ["Peak listening endpoints", summary.peakListeningEndpoints],
      ["Average active routes", summary.averageActiveRoutes]
    ];
    facts.forEach(([label, value]) => {
      const item = document.createElement("div");
      const name = document.createElement("span");
      const metric = document.createElement("strong");
      name.textContent = label;
      metric.textContent = String(value);
      item.append(name, metric);
      report.append(item);
    });
  }

  async function loadHistory() {
    if (DEMO_MODE) { historyReady = true; renderHistory(); return; }
    try {
      retentionDays = readRetention();
      snapshots = await History.getSnapshots();
      await History.pruneDatabase(retentionDays);
      snapshots = History.pruneSnapshots(snapshots, retentionDays);
      lastCaptureAt = snapshots.length ? snapshots[snapshots.length - 1].timestamp : 0;
      historyReady = true;
    } catch (error) {
      historyError = true;
      console.warn("NetPulse local history is unavailable:", error);
    }
    renderHistory();
    if (latestData) captureIfDue(latestData);
  }

  async function captureIfDue(data) {
    if (DEMO_MODE || historyError || !historyReady || captureInFlight) return;
    const now = Date.now();
    if (lastCaptureAt && now - lastCaptureAt < History.SAMPLE_INTERVAL_MS) return;
    captureInFlight = true;
    try {
      const snapshot = History.createSnapshot(data, now);
      await History.saveSnapshot(snapshot);
      snapshots.push(snapshot);
      snapshots = History.pruneSnapshots(snapshots, retentionDays, now);
      await History.pruneDatabase(retentionDays, now);
      lastCaptureAt = now;
      renderHistory();
    } catch (error) {
      historyError = true;
      console.warn("NetPulse could not save a local history snapshot:", error);
      renderHistory();
    } finally {
      captureInFlight = false;
    }
  }

  function downloadCsv() {
    if (!snapshots.length) {
      window.alert("There are no historical snapshots to export yet.");
      return;
    }
    const blob = new Blob([History.toCsv(snapshots)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "netpulse-network-history.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function init() {
    const range = byId("history-range");
    if (range) range.addEventListener("change", () => {
      selectedHours = Number(range.value) || 168;
      renderHistory();
    });
    const retention = byId("history-retention");
    retentionDays = readRetention();
    if (retention) {
      retention.value = String(retentionDays);
      retention.addEventListener("change", async () => {
        const next = Number(retention.value);
        if (!History.RETENTION_OPTIONS.includes(next)) return;
        retentionDays = next;
        try { localStorage.setItem(RETENTION_KEY, String(next)); } catch (_) {}
        try {
          await History.pruneDatabase(retentionDays);
          snapshots = History.pruneSnapshots(snapshots, retentionDays);
          renderHistory();
          if (window.NetPulseApp) window.NetPulseApp.showToast("History retention updated to " + next + " days.");
        } catch (error) {
          historyError = true;
          renderHistory();
        }
      });
    }
    const csv = byId("export-csv");
    if (csv) csv.addEventListener("click", downloadCsv);
    const print = byId("print-report");
    if (print) print.addEventListener("click", () => window.print());
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(renderHistory);
    });
    loadHistory();
  }

  window.NetPulseIntelligence = {
    init,
    update(data) {
      latestData = data;
      renderTopology(data);
      if (historyReady) captureIfDue(data);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();