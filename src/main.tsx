import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { Crash } from '@/app/Crash'
import { forgetOldVersion } from '@/app/signOut'
import { startTheme } from '@/app/theme'
import { watchForUpdates } from '@/app/updates'
import { backend } from '@/backend'
import { startAuth, takeReturnedUrl } from '@/backend/auth'
import { isSetUp } from '@/backend/client'
import { usePictures } from '@/backend/pictures'
import { useSaveStatus } from '@/backend/status'
import { debugWrites } from '@/backend/writes'
import * as actions from '@/data/actions'
import { useTheme } from '@/lib/theme'
import './index.css'

// for scripted checks (CLAUDE.md, testing)
window.sprawniej = {
  ...window.sprawniej,
  actions: { ...actions },
  backend: {
    status: useSaveStatus,
    catchUp: backend.catchUp,
    debug: backend.debug,
    pending: backend.pending,
    flush: backend.flush,
    writes: debugWrites,
    history: backend.history,
    pictures: usePictures,
    saveCache: backend.saveCache,
  },
  theme: useTheme,
}

// a page that loaded fine clears the "reloaded once for a new version" mark, so the next update can do it again
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('sprawniej:reloaded-for-update'), 10_000))

watchForUpdates()
forgetOldVersion()
// light or dark: index.html already put it on the page; this keeps it right from now on
startTheme()

// back from GitHub: the route you were on, and words for a sign-in that didn't finish; then the sign-in starts
if (isSetUp()) startAuth(takeReturnedUrl(location, sessionStorage, (url) => history.replaceState(history.state, '', url)))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
      <App />
    </Crash>
  </StrictMode>,
)
