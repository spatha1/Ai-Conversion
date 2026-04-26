import { useState } from 'react'
import {
  Box, Paper, Typography, Chip, Collapse, IconButton, Tooltip, alpha,
} from '@mui/material'
import {
  BugReportOutlined, ExpandMoreOutlined, ExpandLessOutlined,
  CheckCircleOutlined, ErrorOutlined, AccessTimeOutlined, ContentCopyOutlined,
  SchemaOutlined, TextFieldsOutlined, DataObjectOutlined, SmartToyOutlined,
  StorageOutlined, CodeOutlined,
} from '@mui/icons-material'
import type { DebugPayload, DebugStep } from '@/types'

interface DebugStepsPanelProps {
  debug:      DebugPayload
  module:     string
  collapsed?: boolean
}

const STEP_META: Record<string, { icon: React.ReactNode; color: string }> = {
  context_assembly:       { icon: <SchemaOutlined sx={{ fontSize: 14 }} />,      color: '#2563eb' },
  prompt_template_lookup: { icon: <TextFieldsOutlined sx={{ fontSize: 14 }} />,  color: '#7c3aed' },
  prompt_construction:    { icon: <DataObjectOutlined sx={{ fontSize: 14 }} />,  color: '#0891b2' },
  llm_call:               { icon: <SmartToyOutlined sx={{ fontSize: 14 }} />,    color: '#059669' },
  sql_execution:          { icon: <StorageOutlined sx={{ fontSize: 14 }} />,     color: '#d97706' },
  response_parsing:       { icon: <CodeOutlined sx={{ fontSize: 14 }} />,        color: '#64748b' },
}

function getStepMeta(step: string, status: string) {
  if (status === 'error') return { icon: <ErrorOutlined sx={{ fontSize: 14 }} />, color: '#dc2626' }
  return STEP_META[step] ?? { icon: <CodeOutlined sx={{ fontSize: 14 }} />, color: '#64748b' }
}

function JsonViewer({ data }: { data: Record<string, unknown> }) {
  const text = JSON.stringify(data, null, 2)
  if (!text || text === '{}') return <Typography variant="caption" color="text.disabled">(empty)</Typography>
  return (
    <Box
      component="pre"
      sx={{
        m: 0, p: 1.5, borderRadius: 1,
        bgcolor: alpha('#000', 0.04),
        fontFamily: 'monospace',
        fontSize: '0.72rem',
        lineHeight: 1.6,
        maxHeight: 240,
        overflow: 'auto',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </Box>
  )
}

function StepRow({ step, index }: { step: DebugStep; index: number }) {
  const [open, setOpen] = useState(false)
  const meta  = getStepMeta(step.step, step.status)
  const isErr = step.status === 'error'

  return (
    <Box>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
          cursor: 'pointer', borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Step number circle */}
        <Box sx={{
          width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: alpha(meta.color, 0.12), color: meta.color, flexShrink: 0,
        }}>
          {meta.icon}
        </Box>

        {/* Status indicator */}
        {isErr
          ? <ErrorOutlined sx={{ fontSize: 16, color: '#dc2626', flexShrink: 0 }} />
          : <CheckCircleOutlined sx={{ fontSize: 16, color: '#059669', flexShrink: 0 }} />
        }

        {/* Step number */}
        <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0, minWidth: 18 }}>
          {index + 1}.
        </Typography>

        {/* Label */}
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
          {step.label}
        </Typography>

        {/* Template badge */}
        {step.template_used && (
          <Chip
            label={step.template_used.name}
            size="small"
            sx={{ fontSize: '0.68rem', bgcolor: alpha('#7c3aed', 0.1), color: '#7c3aed', height: 18 }}
          />
        )}
        {step.step === 'prompt_template_lookup' && !step.template_used && (
          <Chip
            label="hardcoded fallback"
            size="small"
            sx={{ fontSize: '0.68rem', bgcolor: 'action.hover', color: 'text.disabled', height: 18 }}
          />
        )}

        {/* Duration */}
        {step.duration_ms != null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, color: 'text.secondary' }}>
            <AccessTimeOutlined sx={{ fontSize: 12 }} />
            <Typography variant="caption">{step.duration_ms}ms</Typography>
          </Box>
        )}

        {open ? <ExpandLessOutlined sx={{ fontSize: 16, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />}
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 3, pb: 2, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {isErr && step.error && (
            <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: alpha('#dc2626', 0.06), border: '1px solid', borderColor: alpha('#dc2626', 0.2) }}>
              <Typography variant="caption" sx={{ color: '#dc2626', fontWeight: 700, display: 'block' }}>
                {step.error.type}
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#dc2626', display: 'block' }}>
                {step.error.message}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Input</Typography>
              <JsonViewer data={step.input} />
            </Box>
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Output</Typography>
              <JsonViewer data={step.output} />
            </Box>
          </Box>
        </Box>
      </Collapse>
    </Box>
  )
}

