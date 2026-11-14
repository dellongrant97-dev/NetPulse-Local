(() => {
  "use strict";

  const POLL_INTERVAL_MS = 1000;
  const HISTORY_LENGTH = 60;
  let started = false;
  let demoMode = false;
  let previous = new Map();
  let latestRates = new Map();
  let selectedInterface = "";
  let samples = [];

  const byId = (id) => document.getElementById(id);
  const setText = (id, value) => {
    const element = byId(id);
    if (element) element.textContent = String(value);
  };
  const formatBytes = (value) => {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return bytes.toFixed(0) + " B";
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let amount = bytes / 1024, index = 0;
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024;
      index += 1;
    }
    return amount.toFixed(amount >= 100 ? 0 : 1) + " " + units[index];
  };
  const formatRate = (bytesPerSecond) => {
    const mbps = Math.max(0, bytesPerSecond) * 8 / 1000000;
    if (mbps >= 1) return mbps.toFixed(2) + " Mbps";
    const kbps = mbps * 1000;
    if (kbps >= 1) return kbps.toFixed(1) + " Kbps";
    return (bytesPerSecond * 8).toFixed(0) + " bps";
  };

  async function fetchCounters() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/api/traffic", {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Traffic API returned HTTP " + response.status);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.interfaces)) {
        throw new Error("Traffic API returned an unexpected data format.");
      }
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  function updateInterfaceSelector(interfaces) {
    const select = byId("traffic-interface");
    if (!select) return;
    const names = interfaces.map((item) => item.name);
    if (!names.includes(selectedInterface)) {
      const preferred = interfaces.find((item) => /wi-?fi|wireless/i.test(item.name)) ||
        interfaces.find((item) => item.status === "Up") || interfaces[0];
      selectedInterface = preferred ? preferred.name : "";
    }
    const currentOptions = [...select.options].map((option) => option.value);
    if (currentOptions.length !== names.length || names.some((name, index) => name !== currentOptions[index])) {
      select.replaceChildren();
      interfaces.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.name;
        option.textContent = item.name;
        select.append(option);
      });
    }
    select.value = selectedInterface;
  }

  function calculateRates(interfaces, sampledAt) {
    const current = new Map();
    const rates = new Map();
    interfaces.forEach((item) => {
      const entry = {
        bytesReceived: Math.max(0, Number(item.bytesReceived) || 0),
        bytesSent: Math.max(0, Number(item.bytesSent) || 0),
        packetsReceived: Math.max(0, Number(item.packetsReceived) || 0),
        packetsSent: Math.max(0, Number(item.packetsSent) || 0),
        status: item.status || "Unknown"
      };
      current.set(item.name, { ...entry, sampledAt });
      const prior = previous.get(item.name);
      let download = 0, upload = 0;
      if (prior && sampledAt > prior.sampledAt) {
        const seconds = (sampledAt - prior.sampledAt) / 1000;
        download = Math.max(0, entry.bytesReceived - prior.bytesReceived) / seconds;
        upload = Math.max(0, entry.bytesSent - prior.bytesSent) / seconds;
      }
      rates.set(item.name, { ...entry, download, upload });
    });
    previous = current;
    latestRates = rates;
    return rates;
  }

  function renderTable(interfaces, rates) {
    const body = byId("traffic-interfaces-body");
    if (!body) return;
    body.replaceChildren();
    if (!interfaces.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "empty";
      cell.textContent = "No network interface counters were returned.";
      row.append(cell);
      body.append(row);
      return;
    }
    interfaces.forEach((item) => {
      const rate = rates.get(item.name) || { download: 0, upload: 0 };
      const row = document.createElement("tr");
      const values = [
        item.name,
        item.status || "Unknown",
        formatRate(rate.download),
        formatRate(rate.upload),
        formatBytes(item.bytesReceived),
        formatBytes(item.bytesSent)
      ];
      values.forEach((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 1) cell.className = item.status === "Up" ? "traffic-status-up" : "traffic-status-down";
        row.append(cell);
      });
      body.append(row);
    });
  }

  function drawChart() {
    const canvas = byId("traffic-chart");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = Math.max(300, canvas.clientWidth || 640);
    const height = 210;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const left = 52, right = 14, top = 14, bottom = 25;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maximum = Math.max(1, ...samples.map((sample) => Math.max(sample.download, sample.upload))) * 1.15;
    context.font = "10px Inter, system-ui, sans-serif";
    context.textAlign = "right";
    context.textBaseline = "middle";
    for (let index = 0; index <= 4; index += 1) {
      const y = top + plotHeight * index / 4;
      context.strokeStyle = "rgba(135,155,184,.16)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = "#8191a8";
      context.fillText(formatRate(maximum * (4 - index) / 4), left - 8, y);
    }
    const drawSeries = (key, color) => {
      if (!samples.length) return;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      samples.forEach((sample, index) => {
        const x = left + (samples.length === 1 ? plotWidth : plotWidth * index / (HISTORY_LENGTH - 1));
        const y = top + plotHeight - Math.max(0, sample[key]) / maximum * plotHeight;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };
    drawSeries("download", "#55d7a8");
    drawSeries("upload", "#75aaff");
    context.fillStyle = "#8191a8";
    context.textAlign = "left";
    context.fillText("60 seconds ago", left, height - 8);
    context.textAlign = "right";
    context.fillText("Now", width - right, height - 8);
    const empty = byId("traffic-empty");
    if (empty) empty.hidden = samples.length > 1;
  }

  function renderSelected() {
    const selected = latestRates.get(selectedInterface);
    if (!selected) {
      setText("traffic-download", "—");
      setText("traffic-upload", "—");
      setText("traffic-received", "—");
      setText("traffic-sent", "—");
      return;
    }
    setText("traffic-download", formatRate(selected.download));
    setText("traffic-upload", formatRate(selected.upload));
    setText("traffic-received", formatBytes(selected.bytesReceived));
    setText("traffic-sent", formatBytes(selected.bytesSent));
    setText("traffic-download-unit", "Current receive rate");
    setText("traffic-upload-unit", "Current transmit rate");
  }

  async function poll() {
    if (demoMode) return;
    try {
      const payload = await fetchCounters();
      if (payload.supported === false) {
        setText("traffic-status", "COUNTERS NOT SUPPORTED");
        setText("traffic-error", "This backend does not support traffic counters on the current operating system.");
        byId("traffic-error").hidden = false;
        return;
      }
      const interfaces = payload.interfaces;
      updateInterfaceSelector(interfaces);
      const timestamp = Number(payload.sampledAt) || Date.now();
      const hadPreviousReading = previous.size > 0;
      const rates = calculateRates(interfaces, timestamp);
      const selected = rates.get(selectedInterface);
      if (selected) {
        samples.push({ download: selected.download, upload: selected.upload });
        samples = samples.slice(-HISTORY_LENGTH);
      }
      renderTable(interfaces, rates);
      renderSelected();
      drawChart();
      setText("traffic-status", hadPreviousReading ? "LIVE · 1 SECOND" : "SAMPLING");
      byId("traffic-error").hidden = true;
    } catch (error) {
      setText("traffic-status", "API UNAVAILABLE");
      setText("traffic-error", (error && error.message) || "Unable to read local traffic counters.");
      byId("traffic-error").hidden = false;
    }
  }

  function start(options = {}) {
    if (started) return;
    started = true;
    demoMode = Boolean(options.demoMode);
    const select = byId("traffic-interface");
    if (select) select.addEventListener("change", () => {
      selectedInterface = select.value;
      samples = [];
      renderSelected();
      drawChart();
    });
    if (demoMode) {
      setText("traffic-status", "PUBLIC PREVIEW");
      setText("traffic-error", "Live traffic is available only when NetPulse is running locally. This preview uses no real device counters.");
      byId("traffic-error").hidden = false;
      setText("traffic-download-unit", "Local backend required");
      setText("traffic-upload-unit", "Local backend required");
      return;
    }
    poll();
    window.setInterval(poll, POLL_INTERVAL_MS);
    window.addEventListener("resize", drawChart);
  }

  window.NetPulseTraffic = { start, formatBytes, formatRate };
})();
