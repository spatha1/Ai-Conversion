import { Box, Chip, Typography } from '@mui/material'
import CircleIcon from '@mui/icons-material/Circle'
import { SaiRunSummary } from '@/types'

interface Props {
  runs: SaiRunSummary[]
  mode: string
  isStreaming: boolean
}

export default function KPIBar({ runs, mode, isStreaming }: Props) {
  const active    = runs.filter(r => r.status === 'running').length
  const recovered = runs.filter(r => r.status === 'complete' && r.findings_count === 0).length
  const total     = runs.length
  const health    = total === 0 ? 100 : Math.round((recovered / total) * 100)

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 3,
      px: 3, py: 1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider',
      flexWrap: 'wrap',
    }}>
      <KPI label="Active Incidents" value={active}    color={active > 0 ? 'error.main' : 'success.main'} />
      <KPI label="Total Runs"       value={total}     color="primary.light" />
      <KPI label="Resolved"         value={recovered} color="success.main" />
      <KPI label="Health Score"     value={`${health}%`}
           color={health >= 80 ? 'success.main' : health >= 50 ? 'warning.main' : 'error.main'} />

      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={`Mode: ${mode.toUpperCase()}`}
          size="small"
          sx={{
            bgcolor: mode === 'autonomous' ? 'error.dark' : mode === 'assisted' ? 'warning.dark' : 'primary.dark',
            color: '#fff', fontSize: '0.7rem', fontWeight: 700,
          }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <CircleIcon sx={{
            fontSize: 10,
            color: isStreaming ? 'success.main' : 'text.disabled',
            animation: isStreaming ? 'pulse 1.5s infinite' : 'none',
          }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
            {isStreaming ? 'LIVE' : 'IDLE'}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

function KPI({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{ color, fontWeight: 700, fontSize: '1.1rem', lineHeight: 1 }}>
        {value}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
        {label}
      </Typography>
    </Box>
  )
}
