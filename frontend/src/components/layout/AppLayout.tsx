import { Box } from '@mui/material'
import { Outlet, useLocation } from 'react-router-dom'
import AppHeader from './AppHeader'
import AppSidebar from './AppSidebar'
import AskAIPanel from '@/components/AskAI/AskAIPanel'

export default function AppLayout() {
  const location = useLocation()

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      <AppSidebar />

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <AppHeader />

        <Box
          component="main"
          key={location.pathname}
          sx={{
            flex: 1,
            overflow: 'auto',
            bgcolor: 'background.default',
            // Fade-in per route change
            animation: 'fadeSlideIn .2s cubic-bezier(.4,0,.2,1)',
            '@keyframes fadeSlideIn': {
              from: { opacity: 0, transform: 'translateY(6px)' },
              to:   { opacity: 1, transform: 'translateY(0)' },
            },
          }}
        >
          <Outlet />
        </Box>
      </Box>

      {/* Global Ask AI floating panel — available on every page */}
      <AskAIPanel />
    </Box>
  )
}
