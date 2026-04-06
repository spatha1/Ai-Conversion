import { createTheme, alpha } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface Palette {
    neutral: Palette['primary']
  }
  interface PaletteOptions {
    neutral?: PaletteOptions['primary']
  }
}

// Shared typography & shape
const baseTypography = {
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  h1: { fontWeight: 800, fontSize: '2.25rem', lineHeight: 1.2 },
  h2: { fontWeight: 700, fontSize: '1.875rem', lineHeight: 1.3 },
  h3: { fontWeight: 700, fontSize: '1.5rem', lineHeight: 1.4 },
  h4: { fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.4 },
  h5: { fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.5 },
  h6: { fontWeight: 600, fontSize: '1rem', lineHeight: 1.5 },
  subtitle1: { fontWeight: 600, fontSize: '0.938rem' },
  subtitle2: { fontWeight: 600, fontSize: '0.875rem' },
  body1: { fontSize: '0.938rem', lineHeight: 1.6 },
  body2: { fontSize: '0.875rem', lineHeight: 1.6 },
  caption: { fontSize: '0.75rem', letterSpacing: '0.02em' },
  button: { fontWeight: 600, letterSpacing: '0.01em', textTransform: 'none' as const },
}

const baseShape = { borderRadius: 10 }

// Component overrides factory
const buildComponents = (mode: 'light' | 'dark') => ({
  MuiCssBaseline: {
    styleOverrides: {
      '*': { boxSizing: 'border-box' },
      'html, body': { height: '100%' },
      '::-webkit-scrollbar': { width: 5, height: 5 },
      '::-webkit-scrollbar-track': { background: 'transparent' },
      '::-webkit-scrollbar-thumb': {
        background: mode === 'dark' ? '#334155' : '#cbd5e1',
        borderRadius: 4,
      },
      '::-webkit-scrollbar-thumb:hover': {
        background: mode === 'dark' ? '#475569' : '#94a3b8',
      },
    },
  },
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 9,
        fontWeight: 600,
        fontSize: '0.875rem',
        padding: '8px 18px',
        boxShadow: 'none',
        transition: 'all .18s ease',
        '&:hover': { boxShadow: 'none', transform: 'translateY(-1px)' },
        '&:active': { transform: 'translateY(0)' },
      },
      containedPrimary: {
        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        '&:hover': {
          background: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
          boxShadow: '0 8px 24px rgba(59,130,246,.35)',
        },
      },
      containedSecondary: {
        background: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
        '&:hover': {
          background: 'linear-gradient(135deg, #c4b5fd 0%, #a78bfa 100%)',
          boxShadow: '0 8px 24px rgba(124,58,237,.35)',
        },
      },
      containedSuccess: {
        background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
        '&:hover': {
          boxShadow: '0 8px 24px rgba(16,185,129,.35)',
        },
      },
      outlined: {
        borderWidth: '1.5px',
        '&:hover': { borderWidth: '1.5px' },
      },
      sizeLarge: { padding: '11px 28px', fontSize: '0.938rem', borderRadius: 10 },
      sizeSmall: { padding: '5px 12px', fontSize: '0.813rem', borderRadius: 7 },
    },
  },
  MuiTextField: {
    defaultProps: { size: 'small' as const, variant: 'outlined' as const },
    styleOverrides: {
      root: {
        '& .MuiOutlinedInput-root': {
          borderRadius: 9,
          transition: 'box-shadow .18s ease',
          '&.Mui-focused': {
            boxShadow: mode === 'dark'
              ? '0 0 0 3px rgba(59,130,246,.25)'
              : '0 0 0 3px rgba(37,99,235,.12)',
          },
        },
      },
    },
  },
  MuiSelect: {
    defaultProps: { size: 'small' as const },
    styleOverrides: {
      outlined: { borderRadius: 9 },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 16,
        boxShadow: mode === 'dark'
          ? '0 1px 3px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.2)'
          : '0 1px 3px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.06)',
        border: '1px solid',
        borderColor: mode === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
        transition: 'box-shadow .2s, transform .2s',
      },
    },
  },
  MuiPaper: {
    styleOverrides: {
      root: { backgroundImage: 'none' },
      rounded: { borderRadius: 14 },
      elevation1: {
        boxShadow: mode === 'dark'
          ? '0 1px 3px rgba(0,0,0,.3)'
          : '0 1px 3px rgba(0,0,0,.05), 0 2px 8px rgba(0,0,0,.06)',
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: { fontWeight: 600, borderRadius: 8, fontSize: '0.813rem' },
      sizeSmall: { borderRadius: 6, fontSize: '0.75rem' },
    },
  },
  MuiTabs: {
    styleOverrides: {
      root: { minHeight: 44 },
      indicator: {
        height: 3,
        borderRadius: '3px 3px 0 0',
      },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        fontWeight: 500,
        fontSize: '0.875rem',
        minHeight: 44,
        textTransform: 'none' as const,
        letterSpacing: 0,
        '&.Mui-selected': { fontWeight: 700 },
      },
    },
  },
  MuiTableHead: {
    styleOverrides: {
      root: {
        '& .MuiTableCell-head': {
          fontWeight: 700,
          fontSize: '0.75rem',
          backgroundColor: mode === 'dark' ? 'rgba(255,255,255,.04)' : '#f8fafc',
          color: mode === 'dark' ? '#94a3b8' : '#64748b',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.06em',
        },
      },
    },
  },
  MuiTableRow: {
    styleOverrides: {
      root: {
        '&:hover': {
          backgroundColor: mode === 'dark' ? 'rgba(255,255,255,.03)' : 'rgba(37,99,235,.03)',
        },
      },
    },
  },
  MuiTableCell: {
    styleOverrides: {
      root: {
        borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,.06)' : '#f1f5f9'}`,
        padding: '10px 14px',
        fontSize: '0.875rem',
      },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: {
        borderRadius: 9,
        margin: '1px 4px',
        padding: '8px 10px',
        transition: 'all .15s ease',
        '&.Mui-selected': {
          backgroundColor: mode === 'dark'
            ? 'rgba(59,130,246,.15)'
            : 'rgba(37,99,235,.08)',
          color: mode === 'dark' ? '#60a5fa' : '#2563eb',
          '& .MuiListItemIcon-root': { color: mode === 'dark' ? '#60a5fa' : '#2563eb' },
          '&:hover': {
            backgroundColor: mode === 'dark'
              ? 'rgba(59,130,246,.22)'
              : 'rgba(37,99,235,.12)',
          },
        },
        '&:hover': {
          backgroundColor: mode === 'dark' ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.03)',
        },
      },
    },
  },
  MuiTooltip: {
    styleOverrides: {
      tooltip: {
        fontSize: '0.75rem',
        borderRadius: 7,
        fontWeight: 500,
        padding: '5px 10px',
      },
    },
  },
  MuiDivider: {
    styleOverrides: {
      root: {
        borderColor: mode === 'dark' ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)',
      },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: { borderRadius: 4 },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: { borderRadius: 10, fontSize: '0.875rem' },
      standardSuccess: {
        background: mode === 'dark' ? 'rgba(16,185,129,.12)' : 'rgba(16,185,129,.08)',
        borderLeft: '3px solid #10b981',
      },
      standardError: {
        background: mode === 'dark' ? 'rgba(239,68,68,.12)' : 'rgba(239,68,68,.08)',
        borderLeft: '3px solid #ef4444',
      },
      standardWarning: {
        background: mode === 'dark' ? 'rgba(245,158,11,.12)' : 'rgba(245,158,11,.08)',
        borderLeft: '3px solid #f59e0b',
      },
      standardInfo: {
        background: mode === 'dark' ? 'rgba(59,130,246,.12)' : 'rgba(59,130,246,.08)',
        borderLeft: '3px solid #3b82f6',
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: { borderRadius: 18, boxShadow: '0 32px 80px rgba(0,0,0,.25)' },
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: {
        borderRight: 'none',
        boxShadow: mode === 'dark'
          ? '1px 0 0 rgba(255,255,255,.06)'
          : '1px 0 0 rgba(0,0,0,.06)',
      },
    },
  },
  MuiAccordion: {
    styleOverrides: {
      root: {
        borderRadius: '10px !important',
        border: '1px solid',
        borderColor: mode === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)',
        '&:before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 },
      },
    },
  },
})