export default function DebugStepsPanel({ debug, module, collapsed = false }: DebugStepsPanelProps) {
  const [open, setOpen] = useState(!collapsed)
  const LEVEL_COLOR = debug.debug_level === 'ADVANCED' ? '#dc2626' : '#0891b2'

  // Aggregate perf summary from steps
  const totalMs     = debug.steps.reduce((acc, s) => acc + (s.duration_ms ?? 0), 0)
  const llmStep     = debug.steps.find((s) => s.step === 'llm_call')
  const tokensIn    = llmStep?.input?.['tokens_in']  as number | undefined
  const tokensOut   = llmStep?.output?.['tokens_out'] as number | undefined
  const errorCount  = debug.steps.filter((s) => s.status === 'error').length

  const copyTraceId = () => {
    navigator.clipboard.writeText(debug.trace_id).catch(() => {})
  }

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2, borderColor: alpha('#dc2626', 0.4), borderLeft: '4px solid #dc2626', mt: 2, overflow: 'hidden' }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25,
          bgcolor: alpha('#dc2626', 0.04), cursor: 'pointer', borderBottom: open ? '1px solid' : 'none', borderColor: 'divider',
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <BugReportOutlined sx={{ color: '#dc2626', fontSize: 18, flexShrink: 0 }} />
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>
          AI Debug — {module}
        </Typography>

        {errorCount > 0 && (
          <Chip label={`${errorCount} error${errorCount > 1 ? 's' : ''}`} size="small" sx={{ bgcolor: alpha('#dc2626', 0.1), color: '#dc2626', fontWeight: 700, fontSize: '0.7rem', height: 20 }} />
        )}
        <Chip label={`${debug.steps.length} steps`} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
        <Chip
          label={debug.debug_level}
          size="small"
          sx={{ bgcolor: alpha(LEVEL_COLOR, 0.1), color: LEVEL_COLOR, fontWeight: 700, fontSize: '0.7rem', height: 20 }}
        />

        <Tooltip title="Copy trace ID">
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); copyTraceId() }}
            sx={{ p: 0.3 }}
          >
            <ContentCopyOutlined sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.disabled', fontSize: '0.68rem' }}>
          {debug.trace_id.slice(0, 8)}…
        </Typography>

        {open ? <ExpandLessOutlined sx={{ fontSize: 16, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />}
      </Box>

      <Collapse in={open}>
        {/* Step timeline */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0, py: 1 }}>
          {debug.steps.map((step, i) => (
            <StepRow key={i} step={step} index={i} />
          ))}
        </Box>

        {/* Performance footer */}
        {debug.steps.length > 0 && (
          <Box sx={{
            display: 'flex', gap: 2.5, px: 2, py: 1,
            borderTop: '1px solid', borderColor: 'divider',
            bgcolor: 'action.hover',
          }}>
            <Typography variant="caption" color="text.secondary">
              <strong>Total:</strong> {totalMs.toLocaleString()}ms
            </Typography>
            {tokensIn != null && tokensOut != null && (
              <Typography variant="caption" color="text.secondary">
                <strong>Tokens:</strong> {tokensIn} in → {tokensOut} out
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              <strong>Steps:</strong> {debug.steps.length}
            </Typography>
            {errorCount > 0 && (
              <Typography variant="caption" sx={{ color: '#dc2626' }}>
                <strong>Errors:</strong> {errorCount}
              </Typography>
            )}
          </Box>
        )}
      </Collapse>
    </Paper>
  )
}
