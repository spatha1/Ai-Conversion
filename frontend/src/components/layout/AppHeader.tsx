import {
  AppBar, Toolbar, Typography, Breadcrumbs, Link, Box, Chip, alpha,
} from '@mui/material'
import {
  NavigateNextOutlined, HomeOutlined,
} from '@mui/icons-material'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'

const SECTION_META: Record<string, { label: string; color: string }> = {
  dashboard:    { label: 'Dashboard',          color: tokens.indigo600 },
  conversion:   { label: 'Conversion',          color: tokens.violet600 },
  'my-dashboards': { label: 'My Dashboards',   color: tokens.sky600 },
  'ps-support': { label: 'PS Support',          color: tokens.emerald600 },
  admin:        { label: 'Administration',      color: tokens.amber600 },
}

export default function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeProject = useAppStore((s) => s.activeProject)
  const themeMode = useAppStore((s) => s.themeMode)
  const isDark = themeMode === 'dark'

  const segments = location.pathname.split('/').filter(Boolean)
  const primarySection = segments[0] ?? ''
  const meta = SECTION_META[primarySection] ?? { label: primarySection, color: tokens.indigo600 }

  // Build breadcrumb segments
  const crumbs: { label: string; path?: string }[] = []
  if (activeProject) crumbs.push({ label: activeProject.name, path: '/projects' })

  // Build label for nested PS Support paths
  if (segments.length > 1) {
    crumbs.push({ label: SECTION_META[primarySection]?.label ?? primarySection, path: `/${primarySection}` })
    const sub = segments[1]
    crumbs.push({ label: sub.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) })
  } else {
    crumbs.push({ label: meta.label })
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
          separator={
            <NavigateNextOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
          }
          sx={{ flex: 1, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap', alignItems: 'center' } }}
        >
          {/* Home */}
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

          {/* Intermediate crumbs */}
          {crumbs.slice(0, -1).map((crumb, i) => (
            <Link
              key={i}
              component="button"
              underline="none"
              onClick={() => crumb.path && navigate(crumb.path)}
              sx={{
                fontSize: '0.813rem',
                fontWeight: 500,
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                transition: 'color .15s ease',
                '&:hover': { color: isDark ? tokens.indigo400 : tokens.indigo600 },
              }}
            >
              {crumb.label}
            </Link>
          ))}

          {/* Current page */}
          <Typography
            sx={{
              fontSize: '0.813rem',
              fontWeight: 700,
              color: 'text.primary',
              whiteSpace: 'nowrap',
            }}
          >
            {crumbs[crumbs.length - 1]?.label}
          </Typography>
        </Breadcrumbs>

        {/* Right side */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {/* Active page badge */}
          <Box
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              px: 1.25, py: 0.4,
              borderRadius: 2,
              bgcolor: alpha(meta.color, isDark ? 0.15 : 0.08),
              border: '1px solid',
              borderColor: alpha(meta.color, isDark ? 0.3 : 0.2),
            }}
          >
            <Box
              sx={{
                width: 6, height: 6, borderRadius: '50%',
                bgcolor: meta.color,
                boxShadow: `0 0 6px ${meta.color}`,
              }}
            />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                color: meta.color,
                fontSize: '0.688rem',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
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
                height: 24,
                fontSize: '0.75rem',
                fontWeight: 600,
                bgcolor: isDark ? alpha(tokens.indigo500, 0.14) : alpha(tokens.indigo600, 0.07),
                color: isDark ? tokens.indigo400 : tokens.indigo700,
                border: '1px solid',
                borderColor: isDark ? alpha(tokens.indigo400, 0.25) : alpha(tokens.indigo600, 0.2),
                cursor: 'pointer',
                transition: 'all .15s ease',
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
