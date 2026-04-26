import { useMemo, useEffect, useState, lazy, Suspense, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { ThemeProvider, CssBaseline, CircularProgress, Box, Alert, Button, Typography } from '@mui/material'
import { Routes, Route, Navigate } from 'react-router-dom'
import { theme, darkTheme } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'
import { authApi, debugSettingsApi } from '@/api'
import { REFRESH_STORAGE_KEY } from '@/api/client'
import LoginPage from '@/pages/Login/LoginPage'
import ProjectsPage from '@/pages/Projects/ProjectsPage'
import AppLayout from '@/components/layout/AppLayout'
import FeedbackButton from '@/components/FeedbackButton'
import HelpChat from '@/components/HelpChat'
import ConversionPage from '@/pages/Conversion/ConversionPage'
import AdminPage from '@/pages/Admin/AdminPage'
import PsSupportPage from '@/pages/PsSupport/PsSupportPage'
import DashboardPage from '@/pages/Dashboard/DashboardPage'
import MyDashboardsPage from '@/pages/MyDashboards/MyDashboardsPage'
import ApiCollectionPage from '@/pages/ApiCollection/ApiCollectionPage'
import ApprovalsPage from '@/pages/Approvals/ApprovalsPage'
import ReportsPage from '@/pages/Reports/ReportsPage'

// Lazy-loaded pages
const DevelopmentHubPage = lazy(() => import('@/pages/Stories/StoriesPage'))
const ConnectionsPage   = lazy(() => import('@/pages/Connections/ConnectionsPage'))
const DevelopmentPage   = lazy(() => import('@/pages/Development/DevelopmentPage'))
const PowerBIPage       = lazy(() => import('@/pages/PowerBI/PowerBIPage'))
const AgentsPage        = lazy(() => import('@/pages/Agents/AgentsPage'))
const TestingPage       = lazy(() => import('@/pages/Testing/TestingPage'))
const UsersPage         = lazy(() => import('@/pages/Users/UsersPage'))

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

// ── Auth Gate: silently refreshes token on page reload ────────────────────────
function AuthGate({ children }: { children: ReactNode }) {
  const user            = useAppStore((s) => s.user)
  const login           = useAppStore((s) => s.login)
  const logout          = useAppStore((s) => s.logout)
  const setDebugLevels  = useAppStore((s) => s.setDebugLevels)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const storedRefresh = localStorage.getItem(REFRESH_STORAGE_KEY)
    // If the store has a user but no token (e.g., after page reload where token was not persisted),
    // try to silently get a new access token using the refresh token.
    if (user && !user.token && storedRefresh) {
      authApi.refresh(storedRefresh)
        .then((data) => {
          // Update full user profile (including role) from the refresh response
          login({ id: data.user_id, username: data.username, role: data.role, token: data.access_token })
          localStorage.setItem(REFRESH_STORAGE_KEY, data.refresh_token)
        })
        .catch(() => {
          logout()
        })
        .finally(() => setReady(true))
    } else {
      setReady(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user?.token) {
      debugSettingsApi.getAll()
        .then((resp) => {
          setDebugLevels(Object.fromEntries(resp.settings.map((s) => [s.module, s.debug_level])))
        })
        .catch(() => {})
    }
  }, [user?.token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }
  return <>{children}</>
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

function AdminRoute({ children }: { children: ReactNode }) {
  const user = useAppStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />
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
      <AuthGate>
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
                <HelpChat />
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
            <Route path="admin"         element={<AdminRoute><PageErrorBoundary><AdminPage /></PageErrorBoundary></AdminRoute>} />
            <Route path="ps-support"    element={<PageErrorBoundary><PsSupportPage /></PageErrorBoundary>} />
            <Route path="ps-support/api-collection" element={<PageErrorBoundary><ApiCollectionPage /></PageErrorBoundary>} />
            <Route path="agents"        element={<Lazy><AgentsPage /></Lazy>} />
            <Route path="testing"       element={<Lazy><TestingPage /></Lazy>} />
            <Route path="users"         element={<AdminRoute><Lazy><UsersPage /></Lazy></AdminRoute>} />
            <Route path="approvals"     element={<PageErrorBoundary><ApprovalsPage /></PageErrorBoundary>} />
            <Route path="development-hub" element={<Lazy><DevelopmentHubPage /></Lazy>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthGate>
    </ThemeProvider>
  )
}
