// filepath: c:\Users\Lenovo\OneDrive\Desktop\app-temp\frontend\src\AreaClimateControl.jsx
import React from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_BASE || ''

const DEFAULT_AREAS = [
  { name: 'Shimla', temp: 18, humidity: 45, lat: 31.1048, lon: 77.1734 },
  { name: 'Manali', temp: 16, humidity: 50, lat: 32.2396, lon: 77.1887 },
  { name: 'Goa', temp: 28, humidity: 70, lat: 15.2993, lon: 74.124 },
  { name: 'Delhi', temp: 30, humidity: 40, lat: 28.6139, lon: 77.209 },
  { name: 'Mumbai', temp: 29, humidity: 75, lat: 19.076, lon: 72.8777 },
  { name: 'Bangalore', temp: 24, humidity: 55, lat: 12.9716, lon: 77.5946 }
]

const STORAGE_KEY = 'area_climate_settings_v1'

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.areas)) return null
    return parsed
  } catch (e) {
    return null
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    // ignore storage errors
  }
}

function mergeAreas(saved = []) {
  const savedMap = new Map(saved.map((a) => [a.name, a]))
  const defaultsSet = new Set(DEFAULT_AREAS.map((a) => a.name))
  const merged = DEFAULT_AREAS.map((base) => ({ ...base, ...(savedMap.get(base.name) || {}) }))

  saved.forEach((area) => {
    if (area?.name && !defaultsSet.has(area.name)) {
      merged.push(area)
    }
  })

  return merged
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(value)
  } catch (e) {
    return ''
  }
}

function formatTimestamp(value) {
  if (!value) return ''
  try {
    const date = new Date(value)
    return `${date.toLocaleDateString()} · ${date.toLocaleTimeString()}`
  } catch (e) {
    return ''
  }
}

function clampCoord(value, min, max) {
  if (!Number.isFinite(value)) return value
  return Math.min(Math.max(value, min), max)
}

function formatLocationLabel(entry) {
  return [entry.name, entry.region, entry.country].filter(Boolean).join(', ')
}

