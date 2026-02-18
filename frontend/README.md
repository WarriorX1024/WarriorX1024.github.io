# ESP32 demo frontend

Simple React (Vite) frontend that talks to the backend.

During local development the Vite dev server proxies /api → http://localhost:4000 so requests to /api/* are forwarded to the backend.

If you prefer not to use the proxy, set VITE_API_BASE in a `.env` file to a full URL (for example `VITE_API_BASE=http://localhost:4000`).

Quick start (PowerShell):

```powershell
cd frontend
npm install
npm run dev

# frontend runs on http://localhost:3000
```

The app stores the JWT token in localStorage for demo purposes. Logout clears the token.

Device manager (ESP32/Arduino)
- When the server runs at http://localhost:3000 the app includes a devices management panel (protected area) that lists serial ports and can flash sketches using the backend /api/flash endpoint. `arduino-cli` must be installed and available on PATH for flashing to work.
