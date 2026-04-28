import React from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import '../shared/api.d'

const container = document.getElementById('root')
if (!container) throw new Error('Status root element not found')
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
