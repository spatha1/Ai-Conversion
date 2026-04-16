import { useMemo, useEffect, lazy, Suspense, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { ThemeProvider, CssBaseline, CircularProgress, Box, Alert, Button, Typography } from '@mui/material'
import { Routes, Route, Navigate } from 'react-router-dom'
import { theme, darkTheme } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'
import LoginPage from '@/pages/Login/LoginPage'
import ProjectsPage from '@/pages/Projects/ProjectsPage'
import AppLayout from '@/components/layout/AppLayout'
import FeedbackButton from '@/components/FeedbackButton'
import ConversionPage from '@/pages/Conversion/ConversionPage'
import AdminPage from '@/pages/Admin/AdminPage'
import PsSupportPage from '@/pages/PsSupport/PsSupportPage'
import DashboardPage from '@/pages/Dashboard/DashboardPage'
import MyDashboardsPage from '@/pages/MyDashboards/MyDashboardsPage'
import ApiCollectionPage from '@/pages/ApiCollection/ApiCollectionPage'
import ReportsPage from '@/pages/Reports/ReportsPage'

// Lazy-loaded pages
const ConnectionsPage   = lazy(() => import('@/pages/Connections/ConnectionsPage'))
const DevelopmentPage   = lazy(() => import('@/pages/Development/DevelopmentPage'))
const PowerBIPage       = lazy(() => import('@/pages/PowerBI/PowerBIPage'))
const AgentsPage        = lazy(() => import('@/pages/Agents/AgentsPage'))
const TestingPage       = lazy(() => import('@/pages/Testing/TestingPage'))

function PageLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <CircularProgress size={32} />
    </Box>
  )
}

// ── Error Boundary ────────────────────────────────────────────────────────────
interface EBState { error: Error | null }
class PageErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null }
  static getDerivedStateFromError(error: Error): EBState { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 4, maxWidth: 600, mx: 'auto', mt: 4 }}>
          <Alert
            severity="error"
            action={
              <Button size="small" color="inherit" onClick={() => this.setState({ error: null })}>
                Retry
              </Button>
            }
          >
            <Typography fontWeight={700} gutterBottom>Page Error</Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block' }}>
              {this.state.error.message}
            </Typography>
          </Alert>
        </Box>
      )
    }
    return this.props.children
  }
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const user = useAppStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function ProjectRoute({ children }: { children: ReactNode }) {
  const user = useAppStore((s) => s.user)
  const project = useAppStore((s) => s.activeProject)
  if (!user) return <Navigate to="/login" replace />
  if (!project) return <Navigate to="/projects" replace />
  return <>{children}</>
}

function Lazy({ children }: { children: ReactNode }) {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </PageErrorBoundary>
  )
}

export default function App() {
  const themeMode = useAppStore((s) => s.themeMode)

  const selectedTheme = useMemo(
    () => (themeMode === 'dark' ? darkTheme : theme),
    [themeMode],
  )

  useEffect(() => {
    if (themeMode === 'dark') {
      document.documentElement.classList.add('dark-mode')
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark-mode')
      document.documentElement.setAttribute('data-theme', 'light')
    }
  }, [themeMode])

  return (
    <ThemeProvider theme={selectedTheme}>
      <CssBaseline />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <ProjectsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProjectRoute>
              <AppLayout />
              <FeedbackButton />
            </ProjectRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"     element={<PageErrorBoundary><DashboardPage /></PageErrorBoundary>} />
          <Route path="connections"   element={<Lazy><ConnectionsPage /></Lazy>} />
          <Route path="conversion"    element={<PageErrorBoundary><ConversionPage /></PageErrorBoundary>} />
          <Route path="development"   element={<Lazy><DevelopmentPage /></Lazy>} />
          <Route path="dashboards"    element={<PageErrorBoundary><MyDashboardsPage /></PageErrorBoundary>} />
          <Route path="my-dashboards" element={<Navigate to="/dashboards" replace />} />
          <Route path="reports"       element={<PageErrorBoundary><ReportsPage /></PageErrorBoundary>} />
          <Route path="powerbi"       element={<Lazy><PowerBIPage /></Lazy>} />
          <Route path="admin"         element={<PageErrorBoundary><AdminPage /></PageErrorBoundary>} />
          <Route path="ps-support"    element={<PageErrorBoundary><PsSupportPage /></PageErrorBoundary>} />
          <Route path="ps-support/api-collection" element={<PageErrorBoundary><ApiCollectionPage /></PageErrorBoundary>} />
          <Route path="agents"        element={<Lazy><AgentsPage /></Lazy>} />
          <Route path="testing"       element={<Lazy><TestingPage /></Lazy>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  )
}
