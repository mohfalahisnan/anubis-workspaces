import { getApiBaseUrl, getHealth } from '@/api'
import { useEffect, useState } from 'react'
import InteractiveDotGrid from './components/aicanvas/dot-grid'
import { ModeToggle } from './components/mode-toggle'

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
    <div className='relative h-screen w-screen'>
      <header className='absolute right-0 top-0 z-10 flex items-center justify-end p-4'>
        <ModeToggle />
      </header>
      <InteractiveDotGrid />
      Hallo Worlds
    </div>
  )
}

export default App
