import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app/App'
import { AuthGate } from './features/auth/AuthGate'
import './shared/styles/tokens.css'
import './shared/styles/global.css'
import './shared/styles/site-theme.css'
import './shared/styles/reading-refresh.css'
import './shared/styles/journal-layout.css'

registerSW({ immediate: true })

const root = document.getElementById('root')

if (!root) {
  throw new Error('找不到應用程式根節點')
}

createRoot(root).render(
  <StrictMode>
    <AuthGate><App /></AuthGate>
  </StrictMode>
)
