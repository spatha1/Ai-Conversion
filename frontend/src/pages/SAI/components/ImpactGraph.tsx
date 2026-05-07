import { Box, Typography, Chip } from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import { SaiFinding } from '@/types'

interface Props {
  findings: SaiFinding[]
  systems:  string[]
}

export default function ImpactGraph({ findings, systems }: Props) {
  const critical       = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
  const rootCauseSystem = critical[0]?.system_impacted || null

  const displaySystems = systems.length > 0
    ? systems
    : findings.map(f => f.system_impacted).filter(Boolean) as string[]

  const unique = [...new Set(displaySystems)].slice(0, 6)

  return (
    <Box sx={{
      width: 220, bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider',
      p: 2, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto',
    }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1, fontSize: '0.65rem' }}>
        IMPACT ANALYSIS
      </Typography>

      {unique.length === 0 ? (
        <Typography sx={{ color: 'text.disabled', fontSize: '0.7rem', fontStyle: 'italic' }}>
          Awaiting analysis...
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
          {unique.map((sys, i) => {
            const isRoot     = sys === rootCauseSystem
            const isImpacted = findings.some(f => f.system_impacted === sys && f.severity !== 'LOW')
            return (
              <Box key={i} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {i > 0 && <ArrowDownwardIcon sx={{ fontSize: 14, color: 'text.disabled', my: 0.25 }} />}
                <Box sx={{
                  px: 1.5, py: 0.75, borderRadius: 1, textAlign: 'center',
                  border: isRoot ? '2px solid' : '1px solid',
                  borderColor: isRoot ? 'error.main' : isImpacted ? 'warning.main' : 'divider',
                  bgcolor: isRoot ? 'error.light' : isImpacted ? 'warning.light' : 'action.hover',
                  minWidth: 140,
                  opacity: isRoot ? 1 : isImpacted ? 0.95 : 0.8,
                }}>
                  <Typography sx={{
                    fontSize: '0.7rem', fontWeight: 700,
                    color: isRoot ? 'error.dark' : isImpacted ? 'warning.dark' : 'text.secondary',
                  }}>
                    {sys}
                  </Typography>
                  {isRoot && (
                    <Typography sx={{ fontSize: '0.6rem', color: 'error.main' }}>ROOT CAUSE</Typography>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}

      {/* Findings summary */}
      {findings.length > 0 && (
        <Box sx={{ mt: 2, borderTop: 1, borderColor: 'divider', pt: 2 }}>
          {findings.slice(0, 3).map((f, i) => (
            <Box key={i} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                <Chip
                  label={f.severity}
                  size="small"
                  sx={{
                    height: 16, fontSize: '0.6rem', fontWeight: 700,
                    bgcolor: f.severity === 'CRITICAL' ? 'error.dark'
                           : f.severity === 'HIGH'     ? 'warning.dark'
                           : f.severity === 'MEDIUM'   ? 'primary.dark'
                           : 'action.selected',
                    color: '#fff',
                  }}
                />
                <Typography sx={{ fontSize: '0.65rem', color: 'primary.light', fontWeight: 600 }}>
                  {f.issue_type}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
                Owner: {f.owner_team || '—'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
