import { Dashboard } from './components/dashboard'
import { NavigationProvider } from './lib/navigation'
import { ProjectProvider } from './lib/use-project'

function App() {
  return (
    <ProjectProvider>
      <NavigationProvider>
        <Dashboard />
      </NavigationProvider>
    </ProjectProvider>
  )
}

export default App
