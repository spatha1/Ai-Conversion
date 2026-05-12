import React, { useState } from 'react'
import {
  Box, Chip, Collapse, Divider, Stack, Typography, IconButton, Tooltip,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import BlockIcon from '@mui/icons-material/Block'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import SyncIcon from '@mui/icons-material/Sync'
import HourglassTopIcon from '@mui/icons-material/HourglassTop'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import { OperationalPayload } from '../../types'

// ── Decision type config ───────────────────────────────────────────────────────

const DECISION_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  STOP:             { label: 'STOP',             color: '#d32f2f', icon: <BlockIcon fontSize="small" /> },
  ESCALATE:         { label: 'ESCALATE',         color: '#e65100', icon: <WarningAmberIcon fontSize="small" /> },
  RETRY:            { label: 'RETRY',             color: '#1565c0', icon: <SyncIcon fontSize="small" /> },
  PARTIAL_CONTINUE: { label: 'PARTIAL CONTINUE', color: '#f57f17', icon: <CallSplitIcon fontSize="small" /> },
  CONTINUE:         { label: 'CONTINUE',         color: '#2e7d32', icon: <CheckCircleOutlineIcon fontSize="small" /> },
  WAIT:             { label: 'WAIT',             color: '#6a1b9a', icon: <HourglassTopIcon fontSize="small" /> },
}

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: '#b71c1c',
  HIGH:     '#e65100',
  MEDIUM:   '#f9a825',
  LOW:      '#1b5e20',
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  payload: OperationalPayload
  compact?: boolean   // hide recovery/dependencies by default, show on expand
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OperationalDecisionCard({ payload, compact = false }: Props) {
  const [expanded, setExpanded] = useState(!compact)

  const dt = (payload.decision_type || 'CONTINUE').toUpperCase()
  const cfg = DECISION_CONFIG[dt] ?? { label: dt, color: '#546e7a', icon: null }
  const sevColor = SEVERITY_COLOR[(payload.severity || '').toUpperCase()] ?? '#546e7a'

  return (
    <Box
      sx={{
        border: `2px solid ${cfg.color}`,
        borderRadius: 2,
        bgcolor: 'background.paper',
        overflow: 'hidden',
        my: 1,
      }}
    >
      {/* ── Header bar ── */}
      <Box
        sx={{
          bgcolor: cfg.color,
          px: 2,
          py: 0.75,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ color: '#fff', display: 'flex', alignItems: 'center' }}>{cfg.icon}</Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#fff', letterSpacing: 1, fontSize: '0.8rem' }}>
            {cfg.label}
          </Typography>
          <Chip
            label={payload.severity || 'MEDIUM'}
            size="small"
            sx={{ bgcolor: sevColor, color: '#fff', fontWeight: 700, fontSize: '0.68rem', height: 20 }}
          />
          <Chip
            label={`SCOPE: ${(payload.scope || 'system').toUpperCase()}`}
            size="small"
            sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: '0.68rem', height: 20 }}
          />
          <Chip
            label={`${payload.rule_count} rule${payload.rule_count !== 1 ? 's' : ''} matched`}
            size="small"
            sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: '0.68rem', height: 20 }}
          />
        </Stack>
        <Tooltip title={expanded ? 'Collapse' : 'Expand'}>
          <IconButton size="small" onClick={() => setExpanded(!expanded)} sx={{ color: '#fff' }}>
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* ── Body ── */}
      <Collapse in={expanded}>
        <Box sx={{ p: 2 }}>

          {/* Actions */}
          {payload.actions.length > 0 && (
            <Section title="Actions Required">
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {payload.actions.map((a, i) => (
                  <li key={i}><Typography variant="body2" sx={{ fontSize: '0.82rem' }}>{a}</Typography></li>
                ))}
              </ol>
            </Section>
          )}

          {/* Stop conditions */}
          {payload.stop_conditions.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Section title="Stop Conditions" titleColor="#d32f2f">
                <Stack spacing={0.5}>
                  {payload.stop_conditions.map((s, i) => (
                    <Typography key={i} variant="body2" sx={{ fontSize: '0.82rem', color: 'error.main' }}>
                      • {s}
                    </Typography>
                  ))}
                </Stack>
              </Section>
            </>
          )}

          {/* Recovery steps */}
          {payload.recovery_steps.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Section title="Recovery Path" titleColor="#1565c0">
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {payload.recovery_steps.map((r, i) => (
                    <li key={i}><Typography variant="body2" sx={{ fontSize: '0.82rem' }}>{r}</Typography></li>
                  ))}
                </ol>
              </Section>
            </>
          )}

          {/* Owners */}
          {payload.owners.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Section title="Ownership">
                <Stack direction="row" flexWrap="wrap" gap={0.75}>
                  {payload.owners.map((o, i) => (
                    <Chip key={i} label={o} size="small" variant="outlined" sx={{ fontSize: '0.75rem' }} />
                  ))}
                </Stack>
              </Section>
            </>
          )}

          {/* Dependencies */}
          {payload.depends_on.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Section title="Rule Dependencies">
                <Stack direction="row" flexWrap="wrap" gap={0.75}>
                  {payload.depends_on.map((d, i) => (
                    <Chip
                      key={i}
                      label={d}
                      size="small"
                      variant="outlined"
                      color="secondary"
                      sx={{ fontSize: '0.72rem' }}
                    />
                  ))}
                </Stack>
              </Section>
            </>
          )}

          {/* Rules matched */}
          {payload.rules_matched.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Section title="Rules Applied" titleColor="#546e7a">
                <Stack direction="row" flexWrap="wrap" gap={0.75}>
                  {payload.rules_matched.map((r, i) => (
                    <Chip
                      key={i}
                      label={r}
                      size="small"
                      sx={{ bgcolor: 'action.selected', fontSize: '0.72rem' }}
                    />
                  ))}
                </Stack>
              </Section>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Internal section helper ────────────────────────────────────────────────────

function Section({
  title,
  titleColor,
  children,
}: {
  title: string
  titleColor?: string
  children: React.ReactNode
}) {
  return (
    <Box sx={{ mb: 0.5 }}>
      <Typography
        variant="caption"
        fontWeight={700}
        sx={{
          display: 'block',
          mb: 0.5,
          fontSize: '0.7rem',
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: titleColor ?? 'text.secondary',
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  )
}
