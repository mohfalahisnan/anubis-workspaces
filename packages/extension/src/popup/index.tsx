import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

interface Status { connected: boolean; port: number | null; version: string }

function App() {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    const tick = () => {
      chrome.runtime.sendMessage({ type: 'status?' }, (resp: Status) => {
        if (chrome.runtime.lastError) { setStatus({ connected: false, port: null, version: '?' }); return }
        setStatus(resp)
      })
    }
    tick()
    const id = window.setInterval(tick, 1500)
    return () => window.clearInterval(id)
  }, [])

  const color = status?.connected ? '#16a34a' : '#b45309'
  return (
    <div style={{ fontFamily: 'system-ui', padding: '12px 14px', minWidth: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {status?.connected ? 'Connected to Anubis' : 'Offline'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
        {status?.connected ? `Port ${status.port} · v${status.version}` : 'Open the Anubis app, or paste a secret in Options.'}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
