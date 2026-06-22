import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './components/theme-provider'
import { ErrorBoundary } from './components/error-boundary'

import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme='system' storageKey='anubis-theme'>
      <ErrorBoundary label='app'>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
)

postMessage({ payload: 'removeLoading' }, '*')
