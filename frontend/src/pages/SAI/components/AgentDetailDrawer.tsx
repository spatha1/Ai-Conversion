import { useState } from 'react'
import {
  Drawer, Box, Typography, IconButton, Chip, Tabs, Tab,
  Accordion, AccordionSummary, AccordionDetails, Stack, Divider,
} from '@mui/material'
import CloseIcon        from '@mui/icons-material/Close'
import ExpandMoreIcon   from '@mui/icons-material/ExpandMore'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import ErrorIcon        from '@mui/icons-material/Error'
import { SaiStep, SaiAiTrace, SaiStepStatus } from '@/types'

const AGENT_LABELS: Record<string, string> = {
  schema_agent:          'Schema Resolution',
  data_collection_agent: 'Data Collection',
  rca_agent:             'RCA Analysis',
  issue_classifier:      'Issue Classification',
  ownership_agent:       'Ownership Mapping',
  action_agent:          'Autonomous Actions',
  validation_agent:      'Validation',
  reporting_agent:       'Report Generation',
  learning_agent:        'Learning',
}

// Map agent names to AITraceLog module values
const AGENT_MODULE: Record<string, string> = {
  schema_agent:          'sai_schema',
  data_collection_agent: 'sai_data_collection',
  rca_agent:             'sai_rca',
  issue_classifier:      'sai_classifier',
  ownership_agent:       'sai_ownership',
  reporting_agent:       'sai_report',
}

interface Props {
  open:      boolean
  onClose:   () => void
  agentName: string
  step:      SaiStep | undefined
  traces:    SaiAiTrace[]
}

function StatusChip({ status }: { status?: SaiStepStatus }) {
  if (!status) return null
  const color = status === 'done' ? 'success' : status === 'error' ? 'error' : 'warning'
  return <Chip label={status} size="small" color={color} sx={{ height: 18, fontSize: '0.65rem' }} />
}

function OutputSummary({ agentName, output }: { agentName: string; output: Record<string, unknown> }) {
  const items: { label: string; value: string | number }[] = []

  const addCount = (key: string, label: string) => {
    const v = output[key]
    if (Array.isArray(v)) items.push({ label, value: v.length })
  }
  const addVal = (key: string, label: string) => {
    const v = output[key]
    if (v != null) items.push({ label, value: String(v) })
  }

  switch (agentName) {
    case 'schema_agent':
      addCount('domains', 'Domains')
      addCount('connections', 'Connections')
      addCount('relevant_tables', 'Tables')
      break
    case 'data_collection_agent': {
      const datasets = (output.datasets as Record<string, unknown>[] | undefined) ?? []
      items.push({ label: 'Datasets', value: datasets.length })
      const ok    = datasets.filter(d => !d.error).length
      const error = datasets.filter(d =>  d.error).length
      if (ok)    items.push({ label: 'OK',     value: ok })
      if (error) items.push({ label: 'Errors', value: error })
      break
    }
    case 'rca_agent':
      addCount('anomalies', 'Anomalies')
      addCount('checks', 'Checks')
      break
    case 'issue_classifier':
      addCount('findings', 'Findings')
      break
    case 'ownership_agent':
      addCount('findings', 'Findings')
      break
    case 'action_agent':
      addCount('actions_taken',  'Actions Taken')
      addCount('approval_items', 'Queued for Approval')
      break
    case 'validation_agent':
      addVal('validation_status', 'Status')
      addVal('message', 'Message')
      break
    case 'reporting_agent': {
      const report = output.report as Record<string, unknown> | undefined
      if (report) items.push({ label: 'Sections', value: Object.keys(report).length })
      break
    }
    case 'learning_agent':
      addCount('learned', 'Patterns Learned')
      break
  }

  if (items.length === 0) return null

  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
      {items.map(({ label, value }) => (
        <Box key={label} sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 1.5, py: 0.75, minWidth: 80, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: 'primary.main', lineHeight: 1.2 }}>
            {value}
          </Typography>
          <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary' }}>{label}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function DatasetList({ datasets }: { datasets: Record<string, unknown>[] }) {
  return (
    <Stack spacing={0.5} mb={1}>
      {datasets.map((ds, i) => {
        const hasError = Boolean(ds.error)
        return (
          <Box key={i} sx={{ px: 1.5, py: 0.75, borderRadius: 1, bgcolor: hasError ? 'error.light' : 'success.light',
            display: 'flex', alignItems: 'center', gap: 1 }}>
            {hasError
              ? <ErrorIcon sx={{ fontSize: 13, color: 'error.dark' }} />
              : <CheckCircleIcon sx={{ fontSize: 13, color: 'success.dark' }} />
            }
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: hasError ? 'error.dark' : 'success.dark', flex: 1 }}>
              {String(ds.label ?? ds.conn_id ?? i)}
            </Typography>
            {ds.row_count != null && (
              <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>{String(ds.row_count)} rows</Typography>
            )}
            {hasError && (
              <Typography sx={{ fontSize: '0.65rem', color: 'error.dark' }} noWrap>{String(ds.error).slice(0, 60)}</Typography>
            )}
          </Box>
        )
      })}
    </Stack>
  )
}

