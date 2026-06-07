import { Dashboard } from './components/dashboard'
import { NavigationProvider } from './lib/navigation'

function App() {
  return (
    <NavigationProvider>
      <Dashboard />
    </NavigationProvider>
  )
}

export default App
