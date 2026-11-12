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

- Dashboard overview with active-interface, VPN/tunnel, listening-endpoint and route summaries
- Devices inventory view: fictional sample inventory in the public demo; locally detected adapters in local mode
- Network interface status and assigned addresses
- VPN/tunnel adapter classification
- Active routing table entries and a simplified route topology view
- Analytics summary calculated from currently available API data
- Global dashboard search plus searchable and sortable TCP/UDP listening endpoints
- Notification panel for demo and local API status
- Guest profile and sign-in information panel; account authentication is not configured
- Five-second refresh when connected to a local backend
- Responsive dark operations dashboard
- Public demo mode with clearly identified fictional sample data

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

The hosted demo contains only static, fictional sample data. The local application reads network information on the device where its backend is running. The Devices view represents adapters reported by the local interface API; it does not discover every device on the LAN. The Topology view summarizes routes returned by the local API rather than mapping the full network. Account sign-in is a visual placeholder only and does not collect credentials. The application does not upload that information to GitHub Pages.
