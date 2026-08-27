import React from 'react'
import { createRoot } from 'react-dom/client'
import SupplierOpsApp from './App'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('SupplierOps renderer root is missing.')
}

createRoot(rootElement).render(
  <React.StrictMode>
    <SupplierOpsApp />
  </React.StrictMode>,
)
