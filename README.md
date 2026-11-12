# NetPulse Local

A privacy-first network dashboard for inspecting network interfaces, assigned IP addresses, active routes, and TCP/UDP listening endpoints.

## Public demo

The public preview uses a clearly labelled, fictional sample dataset. It is an interactive interface preview only; it does not connect to a visitor's computer or show real network activity.

To publish the demo, open the repository Settings → Pages and set the build and deployment source to **GitHub Actions**. The workflow deploys the `public/` folder whenever changes reach `main`. After the first successful deployment, open:

[NetPulse public demo](https://dellongrant97-dev.github.io/NetPulse-Local/)

## Run the real local monitor

The local application reads network information from the computer running the backend. Both included backends bind to loopback (127.0.0.1) by default.

### Requirements

- Node.js 18 or newer
- Windows PowerShell networking cmdlets on Windows
- ss on Linux, or lsof and netstat on macOS

### Node.js backend

```sh
npm install
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

### Python backend

Python 3.10 or newer is required.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m netpulse.server
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001).

The Python backend serves the same dashboard and read-only API endpoints as the Node.js backend. It binds to 127.0.0.1 by default. Set NETPULSE_PORT to use another local port.

## Dashboard features

- Dashboard overview with summary counts
- Devices inventory: fictional sample devices in public demo mode; detected network adapters in local mode
- Network interface status and assigned addresses
- VPN/tunnel adapter classification
- Active routing table entries
- Searchable and sortable TCP/UDP listening endpoints
- Global search across visible device, interface, route, and port rows
- Notification panel with status messages derived from available network checks
- Responsive sidebar, top bar, profile menu, and dark dashboard layout
- Five-second refresh when connected to a local backend
- Public demo mode with clearly identified sample data
- Historical network analytics with one-minute local snapshots and a 30-day default retention period
- Configurable history retention (7, 30, or 90 days) stored in browser IndexedDB
- Host-level topology view with expandable interface details and related route gateways
- Daily and weekly summaries generated from retained measurements
- CSV export and browser print-to-PDF reporting

### Historical data and reporting

In local mode, the dashboard records a compact snapshot after each successful collection interval (once per minute). Snapshots are stored in the browser's IndexedDB database on the device running the dashboard. The default retention is 30 days and can be changed to 7 or 90 days in Settings. Expired records are pruned automatically. Historical analytics and reports are based only on snapshots collected while the local dashboard is running; NetPulse does not invent missing history.

The public GitHub Pages preview does not collect or persist history. Its fictional sample data remains visibly labelled and is not presented as real historical measurements. CSV exports contain timestamped measurements. The Print / Save PDF action uses the browser's print dialog; choose Save as PDF there.

### Topology scope

The topology view initially maps the local monitoring host, its detected network interfaces, and route gateways associated with those interfaces. Interface cards can be expanded to inspect assigned addresses and related routes. This is a host-level view, not LAN-wide device discovery; remote device discovery is a separate future capability.

### Device inventory scope

The current local backend reports interfaces belonging to the computer running NetPulse. The Devices view uses those detected interfaces as a host-level inventory. It does not claim to discover every router, phone, computer, or access point on the wider LAN. LAN-wide discovery would require a separate, explicitly designed feature.

### User sign-in

The profile menu currently displays a guest session and a sign-in entry point, but authentication is **not implemented**. The sign-in action explains this rather than collecting credentials. Real user accounts require a secure authentication service and session handling; a static GitHub Pages site alone cannot securely provide that backend.

## API

- GET /api/interfaces — adapter status, assigned IP addresses, and VPN/tunnel classification
- GET /api/ports — listening TCP sockets and bound UDP endpoints with process IDs when available
- GET /api/routes — active routing table entries

Only GET is supported for API endpoints. Unknown API paths return 404. The application is intended for local inspection; do not expose the backend to an untrusted network.

## Tests

Node.js: `npm test`

Python:

```powershell
python -m pytest test/test_python_api.py test/test_python_inspector.py test/test_python_routes.py -q
```

## Privacy and demo data

The hosted demo contains only static, fictional sample data. The local application reads network information on the device where its backend is running. It does not upload that information to GitHub Pages.
