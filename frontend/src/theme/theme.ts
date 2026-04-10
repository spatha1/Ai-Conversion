import { createTheme, alpha } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface Palette {
    neutral: Palette['primary']
  }
  interface PaletteOptions {
    neutral?: PaletteOptions['primary']
  }
}

// ── Design Tokens ─────────────────────────────────────────────────────────────
// Primary  : #01398c  (navy blue)
// Secondary: #555555  (slate gray)
// Bg light : #EEF2F8  (cool blue-gray wash)
// Bg dark  : #060E1A  (deep navy-black)
// ─────────────────────────────────────────────────────────────────────────────
export const tokens = {
  // ── Navy (primary) ──────────────────────────────────────────
  navy50:   '#E8EEF7',
  navy100:  '#D0DDF0',
  navy200:  '#A1BBE0',
  navy300:  '#6D95CA',
  navy400:  '#3D71B5',
  navy500:  '#1A5099',   // mid-navy — used for hover gradients
  navy600:  '#01398c',   // ← PRIMARY
  navy700:  '#012D72',
  navy800:  '#012059',
  navy900:  '#010E2E',

  // ── Gray (secondary) ────────────────────────────────────────
  gray50:   '#F9F9F9',
  gray100:  '#F0F0F0',
  gray200:  '#DEDEDE',
  gray300:  '#C2C2C2',
  gray400:  '#999999',
  gray500:  '#777777',
  gray600:  '#555555',   // ← SECONDARY
  gray700:  '#3D3D3D',
  gray800:  '#282828',
  gray900:  '#141414',

  // ── Slate neutrals ──────────────────────────────────────────
  slate50:  '#F8FAFC',
  slate100: '#F1F5F9',
  slate200: '#E2E8F0',
  slate300: '#CBD5E1',
  slate400: '#94A3B8',
  slate500: '#64748B',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1E293B',
  slate900: '#0F172A',

  // ── Status ──────────────────────────────────────────────────
  emerald500: '#10B981',
  emerald600: '#059669',
  emerald700: '#047857',
  amber500:   '#F59E0B',
  amber600:   '#D97706',
  amber700:   '#B45309',
  red400:     '#F87171',
  red500:     '#EF4444',
  red600:     '#DC2626',
  sky500:     '#0EA5E9',
  sky600:     '#0284C7',
  sky700:     '#0369A1',

  // ── Dark surfaces ────────────────────────────────────────────
  darkBg:     '#060E1A',
  darkPaper:  '#0C1829',
  darkCard:   '#112038',
  darkBorder: 'rgba(1,57,140,0.35)',

  // ── Aliases (used by components via tokens.indigo* etc) ─────
  // Map old indigo → navy so sidebar/header/login stay working
  indigo50:   '#E8EEF7',
  indigo100:  '#D0DDF0',
  indigo200:  '#A1BBE0',
  indigo300:  '#6D95CA',
  indigo400:  '#3D71B5',
  indigo500:  '#1A5099',
  indigo600:  '#01398c',
  indigo700:  '#012D72',
  indigo800:  '#012059',
  indigo900:  '#010E2E',

  // Map old violet → gray so secondary gradient stays working
  violet50:   '#F9F9F9',
  violet200:  '#DEDEDE',
  violet400:  '#777777',
  violet600:  '#555555',
  violet700:  '#3D3D3D',
  violet800:  '#282828',
}

// ── Typography ────────────────────────────────────────────────────────────────
const baseTypography = {
  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  h1: { fontWeight: 800, fontSize: '2.25rem',  lineHeight: 1.2,  letterSpacing: '-0.03em' },
  h2: { fontWeight: 700, fontSize: '1.875rem', lineHeight: 1.25, letterSpacing: '-0.025em' },
  h3: { fontWeight: 700, fontSize: '1.5rem',   lineHeight: 1.3,  letterSpacing: '-0.02em' },
  h4: { fontWeight: 700, fontSize: '1.25rem',  lineHeight: 1.35, letterSpacing: '-0.015em' },
  h5: { fontWeight: 600, fontSize: '1.125rem', lineHeight: 1.45, letterSpacing: '-0.01em' },
  h6: { fontWeight: 600, fontSize: '1rem',     lineHeight: 1.5,  letterSpacing: '-0.008em' },
  subtitle1: { fontWeight: 600, fontSize: '0.938rem', lineHeight: 1.5 },
  subtitle2: { fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.5 },
  body1:     { fontSize: '0.938rem', lineHeight: 1.65 },
  body2:     { fontSize: '0.875rem', lineHeight: 1.6 },
  caption:   { fontSize: '0.75rem',  lineHeight: 1.5, letterSpacing: '0.01em' },
  button:    { fontWeight: 600, fontSize: '0.875rem', letterSpacing: '0.01em', textTransform: 'none' as const },
  overline:  { fontWeight: 700, fontSize: '0.688rem', letterSpacing: '0.08em', textTransform: 'uppercase' as const },
}

