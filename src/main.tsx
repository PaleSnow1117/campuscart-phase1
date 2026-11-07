import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DownloadPage from './DownloadPage'

const isDownloadPage =
  window.location.pathname === '/download' ||
  window.location.pathname === '/download/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDownloadPage ? <DownloadPage /> : <App />}
  </StrictMode>,
)