// ── Light Theme ───────────────────────────────────────────────────────────────
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb',
      dark: '#1d4ed8',
      light: '#dbeafe',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#7c3aed',
      dark: '#5b21b6',
      light: '#ede9fe',
      contrastText: '#ffffff',
    },
    success: {
      main: '#059669',
      dark: '#047857',
      light: '#d1fae5',
      contrastText: '#ffffff',
    },
    warning: {
      main: '#d97706',
      dark: '#b45309',
      light: '#fef3c7',
      contrastText: '#ffffff',
    },
    error: {
      main: '#dc2626',
      dark: '#b91c1c',
      light: '#fee2e2',
      contrastText: '#ffffff',
    },
    info: {
      main: '#0284c7',
      dark: '#0369a1',
      light: '#e0f2fe',
      contrastText: '#ffffff',
    },
    neutral: {
      main: '#64748b',
      dark: '#475569',
      light: '#f1f5f9',
    },
    background: {
      default: '#f0f4f8',
      paper: '#ffffff',
    },
    text: {
      primary: '#0f172a',
      secondary: '#475569',
      disabled: '#94a3b8',
    },
    divider: 'rgba(0,0,0,.06)',
    action: {
      hover: 'rgba(37,99,235,.04)',
      selected: 'rgba(37,99,235,.08)',
    },
  },
  typography: baseTypography,
  shape: baseShape,
  shadows: [
    'none',
    '0 1px 2px rgba(0,0,0,.04)',
    '0 2px 4px rgba(0,0,0,.06)',
    '0 4px 12px rgba(0,0,0,.08)',
    '0 8px 24px rgba(0,0,0,.10)',
    '0 16px 40px rgba(0,0,0,.12)',
    '0 24px 60px rgba(0,0,0,.14)',
    ...Array(18).fill('none'),
  ] as any,
  components: buildComponents('light'),
})

