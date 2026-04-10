import { useMemo, useEffect } from 'react'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { Routes, Route, Navigate } from 'react-router-dom'
import { theme, darkTheme } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'
import LoginPage from '@/pages/Login/LoginPage'
import ProjectsPage from '@/pages/Projects/ProjectsPage'
import AppLayout from '@/components/layout/AppLayout'
import ConversionPage from '@/pages/Conversion/ConversionPage'
import AdminPage from '@/pages/Admin/AdminPage'
import PsSupportPage from '@/pages/PsSupport/PsSupportPage'
import DashboardPage from '@/pages/Dashboard/DashboardPage'
import MyDashboardsPage from '@/pages/MyDashboards/MyDashboardsPage'
import ApiCollectionPage from '@/pages/ApiCollection/ApiCollectionPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAppStore((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function ProjectRoute({ children }: { children: React.ReactNode }) {
  const user = useAppStore((s) => s.user)
  const project = useAppStore((s) => s.activeProject)
  if (!user) return <Navigate to="/login" replace />
  if (!project) return <Navigate to="/projects" replace />
  return <>{children}</>
}

export default function App() {
  const themeMode = useAppStore((s) => s.themeMode)

  const selectedTheme = useMemo(
    () => (themeMode === 'dark' ? darkTheme : theme),
    [themeMode],
  )

  // Sync dark-mode CSS class on <body> so globals.css dark overrides activate
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
            </ProjectRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"              element={<DashboardPage />} />
          <Route path="conversion"             element={<ConversionPage />} />
          <Route path="admin"                  element={<AdminPage />} />
          <Route path="ps-support"             element={<PsSupportPage />} />
          <Route path="ps-support/api-collection" element={<ApiCollectionPage />} />
          <Route path="my-dashboards"          element={<MyDashboardsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ThemeProvider>
  )
}
