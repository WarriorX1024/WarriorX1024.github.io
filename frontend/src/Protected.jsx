import React from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_BASE || ''

import DeviceManager from './DeviceManager'
import AreaClimateControl from './AreaClimateControl'

export default function Protected({ token, onLogout }) {
  const [user, setUser] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [loading, setLoading] = React.useState(true)
  const authHeaders = React.useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  React.useEffect(() => {
    let isMounted = true
    let forcedLogout = false

    async function hydrate() {
      if (isMounted) setLoading(true)
      try {
        const res = await axios.get(`${API}/api/me`, { headers: authHeaders })
        if (isMounted) {
          setUser(res.data.user)
          setError(null)
        }
      } catch (err) {
        if (!isMounted) return
        const status = err.response?.status
        if (status === 401 || status === 403) {
          forcedLogout = true
          onLogout('Session expired — please sign in again to continue.')
          return
        }
        setError(err.response?.data?.error || err.message || 'Failed to fetch profile')
      } finally {
        if (isMounted && !forcedLogout) setLoading(false)
      }
    }

    hydrate()
    return () => {
      isMounted = false
    }
  }, [token, authHeaders, onLogout])

  async function doLogout() {
    try {
      await axios.post(`${API}/api/logout`, {}, { headers: authHeaders })
    } catch (err) {
      // ignore network noise on logout
    }
    onLogout()
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Authenticated Node</p>
          <h2>{user?.email || 'Calibrating'}</h2>
          <p className="muted">Session fingerprint: {user?.id || 'pending...'}</p>
        </div>
        <button className="button-base ghost-button" onClick={doLogout}>
          Terminate Session
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading-card glass-card">
          <p>Calibrating session telemetry…</p>
        </div>
      ) : (
        <div className="panel-grid">
          <AreaClimateControl token={token} />

          <div className="stack">
            <div className="glass-card advisory-card">
              <h3>ESP32 Flight Plan</h3>
              <p className="muted">
                Scan the lab rack for serial ports, confirm board profile, and push firmware directly from the console.
              </p>
              <ul>
                <li>Securely enumerate available serial endpoints</li>
                <li>Validate sketch paths before dispatch</li>
                <li>Stream compiler logs in real time</li>
              </ul>
            </div>

            <DeviceManager token={token} />
          </div>
        </div>
      )}
    </section>
  )
}
