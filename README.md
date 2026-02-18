# Project root — ESP32 demo + Android helper

This workspace contains three areas:

- `backend/` — Node + Express server (HTTP API) running on port 4000 by default
- `frontend/` — Vite + React app (dev server on port 3000). Vite proxies `/api` to the backend during development
- `android_project/` — Android / Arduino placeholder files (moved here for organization)

How to run locally (PowerShell):

```powershell
# backend
cd backend
npm install
npm run dev

# frontend (new terminal)
cd frontend
npm install
npm run dev

# frontend will be available at http://localhost:3000 and will proxy API calls to the backend on :4000
```

If you run into network errors from the browser, check:
- Backend is running at http://localhost:4000
- Vite proxy is active (frontend vite.config.js contains a proxy entry for /api)
- Your firewall or antivirus is not blocking localhost ports
