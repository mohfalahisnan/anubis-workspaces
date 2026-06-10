import { Dashboard } from './components/dashboard'
import Update from './components/update'
import { NavigationProvider } from './lib/navigation'
import { ProjectProvider } from './lib/use-project'

function App() {
  return (
    <ProjectProvider>
      <NavigationProvider>
        <Dashboard />
        {/* Silent update check on launch; the modal opens only when a new
            version exists. Settings triggers manual checks via
            requestUpdateCheck(). */}
        <Update />
      </NavigationProvider>
    </ProjectProvider>
  )
}

export default App
