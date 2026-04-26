import {
  AppBar, Toolbar, Typography, Breadcrumbs, Link, Box, Chip, alpha,
  Select, MenuItem, Tooltip, IconButton, Divider,
} from '@mui/material'
import {
  HomeOutlined, StorageOutlined,
  EditOutlined, KeyboardArrowDownOutlined, AutoAwesomeOutlined,
} from '@mui/icons-material'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { connectionsApi } from '@/api'
import { tokens } from '@/theme/theme'
import NotificationBell from '@/components/NotificationBell'

const SECTION_META: Record<string, { label: string; color: string }> = {
  dashboard:        { label: 'Dashboard',      color: tokens.indigo600 },
  connections:      { label: 'Connections',    color: tokens.sky600 },
  conversion:       { label: 'Conversion',     color: tokens.violet600 },
  development:      { label: 'Build',          color: tokens.emerald600 },
  'development-hub':{ label: 'Dev Hub',        color: tokens.emerald600 },
  dashboards:       { label: 'My Dashboards',  color: tokens.sky600 },
  'my-dashboards':  { label: 'My Dashboards',  color: tokens.sky600 },
  'ps-support':     { label: 'PS Support',     color: tokens.emerald600 },
  'api-collection': { label: 'API Collection', color: tokens.emerald600 },
  agents:           { label: 'AI Agents',      color: tokens.violet600 },
  testing:          { label: 'Testing',        color: tokens.amber600 },
  reports:          { label: 'Reports',        color: tokens.amber600 },
  powerbi:          { label: 'Power BI Dev',   color: tokens.violet600 },
  approvals:        { label: 'Approvals',      color: tokens.sky600 },
  admin:            { label: 'Administration', color: tokens.amber600 },
  users:            { label: 'User Management',color: tokens.indigo600 },
}