// ── Dark Theme ────────────────────────────────────────────────────────────────
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6',
      dark: '#2563eb',
      light: '#bfdbfe',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#a78bfa',
      dark: '#7c3aed',
      light: '#ede9fe',
      contrastText: '#ffffff',
    },
    success: {
      main: '#34d399',
      dark: '#10b981',
      light: 'rgba(16,185,129,.15)',
      contrastText: '#fff',
    },
    warning: {
      main: '#fbbf24',
      dark: '#f59e0b',
      light: 'rgba(245,158,11,.15)',
      contrastText: '#fff',
    },
    error: {
      main: '#f87171',
      dark: '#ef4444',
      light: 'rgba(239,68,68,.15)',
      contrastText: '#fff',
    },
    info: {
      main: '#38bdf8',
      dark: '#0ea5e9',
      light: 'rgba(14,165,233,.15)',
      contrastText: '#fff',
    },
    neutral: {
      main: '#94a3b8',
      dark: '#64748b',
      light: 'rgba(148,163,184,.1)',
    },
    background: {
      default: '#0c1222',
      paper: '#131c2e',
    },
    text: {
      primary: '#f1f5f9',
      secondary: '#94a3b8',
      disabled: '#475569',
    },
    divider: 'rgba(255,255,255,.07)',
    action: {
      hover: 'rgba(59,130,246,.08)',
      selected: 'rgba(59,130,246,.14)',
    },
  },
  typography: baseTypography,
  shape: baseShape,
  shadows: [
    'none',
    '0 1px 2px rgba(0,0,0,.3)',
    '0 2px 6px rgba(0,0,0,.4)',
    '0 4px 14px rgba(0,0,0,.5)',
    '0 8px 28px rgba(0,0,0,.5)',
    '0 16px 48px rgba(0,0,0,.55)',
    '0 24px 64px rgba(0,0,0,.6)',
    ...Array(18).fill('none'),
  ] as any,
  components: buildComponents('dark'),
})
