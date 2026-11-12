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

The browser refreshes `/api/interfaces`, `/api/ports`, and `/api/routes` every five seconds. API requests are read-only and local to this machine; ports that require elevated privileges may not include a PID.

## API

- `GET /api/interfaces` — adapter status, assigned IP addresses, and VPN/tunnel classification
- `GET /api/ports` — listening TCP sockets and bound UDP endpoints with process IDs when available
- `GET /api/routes` — active routing table entries

Only GET is supported for API endpoints. Unknown API paths return 404.

## Tests

```sh
npm test
```
