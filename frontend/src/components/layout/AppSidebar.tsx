import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, Avatar, Tooltip, IconButton, alpha,
  Chip,
} from '@mui/material'
import {
  TransformOutlined,
  AdminPanelSettingsOutlined,
  SupportAgentOutlined,
  FolderOutlined,
  DarkModeOutlined,
  LightModeOutlined,
  LogoutOutlined,
  SwapHorizOutlined,
  DashboardOutlined,
  DashboardCustomizeOutlined,
  ApiOutlined,
} from '@mui/icons-material'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'

const SIDEBAR_WIDTH = 220

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
  { path: '/conversion', label: 'Conversion', icon: <TransformOutlined /> },
  { path: '/my-dashboards', label: 'My Dashboards', icon: <DashboardCustomizeOutlined /> },
  { path: '/ps-support', label: 'PS Support', icon: <SupportAgentOutlined /> },
  { path: '/ps-support/api-collection', label: 'API Collection', icon: <ApiOutlined /> },
  { path: '/admin', label: 'Admin', icon: <AdminPanelSettingsOutlined /> },
]

export default function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, activeProject, themeMode, toggleTheme, logout } = useAppStore()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: SIDEBAR_WIDTH,
          boxSizing: 'border-box',
          border: 'none',
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Brand */}
      <Box sx={{ p: 2.5, pb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2,
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <SwapHorizOutlined sx={{ color: '#fff', fontSize: 20 }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Clarity Studio
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary">
          v2.0 · Data Conversion
        </Typography>
      </Box>

      <Divider />

      {/* Active Project */}
      <Box
        sx={{
          mx: 1.5, my: 1.5, p: 1.5, borderRadius: 2,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.06),
          border: '1px solid',
          borderColor: (t) => alpha(t.palette.primary.main, 0.15),
          cursor: 'pointer',
          '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.10) },
        }}
        onClick={() => navigate('/projects')}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FolderOutlined sx={{ fontSize: 16, color: 'primary.main' }} />
          <Typography variant="caption" color="primary" fontWeight={600}>
            PROJECT
          </Typography>
        </Box>
        <Typography
          variant="subtitle2"
          sx={{ mt: 0.25, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {activeProject?.name ?? 'No project selected'}
        </Typography>
        <Chip
          label="Switch"
          size="small"
          variant="outlined"
          color="primary"
          sx={{ mt: 0.5, height: 20, fontSize: '0.688rem' }}
        />
      </Box>

      <Divider />

      {/* Navigation */}
      <List sx={{ flex: 1, pt: 1, px: 0.5 }}>
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.path)
          return (
            <ListItemButton
              key={item.path}
              selected={active}
              onClick={() => navigate(item.path)}
              sx={{ mb: 0.5 }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 36,
                  color: active ? 'primary.main' : 'text.secondary',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  variant: 'body2',
                  fontWeight: active ? 600 : 400,
                  color: active ? 'primary.main' : 'text.primary',
                }}
              />
            </ListItemButton>
          )
        })}
      </List>

      <Divider />

      {/* Footer */}
      <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
          {user?.username?.[0]?.toUpperCase() ?? 'U'}
        </Avatar>
        <Typography variant="body2" fontWeight={500} sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {user?.username ?? 'User'}
        </Typography>
        <Tooltip title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'}>
          <IconButton size="small" onClick={toggleTheme}>
            {themeMode === 'dark' ? (
              <LightModeOutlined fontSize="small" />
            ) : (
              <DarkModeOutlined fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Logout">
          <IconButton size="small" onClick={handleLogout} color="error">
            <LogoutOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Drawer>
  )
}
