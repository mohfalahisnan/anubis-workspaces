import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  const [secret, setSecret] = useState('')
  const [saved, setSaved] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [existing, setExisting] = useState<boolean>(false)

  useEffect(() => {
    void chrome.storage.local.get('anubis.secret').then((r) => {
      setExisting(typeof r['anubis.secret'] === 'string' && (r['anubis.secret'] as string).length >= 32)
    })
  }, [])

  async function save() {
    if (secret.length < 32) { setSaved('err'); return }
    setSaved('saving')
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'secret-updated', secret }, (resp) => {
          if (resp?.ok) resolve(); else reject(new Error('background rejected'))
        })
      })
      setSaved('ok')
      setExisting(true)
      setSecret('')
    } catch {
      setSaved('err')
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 480 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Anubis pairing</h1>
      <p style={{ color: '#555', fontSize: 13 }}>
        Open the Anubis desktop app, go to <strong>Settings → Chrome extension</strong>, click
        <em> Reveal pairing secret</em>, and paste it below.
      </p>
      <input
        type='password'
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder='Paste the 64-character secret'
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13, padding: '8px 10px' }}
      />
      <button
        onClick={() => void save()}
        disabled={saved === 'saving' || secret.length < 32}
        style={{ marginTop: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
      >
        {saved === 'saving' ? 'Saving…' : existing ? 'Replace pairing' : 'Pair'}
      </button>
      {saved === 'ok' && <p style={{ color: 'green', fontSize: 12, marginTop: 8 }}>Paired. The popup icon will turn green within a moment.</p>}
      {saved === 'err' && <p style={{ color: '#b00', fontSize: 12, marginTop: 8 }}>Secret must be ≥ 32 characters.</p>}
      {existing && saved === 'idle' && <p style={{ color: '#555', fontSize: 12, marginTop: 8 }}>A secret is already stored. Paste a new one to re-pair.</p>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
