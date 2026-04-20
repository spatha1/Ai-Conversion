import { Box, Tabs, Tab, Paper, Typography, alpha, Alert, Button, Tooltip } from '@mui/material'
import {
  AccountTreeOutlined,
  OutputOutlined, VerifiedOutlined, SendOutlined, StorageOutlined,
  TransformOutlined, AutoAwesomeOutlined,
} from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import TargetTab from './tabs/TargetTab'
import AgentPipelineTab from './tabs/AgentPipelineTab'
import OutputTab from './tabs/OutputTab'
import ValidationTab from './tabs/ValidationTab'
import SendToApiTab from './tabs/SendToApiTab'
import { tokens } from '@/theme/theme'
import PipelineTab from './tabs/PipelineTab'

const TABS = [
  { label: 'Target',         icon: <AccountTreeOutlined />,    color: tokens.violet600  },
  { label: 'Agent Pipeline', icon: <AutoAwesomeOutlined />,    color: '#8B5CF6'         },
  { label: 'Output',         icon: <OutputOutlined />,         color: tokens.emerald600 },
  { label: 'Validation',     icon: <VerifiedOutlined />,       color: tokens.amber600   },
  { label: 'Dispatch',       icon: <SendOutlined />,           color: tokens.red600     },
  { label: 'Pipeline',       icon: <TransformOutlined />,      color: '#0EA5E9'         },
]

export default function ConversionPage() {
  const { conversionTab: tab, setConversionTab: setTab, themeMode, activeConnection, templateFormat } = useAppStore()
  const isDark = themeMode === 'dark'
  const navigate = useNavigate()
  const validationDisabled = templateFormat !== 'xml'

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Page header — matches Reports / Dashboards style */}
      <Box sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 56, flexShrink: 0 }}>
        <TransformOutlined color="primary" sx={{ flexShrink: 0 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flexShrink: 0 }}>Conversion</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>XML template upload · field mapping · output generation</Typography>
      </Box>

      {/* No-connection banner */}
      {!activeConnection && (
        <Alert
          severity="info"
          icon={<StorageOutlined fontSize="inherit" />}
          sx={{ borderRadius: 0, py: 0.5, fontSize: '0.813rem' }}
          action={
            <Button size="small" variant="outlined" onClick={() => navigate('/connections')} sx={{ fontSize: '0.75rem', py: 0.25 }}>
              Go to Connections
            </Button>
          }
        >
          No connection selected — choose one from the header or set up a connection first.
        </Alert>
      )}
      {/* ── Enhanced Tab Bar ──────────────────────────────── */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: isDark ? tokens.darkPaper : '#ffffff',
          px: 2,
          flexShrink: 0,
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          TabIndicatorProps={{
            style: {
              background: `linear-gradient(90deg, ${TABS[tab]?.color ?? tokens.indigo600}, ${tokens.violet600})`,
              height: 2.5,
              borderRadius: '3px 3px 0 0',
            },
          }}
          sx={{
            minHeight: 52,
            '& .MuiTabs-scrollButtons': {
              '&.Mui-disabled': { opacity: 0.3 },
            },
          }}
        >
          {TABS.map((t, i) => {
            const active = tab === i
            const color = t.color
            const isDisabled = i === 3 && validationDisabled
            const tabEl = (
              <Tab
                key={i}
                disabled={isDisabled}
                icon={
                  <Box
                    sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 1.5,
                      bgcolor: active ? alpha(color, isDark ? 0.2 : 0.1) : 'transparent',
                      transition: 'all .18s ease',
                      '& svg': { fontSize: 16, color: active ? color : 'text.disabled', transition: 'color .18s ease' },
                    }}
                  >
                    {t.icon}
                  </Box>
                }
                iconPosition="start"
                label={t.label}
                sx={{
                  minHeight: 52,
                  px: 1.75,
                  gap: 0.5,
                  textTransform: 'none',
                  fontWeight: active ? 700 : 500,
                  fontSize: '0.844rem',
                  color: active ? color : 'text.secondary',
                  letterSpacing: 0,
                  transition: 'all .18s ease',
                  '&:hover': {
                    color: active ? color : 'text.primary',
                    bgcolor: alpha(color, 0.04),
                    borderRadius: '8px 8px 0 0',
                  },
                }}
              />
            )
            return isDisabled ? (
              <Tooltip key={i} title="Validation is only available for XML templates" placement="bottom">
                <span>{tabEl}</span>
              </Tooltip>
            ) : tabEl
          })}
        </Tabs>
      </Paper>

      {/* ── Tab Content ───────────────────────────────────── */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          animation: 'fadeSlideIn .18s cubic-bezier(.4,0,.2,1)',
          '@keyframes fadeSlideIn': {
            from: { opacity: 0, transform: 'translateY(5px)' },
            to:   { opacity: 1, transform: 'translateY(0)' },
          },
        }}
        key={tab}
      >
        {tab === 0 && <TargetTab />}
        {tab === 1 && <AgentPipelineTab />}
        {tab === 2 && <OutputTab />}
        {tab === 3 && <ValidationTab />}
        {tab === 4 && <SendToApiTab />}
        {tab === 5 && <PipelineTab />}
      </Box>
    </Box>
  )
}
