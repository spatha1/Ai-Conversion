import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, Avatar, Tooltip, IconButton, alpha, Chip,
} from '@mui/material'
import {
  TransformOutlined,
  AdminPanelSettingsOutlined,
  SupportAgentOutlined,
  DarkModeOutlined,
  LightModeOutlined,
  LogoutOutlined,
  DashboardOutlined,
  DashboardCustomizeOutlined,
  ApiOutlined,
  KeyboardArrowRightOutlined,
  StorageOutlined,
  CodeOutlined,
  BarChartOutlined,
  AssessmentOutlined,
  FolderOutlined,
  PrecisionManufacturingOutlined,
  FactCheckOutlined,
  PeopleOutlined,
  CheckCircleOutlined,
  AutoAwesomeOutlined,
  DynamicFormOutlined,
} from '@mui/icons-material'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type { UserRole } from '@/types'

const SIDEBAR_WIDTH = 212

// ── Logo switch: set to 'sai' or 'aggne' ──────────────────────────────────
const ACTIVE_LOGO: 'sai' | 'aggne' = 'sai'
const LOGOS = {
  sai:   { src: '/sai-logo.png',   alt: 'Smart AI Intelligence', maxWidth: 72, height: 'auto', bg: 'transparent' },
  aggne: { src: 'https://cdn.prod.website-files.com/6475eb051e7c8aad43b89678/65e95c179626aa016929e0fe_Aggne_logo_white.png', alt: 'Aggne', maxWidth: 80, height: 22, bg: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' },
}
const logo = LOGOS[ACTIVE_LOGO]

// Role rank: higher number = more access
const ROLE_RANK: Record<string, number> = { viewer: 0, developer: 1, admin: 2 }

function canSeeItem(userRole: UserRole | undefined, minRole: UserRole): boolean {
  return (ROLE_RANK[userRole ?? 'viewer'] ?? 0) >= (ROLE_RANK[minRole] ?? 0)
}

const NAV_ITEMS: Array<{
  path: string
  label: string
  icon: React.ReactNode
  group: string
  minRole: UserRole
}> = [
  { path: '/dashboard',                 label: 'Dashboard',       icon: <DashboardOutlined />,           group: 'workspace', minRole: 'viewer' },
  { path: '/connections',               label: 'Connections',     icon: <StorageOutlined />,             group: 'workspace', minRole: 'viewer' },
  { path: '/conversion',                label: 'Conversion',      icon: <TransformOutlined />,           group: 'modules',   minRole: 'viewer' },
  { path: '/development',               label: 'Build',           icon: <CodeOutlined />,                group: 'modules',   minRole: 'developer' },
  { path: '/development-hub',           label: 'Dev Hub',         icon: <AutoAwesomeOutlined />,         group: 'modules',   minRole: 'developer' },
  { path: '/dashboards',                label: 'My Dashboards',   icon: <DashboardCustomizeOutlined />,  group: 'analytics', minRole: 'viewer' },
  { path: '/ps-support',                label: 'PS Support',      icon: <SupportAgentOutlined />,        group: 'support',   minRole: 'viewer' },
  { path: '/ps-support/api-collection', label: 'API Collection',  icon: <ApiOutlined />,                group: 'support',   minRole: 'developer' },
  { path: '/agents',                    label: 'AI Agents',       icon: <PrecisionManufacturingOutlined />, group: 'support', minRole: 'developer' },
  { path: '/testing',                   label: 'Testing / Recon', icon: <FactCheckOutlined />,           group: 'analytics', minRole: 'developer' },
  { path: '/reports',                   label: 'Reports',         icon: <BarChartOutlined />,            group: 'analytics', minRole: 'viewer' },
  { path: '/form-builder',              label: 'Form Builder',    icon: <DynamicFormOutlined />,         group: 'analytics', minRole: 'developer' },
  { path: '/powerbi',                   label: 'Power BI Dev',    icon: <AssessmentOutlined />,          group: 'analytics', minRole: 'developer' },
  { path: '/approvals',                  label: 'Approvals',       icon: <CheckCircleOutlined />,         group: 'system',    minRole: 'viewer' },
  { path: '/admin',                     label: 'Admin',           icon: <AdminPanelSettingsOutlined />,  group: 'system',    minRole: 'admin' },
  { path: '/users',                     label: 'User Management', icon: <PeopleOutlined />,              group: 'system',    minRole: 'admin' },
]

const GROUP_ORDER = ['workspace', 'modules', 'support', 'analytics', 'system']

const GROUP_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  modules:   'Modules',
  support:   'PS Support',
  analytics: 'Analytics',
  system:    'System',
}