export default function AreaClimateControl({ token }) {
  const authHeaders = React.useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const [areas, setAreas] = React.useState(DEFAULT_AREAS)
  const [selectedArea, setSelectedArea] = React.useState(DEFAULT_AREAS[0].name)
  const [status, setStatus] = React.useState('')
  const [clock, setClock] = React.useState(() => new Date())
  const [liveTelemetry, setLiveTelemetry] = React.useState({ temp: null, humidity: null, time: null, precise: null, source: null, coords: null })
  const [liveStatus, setLiveStatus] = React.useState({ loading: false, error: null })
  const [searchTerm, setSearchTerm] = React.useState('')
  const [searchResults, setSearchResults] = React.useState([])
  const [searchLoading, setSearchLoading] = React.useState(false)
  const [searchError, setSearchError] = React.useState(null)

  React.useEffect(() => {
    const saved = loadState()
    if (saved && saved.areas && saved.areas.length) {
      const hydrated = mergeAreas(saved.areas)
      setAreas(hydrated)
      setSelectedArea(saved.selectedArea || hydrated[0].name)
    }
  }, [])

  React.useEffect(() => {
    saveState({ areas, selectedArea })
  }, [areas, selectedArea])

  React.useEffect(() => {
    const tick = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  const current = React.useMemo(() => {
    return areas.find((a) => a.name === selectedArea) || areas[0]
  }, [areas, selectedArea])

  const requestWeather = React.useCallback(async (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('Valid coordinates are required for live telemetry')
    }

    try {
      const { data } = await axios.get(`${API}/api/weather`, {
        params: { lat, lon },
        headers: authHeaders
      })

      return {
        temp: typeof data.temperature?.blended === 'number'
          ? data.temperature.blended
          : data.temperature?.current ?? null,
        humidity: data.humidity ?? null,
        time: data.fetchedAt,
        precise: data.temperature || null,
        source: data.provider || 'open-meteo',
        coords: data.coords || { latitude: lat, longitude: lon }
      }
    } catch (err) {
      const message = err.response?.data?.error || err.response?.data?.message || err.message || 'Weather lookup failed'
      throw new Error(message)
    }
  }, [authHeaders])

  React.useEffect(() => {
    if (!Number.isFinite(current?.lat) || !Number.isFinite(current?.lon)) {
      setLiveTelemetry({ temp: null, humidity: null, time: null, precise: null, source: null, coords: null })
      setLiveStatus({ loading: false, error: 'Set coordinates to sync live telemetry' })
      return
    }

    let active = true
    setLiveStatus({ loading: true, error: null })

    requestWeather(current.lat, current.lon)
      .then((telemetry) => {
        if (!active) return
        setLiveTelemetry(telemetry)
        setLiveStatus({ loading: false, error: null })
      })
      .catch((err) => {
        if (!active) return
        setLiveTelemetry({ temp: null, humidity: null, time: null, precise: null, source: null, coords: null })
        setLiveStatus({ loading: false, error: err.message })
      })

    return () => {
      active = false
    }
  }, [current?.lat, current?.lon, requestWeather])

  function updateCurrent(updates) {
    setAreas((prev) =>
      prev.map((a) => (a.name === selectedArea ? { ...a, ...updates } : a))
    )
    setStatus('Saved')
    setTimeout(() => setStatus(''), 1200)
  }

  function adoptLiveValues() {
    const next = {}
    if (typeof liveTelemetry?.precise?.blended === 'number') next.temp = Math.round(liveTelemetry.precise.blended)
    if (typeof liveTelemetry?.humidity === 'number') next.humidity = Math.round(liveTelemetry.humidity)
    if (Object.keys(next).length) {
      updateCurrent(next)
    }
  }

  function handleCoordChange(key, value) {
    if (value === '') {
      updateCurrent({ [key]: null })
      return
    }
    const num = Number(value)
    if (Number.isNaN(num)) return
    const limits = key === 'lat' ? [-90, 90] : [-180, 180]
    updateCurrent({ [key]: clampCoord(num, limits[0], limits[1]) })
  }

  const runLocationSearch = React.useCallback(async (event) => {
    event?.preventDefault()
    const term = searchTerm.trim()
    if (term.length < 2) {
      setSearchError('Enter at least two characters to search')
      return
    }

    setSearchLoading(true)
    setSearchError(null)

    try {
      const { data } = await axios.get(`${API}/api/geocode`, {
        params: { q: term },
        headers: authHeaders
      })
      setSearchResults(data.matches || [])
      if (!data.matches?.length) {
        setSearchError('No matches found for that query')
      }
    } catch (err) {
      setSearchResults([])
      setSearchError(err.response?.data?.error || err.message || 'Lookup failed')
    } finally {
      setSearchLoading(false)
    }
  }, [authHeaders, searchTerm])

  function adoptSearchResult(match) {
    const label = formatLocationLabel(match)
    setAreas((prev) => {
      const exists = prev.some((a) => a.name === label)
      if (exists) {
        return prev.map((a) => (a.name === label ? { ...a, lat: match.latitude, lon: match.longitude } : a))
      }
      return [
        ...prev,
        {
          name: label,
          temp: Math.round(liveTelemetry?.temp ?? 22),
          humidity: Math.round(liveTelemetry?.humidity ?? 55),
          lat: match.latitude,
          lon: match.longitude
        }
      ]
    })
    setSelectedArea(label)
    setSearchResults([])
    setStatus(`Pinned ${label}`)
    setTimeout(() => setStatus(''), 1500)
  }

  async function refreshTelemetry() {
    if (!Number.isFinite(current?.lat) || !Number.isFinite(current?.lon)) {
      setLiveStatus({ loading: false, error: 'Set coordinates first' })
      return
    }
    setLiveStatus({ loading: true, error: null })
    try {
      const telemetry = await requestWeather(current.lat, current.lon)
      setLiveTelemetry(telemetry)
      setLiveStatus({ loading: false, error: null })
    } catch (err) {
      setLiveTelemetry({ temp: null, humidity: null, time: null, precise: null, source: null, coords: null })
      setLiveStatus({ loading: false, error: err.message })
    }
  }

  const canAdoptLive = typeof liveTelemetry?.precise?.blended === 'number' || typeof liveTelemetry?.humidity === 'number'
  const clockDisplay = formatTime(clock)
  const coordDisplay = liveTelemetry.coords
    ? `${Number(liveTelemetry.coords.latitude).toFixed(2)}°, ${Number(liveTelemetry.coords.longitude).toFixed(2)}°`
    : '—'

  return (
    <section className="neon-card climate-card">
      <div className="card-header">
        <p className="eyebrow">Local climate cell</p>
        <h3>{selectedArea}</h3>
        <p className="muted">Fine-tune environmental targets before dispatching directives to the field.</p>
        <div className="clock-chip" aria-live="polite">
          <span>{clock.toLocaleDateString()}</span>
          <strong>{clockDisplay}</strong>
        </div>
      </div>

      <div className="form-grid compact">
        <label className="form-label" htmlFor="area-select">Area</label>
        <select id="area-select" value={selectedArea} onChange={(e) => setSelectedArea(e.target.value)}>
          {areas.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="location-panel glass-card">
        <form className="search-grid" onSubmit={runLocationSearch}>
          <label className="form-label" htmlFor="location-query">Point anywhere</label>
          <div className="search-row">
            <input
              id="location-query"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="City, landmark, or region"
            />
            <button className="button-base outline-button" type="submit" disabled={searchLoading}>
              {searchLoading ? 'Scanning…' : 'Locate'}
            </button>
          </div>
        </form>
        {searchError && <p className="search-error">{searchError}</p>}
        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((match) => (
              <button key={`${match.name}-${match.latitude}-${match.longitude}`} type="button" className="search-pill" onClick={() => adoptSearchResult(match)}>
                <strong>{formatLocationLabel(match)}</strong>
                <span>{match.latitude}°, {match.longitude}°</span>
              </button>
            ))}
          </div>
        )}
        <div className="coord-grid">
          <div>
            <label className="form-label" htmlFor="latitude-input">Latitude</label>
            <input
              id="latitude-input"
              type="number"
              step="0.0001"
              value={current?.lat ?? ''}
              onChange={(e) => handleCoordChange('lat', e.target.value)}
              placeholder="0.0000"
            />
          </div>
          <div>
            <label className="form-label" htmlFor="longitude-input">Longitude</label>
            <input
              id="longitude-input"
              type="number"
              step="0.0001"
              value={current?.lon ?? ''}
              onChange={(e) => handleCoordChange('lon', e.target.value)}
              placeholder="0.0000"
            />
          </div>
        </div>
      </div>

      <div className="climate-stats">
        <div className="stat-chip">
          <span>Temperature</span>
          <strong>{current.temp}°C</strong>
        </div>
        <div className="stat-chip">
          <span>Humidity</span>
          <strong>{current.humidity}%</strong>
        </div>
      </div>

      <div className="live-feed glass-card">
        <div>
          <p className="eyebrow">Live telemetry</p>
          <p className="live-reading">
            {liveStatus.loading && 'Syncing high-resolution feed…'}
            {!liveStatus.loading && canAdoptLive && `${liveTelemetry.temp ?? '—'}°C · ${liveTelemetry.humidity ?? '—'}% RH`}
            {!liveStatus.loading && !canAdoptLive && 'Feed unavailable'}
          </p>
          <p className="live-meta">
            {liveStatus.error ? `⚠ ${liveStatus.error}` : liveTelemetry.time ? `as of ${formatTimestamp(liveTelemetry.time)}` : ''}
          </p>
          <div className="telemetry-meta">
            <div className="telemetry-chip">
              <span>Source</span>
              <strong>{liveTelemetry.source || '—'}</strong>
            </div>
            <div className="telemetry-chip">
              <span>Coordinates</span>
              <strong>{coordDisplay}</strong>
            </div>
          </div>
        </div>
        <div className="telemetry-actions">
          <button
            type="button"
            className="button-base outline-button"
            onClick={refreshTelemetry}
            disabled={liveStatus.loading}
          >
            Refresh Live Feed
          </button>
          <button
            type="button"
            className="button-base solid-button"
            onClick={adoptLiveValues}
            disabled={!canAdoptLive || liveStatus.loading}
          >
            Sync To Setpoints
          </button>
        </div>
      </div>

      <div className="range-field">
        <label className="form-label" htmlFor="temp-range">Temperature setpoint</label>
        <input
          id="temp-range"
          type="range"
          min={-20}
          max={50}
          value={current.temp}
          onChange={(e) => updateCurrent({ temp: Number(e.target.value) })}
        />
        <span className="range-value">{current.temp}°C</span>
      </div>

      <div className="range-field">
        <label className="form-label" htmlFor="humidity-range">Humidity setpoint</label>
        <input
          id="humidity-range"
          type="range"
          min={20}
          max={90}
          value={current.humidity}
          onChange={(e) => updateCurrent({ humidity: Number(e.target.value) })}
        />
        <span className="range-value">{current.humidity}%</span>
      </div>

      <p className="muted save-status">
        {status ? '✅ Saved locally' : 'Changes persist in this browser and sync per cell.'}
      </p>
    </section>
  )
}
