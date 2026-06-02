import { getApiBaseUrl, getHealth } from '@/api'
import { useEffect, useState } from 'react'
import InteractiveDotGrid from './components/aicanvas/dot-grid'

function App() {
  const [count, setCount] = useState(0)
  const [apiBaseUrl, setApiBaseUrl] = useState('Resolving...')
  const [backendStatus, setBackendStatus] = useState('Checking...')

  useEffect(() => {
    let active = true

    async function loadBackendStatus() {
      try {
        const [baseUrl, health] = await Promise.all([getApiBaseUrl(), getHealth()])
        if (!active) return

        setApiBaseUrl(baseUrl)
        setBackendStatus(`${health.service} online`)
      } catch (error) {
        if (!active) return

        setBackendStatus(error instanceof Error ? error.message : 'Backend unavailable')
      }
    }

    loadBackendStatus()

    return () => {
      active = false
    }
  }, [])

  return (
    <div className='dark h-screen w-screen'>
      <InteractiveDotGrid />
      Hallo Worlds
    </div>
  )
}

export default App
