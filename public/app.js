const REFRESH_INTERVAL = 5000;
const PORT_SORT_KEYS = ["protocol", "address", "port", "pid"];
const DEMO_MODE = typeof window !== "undefined" && (
  window.location.hostname.endsWith(".github.io") ||
  new URLSearchParams(window.location.search).get("demo") === "1"
);
const DEMO_DATA = {
  interfaces: [
    { name: "Wi-Fi", description: "Wireless Network Adapter", status: "Up", addresses: ["192.0.2.24", "2001:db8:1::24"], tunnel: false },
    { name: "Ethernet", description: "Gigabit Ethernet", status: "Up", addresses: ["198.51.100.18"], tunnel: false },
    { name: "WireGuard", description: "Private Tunnel Interface", status: "Up", addresses: ["198.51.100.7"], tunnel: true },
    { name: "Bluetooth Network", description: "Bluetooth Device Network", status: "Down", addresses: [], tunnel: false }
  ],
  ports: [
    { protocol: "TCP", address: "127.0.0.1", port: 3000, pid: 1240 },
    { protocol: "TCP", address: "127.0.0.1", port: 5432, pid: 2184 },
    { protocol: "TCP", address: "0.0.0.0", port: 8080, pid: 3420 },
    { protocol: "TCP", address: "192.0.2.24", port: 8443, pid: 3420 },
    { protocol: "UDP", address: "0.0.0.0", port: 5353, pid: 980 },
    { protocol: "UDP", address: "127.0.0.1", port: 1900, pid: 980 }
  ],
  routes: [
    { destination: "0.0.0.0/0", gateway: "192.0.2.1", interface: "Wi-Fi", metric: 25, active: true },
    { destination: "192.0.2.0/24", gateway: "On-link", interface: "Wi-Fi", metric: 281, active: true },
    { destination: "198.51.100.0/24", gateway: "On-link", interface: "Ethernet", metric: 15, active: true },
    { destination: "198.51.100.0/24", gateway: "On-link", interface: "WireGuard", metric: 5, active: true }
  ]
};

