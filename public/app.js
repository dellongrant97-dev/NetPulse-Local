const REFRESH_INTERVAL = 5000;
const PORT_SORT_KEYS = ["protocol", "address", "port", "pid"];

function filterAndSortPorts(ports, query, sortKey, direction) {
  const term = query.trim().toLocaleLowerCase();
  return ports
    .filter((port) => !term || PORT_SORT_KEYS.some((key) => String(port[key] ?? "").toLocaleLowerCase().includes(term)))
    .slice()
    .sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      if (leftValue == null || rightValue == null) {
        return leftValue == null ? (rightValue == null ? 0 : 1) : -1;
      }
      const result = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: "base" });
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
    const row = document.createElement("tr");
    const empty = cell(emptyMessage, "empty");
    empty.colSpan = columns.length;
    row.append(empty);
    body.append(row);
    return;
  }
  for (const item of rows) {
    const row = document.createElement("tr");
    for (const column of columns) row.append(cell(column.value(item), column.className));
    body.append(row);
  }
}

function renderPorts(ports, sortKey, direction) {
  const query = document.getElementById("port-search").value;
  const filteredPorts = filterAndSortPorts(ports, query, sortKey, direction);
  renderRows("ports-body", filteredPorts, [
    { value: (item) => item.protocol },
    { value: (item) => item.address },
    { value: (item) => item.port, className: "port-cell" },
    { value: (item) => item.pid }
  ], query.trim() ? "No endpoints match your search" : "No listening endpoints found");
  document.getElementById("port-result-count").textContent = query.trim()
    ? `${filteredPorts.length} of ${ports.length} endpoints`
    : `${ports.length} endpoints`;

  document.querySelectorAll("[data-port-sort]").forEach((button) => {
    const active = button.dataset.portSort === sortKey;
    const heading = button.closest("th");
    heading.setAttribute("aria-sort", active ? (direction === 1 ? "ascending" : "descending") : "none");
    button.querySelector(".sort-indicator").textContent = active ? (direction === 1 ? "↑" : "↓") : "";
  });
}

async function fetchData(endpoint) {
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
  return response.json();
}

async function refreshDashboard() {
  const statusText = document.getElementById("status-text");
  try {
    const [interfaces, ports, routes] = await Promise.all([
      fetchData("/api/interfaces"),
      fetchData("/api/ports"),
      fetchData("/api/routes")
    ]);
    document.getElementById("interface-count").textContent = interfaces.filter((item) => item.status === "Up").length;
    document.getElementById("tunnel-count").textContent = interfaces.filter((item) => item.tunnel).length;
    document.getElementById("port-count").textContent = ports.length;
    document.getElementById("route-count").textContent = routes.filter((item) => item.active !== false).length;
    currentPorts = ports;
    renderRows("interfaces-body", interfaces, [
      { value: (item) => item.description || item.name },
      { value: (item) => item.status, className: "status-cell" },
      { value: (item) => (item.addresses || []).join(", ") },
      { value: (item) => item.tunnel ? "VPN / tunnel" : "Network" }
    ], "No active interfaces");
    renderRows("routes-body", routes.filter((item) => item.active !== false), [
      { value: (item) => item.destination },
      { value: (item) => item.gateway },
      { value: (item) => item.interface },
      { value: (item) => item.metric }
    ], "No routes found");
    renderPorts(ports, currentPortSort.key, currentPortSort.direction);
    statusText.textContent = "Live";
    document.getElementById("status-dot").classList.add("online");
    document.getElementById("last-updated").textContent = `· Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    statusText.textContent = "API unavailable";
    document.getElementById("status-dot").classList.remove("online");
    console.error("Dashboard refresh failed:", error);
  }
}

let currentPortSort = { key: "port", direction: 1 };
let currentPorts = [];

if (typeof document !== "undefined") {
  document.getElementById("port-search").addEventListener("input", () => {
    renderPorts(currentPorts, currentPortSort.key, currentPortSort.direction);
  });
  document.querySelectorAll("[data-port-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      if (currentPortSort.key === button.dataset.portSort) {
        currentPortSort.direction *= -1;
      } else {
        currentPortSort = { key: button.dataset.portSort, direction: 1 };
      }
      renderPorts(currentPorts, currentPortSort.key, currentPortSort.direction);
    });
  });

  refreshDashboard();
  setInterval(refreshDashboard, REFRESH_INTERVAL);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { filterAndSortPorts };
}
