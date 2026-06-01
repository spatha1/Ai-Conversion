import { useState } from 'react'
import {
  Box, Typography, Chip, Paper, Collapse, IconButton, Button,
  CircularProgress, Stack, alpha, Tooltip, Snackbar,
} from '@mui/material'
import {
  ExpandMoreOutlined, ExpandLessOutlined, DeleteOutlined,
  BugReportOutlined, RefreshOutlined, ContentCopyOutlined, CheckOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { AITraceEntry } from '@/types'

const MODULE_COLORS: Record<string, string> = {
  mapping:          tokens.indigo600,
  report:           tokens.sky600,
  dashboard:        tokens.violet600,
  development:      tokens.emerald600,
  ps:               tokens.amber600,
  admin:            tokens.slate600,
  knowledge:         '#7C3AED',
  knowledge_process: '#6D28D9',
  knowledge_parse:   '#9333EA',
  knowledge_fetch:   '#A855F7',
}

interface Props {
  connId?: number
  module?: string
  maxHeight?: number
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(text).catch(() => {
      // fallback for non-secure contexts
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    })
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Tooltip title={copied ? 'Copied!' : label}>
      <IconButton size="small" onClick={handleCopy} sx={{ p: 0.25, color: copied ? 'success.main' : 'text.disabled', '&:hover': { color: 'primary.main' } }}>
        {copied ? <CheckOutlined sx={{ fontSize: 13 }} /> : <ContentCopyOutlined sx={{ fontSize: 13 }} />}
      </IconButton>
    </Tooltip>
  )
}

function TraceRow({ trace }: { trace: AITraceEntry }) {
  const [open, setOpen] = useState(false)
  const color = MODULE_COLORS[trace.module] ?? tokens.indigo600

  return (
    <Paper
      variant="outlined"
      sx={{ mb: 0.75, borderRadius: 1.5, overflow: 'hidden', borderColor: alpha(color, 0.2) }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75,
          cursor: 'pointer', '&:hover': { bgcolor: alpha(color, 0.03) },
        }}
        onClick={() => setOpen((p) => !p)}
      >
        <Chip
          label={trace.module}
          size="small"
          sx={{
            height: 18, fontSize: '0.625rem', fontWeight: 700,
            bgcolor: alpha(color, 0.12), color, border: 'none',
          }}
        />
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
          {trace.model}
        </Typography>
        {trace.tokens_in != null && (
          <Typography variant="caption" color="text.disabled">
            {trace.tokens_in}↑ {trace.tokens_out}↓
          </Typography>
        )}
        {trace.latency_ms != null && (
          <Typography variant="caption" color="text.disabled">
            {trace.latency_ms}ms
          </Typography>
        )}
        <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: 'nowrap' }}>
          {new Date(trace.created_at).toLocaleTimeString()}
        </Typography>
        <IconButton size="small" sx={{ p: 0.25 }}>
          {open ? <ExpandLessOutlined sx={{ fontSize: 14 }} /> : <ExpandMoreOutlined sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>

      <Collapse in={open}>
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1.5 }}>
          {trace.prompt_text && (
            <Box sx={{ mb: 1 }}>
              <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">PROMPT</Typography>
                <CopyButton text={trace.prompt_text} label="Copy prompt" />
              </Stack>
              <Box component="pre" sx={{
                p: 1, borderRadius: 1, fontSize: '0.688rem', lineHeight: 1.5,
                bgcolor: alpha('#000', 0.04), overflow: 'auto', maxHeight: 200,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0,
              }}>
                {trace.prompt_text}
              </Box>
            </Box>
          )}
          {trace.response_text && (
            <Box>
              <Stack direction="row" alignItems="center" spacing={0.5} mb={0.5}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">RESPONSE</Typography>
                <CopyButton text={trace.response_text} label="Copy response" />
                <Box sx={{ flex: 1 }} />
                <CopyButton
                  text={[
                    trace.prompt_text ? `=== PROMPT ===\n${trace.prompt_text}` : '',
                    trace.response_text ? `=== RESPONSE ===\n${trace.response_text}` : '',
                  ].filter(Boolean).join('\n\n')}
                  label="Copy all (prompt + response)"
                />
              </Stack>
              <Box component="pre" sx={{
                p: 1, borderRadius: 1, fontSize: '0.688rem', lineHeight: 1.5,
                bgcolor: alpha('#000', 0.04), overflow: 'auto', maxHeight: 200,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0,
              }}>
                {trace.response_text}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

export default function AIDebugPanel({ connId, module, maxHeight = 480 }: Props) {
  const [activeModule, setActiveModule] = useState<string | undefined>(module)
  const qc = useQueryClient()

  const { data: traces = [], isFetching, refetch } = useQuery({
    queryKey: ['ai-traces', connId, activeModule],
    queryFn: () => adminApi.getTraces({ conn_id: connId, module: activeModule, limit: 100 }),
    staleTime: 10_000,
  })

  const purgeMut = useMutation({
    mutationFn: (days: number) => adminApi.purgeTraces(days),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-traces'] }),
  })

  const modules = ['mapping', 'report', 'dashboard', 'development', 'ps', 'admin', 'knowledge', 'knowledge_process', 'knowledge_parse', 'knowledge_fetch']

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <BugReportOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          AI Debug Traces
        </Typography>
        <Box sx={{ flex: 1 }} />
        {isFetching && <CircularProgress size={12} />}
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => refetch()} sx={{ p: 0.25 }}>
            <RefreshOutlined sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Module filter — only shown when module prop not fixed */}
      {!module && (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            label="All"
            size="small"
            onClick={() => setActiveModule(undefined)}
            variant={activeModule == null ? 'filled' : 'outlined'}
            sx={{ height: 22, fontSize: '0.688rem' }}
          />
          {modules.map((m) => (
            <Chip
              key={m}
              label={m}
              size="small"
              onClick={() => setActiveModule(m === activeModule ? undefined : m)}
              variant={activeModule === m ? 'filled' : 'outlined'}
              sx={{
                height: 22, fontSize: '0.688rem',
                ...(activeModule === m && {
                  bgcolor: alpha(MODULE_COLORS[m] ?? tokens.indigo600, 0.12),
                  color: MODULE_COLORS[m] ?? tokens.indigo600,
                  borderColor: 'transparent',
                }),
              }}
            />
          ))}
        </Stack>
      )}

      {/* Purge controls */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.disabled" sx={{ flex: 1, alignSelf: 'center' }}>
          {traces.length} trace{traces.length !== 1 ? 's' : ''}
        </Typography>
        {[7, 30].map((d) => (
          <Button
            key={d}
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteOutlined />}
            onClick={() => purgeMut.mutate(d)}
            disabled={purgeMut.isPending}
            sx={{ fontSize: '0.688rem', py: 0.25, px: 1, minWidth: 0 }}
          >
            &gt;{d}d
          </Button>
        ))}
      </Stack>

      {/* Trace list */}
      <Box sx={{ maxHeight, overflowY: 'auto' }}>
        {traces.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', py: 3 }}>
            No traces yet. Use an AI feature to generate traces.
          </Typography>
        ) : (
          traces.map((t) => <TraceRow key={t.id} trace={t} />)
        )}
      </Box>
    </Box>
  )
}
