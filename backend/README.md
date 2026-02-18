# ESP32 demo backend

This is a minimal Node + Express backend for the quick demo.

Quick start (PowerShell):

```powershell
cd backend
npm install
# dev server
npm run dev

# server will be available at http://localhost:4000
```

API endpoints:
- POST /api/register  — { email, password }
- POST /api/login     — { email, password } returns { token }
- POST /api/logout    — returns { ok: true }
- GET  /api/me        — protected route, requires Authorization: Bearer <token>

Device management endpoints (for local flashing):
- GET  /api/ports       — lists serial ports found on the machine
- POST /api/flash       — { sketchPath, port, fqbn? }  — compile + upload via arduino-cli

Requirements and notes:
- This server can both serve the frontend build and expose device APIs on http://localhost:3000
- Flashing requires arduino-cli to be installed and available on PATH. Install guide: https://arduino.github.io/arduino-cli/installation/
- After installing, you generally need to install the ESP32 core once: e.g.

	arduino-cli core update-index
	arduino-cli core install esp32:esp32

- To find the fully-qualified board name (FQBN) to use with your board, run:

	arduino-cli board listall

	and use the FQBN field for your board (pass it in the `fqbn` field to /api/flash if needed).

Example usage (PowerShell):

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/api/ports' -Method Get | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://localhost:3000/api/flash' -Method Post -Body (@{sketchPath='android_project/arduino_sketch.ino'; port='COM3'; fqbn='esp32:esp32:esp32'} | ConvertTo-Json) -ContentType 'application/json'
```

If arduino-cli is missing the /api/flash response will include a message telling you how to install it.
