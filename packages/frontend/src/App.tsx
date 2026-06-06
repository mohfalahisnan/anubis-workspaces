import { Dashboard } from './components/dashboard'
import { NavigationProvider } from './lib/navigation'
import { WorkspaceProvider } from './lib/workspace'

function App() {
  return (
    <WorkspaceProvider>
      <NavigationProvider>
        <Dashboard />
      </NavigationProvider>
    </WorkspaceProvider>
  )
}

export default App
