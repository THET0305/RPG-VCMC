import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Mount immediately; App handles boot/error UI.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