function filterAndSortPorts(ports, query, sortKey, direction) {
  const term = query.trim().toLocaleLowerCase();
  return ports.filter((port) => !term || PORT_SORT_KEYS.some((key) => String(port[key] ?? "").toLocaleLowerCase().includes(term)))
    .slice().sort((left, right) => {
      const a = left[sortKey], b = right[sortKey];
      if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
      const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
      return result * direction;
    });
}
function cell(value, className) {
  const element = document.createElement("td");
  element.textContent = value == null || value === "" ? "—" : String(value);
  if (className) element.className = className;
  return element;
}
function renderRows(bodyId, rows, columns, emptyMessage) {
  const body = document.getElementById(bodyId);
  body.replaceChildren();
  if (!rows.length) {
    const row = document.createElement("tr"), empty = cell(emptyMessage, "empty");
    empty.colSpan = columns.length; row.append(empty); body.append(row); return;
  }
  for (const item of rows) {
    const row = document.createElement("tr");
    for (const column of columns) row.append(cell(column.value(item), column.className));
    body.append(row);
  }
}
function addDeviceRows(interfaces) {
  const body = document.getElementById("devices-body");
  body.replaceChildren();
  if (!interfaces.length) {
    const row = document.createElement("tr"), empty = cell("No detected network adapters", "empty");
    empty.colSpan = 5; row.append(empty); body.append(row); return;
  }
  for (const item of interfaces) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const glyph = document.createElement("span");
    glyph.className = "device-glyph" + (item.status === "Up" ? "" : " down");
    glyph.textContent = item.tunnel ? "◇" : (item.name || "").toLowerCase().includes("wi") ? "⌁" : "▣";
    const label = document.createElement("span");
    label.className = "device-name";
    label.textContent = item.name || item.description || "Network adapter";
    name.append(glyph, label);
    const type = cell(item.tunnel ? "Tunnel adapter" : (item.description || "Network adapter"), "device-type");
    const address = cell((item.addresses || []).join(", ") || "No address assigned");
    const status = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "status-badge" + (item.status === "Up" ? "" : " down");
    badge.textContent = item.status === "Up" ? "● Online" : "● Offline";
    status.append(badge);
    const classification = cell(item.tunnel ? "VPN / tunnel" : "Local interface");
    row.append(name, type, address, status, classification);
    body.append(row);
  }
}
function renderPorts(ports, sortKey, direction) {
  const query = document.getElementById("port-search").value;
  const filtered = filterAndSortPorts(ports, query, sortKey, direction);
  renderRows("ports-body", filtered, [
    { value: (item) => item.protocol }, { value: (item) => item.address },
    { value: (item) => item.port, className: "port-cell" }, { value: (item) => item.pid }
  ], query.trim() ? "No endpoints match your search" : "No listening endpoints found");
  document.getElementById("port-result-count").textContent = query.trim()
    ? filtered.length + " of " + ports.length + " endpoints" : ports.length + " endpoints";
  document.querySelectorAll("[data-port-sort]").forEach((button) => {
    const active = button.dataset.portSort === sortKey, heading = button.closest("th");
    heading.setAttribute("aria-sort", active ? (direction === 1 ? "ascending" : "descending") : "none");
    button.querySelector(".sort-indicator").textContent = active ? (direction === 1 ? "↑" : "↓") : "";
  });
  applyGlobalSearch();
}
async function fetchData(endpoint) {
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(endpoint + " returned " + response.status);
  return response.json();
}
function setNotifications(messages, state) {
  const list = document.getElementById("notification-list");
  list.replaceChildren();
  messages.forEach((message) => {
    const item = document.createElement("p");
    item.className = "notification-item";
    item.textContent = message;
    list.append(item);
  });
  document.getElementById("notification-count").textContent = String(messages.length);
  document.getElementById("notification-state").textContent = state;
}
function renderAnalytics(data) {
  document.getElementById("tcp-count").textContent = data.ports.filter((item) => String(item.protocol).toUpperCase() === "TCP").length;
  document.getElementById("udp-count").textContent = data.ports.filter((item) => String(item.protocol).toUpperCase() === "UDP").length;
  document.getElementById("down-count").textContent = data.interfaces.filter((item) => item.status !== "Up").length;
  document.getElementById("analytics-tunnel-count").textContent = data.interfaces.filter((item) => item.tunnel).length;
}
function renderTopology(data) {
  const list = document.getElementById("topology-list");
  list.replaceChildren();
  const routes = data.routes.filter((item) => item.active !== false);
  if (!routes.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No active route information is available.";
    list.append(empty);
    return;
  }
  routes.forEach((route) => {
    const row = document.createElement("div");
    row.className = "topology-row";
    const iface = document.createElement("span");
    iface.className = "topology-node";
    iface.textContent = route.interface || "Unknown interface";
    const arrow = document.createElement("span");
    arrow.className = "topology-arrow";
    arrow.textContent = "→";
    const destination = document.createElement("span");
    destination.className = "topology-destination";
    destination.textContent = (route.destination || "Unknown destination") + " via " + (route.gateway || "—");
    const metric = document.createElement("span");
    metric.className = "topology-metric";
    metric.textContent = "Metric " + (route.metric ?? "—");
    row.append(iface, arrow, destination, metric);
    list.append(row);
  });
}
function applyGlobalSearch() {
  const input = document.getElementById("global-search");
  if (!input) return;
  const term = input.value.trim().toLocaleLowerCase();
  document.querySelectorAll(".panel tbody tr").forEach((row) => {
    if (row.querySelector(".empty")) {
      row.hidden = false;
      return;
    }
    row.hidden = Boolean(term) && !row.textContent.toLocaleLowerCase().includes(term);
  });
}
function renderDashboard(data) {
  const { interfaces, ports, routes } = data;
  document.getElementById("interface-count").textContent = interfaces.filter((item) => item.status === "Up").length;
  document.getElementById("tunnel-count").textContent = interfaces.filter((item) => item.tunnel).length;
  document.getElementById("port-count").textContent = ports.length;
  document.getElementById("route-count").textContent = routes.filter((item) => item.active !== false).length;
  currentPorts = ports;
  addDeviceRows(interfaces);
  renderRows("interfaces-body", interfaces, [
    { value: (item) => item.description || item.name },
    { value: (item) => item.status, className: "status-cell" },
    { value: (item) => (item.addresses || []).join(", ") },
    { value: (item) => item.tunnel ? "VPN / tunnel" : "Network" }
  ], "No active interfaces");
  renderRows("routes-body", routes.filter((item) => item.active !== false), [
    { value: (item) => item.destination }, { value: (item) => item.gateway },
    { value: (item) => item.interface }, { value: (item) => item.metric }
  ], "No routes found");
  renderAnalytics(data);
  renderTopology(data);
  renderPorts(ports, currentPortSort.key, currentPortSort.direction);
  applyGlobalSearch();
}
async function refreshDashboard() {
  const statusText = document.getElementById("status-text"), statusDot = document.getElementById("status-dot");
  try {
    if (DEMO_MODE) {
      renderDashboard(DEMO_DATA);
      statusText.textContent = "Demo mode";
      statusDot.classList.remove("online"); statusDot.classList.add("demo");
      document.getElementById("last-updated").textContent = "Sample dataset · not live";
      document.getElementById("device-source-label").textContent = "SAMPLE INVENTORY";
      document.getElementById("device-footnote").textContent = "These are fictional sample adapters for the public preview. No real device discovery is performed.";
      document.getElementById("settings-mode").textContent = "Public demo · sample data";
      setNotifications(["Public demo is active; all displayed network details are fictional.", "This page is not connected to your computer."], "DEMO");
      return;
    }
    const [interfaces, ports, routes] = await Promise.all([
      fetchData("/api/interfaces"), fetchData("/api/ports"), fetchData("/api/routes")
    ]);
    renderDashboard({ interfaces, ports, routes });
    statusText.textContent = "Live";
    statusDot.classList.remove("demo"); statusDot.classList.add("online");
    document.getElementById("last-updated").textContent = "Updated " + new Date().toLocaleTimeString();
    document.getElementById("device-source-label").textContent = "LOCAL ADAPTERS";
    document.getElementById("device-footnote").textContent = "This inventory represents adapters detected on this computer. It does not scan or discover every device on your LAN.";
    document.getElementById("settings-mode").textContent = "Local monitoring";
    setNotifications(["Local monitoring API is responding.", "Network data is read from this computer and is not uploaded by the dashboard."], "LIVE");
  } catch (error) {
    statusText.textContent = "API unavailable";
    statusDot.classList.remove("online", "demo");
    document.getElementById("last-updated").textContent = "Waiting for local API";
    setNotifications(["The local API is unavailable. Start the NetPulse backend to view live network information."], "ATTENTION");
    console.error("Dashboard refresh failed:", error);
  }
}
let currentPortSort = { key: "port", direction: 1 };
let currentPorts = [];
if (typeof document !== "undefined") {
  if (DEMO_MODE) {
    document.getElementById("demo-banner").hidden = false;
    document.getElementById("mode-label").textContent = "PUBLIC DEMO";
    document.getElementById("footer-mode").textContent = "SAMPLE DATA ONLY";
  }
  document.getElementById("global-search").addEventListener("input", applyGlobalSearch);
  document.getElementById("port-search").addEventListener("input", () => renderPorts(currentPorts, currentPortSort.key, currentPortSort.direction));
  document.querySelectorAll("[data-port-sort]").forEach((button) => button.addEventListener("click", () => {
    if (currentPortSort.key === button.dataset.portSort) currentPortSort.direction *= -1;
    else currentPortSort = { key: button.dataset.portSort, direction: 1 };
    renderPorts(currentPorts, currentPortSort.key, currentPortSort.direction);
  }));
  const notificationsButton = document.getElementById("notifications-button");
  const notificationPanel = document.getElementById("notification-panel");
  const userMenuButton = document.getElementById("user-menu-button");
  const userPanel = document.getElementById("user-panel");
  notificationsButton.addEventListener("click", () => {
    const open = notificationPanel.hidden;
    notificationPanel.hidden = !open;
    notificationsButton.setAttribute("aria-expanded", String(open));
    userPanel.hidden = true;
    userMenuButton.setAttribute("aria-expanded", "false");
  });
  userMenuButton.addEventListener("click", () => {
    const open = userPanel.hidden;
    userPanel.hidden = !open;
    userMenuButton.setAttribute("aria-expanded", String(open));
    notificationPanel.hidden = true;
    notificationsButton.setAttribute("aria-expanded", "false");
  });
  const signInModal = document.getElementById("sign-in-modal");
  const openSignIn = () => { signInModal.hidden = false; userPanel.hidden = true; };
  document.getElementById("sign-in-button").addEventListener("click", openSignIn);
  document.getElementById("user-sign-in-button").addEventListener("click", openSignIn);
  const closeSignIn = () => { signInModal.hidden = true; };
  document.getElementById("close-sign-in").addEventListener("click", closeSignIn);
  document.getElementById("dismiss-sign-in").addEventListener("click", closeSignIn);
  signInModal.addEventListener("click", (event) => { if (event.target === signInModal) closeSignIn(); });
  document.querySelectorAll("[data-nav]").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll("[data-nav]").forEach((item) => item.classList.toggle("active", item === link));
  }));
  refreshDashboard();
  if (!DEMO_MODE) setInterval(refreshDashboard, REFRESH_INTERVAL);
}
if (typeof module !== "undefined" && module.exports) module.exports = { filterAndSortPorts };