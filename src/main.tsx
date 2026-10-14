import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// Start the entrance text only once its bundled font is ready, avoiding a visible swap.
document.fonts.load('italic 300 14px "Cormorant Garamond"')
  .catch(() => { /* Keep the app usable if the font request fails. */ })
  .finally(() => createRoot(document.getElementById('root')!).render(<App />))
