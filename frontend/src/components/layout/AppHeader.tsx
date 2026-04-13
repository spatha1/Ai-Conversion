import {
  AppBar, Toolbar, Typography, Breadcrumbs, Link, Box, Chip, alpha,
  Select, MenuItem, Tooltip, IconButton,
} from '@mui/material'
import {
  NavigateNextOutlined, HomeOutlined, StorageOutlined,
  EditOutlined, KeyboardArrowDownOutlined,
} from '@mui/icons-material'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { connectionsApi } from '@/api'
import { tokens } from '@/theme/theme'

const SECTION_META: Record<string, { label: string; color: string }> = {
  dashboard:       { label: 'Dashboard',     color: tokens.indigo600 },
  connections:     { label: 'Connections',   color: tokens.sky600 },
  conversion:      { label: 'Conversion',    color: tokens.violet600 },
  development:     { label: 'Development',   color: tokens.emerald600 },
  dashboards:      { label: 'Dashboards',    color: tokens.sky600 },
  'my-dashboards': { label: 'My Dashboards', color: tokens.sky600 },
  'ps-support':    { label: 'PS Support',    color: tokens.emerald600 },
  'api-collection':{ label: 'API Collection',color: tokens.emerald600 },
  reports:         { label: 'Reports',       color: tokens.amber600 },
  powerbi:         { label: 'Power BI Dev',  color: tokens.violet600 },
  admin:           { label: 'Administration',color: tokens.amber600 },
}