export default function AgentDetailDrawer({ open, onClose, agentName, step, traces }: Props) {
  const [tab, setTab] = useState(0)

  const label   = AGENT_LABELS[agentName] || agentName
  const output  = (step?.output ?? {}) as Record<string, unknown>
  const module  = AGENT_MODULE[agentName]
  const myTraces = module ? traces.filter(t => t.module === module) : []

  const datasets = agentName === 'data_collection_agent'
    ? ((output.datasets as Record<string, unknown>[] | undefined) ?? [])
    : []

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: 480, display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>{label}</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 0.25 }}>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', fontFamily: 'monospace' }}>{agentName}</Typography>
            <StatusChip status={step?.status} />
            {step?.elapsed_ms != null && (
              <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>{step.elapsed_ms}ms</Typography>
            )}
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 36 }}
        TabIndicatorProps={{ sx: { height: 2 } }}>
        <Tab label="Output" sx={{ minHeight: 36, fontSize: '0.75rem', py: 0 }} />
        <Tab label={`AI Calls${myTraces.length ? ` (${myTraces.length})` : ''}`}
          sx={{ minHeight: 36, fontSize: '0.75rem', py: 0 }} />
      </Tabs>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>

        {/* ── OUTPUT TAB ── */}
        {tab === 0 && (
          <>
            {!step && (
              <Typography sx={{ color: 'text.disabled', fontSize: '0.8rem', fontStyle: 'italic' }}>
                No output recorded for this agent yet.
              </Typography>
            )}
            {step && (
              <>
                <OutputSummary agentName={agentName} output={output} />

                {datasets.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: 'text.secondary', letterSpacing: 1, mb: 0.5 }}>
                      DATASETS
                    </Typography>
                    <DatasetList datasets={datasets} />
                    <Divider sx={{ my: 1.5 }} />
                  </>
                )}

                <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 16 }} />} sx={{ minHeight: 36, py: 0 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600 }}>Full Output JSON</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0 }}>
                    <Box sx={{
                      bgcolor: 'action.hover', p: 1.5, fontFamily: 'monospace', fontSize: '0.68rem',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.primary',
                      maxHeight: 400, overflowY: 'auto',
                    }}>
                      {JSON.stringify(output, null, 2)}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              </>
            )}
          </>
        )}

        {/* ── AI CALLS TAB ── */}
        {tab === 1 && (
          <>
            {myTraces.length === 0 && (
              <Typography sx={{ color: 'text.disabled', fontSize: '0.8rem', fontStyle: 'italic' }}>
                {module ? 'No AI calls recorded for this agent.' : 'This agent does not make LLM calls.'}
              </Typography>
            )}
            <Stack spacing={1.5}>
              {myTraces.map((t, i) => (
                <Box key={t.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  {/* Trace header */}
                  <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, flex: 1 }}>Call #{i + 1} — {t.model}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>
                      {(t.tokens_in || 0).toLocaleString()} in · {(t.tokens_out || 0).toLocaleString()} out · {t.latency_ms}ms
                    </Typography>
                  </Box>
                  {/* Prompt */}
                  <Accordion disableGutters elevation={0}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 14 }} />} sx={{ minHeight: 30, py: 0, px: 1.5 }}>
                      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.secondary' }}>Prompt</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ p: 0 }}>
                      <Box sx={{ bgcolor: 'action.hover', px: 1.5, py: 1, fontFamily: 'monospace', fontSize: '0.68rem',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.primary', maxHeight: 200, overflowY: 'auto' }}>
                        {t.prompt_text || '—'}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                  {/* Response */}
                  <Accordion disableGutters elevation={0}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ fontSize: 14 }} />} sx={{ minHeight: 30, py: 0, px: 1.5 }}>
                      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: 'text.secondary' }}>Response</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ p: 0 }}>
                      <Box sx={{ bgcolor: 'action.hover', px: 1.5, py: 1, fontFamily: 'monospace', fontSize: '0.68rem',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.primary', maxHeight: 200, overflowY: 'auto' }}>
                        {t.response_text || '—'}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                </Box>
              ))}
            </Stack>
          </>
        )}
      </Box>
    </Drawer>
  )
}