const ROLE_COLORS: Record<UserRole, { bg: string; text: string }> = {
  admin:     { bg: '#7C3AED20', text: '#7C3AED' },
  developer: { bg: '#1D4ED820', text: '#1D4ED8' },
  viewer:    { bg: '#6B728020', text: '#6B7280' },
}

export default function AppSidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, activeProject, themeMode, toggleTheme, logout } = useAppStore()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const userRole = user?.role ?? 'viewer'
  const roleColors = ROLE_COLORS[userRole]

  // Filter nav items by role
  const grouped = NAV_ITEMS.reduce<Record<string, typeof NAV_ITEMS>>((acc, item) => {
    if (!canSeeItem(userRole, item.minRole)) return acc
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {})

  const userInitial = user?.username?.[0]?.toUpperCase() ?? 'U'
  const isDark = themeMode === 'dark'

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
          bgcolor: isDark ? tokens.darkPaper : '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          overflowX: 'hidden',
        },
      }}
    >
      {/* ── Brand ─────────────────────────────────────────────── */}
      <Box sx={{ px: 2, pt: 1.75, pb: 1.25, display: 'flex', alignItems: 'center' }}>
        <Box sx={{
          px: ACTIVE_LOGO === 'aggne' ? 1.25 : 0,
          py: ACTIVE_LOGO === 'aggne' ? 0.75 : 0,
          borderRadius: 2,
          background: logo.bg,
          boxShadow: ACTIVE_LOGO === 'aggne' ? '0 3px 10px rgba(79,70,229,0.4)' : 'none',
          display: 'flex', alignItems: 'center',
        }}>
          <Box
            component="img"
            src={logo.src}
            alt={logo.alt}
            sx={{ maxWidth: logo.maxWidth, height: logo.height, objectFit: 'contain', display: 'block' }}
          />
        </Box>
      </Box>

      <Divider />

      {/* ── Navigation ─────────────────────────────────────────── */}
      <Box sx={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 1,
        scrollbarWidth: 'thin',
        scrollbarColor: isDark ? 'rgba(255,255,255,.12) transparent' : 'rgba(0,0,0,.1) transparent',
        '&::-webkit-scrollbar': { width: 3 },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': {
          borderRadius: 4,
          background: isDark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)',
        },
      }}>
        {GROUP_ORDER.map((groupKey) => {
          const items = grouped[groupKey]
          if (!items?.length) return null
          return (
          <Box key={groupKey}>
            <Typography
              variant="overline"
              sx={{
                px: 2, pt: 2, pb: 0.25, display: 'block',
                color: isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.45)',
                fontSize: '0.6rem',
                letterSpacing: '0.1em',
                fontWeight: 800,
              }}
            >
              {GROUP_LABELS[groupKey]}
            </Typography>
            <List disablePadding sx={{ px: 0.75 }}>
              {items.map((item) => {
                const active = location.pathname === item.path ||
                  (item.path !== '/ps-support' && location.pathname.startsWith(item.path))
                return (
                  <ListItemButton
                    key={item.path}
                    selected={active}
                    onClick={() => navigate(item.path)}
                    sx={{
                      mb: 0.25, borderRadius: 2,
                      minHeight: 36,
                      px: 1.25, py: 0.6,
                      position: 'relative',
                      transition: 'background .15s ease, box-shadow .15s ease',
                      '&:hover': {
                        background: isDark
                          ? alpha(tokens.indigo500, 0.1)
                          : alpha(tokens.indigo600, 0.07),
                        '& .nav-icon svg': { color: isDark ? tokens.indigo400 : tokens.indigo600 },
                        '& .nav-label': { color: isDark ? tokens.indigo300 : tokens.indigo700 },
                      },
                      ...(active && {
                        background: isDark
                          ? `linear-gradient(135deg, ${alpha(tokens.indigo500, 0.25)}, ${alpha(tokens.violet600, 0.18)})`
                          : `linear-gradient(135deg, ${alpha(tokens.indigo600, 0.12)}, ${alpha(tokens.violet600, 0.08)})`,
                        boxShadow: isDark
                          ? `inset 0 0 0 1px ${alpha(tokens.indigo400, 0.3)}`
                          : `inset 0 0 0 1px ${alpha(tokens.indigo600, 0.2)}`,
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          left: -6,
                          top: '18%',
                          height: '64%',
                          width: 3,
                          borderRadius: '0 3px 3px 0',
                          background: isDark ? tokens.indigo400 : tokens.indigo600,
                          boxShadow: `0 0 8px ${isDark ? tokens.indigo400 : tokens.indigo600}`,
                        },
                        '&:hover': {
                          background: isDark
                            ? `linear-gradient(135deg, ${alpha(tokens.indigo500, 0.32)}, ${alpha(tokens.violet600, 0.24)})`
                            : `linear-gradient(135deg, ${alpha(tokens.indigo600, 0.16)}, ${alpha(tokens.violet600, 0.11)})`,
                        },
                      }),
                    }}
                  >
                    <ListItemIcon
                      className="nav-icon"
                      sx={{
                        minWidth: 30,
                        '& svg': {
                          fontSize: 17,
                          color: active
                            ? (isDark ? tokens.indigo400 : tokens.indigo600)
                            : (isDark ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.38)'),
                          transition: 'color .15s ease',
                        },
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        className: 'nav-label',
                        variant: 'body2',
                        fontWeight: active ? 700 : 500,
                        fontSize: '0.825rem',
                        color: active
                          ? (isDark ? tokens.indigo300 : tokens.indigo700)
                          : 'text.primary',
                        sx: { transition: 'color .15s ease' },
                      }}
                    />
                    {active && (
                      <Box
                        sx={{
                          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                          background: isDark ? tokens.indigo400 : tokens.indigo600,
                          boxShadow: `0 0 6px ${isDark ? tokens.indigo400 : tokens.indigo600}`,
                        }}
                      />
                    )}
                  </ListItemButton>
                )
              })}
            </List>
          </Box>
          )
        })}
      </Box>

      <Divider />

      {/* ── Footer ────────────────────────────────────────────── */}
      <Box sx={{ p: 1.5 }}>
        {/* User row */}
        <Box
          sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            p: 1, borderRadius: 2.5, mb: 0.5,
            bgcolor: isDark ? 'rgba(255,255,255,.04)' : tokens.slate50,
            border: '1px solid',
            borderColor: isDark ? 'rgba(255,255,255,.08)' : tokens.slate100,
            boxShadow: isDark ? '0 -2px 12px rgba(0,0,0,.25)' : '0 -2px 8px rgba(0,0,0,.06)',
          }}
        >
          <Avatar
            sx={{
              width: 30, height: 30, flexShrink: 0,
              background: `linear-gradient(135deg, ${tokens.indigo500}, ${tokens.violet600})`,
              fontSize: 12, fontWeight: 700,
              boxShadow: `0 2px 8px ${alpha(tokens.indigo600, 0.35)}`,
            }}
          >
            {userInitial}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.813rem', lineHeight: 1.3 }}
            >
              {user?.username ?? 'User'}
            </Typography>
            <Chip
              label={userRole}
              size="small"
              sx={{
                height: 16, fontSize: '0.58rem', fontWeight: 700, mt: 0.25,
                bgcolor: roleColors.bg,
                color: roleColors.text,
                border: 'none',
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          </Box>
          <Tooltip title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'} arrow>
            <IconButton
              size="small"
              onClick={toggleTheme}
              sx={{
                width: 28, height: 28, flexShrink: 0,
                color: 'text.secondary',
                '&:hover': { color: isDark ? tokens.indigo400 : tokens.indigo600 },
              }}
            >
              {themeMode === 'dark'
                ? <LightModeOutlined sx={{ fontSize: 15 }} />
                : <DarkModeOutlined sx={{ fontSize: 15 }} />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Sign out" arrow>
            <IconButton
              size="small"
              onClick={handleLogout}
              sx={{
                width: 28, height: 28, flexShrink: 0,
                color: 'text.disabled',
                '&:hover': { color: 'error.main', bgcolor: alpha('#ef4444', 0.08) },
              }}
            >
              <LogoutOutlined sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Drawer>
  )
}