export default function AppHeader() {
  const location = useLocation()
  const navigate  = useNavigate()

  const activeProject    = useAppStore((s) => s.activeProject)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const themeMode        = useAppStore((s) => s.themeMode)
  const isDark           = themeMode === 'dark'

  // Load connections for the active project
  const { data: connections = [] } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn:  () => connectionsApi.list(activeProject?.id),
    enabled:  Boolean(activeProject?.id),
  })

  const segments       = location.pathname.split('/').filter(Boolean)
  const primarySection = segments[0] ?? ''
  const meta           = SECTION_META[primarySection] ?? { label: primarySection, color: tokens.indigo600 }

  // Breadcrumbs
  const crumbs: { label: string; path?: string }[] = []
  if (activeProject) crumbs.push({ label: activeProject.name, path: '/projects' })
  if (segments.length > 1) {
    crumbs.push({ label: SECTION_META[primarySection]?.label ?? primarySection, path: `/${primarySection}` })
    const sub = segments[1]
    crumbs.push({ label: sub.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })
  } else {
    crumbs.push({ label: meta.label })
  }

  const hasConn = Boolean(activeConnection)

  const handleEditConnection = () => {
    navigate('/conversion')
  }

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: isDark ? `${tokens.darkPaper}cc` : 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(12px)',
        zIndex: 10,
      }}
    >
      <Toolbar sx={{ minHeight: '48px !important', px: 3, gap: 2 }}>
        {/* Breadcrumbs */}
        <Breadcrumbs
          separator={<NavigateNextOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />}
          sx={{ flex: 1, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap', alignItems: 'center' } }}
        >
          <Link
            component="button"
            underline="none"
            onClick={() => navigate('/projects')}
            sx={{
              display: 'flex', alignItems: 'center',
              color: 'text.disabled',
              transition: 'color .15s ease',
              '&:hover': { color: isDark ? tokens.indigo400 : tokens.indigo600 },
            }}
          >
            <HomeOutlined sx={{ fontSize: 15 }} />
          </Link>

          {crumbs.slice(0, -1).map((crumb, i) => (
            <Link
              key={i}
              component="button"
              underline="none"
              onClick={() => crumb.path && navigate(crumb.path)}
              sx={{
                fontSize: '0.813rem', fontWeight: 500, color: 'text.secondary',
                whiteSpace: 'nowrap', transition: 'color .15s ease',
                '&:hover': { color: isDark ? tokens.indigo400 : tokens.indigo600 },
              }}
            >
              {crumb.label}
            </Link>
          ))}

          <Typography sx={{ fontSize: '0.813rem', fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
            {crumbs[crumbs.length - 1]?.label}
          </Typography>
        </Breadcrumbs>

        {/* Right side */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>

          {/* ── Global Connection Selector ── */}
          {activeProject && (
            <Box
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                px: 1, py: 0.35,
                borderRadius: 2,
                border: '1px solid',
                borderColor: hasConn
                  ? alpha(tokens.sky600, isDark ? 0.35 : 0.25)
                  : alpha('#94a3b8', 0.25),
                bgcolor: hasConn
                  ? alpha(tokens.sky600, isDark ? 0.1 : 0.05)
                  : alpha('#94a3b8', isDark ? 0.08 : 0.04),
                transition: 'all .15s ease',
                '&:hover': {
                  borderColor: hasConn
                    ? alpha(tokens.sky600, isDark ? 0.5 : 0.4)
                    : alpha('#94a3b8', 0.4),
                },
              }}
            >
              <StorageOutlined
                sx={{
                  fontSize: 13,
                  color: hasConn ? tokens.sky600 : 'text.disabled',
                  flexShrink: 0,
                }}
              />

              <Select
                value={activeConnection?.id ?? ''}
                onChange={(e) => {
                  const conn = connections.find((c) => c.id === e.target.value) ?? null
                  setActiveConnection(conn)
                }}
                displayEmpty
                variant="standard"
                disableUnderline
                IconComponent={KeyboardArrowDownOutlined}
                renderValue={(val) => {
                  if (!val) return (
                    <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', fontStyle: 'italic' }}>
                      No connection
                    </Typography>
                  )
                  const name = connections.find((c) => c.id === val)?.name ?? activeConnection?.name ?? 'Unknown'
                  return (
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: hasConn ? tokens.sky600 : 'text.primary' }}>
                      {name}
                    </Typography>
                  )
                }}
                sx={{
                  '& .MuiSelect-select': { p: 0, pr: '20px !important', display: 'flex', alignItems: 'center' },
                  '& .MuiSelect-icon': { fontSize: 16, color: hasConn ? tokens.sky600 : 'text.disabled', right: 0 },
                  minWidth: 110,
                  maxWidth: 180,
                }}
              >
                <MenuItem value="">
                  <Typography variant="body2" color="text.secondary" fontStyle="italic">No connection</Typography>
                </MenuItem>
                {connections.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    <Box>
                      <Typography variant="body2" fontWeight={500}>{c.name}</Typography>
                      <Typography variant="caption" color="text.disabled">
                        {c.source_type}{c.dialect ? ` · ${c.dialect}` : ''}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>

              {/* Navigate to Conversion */}
              <Tooltip title="Go to Conversion">
                <IconButton
                  size="small"
                  onClick={handleEditConnection}
                  sx={{ p: 0.25, color: hasConn ? tokens.sky600 : 'text.disabled', '&:hover': { color: tokens.sky500 } }}
                >
                  <EditOutlined sx={{ fontSize: 13 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {/* Active page badge */}
          <Box
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              px: 1.25, py: 0.4, borderRadius: 2,
              bgcolor: alpha(meta.color, isDark ? 0.15 : 0.08),
              border: '1px solid',
              borderColor: alpha(meta.color, isDark ? 0.3 : 0.2),
            }}
          >
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
            <Typography
              variant="caption"
              sx={{ fontWeight: 700, color: meta.color, fontSize: '0.688rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}
            >
              {meta.label}
            </Typography>
          </Box>

          {/* Project chip */}
          {activeProject && (
            <Chip
              label={activeProject.name}
              size="small"
              onClick={() => navigate('/projects')}
              sx={{
                height: 24, fontSize: '0.75rem', fontWeight: 600,
                bgcolor: isDark ? alpha(tokens.indigo500, 0.14) : alpha(tokens.indigo600, 0.07),
                color: isDark ? tokens.indigo400 : tokens.indigo700,
                border: '1px solid',
                borderColor: isDark ? alpha(tokens.indigo400, 0.25) : alpha(tokens.indigo600, 0.2),
                cursor: 'pointer', transition: 'all .15s ease',
                '&:hover': {
                  bgcolor: isDark ? alpha(tokens.indigo500, 0.22) : alpha(tokens.indigo600, 0.12),
                  borderColor: isDark ? alpha(tokens.indigo400, 0.4) : alpha(tokens.indigo600, 0.35),
                },
              }}
            />
          )}
        </Box>
      </Toolbar>
    </AppBar>
  )
}