const baseShape = { borderRadius: 12 }

// ── Component overrides ───────────────────────────────────────────────────────
const buildComponents = (mode: 'light' | 'dark') => {
  const isDark = mode === 'dark'
  const P  = tokens.navy600   // primary  #01398c
  const PL = tokens.navy500   // lighter  #1A5099
  const PD = tokens.navy700   // darker   #012D72
  const S  = tokens.gray600   // secondary #555555
  const SL = tokens.gray400   // lighter  #999999

  return {
    MuiCssBaseline: {
      styleOverrides: {
        '*': { boxSizing: 'border-box', margin: 0 },
        'html, body, #root': { height: '100%' },
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          backgroundColor: isDark ? tokens.darkBg : '#EEF2F8',
        },
      },
    },

    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 600,
          fontSize: '0.875rem',
          padding: '7px 18px',
          boxShadow: 'none',
          transition: 'all .18s cubic-bezier(.4,0,.2,1)',
          '&:active': { transform: 'translateY(0px)' },
          // ── Disabled state — clearly visible but obviously inactive ──
          '&.Mui-disabled': {
            opacity: 1,                          // don't fade to near-invisible
            cursor: 'not-allowed',
            pointerEvents: 'auto',               // keep cursor visible
            background: isDark
              ? 'rgba(255,255,255,.06) !important'
              : '#E2E8F0 !important',
            color: isDark
              ? 'rgba(255,255,255,.28) !important'
              : '#94A3B8 !important',
            borderColor: isDark
              ? 'rgba(255,255,255,.08) !important'
              : '#CBD5E1 !important',
            boxShadow: 'none !important',
            transform: 'none !important',
          },
        },
        containedPrimary: {
          background: `linear-gradient(135deg, ${PL} 0%, ${PD} 100%)`,
          color: '#fff',
          boxShadow: `0 2px 8px ${alpha(P, 0.4)}`,
          '&:hover': {
            background: `linear-gradient(135deg, ${tokens.navy400} 0%, ${P} 100%)`,
            boxShadow: `0 6px 20px ${alpha(P, 0.55)}`,
            transform: 'translateY(-1px)',
          },
        },
        containedSecondary: {
          background: `linear-gradient(135deg, ${SL} 0%, ${tokens.gray700} 100%)`,
          color: '#fff',
          boxShadow: `0 2px 8px ${alpha(S, 0.35)}`,
          '&:hover': {
            background: `linear-gradient(135deg, ${tokens.gray500} 0%, ${S} 100%)`,
            boxShadow: `0 6px 20px ${alpha(S, 0.45)}`,
            transform: 'translateY(-1px)',
          },
        },
        containedSuccess: {
          background: `linear-gradient(135deg, ${tokens.emerald500} 0%, ${tokens.emerald700} 100%)`,
          color: '#fff',
          '&:hover': {
            boxShadow: `0 6px 20px ${alpha(tokens.emerald600, 0.5)}`,
            transform: 'translateY(-1px)',
          },
        },
        containedError: {
          background: `linear-gradient(135deg, ${tokens.red400} 0%, ${tokens.red600} 100%)`,
          color: '#fff',
          '&:hover': {
            boxShadow: `0 6px 20px ${alpha(tokens.red600, 0.5)}`,
            transform: 'translateY(-1px)',
          },
        },
        outlined: { borderWidth: '1.5px', '&:hover': { borderWidth: '1.5px' } },
        outlinedPrimary: {
          borderColor: alpha(P, isDark ? 0.55 : 0.45),
          color: isDark ? tokens.navy400 : P,
          '&:hover': {
            background: alpha(P, 0.07),
            borderColor: isDark ? tokens.navy400 : P,
          },
        },
        text: {
          '&:hover': { background: isDark ? 'rgba(255,255,255,.06)' : alpha(P, 0.05) },
        },
        sizeLarge: { padding: '10px 28px', fontSize: '0.938rem', borderRadius: 11 },
        sizeSmall: { padding: '4px 12px',  fontSize: '0.813rem', borderRadius: 8 },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          transition: 'all .15s ease',
          '&:hover': { transform: 'scale(1.06)' },
        },
      },
    },

    MuiTextField: {
      defaultProps: { size: 'small' as const, variant: 'outlined' as const },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
            transition: 'box-shadow .18s ease',
            backgroundColor: isDark ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.85)',
            '& fieldset': {
              borderColor: isDark ? 'rgba(255,255,255,.1)' : alpha(P, 0.22),
              transition: 'border-color .18s ease',
            },
            '&:hover fieldset': {
              borderColor: isDark ? 'rgba(255,255,255,.25)' : alpha(P, 0.48),
            },
            '&.Mui-focused': {
              boxShadow: `0 0 0 3px ${alpha(P, isDark ? 0.25 : 0.12)}`,
            },
            '&.Mui-focused fieldset': {
              borderColor: isDark ? tokens.navy400 : P,
              borderWidth: '2px',
            },
          },
          '& .MuiInputLabel-root.Mui-focused': {
            color: isDark ? tokens.navy400 : P,
          },
        },
      },
    },

    MuiSelect: {
      defaultProps: { size: 'small' as const },
      styleOverrides: { outlined: { borderRadius: 10 } },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: isDark
            ? `0 1px 0 ${tokens.darkBorder}, 0 4px 20px rgba(0,0,0,.35)`
            : `0 1px 3px ${alpha(P, 0.05)}, 0 4px 16px ${alpha(P, 0.08)}`,
          border: '1px solid',
          borderColor: isDark ? tokens.darkBorder : alpha(P, 0.12),
          transition: 'box-shadow .22s ease, transform .22s ease, border-color .22s ease',
          backgroundImage: 'none',
          '&:hover': {
            boxShadow: isDark
              ? `0 1px 0 ${tokens.darkBorder}, 0 8px 32px ${alpha(P, 0.22)}`
              : `0 8px 32px ${alpha(P, 0.14)}`,
            borderColor: isDark ? alpha(P, 0.3) : alpha(P, 0.22),
          },
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: 14 },
        elevation1: {
          boxShadow: isDark
            ? '0 1px 3px rgba(0,0,0,.4)'
            : `0 1px 3px ${alpha(P, 0.04)}, 0 2px 8px rgba(0,0,0,.05)`,
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 8, fontSize: '0.813rem', height: 28, transition: 'all .15s ease' },
        sizeSmall: { borderRadius: 6, fontSize: '0.75rem', height: 22 },
        colorPrimary: {
          backgroundColor: isDark ? alpha(P, 0.22) : alpha(P, 0.1),
          color: isDark ? tokens.navy300 : tokens.navy700,
          '&.MuiChip-outlined': { borderColor: isDark ? tokens.navy400 : P },
        },
        colorSuccess: {
          backgroundColor: isDark ? alpha(tokens.emerald600, 0.2) : '#D1FAE5',
          color: isDark ? '#34D399' : tokens.emerald700,
        },
        colorError: {
          backgroundColor: isDark ? alpha(tokens.red600, 0.2) : '#FEE2E2',
          color: isDark ? tokens.red400 : tokens.red600,
        },
        colorWarning: {
          backgroundColor: isDark ? alpha(tokens.amber600, 0.2) : '#FEF3C7',
          color: isDark ? tokens.amber500 : tokens.amber700,
        },
        colorInfo: {
          backgroundColor: isDark ? alpha(tokens.sky600, 0.2) : '#E0F2FE',
          color: isDark ? '#38BDF8' : tokens.sky700,
        },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 46, '& .MuiTabs-flexContainer': { gap: 2 } },
        indicator: {
          height: 3,
          borderRadius: '3px 3px 0 0',
          background: `linear-gradient(90deg, ${P}, ${S})`,
          transition: 'all .25s cubic-bezier(.4,0,.2,1)',
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          fontSize: '0.875rem',
          minHeight: 46,
          textTransform: 'none' as const,
          letterSpacing: 0,
          transition: 'all .18s ease',
          color: isDark ? tokens.slate400 : tokens.slate500,
          '&.Mui-selected': { fontWeight: 700, color: isDark ? tokens.navy400 : P },
          '&:hover': {
            color: isDark ? tokens.slate200 : tokens.slate800,
            backgroundColor: isDark ? 'rgba(255,255,255,.04)' : alpha(P, 0.04),
            borderRadius: '8px 8px 0 0',
          },
        },
      },
    },

    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            fontWeight: 700,
            fontSize: '0.688rem',
            background: isDark
              ? alpha(P, 0.1)
              : `linear-gradient(to right, ${alpha(P, 0.06)}, ${alpha(S, 0.03)})`,
            color: isDark ? tokens.navy300 : tokens.navy700,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.07em',
            borderBottom: `2px solid ${isDark ? alpha(P, 0.2) : alpha(P, 0.18)}`,
          },
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color .12s ease',
          '&:nth-of-type(even)': {
            backgroundColor: isDark ? alpha(P, 0.025) : alpha(P, 0.02),
          },
          '&:hover': {
            backgroundColor: isDark
              ? `${alpha(P, 0.07)} !important`
              : `${alpha(P, 0.045)} !important`,
          },
        },
      },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${isDark ? alpha(P, 0.1) : alpha(P, 0.07)}`,
          padding: '10px 16px',
          fontSize: '0.875rem',
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          margin: '1px 6px',
          padding: '8px 10px',
          transition: 'all .15s ease',
          '&.Mui-selected': {
            background: isDark
              ? `linear-gradient(135deg, ${alpha(P, 0.25)}, ${alpha(S, 0.15)})`
              : `linear-gradient(135deg, ${alpha(P, 0.12)}, ${alpha(S, 0.06)})`,
            color: isDark ? tokens.navy400 : tokens.navy700,
            boxShadow: isDark
              ? `inset 0 0 0 1px ${alpha(P, 0.28)}`
              : `inset 0 0 0 1px ${alpha(P, 0.2)}`,
            '& .MuiListItemIcon-root': { color: isDark ? tokens.navy400 : P },
            '&:hover': {
              background: isDark
                ? `linear-gradient(135deg, ${alpha(P, 0.32)}, ${alpha(S, 0.2)})`
                : `linear-gradient(135deg, ${alpha(P, 0.17)}, ${alpha(S, 0.09)})`,
            },
          },
          '&:hover': {
            backgroundColor: isDark ? 'rgba(255,255,255,.05)' : alpha(P, 0.05),
          },
        },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: '0.75rem',
          borderRadius: 8,
          fontWeight: 500,
          padding: '5px 10px',
          backgroundColor: isDark ? tokens.navy900 : tokens.navy800,
          boxShadow: '0 4px 12px rgba(0,0,0,.25)',
        },
        arrow: { color: isDark ? tokens.navy900 : tokens.navy800 },
      },
    },

    MuiDivider: {
      styleOverrides: {
        root: { borderColor: isDark ? alpha(P, 0.12) : alpha(P, 0.1) },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          backgroundColor: isDark ? alpha(P, 0.15) : alpha(P, 0.1),
        },
        bar: {
          borderRadius: 6,
          background: `linear-gradient(90deg, ${P}, ${S})`,
        },
      },
    },

    MuiCircularProgress: {
      styleOverrides: {
        colorPrimary: { color: isDark ? tokens.navy400 : P },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 10, fontSize: '0.875rem' },
        standardSuccess: {
          background: isDark ? alpha(tokens.emerald600, 0.12) : '#F0FDF4',
          border: `1px solid ${isDark ? alpha(tokens.emerald600, 0.3) : '#BBF7D0'}`,
          borderLeft: `3px solid ${tokens.emerald600}`,
          '& .MuiAlert-icon': { color: isDark ? '#34D399' : tokens.emerald600 },
        },
        standardError: {
          background: isDark ? alpha(tokens.red600, 0.12) : '#FFF1F2',
          border: `1px solid ${isDark ? alpha(tokens.red600, 0.3) : '#FECDD3'}`,
          borderLeft: `3px solid ${tokens.red600}`,
          '& .MuiAlert-icon': { color: isDark ? tokens.red400 : tokens.red600 },
        },
        standardWarning: {
          background: isDark ? alpha(tokens.amber600, 0.12) : '#FFFBEB',
          border: `1px solid ${isDark ? alpha(tokens.amber600, 0.3) : '#FDE68A'}`,
          borderLeft: `3px solid ${tokens.amber600}`,
          '& .MuiAlert-icon': { color: isDark ? tokens.amber500 : tokens.amber600 },
        },
        standardInfo: {
          background: isDark ? alpha(P, 0.12) : tokens.navy50,
          border: `1px solid ${isDark ? alpha(P, 0.3) : tokens.navy200}`,
          borderLeft: `3px solid ${P}`,
          '& .MuiAlert-icon': { color: isDark ? tokens.navy400 : P },
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 18,
          boxShadow: isDark
            ? `0 32px 80px rgba(0,0,0,.65), 0 0 0 1px ${alpha(P, 0.18)}`
            : `0 32px 80px ${alpha(P, 0.2)}, 0 8px 32px rgba(0,0,0,.08)`,
          border: `1px solid ${isDark ? alpha(P, 0.18) : alpha(P, 0.12)}`,
        },
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: { fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.01em', padding: '20px 24px 12px' },
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: 'none',
          backgroundColor: isDark ? tokens.darkPaper : '#F4F7FC',
          boxShadow: isDark
            ? `1px 0 0 ${tokens.darkBorder}`
            : `1px 0 0 ${alpha(P, 0.1)}`,
        },
      },
    },

    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: '12px !important',
          border: '1px solid',
          borderColor: isDark ? alpha(P, 0.12) : alpha(P, 0.14),
          boxShadow: 'none',
          '&:before': { display: 'none' },
          '&.Mui-expanded': {
            margin: 0,
            borderColor: isDark ? alpha(P, 0.28) : alpha(P, 0.28),
            boxShadow: `0 4px 16px ${alpha(P, 0.08)}`,
          },
          transition: 'border-color .18s ease, box-shadow .18s ease',
          '&:hover': { borderColor: isDark ? alpha(P, 0.25) : alpha(P, 0.25) },
        },
      },
    },

    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          '&.Mui-expanded': {
            borderRadius: '12px 12px 0 0',
            background: isDark ? alpha(P, 0.08) : alpha(P, 0.04),
          },
          minHeight: 48,
        },
      },
    },

    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          border: `1px solid ${isDark ? alpha(P, 0.18) : alpha(P, 0.14)}`,
          boxShadow: isDark
            ? '0 8px 32px rgba(0,0,0,.55)'
            : `0 8px 32px ${alpha(P, 0.14)}, 0 2px 8px rgba(0,0,0,.06)`,
          padding: '4px',
        },
      },
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontSize: '0.875rem',
          fontWeight: 500,
          padding: '7px 12px',
          transition: 'background-color .12s ease',
          margin: '1px 0',
          '&:hover': { background: alpha(P, 0.06) },
          '&.Mui-selected': { background: alpha(P, 0.1), color: isDark ? tokens.navy400 : tokens.navy700 },
        },
      },
    },

    MuiAppBar: {
      styleOverrides: {
        root: { backgroundImage: 'none', backdropFilter: 'blur(12px)' },
      },
    },

    MuiSkeleton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: isDark ? alpha(P, 0.1) : alpha(P, 0.07),
        },
      },
    },

    MuiBadge: {
      styleOverrides: {
        badge: {
          fontWeight: 700,
          fontSize: '0.625rem',
          background: `linear-gradient(135deg, ${P}, ${S})`,
          color: '#fff',
        },
      },
    },

    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked + .MuiSwitch-track': {
            opacity: 1,
            background: `linear-gradient(135deg, ${P}, ${S})`,
          },
        },
        thumb: { boxShadow: '0 2px 4px rgba(0,0,0,.2)' },
        track: { borderRadius: 20, opacity: 0.3 },
      },
    },
  }
}

// ── Light Theme ───────────────────────────────────────────────────────────────
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: tokens.navy600,      // #01398c
      dark: tokens.navy800,
      light: tokens.navy100,
      contrastText: '#ffffff',
    },
    secondary: {
      main: tokens.gray600,      // #555555
      dark: tokens.gray800,
      light: tokens.gray100,
      contrastText: '#ffffff',
    },
    success: {
      main: tokens.emerald600,
      dark: tokens.emerald700,
      light: '#D1FAE5',
      contrastText: '#ffffff',
    },
    warning: {
      main: tokens.amber600,
      dark: tokens.amber700,
      light: '#FEF3C7',
      contrastText: '#ffffff',
    },
    error: {
      main: tokens.red600,
      dark: '#B91C1C',
      light: '#FEE2E2',
      contrastText: '#ffffff',
    },
    info: {
      main: tokens.sky600,
      dark: tokens.sky700,
      light: '#E0F2FE',
      contrastText: '#ffffff',
    },
    neutral: {
      main: tokens.slate500,
      dark: tokens.slate600,
      light: tokens.slate100,
    },
    background: {
      default: '#EEF2F8',     // ← cool blue-gray wash
      paper:   '#FFFFFF',
    },
    text: {
      primary:   '#0A1628',   // very dark navy text
      secondary: tokens.slate500,
      disabled:  tokens.slate400,
    },
    divider: alpha(tokens.navy600, 0.1),
    action: {
      hover:    alpha(tokens.navy600, 0.05),
      selected: alpha(tokens.navy600, 0.1),
      focus:    alpha(tokens.navy600, 0.12),
    },
  },
  typography: baseTypography,
  shape: baseShape,
  shadows: [
    'none',
    `0 1px 2px ${alpha(tokens.navy600, 0.05)}, 0 1px 3px rgba(0,0,0,.03)`,
    `0 1px 5px ${alpha(tokens.navy600, 0.06)}, 0 2px 8px rgba(0,0,0,.05)`,
    `0 2px 8px ${alpha(tokens.navy600, 0.07)}, 0 4px 16px rgba(0,0,0,.07)`,
    `0 4px 12px ${alpha(tokens.navy600, 0.08)}, 0 8px 24px rgba(0,0,0,.08)`,
    `0 8px 20px ${alpha(tokens.navy600, 0.1)},  0 16px 40px rgba(0,0,0,.09)`,
    `0 12px 28px ${alpha(tokens.navy600, 0.12)}, 0 24px 56px rgba(0,0,0,.1)`,
    ...Array(18).fill('none'),
  ] as any,
  components: buildComponents('light'),
})

// ── Dark Theme ────────────────────────────────────────────────────────────────
export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: tokens.navy400,
      dark: tokens.navy600,
      light: tokens.navy200,
      contrastText: '#ffffff',
    },
    secondary: {
      main: tokens.gray400,
      dark: tokens.gray600,
      light: tokens.gray200,
      contrastText: '#ffffff',
    },
    success: {
      main: '#34D399',
      dark: tokens.emerald600,
      light: alpha(tokens.emerald600, 0.15),
      contrastText: '#fff',
    },
    warning: {
      main: tokens.amber500,
      dark: tokens.amber600,
      light: alpha(tokens.amber600, 0.15),
      contrastText: '#fff',
    },
    error: {
      main: tokens.red400,
      dark: tokens.red600,
      light: alpha(tokens.red600, 0.15),
      contrastText: '#fff',
    },
    info: {
      main: '#38BDF8',
      dark: tokens.sky600,
      light: alpha(tokens.sky600, 0.15),
      contrastText: '#fff',
    },
    neutral: {
      main: tokens.slate400,
      dark: tokens.slate600,
      light: alpha(tokens.slate400, 0.1),
    },
    background: {
      default: tokens.darkBg,      // #060E1A
      paper:   tokens.darkPaper,   // #0C1829
    },
    text: {
      primary:   '#E8EEF7',
      secondary: tokens.slate400,
      disabled:  tokens.slate600,
    },
    divider: alpha(tokens.navy400, 0.14),
    action: {
      hover:    alpha(tokens.navy500, 0.12),
      selected: alpha(tokens.navy500, 0.2),
      focus:    alpha(tokens.navy500, 0.24),
    },
  },
  typography: baseTypography,
  shape: baseShape,
  shadows: [
    'none',
    '0 1px 2px rgba(0,0,0,.35)',
    '0 2px 6px rgba(0,0,0,.45)',
    '0 4px 12px rgba(0,0,0,.55)',
    '0 8px 24px rgba(0,0,0,.6)',
    '0 16px 40px rgba(0,0,0,.65)',
    '0 24px 56px rgba(0,0,0,.7)',
    ...Array(18).fill('none'),
  ] as any,
  components: buildComponents('dark'),
})
