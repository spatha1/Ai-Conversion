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
  SchemaOutlined,
  LibraryBooksOutlined,
  SmartToyOutlined,
  PsychologyOutlined,
  DataObjectOutlined,
  RadarOutlined,
} from '@mui/icons-material'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type { UserRole } from '@/types'

const SIDEBAR_WIDTH = 228

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
  // ── Workspace ─────────────────────────────────────────────────────────────
  { path: '/dashboard',                 label: 'Dashboard',          icon: <DashboardOutlined />,              group: 'workspace',   minRole: 'viewer' },
  { path: '/connections',               label: 'Connections',        icon: <StorageOutlined />,                group: 'workspace',   minRole: 'viewer' },

  // ── Migration ─────────────────────────────────────────────────────────────
  { path: '/conversion',                label: 'P&C',                icon: <TransformOutlined />,              group: 'migration',   minRole: 'viewer' },
  { path: '/la',                        label: 'L&A',                icon: <TransformOutlined />,              group: 'migration',   minRole: 'viewer' },

  // ── Work Bench ────────────────────────────────────────────────────────────
  { path: '/dashboards',                label: 'Dashboards',         icon: <DashboardCustomizeOutlined />,     group: 'workbench',   minRole: 'viewer' },
  { path: '/reports',                   label: 'Reports',            icon: <BarChartOutlined />,               group: 'workbench',   minRole: 'viewer' },
  { path: '/dev-hub',                   label: 'Design Hub',         icon: <AutoAwesomeOutlined />,            group: 'workbench',   minRole: 'developer' },
  { path: '/development',               label: 'SQL Agent',          icon: <CodeOutlined />,                   group: 'workbench',   minRole: 'developer' },

  // ── Production Support ────────────────────────────────────────────────────
  { path: '/ps-support',                label: 'PS Support',         icon: <SupportAgentOutlined />,           group: 'prodsupport', minRole: 'viewer' },
  { path: '/ps-support/api-collection', label: 'API Collection',     icon: <ApiOutlined />,                    group: 'prodsupport', minRole: 'developer' },
  { path: '/agents',                    label: 'AI Agents',          icon: <PrecisionManufacturingOutlined />, group: 'prodsupport', minRole: 'developer' },
  { path: '/sai',                       label: 'SAI',                icon: <RadarOutlined />,                  group: 'prodsupport', minRole: 'developer' },
  { path: '/knowledge',                 label: 'SAI Knowledge',      icon: <AutoAwesomeOutlined />,            group: 'prodsupport', minRole: 'viewer' },

  // ── Analytics ─────────────────────────────────────────────────────────────
  { path: '/testing',                   label: 'Testing / Recon',    icon: <FactCheckOutlined />,              group: 'analytics',   minRole: 'developer' },
  { path: '/form-builder',              label: 'Form Builder',       icon: <DynamicFormOutlined />,            group: 'analytics',   minRole: 'developer' },
  { path: '/query-intelligence',        label: 'Query Intelligence', icon: <PsychologyOutlined />,             group: 'analytics',   minRole: 'developer' },
  { path: '/payload-intelligence',      label: 'Payload Intelligence', icon: <DataObjectOutlined />,           group: 'analytics',   minRole: 'developer' },
  { path: '/powerbi',                   label: 'Power BI Dev',       icon: <AssessmentOutlined />,             group: 'analytics',   minRole: 'developer' },

  // ── Mapper ────────────────────────────────────────────────────────────────
  { path: '/agent-mapper/templates',    label: 'Mapper Templates',   icon: <LibraryBooksOutlined />,           group: 'mapper',      minRole: 'developer' },
  { path: '/agent-mapper',              label: 'Agent Mapper',       icon: <SchemaOutlined />,                 group: 'mapper',      minRole: 'developer' },
  { path: '/mapping-assistant',         label: 'Mapping Assistant',  icon: <SmartToyOutlined />,               group: 'mapper',      minRole: 'developer' },

  // ── System ────────────────────────────────────────────────────────────────
  { path: '/approvals',                 label: 'Approvals',          icon: <CheckCircleOutlined />,            group: 'system',      minRole: 'viewer' },
  { path: '/admin',                     label: 'Admin',              icon: <AdminPanelSettingsOutlined />,     group: 'system',      minRole: 'developer' },
  { path: '/users',                     label: 'User Management',    icon: <PeopleOutlined />,                 group: 'system',      minRole: 'admin' },
]

const GROUP_ORDER = ['workspace', 'migration', 'workbench', 'prodsupport', 'analytics', 'mapper', 'system']

