const REFRESH_INTERVAL = 5000;

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

async function fetchData(endpoint) {
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
  return response.json();
}

async function refreshDashboard() {
  const statusText = document.getElementById("status-text");
  try {
    const [interfaces, ports, routes] = await Promise.all([
      fetchData("http://localhost:3000/api/interfaces"),
      fetchData("http://localhost:3000/api/ports"),
      fetchData("http://localhost:3000/api/routes")
    ]);
    document.getElementById("interface-count").textContent = interfaces.filter((item) => item.status === "Up").length;
    document.getElementById("tunnel-count").textContent = interfaces.filter((item) => item.tunnel).length;
    document.getElementById("port-count").textContent = ports.length;
    document.getElementById("route-count").textContent = routes.filter((item) => item.active !== false).length;
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
    renderRows("ports-body", ports, [
      { value: (item) => item.protocol },
      { value: (item) => item.address },
      { value: (item) => item.port, className: "port-cell" },
      { value: (item) => item.pid }
    ], "No listening endpoints found");
    statusText.textContent = "Live";
    document.getElementById("status-dot").classList.add("online");
    document.getElementById("last-updated").textContent = `· Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    statusText.textContent = "API unavailable";
    document.getElementById("status-dot").classList.remove("online");
    console.error("Dashboard refresh failed:", error);
  }
}

refreshDashboard();
setInterval(refreshDashboard, REFRESH_INTERVAL);
