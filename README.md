# NetPulse Local

A local-only dashboard for network interfaces, IP addresses, active routes, and TCP/UDP listening endpoints. The Express service binds to `127.0.0.1` and exposes read-only JSON endpoints.

## Requirements

- Node.js 18 or newer
- Windows PowerShell networking cmdlets on Windows
- `ss` on Linux, or `lsof` and `netstat` on macOS

## Run

```sh
npm install
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Set `PORT` to use another local port.

The browser refreshes `/api/interfaces`, `/api/ports`, and `/api/routes` every five seconds. The listening-port table can be searched by protocol, address, port, or PID and sorted by any column. API requests are read-only and local to this machine; ports that require elevated privileges may not include a PID.

## API

- `GET /api/interfaces` — adapter status, assigned IP addresses, and VPN/tunnel classification
- `GET /api/ports` — listening TCP sockets and bound UDP endpoints with process IDs when available
- `GET /api/routes` — active routing table entries

Only GET is supported for API endpoints. Unknown API paths return 404.

## Tests

```sh
npm test
```

## Python Backend

Python 3.10 or newer is required for the FastAPI backend.

Create and activate a virtual environment, then install dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Start the Python backend:

```powershell
python -m netpulse.server
```

Open http://127.0.0.1:3001. The Python backend serves the same dashboard and read-only API endpoints as the Node.js backend. It binds to 127.0.0.1 by default. Set NETPULSE_PORT to use another port.

Run the Python tests:

```powershell
python -m pytest test/test_python_api.py test/test_python_inspector.py test/test_python_routes.py -q
```
