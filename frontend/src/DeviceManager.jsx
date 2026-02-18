import React from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_BASE || ''

export default function DeviceManager({ token }) {
  const [ports, setPorts] = React.useState([])
  const [loadingPorts, setLoadingPorts] = React.useState(false)
  const [selectedPort, setSelectedPort] = React.useState('')
  const [sketchPath, setSketchPath] = React.useState('android_project/arduino_sketch.ino')
  const [fqbn, setFqbn] = React.useState('esp32:esp32:esp32')
  const [output, setOutput] = React.useState('')
  const [flashing, setFlashing] = React.useState(false)

  const authHeaders = React.useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const refreshPorts = React.useCallback(async () => {
    setLoadingPorts(true)
    setOutput('Scanning serial bus…')
    try {
      const res = await axios.get(`${API}/api/ports`, { headers: authHeaders })
      const discovered = res.data.ports || []
      setPorts(discovered)
      setSelectedPort((prev) => prev || discovered[0]?.path || '')
      setOutput(discovered.length ? `Detected ${discovered.length} interface(s)` : 'No serial interfaces detected')
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Failed to list ports'
      setOutput(`❌ ${message}`)
    } finally {
      setLoadingPorts(false)
    }
  }, [authHeaders])

  React.useEffect(() => {
    refreshPorts()
  }, [refreshPorts])

  async function handleFlash() {
    if (!selectedPort) return setOutput('❌ Select a serial port first')
    if (!sketchPath) return setOutput('❌ Enter a sketch path')

    setFlashing(true)
    setOutput('⏳ Compiling sketch and initiating upload…')
    try {
      const res = await axios.post(
        `${API}/api/flash`,
        { sketchPath, port: selectedPort, fqbn },
        { headers: authHeaders }
      )
      setOutput('✅ ' + (res.data.msg || 'Flash successful'))
    } catch (err) {
      const isUnauthorized = err.response?.status === 401
      const message = err.response?.data?.error || err.response?.data?.message || err.message
      setOutput(isUnauthorized ? 'Session expired — please reauthenticate.' : `❌ Flash failed: ${message}`)
    } finally {
      setFlashing(false)
    }
  }

  return (
    <section className="neon-card device-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Hardware uplink</p>
          <h3>Device Orchestrator</h3>
        </div>
        <button
          className="button-base outline-button"
          onClick={refreshPorts}
          disabled={loadingPorts || flashing}
        >
          {loadingPorts ? 'Scanning…' : 'Refresh Ports'}
        </button>
      </div>

      <div className="port-list">
        {ports.length === 0 ? (
          <p className="muted">Awaiting hardware handshake. Connect your ESP32 and rescan.</p>
        ) : (
          ports.map((p) => (
            <button
              key={p.path}
              type="button"
              className={`port-pill ${selectedPort === p.path ? 'active' : ''}`}
              onClick={() => setSelectedPort(p.path)}
            >
              <span>{p.path}</span>
              {p.manufacturer && <small>{p.manufacturer}</small>}
            </button>
          ))
        )}
      </div>

      <div className="form-grid compact">
        <label className="form-label" htmlFor="sketch">Sketch Path</label>
        <input
          id="sketch"
          value={sketchPath}
          onChange={(e) => setSketchPath(e.target.value)}
          placeholder="android_project/arduino_sketch.ino"
        />

        <label className="form-label" htmlFor="fqbn">FQBN (Board)</label>
        <input
          id="fqbn"
          value={fqbn}
          onChange={(e) => setFqbn(e.target.value)}
          placeholder="esp32:esp32:esp32"
        />
      </div>

      <button
        className="button-base solid-button full-width"
        onClick={handleFlash}
        disabled={flashing || !selectedPort}
      >
        {flashing ? 'Uploading…' : 'Flash Sketch to ESP32'}
      </button>

      {output && <pre className="console-block">{output}</pre>}
    </section>
  )
}