const GROUP_LABELS: Record<string, string> = {
  workspace:   'Workspace',
  migration:   'Migration',
  workbench:   'Work Bench',
  prodsupport: 'Production Support',
  analytics:   'Analytics',
  mapper:      'Mapper',
  system:      'System',
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
      <Box sx={{ px: 2, pt: 2, pb: 1.5 }}>
        {/* Logo — full width */}
        <Box
          component="img"
          src="/flarre-logo.png?v=2"
          alt="Flarre.ai"
          sx={{ height: 36, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block', mb: 0.75 }}
        />
        {/* App name below the logo */}
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
        >
          Data Work Bench
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.668rem' }}>
          AI Data Platform
        </Typography>
      </Box>

      <Divider />

      {/* ── Active Project ─────────────────────────────────────── */}
      <Box
        sx={{
          mx: 1.5, my: 1.5, p: 1.25, borderRadius: 2.5,
          background: isDark
            ? `linear-gradient(135deg, ${alpha(tokens.indigo500, 0.1)}, ${alpha(tokens.violet600, 0.08)})`
            : `linear-gradient(135deg, ${alpha(tokens.indigo600, 0.06)}, ${alpha(tokens.violet600, 0.04)})`,
          border: '1px solid',
          borderColor: isDark ? alpha(tokens.indigo400, 0.2) : alpha(tokens.indigo600, 0.15),
          cursor: 'pointer',
          transition: 'all .18s ease',
          '&:hover': {
            background: isDark
              ? `linear-gradient(135deg, ${alpha(tokens.indigo500, 0.16)}, ${alpha(tokens.violet600, 0.12)})`
              : `linear-gradient(135deg, ${alpha(tokens.indigo600, 0.1)}, ${alpha(tokens.violet600, 0.07)})`,
            borderColor: isDark ? alpha(tokens.indigo400, 0.35) : alpha(tokens.indigo600, 0.25),
          },
        }}
        onClick={() => navigate('/projects')}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <FolderOutlined sx={{ fontSize: 13, color: isDark ? tokens.indigo400 : tokens.indigo600, flexShrink: 0 }} />
            <Typography
              variant="caption"
              sx={{
                color: isDark ? tokens.indigo400 : tokens.indigo700,
                fontWeight: 700,
                fontSize: '0.625rem',
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
              }}
            >
              Project
            </Typography>
          </Box>
          <KeyboardArrowRightOutlined sx={{ fontSize: 14, color: isDark ? tokens.indigo400 : tokens.indigo600, opacity: 0.7, flexShrink: 0 }} />
        </Box>
        <Typography
          variant="body2"
          sx={{ mt: 0.4, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.813rem' }}
        >
          {activeProject?.name ?? 'No project selected'}
        </Typography>
        {activeProject && (
          <Chip
            label="Switch"
            size="small"
            sx={{
              mt: 0.75, height: 18, fontSize: '0.625rem', fontWeight: 700,
              bgcolor: isDark ? alpha(tokens.indigo500, 0.2) : alpha(tokens.indigo600, 0.08),
              color: isDark ? tokens.indigo400 : tokens.indigo700,
              border: 'none',
            }}
          />
        )}
      </Box>

      <Divider />

      {/* ── Navigation ─────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 1 }}>
        {GROUP_ORDER.map((groupKey) => {
          const items = grouped[groupKey]
          if (!items?.length) return null
          return (
          <Box key={groupKey}>
            <Typography
              variant="overline"
              sx={{
                px: 2.5, pt: 1.5, pb: 0.5, display: 'block',
                color: 'text.disabled',
                fontSize: '0.625rem',
                letterSpacing: '0.09em',
                fontWeight: 700,
              }}
            >
              {GROUP_LABELS[groupKey]}
            </Typography>
            <List disablePadding sx={{ px: 0.75 }}>
              {items.map((item) => {
                const EXACT_ONLY = ['/ps-support', '/agent-mapper']
                const active = location.pathname === item.path ||
                  (!EXACT_ONLY.includes(item.path) && location.pathname.startsWith(item.path + '/'))
                return (
                  <ListItemButton
                    key={item.path}
                    selected={active}
                    onClick={() => navigate(item.path)}
                    sx={{
                      mb: 0.25, borderRadius: 2.5,
                      minHeight: 38,
                      px: 1.25, py: 0.75,
                      ...(active && {
                        background: isDark
                          ? `linear-gradient(135deg, ${alpha(tokens.indigo500, 0.22)}, ${alpha(tokens.violet600, 0.16)})`
                          : `linear-gradient(135deg, ${alpha(tokens.indigo600, 0.1)}, ${alpha(tokens.violet600, 0.07)})`,
                        boxShadow: isDark
                          ? `inset 0 0 0 1px ${alpha(tokens.indigo400, 0.25)}`
                          : `inset 0 0 0 1px ${alpha(tokens.indigo600, 0.18)}`,
                        '&:hover': {
                          background: isDark
                            ? `linear-gradient(135deg, ${alpha(tokens.indigo500, 0.28)}, ${alpha(tokens.violet600, 0.22)})`
                            : `linear-gradient(135deg, ${alpha(tokens.indigo600, 0.14)}, ${alpha(tokens.violet600, 0.1)})`,
                        },
                      }),
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 32,
                        '& svg': {
                          fontSize: 18,
                          color: active
                            ? (isDark ? tokens.indigo400 : tokens.indigo600)
                            : 'text.disabled',
                          transition: 'color .15s ease',
                        },
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        variant: 'body2',
                        fontWeight: active ? 700 : 500,
                        fontSize: '0.844rem',
                        color: active
                          ? (isDark ? tokens.indigo400 : tokens.indigo700)
                          : 'text.primary',
                        sx: { transition: 'color .15s ease' },
                      }}
                    />
                    {active && (
                      <Box
                        sx={{
                          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
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
            bgcolor: isDark ? 'rgba(255,255,255,.03)' : tokens.slate50,
            border: '1px solid',
            borderColor: isDark ? 'rgba(255,255,255,.06)' : tokens.slate100,
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
