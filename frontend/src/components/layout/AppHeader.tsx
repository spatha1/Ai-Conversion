import { AppBar, Toolbar, Typography, Breadcrumbs, Link, Box, Chip } from '@mui/material'
import { NavigateNextOutlined, HomeOutlined } from '@mui/icons-material'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'

const SECTION_LABELS: Record<string, string> = {
  conversion: 'Conversion',
  reports: 'Reports & Analytics',
  'ps-support': 'PS Support',
  admin: 'Administration',
}

export default function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeProject = useAppStore((s) => s.activeProject)

  const section = location.pathname.split('/').filter(Boolean)[0] ?? ''
  const label = SECTION_LABELS[section] ?? section

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        zIndex: 10,
      }}
    >
      <Toolbar sx={{ minHeight: 52, px: 3 }}>
        <Breadcrumbs
          separator={<NavigateNextOutlined sx={{ fontSize: 16 }} />}
          sx={{ flex: 1 }}
        >
          <Link
            component="button"
            underline="hover"
            color="inherit"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.875rem' }}
            onClick={() => navigate('/projects')}
          >
            <HomeOutlined sx={{ fontSize: 16 }} />
          </Link>
          {activeProject && (
            <Link
              component="button"
              underline="hover"
              color="inherit"
              sx={{ fontSize: '0.875rem' }}
              onClick={() => navigate('/projects')}
            >
              {activeProject.name}
            </Link>
          )}
          <Typography color="text.primary" sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
            {label}
          </Typography>
        </Breadcrumbs>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {activeProject && (
            <Chip
              label={`Project: ${activeProject.name}`}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
            />
          )}
        </Box>
      </Toolbar>
    </AppBar>
  )
}
