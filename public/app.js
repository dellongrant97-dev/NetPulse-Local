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
const DEMO_DEVICES = [
  { name: "Workstation-01", type: "Local host", address: "192.0.2.24", status: "Online", classification: "Sample host" },
  { name: "Router-Main", type: "Router", address: "192.0.2.1", status: "Online", classification: "Sample gateway" },
  { name: "Storage-01", type: "Server", address: "198.51.100.18", status: "Online", classification: "Sample server" },
  { name: "Guest-AP", type: "Access point", address: "192.0.2.80", status: "Offline", classification: "Sample device" }
];
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
function renderDevices(interfaces) {
  const rows = DEMO_MODE ? DEMO_DEVICES : interfaces.map((item) => ({
    name: item.name, type: item.tunnel ? "VPN / tunnel adapter" : "Network adapter",
    address: (item.addresses || []).join(", ") || "No assigned address",
    status: item.status === "Up" ? "Online" : "Offline",
    classification: item.tunnel ? "VPN / tunnel" : "Detected on this host"
  }));
  renderRows("devices-body", rows, [
    { value: (item) => item.name },
    { value: (item) => item.type, className: "type-chip" },
    { value: (item) => item.address },
    { value: (item) => item.status, className: "status-cell" },
    { value: (item) => item.classification }
  ], "No devices or adapters detected");
  document.getElementById("device-count").textContent = rows.length;
  document.getElementById("device-detail").textContent = DEMO_MODE ? "Fictional sample inventory" : "Detected adapters on this host";
  document.getElementById("devices-description").textContent = DEMO_MODE ? "Fictional devices for preview purposes" : "Detected network adapters on this computer";
  document.getElementById("device-mode-tag").textContent = DEMO_MODE ? "SAMPLE INVENTORY" : "LOCAL INVENTORY";
  document.getElementById("device-footnote").textContent = DEMO_MODE
    ? "All devices and addresses above are fictional sample data. This preview does not discover real network devices."
    : "Local inventory reflects interfaces detected by this computer. It does not scan or identify every device on your Wi-Fi network.";
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
}
async function fetchData(endpoint) {
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(endpoint + " returned " + response.status);
  return response.json();
}
function renderDashboard(data) {
  const { interfaces, ports, routes } = data;
  const up = interfaces.filter((item) => item.status === "Up").length;
  const activeRoutes = routes.filter((item) => item.active !== false).length;
  document.getElementById("interface-count").textContent = up;
  document.getElementById("tunnel-count").textContent = interfaces.filter((item) => item.tunnel).length;
  document.getElementById("port-count").textContent = ports.length;
  document.getElementById("route-count").textContent = activeRoutes;
  document.getElementById("tcp-count").textContent = ports.filter((item) => item.protocol === "TCP").length;
  document.getElementById("udp-count").textContent = ports.filter((item) => item.protocol === "UDP").length;
  document.getElementById("down-count").textContent = interfaces.filter((item) => item.status !== "Up").length;
  document.getElementById("topology-interface-count").textContent = interfaces.length + " interfaces";
  document.getElementById("topology-route-count").textContent = activeRoutes + " routes";
  renderDevices(interfaces);
  currentPorts = ports;
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
  renderPorts(ports, currentPortSort.key, currentPortSort.direction);
  updateNotifications(interfaces, ports, routes);
  applyGlobalSearch();
}
function updateNotifications(interfaces, ports, routes) {
  const notes = [];
  const down = interfaces.filter((item) => item.status !== "Up").length;
  if (down) notes.push(down + " interface(s) are currently down.");
  if (!ports.length) notes.push("No listening endpoints were returned.");
  if (!routes.length) notes.push("No routes were returned by the local API.");
  if (!notes.length) notes.push("No current network warnings from the available checks.");
  document.getElementById("notification-count").textContent = notes.length;
  document.getElementById("notification-summary").textContent = notes.length + " update(s)";
  const list = document.getElementById("notification-list");
  list.replaceChildren();
  notes.forEach((note) => { const li = document.createElement("li"); li.textContent = note; list.append(li); });
}
async function refreshDashboard() {
  const statusText = document.getElementById("status-text"), statusDot = document.getElementById("status-dot");
  try {
    if (DEMO_MODE) {
      renderDashboard(DEMO_DATA);
      statusText.textContent = "Demo mode";
      statusDot.classList.remove("online"); statusDot.classList.add("demo");
      document.getElementById("last-updated").textContent = "Sample dataset · not live";
      return;
    }
    const [interfaces, ports, routes] = await Promise.all([
      fetchData("/api/interfaces"), fetchData("/api/ports"), fetchData("/api/routes")
    ]);
    renderDashboard({ interfaces, ports, routes });
    statusText.textContent = "Live";
    statusDot.classList.remove("demo"); statusDot.classList.add("online");
    document.getElementById("last-updated").textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (error) {
    statusText.textContent = "API unavailable";
    statusDot.classList.remove("online", "demo");
    console.error("Dashboard refresh failed:", error);
  }
}
function applyGlobalSearch() {
  const term = document.getElementById("global-search").value.trim().toLocaleLowerCase();
  document.querySelectorAll("#devices-body tr,#interfaces-body tr,#routes-body tr,#ports-body tr").forEach((row) => {
    row.hidden = !!term && !row.textContent.toLocaleLowerCase().includes(term);
  });
}
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
}
let currentPortSort = { key: "port", direction: 1 };
let currentPorts = [];
if (typeof document !== "undefined") {
  if (DEMO_MODE) {
    document.getElementById("demo-banner").hidden = false;
    document.getElementById("mode-label").textContent = "PUBLIC DEMO";
    document.getElementById("footer-mode").textContent = "SAMPLE DATA ONLY";
  }
  document.getElementById("port-search").addEventListener("input", () => renderPorts(currentPorts, currentPortSort.key, currentPortSort.direction));
  document.querySelectorAll("[data-port-sort]").forEach((button) => button.addEventListener("click", () => {
    if (currentPortSort.key === button.dataset.portSort) currentPortSort.direction *= -1;
    else currentPortSort = { key: button.dataset.portSort, direction: 1 };
    renderPorts(currentPorts, currentPortSort.key, currentPortSort.direction);
  }));
  document.getElementById("global-search").addEventListener("input", applyGlobalSearch);
  document.getElementById("notifications-button").addEventListener("click", () => {
    const menu = document.getElementById("notification-menu"), open = menu.hidden;
    menu.hidden = !open;
    document.getElementById("notifications-button").setAttribute("aria-expanded", String(open));
    document.getElementById("profile-menu").hidden = true;
    document.getElementById("profile-button").setAttribute("aria-expanded", "false");
  });
  document.getElementById("profile-button").addEventListener("click", () => {
    const menu = document.getElementById("profile-menu"), open = menu.hidden;
    menu.hidden = !open;
    document.getElementById("profile-button").setAttribute("aria-expanded", String(open));
    document.getElementById("notification-menu").hidden = true;
    document.getElementById("notifications-button").setAttribute("aria-expanded", "false");
  });
  document.getElementById("sign-in-button").addEventListener("click", () => {
    showToast("User sign-in is a planned feature. No account system or password handling is configured yet.");
    document.getElementById("profile-menu").hidden = true;
    document.getElementById("profile-button").setAttribute("aria-expanded", "false");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".top-action-wrap")) {
      document.getElementById("notification-menu").hidden = true;
      document.getElementById("profile-menu").hidden = true;
      document.getElementById("notifications-button").setAttribute("aria-expanded", "false");
      document.getElementById("profile-button").setAttribute("aria-expanded", "false");
    }
  });
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.toggle("active", item === link));
  }));
  refreshDashboard();
  if (!DEMO_MODE) setInterval(refreshDashboard, REFRESH_INTERVAL);
}
if (typeof module !== "undefined" && module.exports) module.exports = { filterAndSortPorts };