import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import './styles/components.css'
import './styles/responsive.css'
import './styles/whatsapp.css'
import './styles/layout.css'
import './styles/dashboard-modern.css'
import './styles/donut-chart.css'
import './styles/login-modern.css'
import './styles/carteira-modern.css'
import './styles/fluxo-modern.css'
import './styles/diag-modern.css'
import './styles/loading.css'
import './styles/modals-modern.css'
import './styles/mercado-modern.css'
import './styles/admin-modern.css'
import './styles/extrato-modern.css'
import './styles/reset-modern.css'
import './styles/paginas-modern.css'
import './styles/ui.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