export default function AppHeader() {
  const location = useLocation()
  const navigate  = useNavigate()

  const activeProject       = useAppStore((s) => s.activeProject)
  const activeConnection    = useAppStore((s) => s.activeConnection)
  const setActiveConnection = useAppStore((s) => s.setActiveConnection)
  const themeMode           = useAppStore((s) => s.themeMode)
  const setAskAIOpen        = useAppStore((s) => s.setAskAIOpen)
  const isDark              = themeMode === 'dark'

  const { data: connections = [] } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn:  () => connectionsApi.list(activeProject?.id),
    enabled:  Boolean(activeProject?.id),
  })

  const segments       = location.pathname.split('/').filter(Boolean)
  const primarySection = segments[0] ?? ''
  const meta           = SECTION_META[primarySection] ?? { label: primarySection, color: tokens.indigo600 }

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

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        boxShadow: 'none',
        backgroundImage: 'none',
        borderBottom: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)',
        bgcolor: isDark ? tokens.darkPaper : '#ffffff',
        zIndex: 10,
      }}
    >
      <Toolbar sx={{ minHeight: '48px !important', px: 2.5, gap: 0 }}>

        {/* ── LEFT: Breadcrumb ──────────────────────────────── */}
        <Box sx={{ flex: '0 0 auto', minWidth: 0, maxWidth: 260, mr: 2 }}>
          <Breadcrumbs
            separator={
              <Box sx={{
                width: 3, height: 3, borderRadius: '50%',
                bgcolor: isDark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.18)',
              }} />
            }
            sx={{ '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap', alignItems: 'center' } }}
          >
            <Tooltip title="Home" arrow>
              <Link
                component="button"
                underline="none"
                onClick={() => navigate('/projects')}
                sx={{
                  display: 'flex', alignItems: 'center',
                  color: isDark ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.28)',
                  transition: 'color .15s ease',
                  '&:hover': { color: isDark ? tokens.indigo400 : tokens.indigo600 },
                }}
              >
                <HomeOutlined sx={{ fontSize: 13 }} />
              </Link>
            </Tooltip>

            {crumbs.slice(0, -1).map((crumb, i) => (
              <Link
                key={i}
                component="button"
                underline="none"
                onClick={() => crumb.path && navigate(crumb.path)}
                sx={{
                  fontSize: '0.75rem', fontWeight: 500,
                  color: isDark ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.4)',
                  whiteSpace: 'nowrap', transition: 'color .15s ease',
                  '&:hover': { color: isDark ? tokens.indigo400 : tokens.indigo600 },
                }}
              >
                {crumb.label}
              </Link>
            ))}

            <Typography sx={{
              fontSize: '0.75rem', fontWeight: 700,
              color: 'text.primary', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {crumbs[crumbs.length - 1]?.label}
            </Typography>
          </Breadcrumbs>
        </Box>

        {/* ── CENTER: Connection selector ───────────────────── */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {activeProject && (
            <Box
              sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                px: 2, py: 0.6,
                borderRadius: 2.5,
                border: '1px solid',
                borderColor: hasConn
                  ? alpha(tokens.sky600, isDark ? 0.35 : 0.25)
                  : alpha('#94a3b8', 0.25),
                bgcolor: hasConn
                  ? alpha(tokens.sky600, isDark ? 0.1 : 0.05)
                  : isDark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.025)',
                transition: 'all .15s ease',
                cursor: 'default',
                '&:hover': {
                  borderColor: hasConn
                    ? alpha(tokens.sky600, isDark ? 0.5 : 0.4)
                    : alpha('#94a3b8', 0.4),
                  bgcolor: hasConn
                    ? alpha(tokens.sky600, isDark ? 0.14 : 0.07)
                    : isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)',
                },
              }}
            >
              {/* Status dot */}
              <Box sx={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                bgcolor: hasConn ? '#22c55e' : '#94a3b8',
                boxShadow: hasConn ? '0 0 6px #22c55e' : 'none',
              }} />

              <StorageOutlined sx={{
                fontSize: 14, flexShrink: 0,
                color: hasConn ? tokens.sky600 : 'text.disabled',
              }} />

              <Typography sx={{
                fontSize: '0.7rem', fontWeight: 600, flexShrink: 0,
                color: isDark ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.38)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                Data Source
              </Typography>

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
                    <Typography sx={{ fontSize: '0.813rem', color: 'text.disabled', fontStyle: 'italic' }}>
                      Select connection…
                    </Typography>
                  )
                  const name = connections.find((c) => c.id === val)?.name ?? activeConnection?.name ?? 'Unknown'
                  return (
                    <Typography sx={{ fontSize: '0.813rem', fontWeight: 700, color: hasConn ? (isDark ? tokens.sky500 : tokens.sky600) : 'text.primary' }}>
                      {name}
                    </Typography>
                  )
                }}
                sx={{
                  '& .MuiSelect-select': { p: 0, pr: '20px !important', display: 'flex', alignItems: 'center' },
                  '& .MuiSelect-icon': { fontSize: 16, color: hasConn ? tokens.sky600 : 'text.disabled', right: 0, top: 'calc(50% - 8px)' },
                  minWidth: 120, maxWidth: 220,
                }}
              >
                <MenuItem value="">
                  <Typography variant="body2" color="text.secondary" fontStyle="italic">No connection</Typography>
                </MenuItem>
                {connections.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    <Box>
                      <Typography variant="body2" fontWeight={600}>{c.name}</Typography>
                      <Typography variant="caption" color="text.disabled">
                        {c.source_type}{c.dialect ? ` · ${c.dialect}` : ''}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>

              <Divider orientation="vertical" flexItem sx={{ height: 16, alignSelf: 'center', opacity: 0.3, mx: 0.5 }} />

              <Tooltip title="Manage connections" arrow>
                <IconButton
                  size="small"
                  onClick={() => navigate('/conversion')}
                  sx={{
                    p: 0.3, color: hasConn ? tokens.sky600 : 'text.disabled',
                    '&:hover': { color: tokens.sky500, bgcolor: alpha(tokens.sky600, 0.08) },
                  }}
                >
                  <EditOutlined sx={{ fontSize: 13 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>

        {/* ── RIGHT: Module · Actions · User ───────────────── */}
        <Box sx={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 0.75, ml: 2 }}>

          {/* Module badge */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.6,
            px: 1, py: 0.35, borderRadius: 1.5,
            bgcolor: alpha(meta.color, isDark ? 0.12 : 0.07),
            border: '1px solid',
            borderColor: alpha(meta.color, isDark ? 0.28 : 0.18),
          }}>
            <Box sx={{
              width: 5, height: 5, borderRadius: '50%',
              bgcolor: meta.color,
              boxShadow: `0 0 5px ${meta.color}`,
            }} />
            <Typography sx={{
              fontWeight: 700, color: meta.color,
              fontSize: '0.675rem', letterSpacing: '0.06em',
              textTransform: 'uppercase', whiteSpace: 'nowrap',
            }}>
              {meta.label}
            </Typography>
          </Box>

          <Divider orientation="vertical" flexItem sx={{ height: 18, alignSelf: 'center', opacity: 0.3 }} />

          {/* Ask AI */}
          <Tooltip title="Ask AI" arrow>
            <IconButton
              size="small"
              onClick={() => setAskAIOpen(true)}
              sx={{
                color: isDark ? '#a78bfa' : tokens.violet600,
                bgcolor: alpha(tokens.violet600, isDark ? 0.1 : 0.06),
                border: '1px solid',
                borderColor: alpha(tokens.violet600, isDark ? 0.22 : 0.18),
                borderRadius: 1.5, p: 0.5,
                transition: 'all .15s ease',
                '&:hover': {
                  bgcolor: alpha(tokens.violet600, isDark ? 0.2 : 0.12),
                  transform: 'scale(1.06)',
                },
              }}
            >
              <AutoAwesomeOutlined sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>

          {/* Notifications */}
          <NotificationBell />

          <Divider orientation="vertical" flexItem sx={{ height: 18, alignSelf: 'center', opacity: 0.3 }} />

          {/* Project chip */}
          {activeProject && (
            <Chip
              label={activeProject.name}
              size="small"
              onClick={() => navigate('/projects')}
              sx={{
                height: 24, fontSize: '0.725rem', fontWeight: 600,
                bgcolor: isDark ? alpha(tokens.indigo500, 0.12) : alpha(tokens.indigo600, 0.06),
                color: isDark ? tokens.indigo400 : tokens.indigo700,
                border: '1px solid',
                borderColor: isDark ? alpha(tokens.indigo400, 0.22) : alpha(tokens.indigo600, 0.18),
                cursor: 'pointer', transition: 'all .15s ease',
                '& .MuiChip-label': { px: 1.25 },
                '&:hover': {
                  bgcolor: isDark ? alpha(tokens.indigo500, 0.2) : alpha(tokens.indigo600, 0.1),
                },
              }}
            />
          )}
        </Box>

      </Toolbar>
    </AppBar>
  )
}
