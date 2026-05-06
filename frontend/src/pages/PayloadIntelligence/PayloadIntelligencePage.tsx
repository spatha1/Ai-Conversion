import { useState, useCallback } from 'react'
import {
  Box, Typography, Paper, Button, TextField, Chip, Stack, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, Divider, alpha,
  Tooltip, IconButton, CircularProgress,
} from '@mui/material'
import {
  ExpandMoreOutlined, UploadFileOutlined, AutoAwesomeOutlined,
  CheckCircleOutlineOutlined, WarningAmberOutlined, ErrorOutlineOutlined,
  InfoOutlined, HistoryOutlined, ContentCopyOutlined, RestoreOutlined,
  DataObjectOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { payloadApi } from '@/api'
import type { PayloadAnalysisResult, PayloadSession, PayloadIssue } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────
function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'success' : value >= 50 ? 'warning' : 'error'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
      <LinearProgress
        variant="determinate" value={value} color={color}
        sx={{ flex: 1, height: 6, borderRadius: 3 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 28, textAlign: 'right' }}>
        {value}%
      </Typography>
    </Box>
  )
}

const ISSUE_META: Record<PayloadIssue['issue_type'], { color: 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  missing_required: { color: 'error',   label: 'Missing' },
  null_value:       { color: 'warning', label: 'Null' },
  type_mismatch:    { color: 'warning', label: 'Type Mismatch' },
  unexpected_field: { color: 'info',    label: 'Unexpected' },
  format_error:     { color: 'error',   label: 'Format Error' },
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function PayloadIntelligencePage() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [payload, setPayload]         = useState('')
  const [targetSchema, setTargetSchema] = useState('')
  const [instructions, setInstructions] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [result, setResult]           = useState<PayloadAnalysisResult | null>(null)

  const { data: sessions = [] } = useQuery<PayloadSession[]>({
    queryKey: ['payloadSessions'],
    queryFn:  () => payloadApi.sessions(20),
  })

  const analyzeMut = useMutation({
    mutationFn: () =>
      payloadApi.analyze(payload, targetSchema || undefined, instructions || undefined, sessionName || undefined),
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['payloadSessions'] })
      enqueueSnackbar('Analysis complete', { variant: 'success' })
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      enqueueSnackbar(e.response?.data?.detail ?? 'Analysis failed', { variant: 'error' })
    },
  })

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      enqueueSnackbar('File too large (max 10 MB)', { variant: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => setPayload(ev.target?.result as string ?? '')
    reader.readAsText(file)
    e.target.value = ''
  }, [enqueueSnackbar])

  const handleRestoreSession = async (id: number) => {
    try {
      const data = await payloadApi.session(id)
      setResult(data)
      enqueueSnackbar('Session restored', { variant: 'info' })
    } catch {
      enqueueSnackbar('Failed to restore session', { variant: 'error' })
    }
  }

  const isValid = payload.trim().length > 0

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={3}>
        <DataObjectOutlined sx={{ fontSize: 22, color: 'primary.main' }} />
        <Typography variant="h6" fontWeight={700}>Payload Intelligence</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          Decompose large JSON payloads, map fields to your target schema, detect issues
        </Typography>
      </Stack>

      {/* ── Input Section ───────────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Typography variant="body2" fontWeight={700} mb={1.5}>JSON Payload</Typography>
        <Stack direction="row" spacing={1} mb={1}>
          <TextField
            size="small"
            placeholder="Session name (optional)"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            sx={{ width: 240, fontSize: '0.8rem' }}
            inputProps={{ sx: { fontSize: '0.8rem' } }}
          />
          <Button
            component="label"
            size="small"
            variant="outlined"
            startIcon={<UploadFileOutlined sx={{ fontSize: 15 }} />}
            sx={{ fontSize: '0.75rem' }}
          >
            Upload JSON
            <input type="file" accept=".json" hidden onChange={handleFileUpload} />
          </Button>
          <Box sx={{ flex: 1 }} />
          {payload && (
            <Tooltip title="Copy payload">
              <IconButton size="small" onClick={() => navigator.clipboard.writeText(payload)}>
                <ContentCopyOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <TextField
          multiline rows={8} fullWidth
          placeholder='Paste your JSON payload here, e.g. {"PolicyNumber": "POL-001", "Insured": {...}}'
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          inputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          sx={{ mb: 1.5 }}
        />

        <Typography variant="body2" fontWeight={700} mb={1}>Target Schema <Typography component="span" variant="caption" color="text.secondary">(optional)</Typography></Typography>
        <TextField
          multiline rows={3} fullWidth
          placeholder="Paste a JSON Schema, field list, XSD excerpt, or plain text like: PolicyNumber, EffectiveDate, InsuredName, VehicleVIN"
          value={targetSchema}
          onChange={(e) => setTargetSchema(e.target.value)}
          inputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          sx={{ mb: 1.5 }}
        />

        <Typography variant="body2" fontWeight={700} mb={1}>Instructions <Typography component="span" variant="caption" color="text.secondary">(optional)</Typography></Typography>
        <TextField
          multiline rows={2} fullWidth
          placeholder='e.g. "Flag all null date fields", "Only map Risk-level fields", "Highlight required fields"'
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          inputProps={{ sx: { fontSize: '0.8rem' } }}
          sx={{ mb: 2 }}
        />

        <Button
          variant="contained"
          startIcon={analyzeMut.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeOutlined sx={{ fontSize: 16 }} />}
          disabled={!isValid || analyzeMut.isPending}
          onClick={() => analyzeMut.mutate()}
        >
          {analyzeMut.isPending ? 'Analyzing…' : 'Analyze Payload'}
        </Button>
      </Paper>

      {/* ── Results Section ─────────────────────────────────────────────────── */}
      {result && (
        <>
          {/* AI trace chip row */}
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <AutoAwesomeOutlined sx={{ fontSize: 14, color: 'primary.main' }} />
            <Typography variant="caption" color="text.secondary">gpt-4o-mini</Typography>
            <Chip label={`${result.tokens_in + result.tokens_out} tokens`} size="small" sx={{ fontSize: '0.65rem', height: 18 }} />
            <Chip label={`${result.latency_ms}ms`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
          </Stack>

          {/* Narrative */}
          <Alert severity="info" sx={{ mb: 2, fontSize: '0.85rem' }}>
            {result.narrative}
          </Alert>

          {/* Components */}
          <Accordion defaultExpanded sx={{ mb: 1, borderRadius: 2, '&:before': { display: 'none' } }} variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Typography variant="body2" fontWeight={700}>
                Components
                <Chip label={result.components.length} size="small" sx={{ ml: 1, fontSize: '0.65rem', height: 18 }} />
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Stack spacing={1}>
                {result.components.map((c, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" spacing={1} alignItems="center" mb={0.3}>
                        <Typography variant="body2" fontWeight={600} fontSize="0.85rem">{c.name}</Typography>
                        <Chip label={c.type} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                        {c.row_count != null && (
                          <Chip label={`${c.row_count} rows`} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                        )}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" fontFamily="monospace">{c.path || '(root)'}</Typography>
                      {c.description && (
                        <Typography variant="body2" fontSize="0.78rem" color="text.secondary" display="block" mt={0.3}>{c.description}</Typography>
                      )}
                    </Box>
                  </Paper>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>

          {/* Field Mappings */}
          <Accordion defaultExpanded sx={{ mb: 1, borderRadius: 2, '&:before': { display: 'none' } }} variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Typography variant="body2" fontWeight={700}>
                Field Mappings
                <Chip label={result.field_mappings.length} size="small" sx={{ ml: 1, fontSize: '0.65rem', height: 18 }} />
                {result.field_mappings.filter((m) => m.confidence < 60).length > 0 && (
                  <Chip
                    label={`${result.field_mappings.filter((m) => m.confidence < 60).length} uncertain`}
                    size="small" color="warning" sx={{ ml: 0.5, fontSize: '0.65rem', height: 18 }}
                  />
                )}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {result.field_mappings.length === 0 ? (
                <Typography variant="caption" color="text.secondary">No field mappings — provide a target schema to enable field mapping</Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Source Path</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Target Field</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 160 }}>Confidence</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Note</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.field_mappings.map((m, i) => (
                      <TableRow key={i} hover sx={{ opacity: m.confidence < 60 ? 0.75 : 1 }}>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'primary.main' }}>{m.source_path}</TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace', fontWeight: 600 }}>{m.target_field}</TableCell>
                        <TableCell><ConfidenceBar value={m.confidence} /></TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{m.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </AccordionDetails>
          </Accordion>

          {/* Issues */}
          <Accordion defaultExpanded={result.issues.length > 0} sx={{ mb: 2, borderRadius: 2, '&:before': { display: 'none' } }} variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Typography variant="body2" fontWeight={700}>
                Issues
                <Chip
                  label={result.issues.length}
                  size="small"
                  color={result.issues.length > 0 ? 'error' : 'default'}
                  sx={{ ml: 1, fontSize: '0.65rem', height: 18 }}
                />
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {result.issues.length === 0 ? (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <CheckCircleOutlineOutlined sx={{ fontSize: 16, color: 'success.main' }} />
                  <Typography variant="caption" color="success.main">No issues detected</Typography>
                </Stack>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Field Path</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 130 }}>Issue Type</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Detail</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Suggestion</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.issues.map((issue, i) => {
                      const meta = ISSUE_META[issue.issue_type] ?? { color: 'default', label: issue.issue_type }
                      return (
                        <TableRow key={i} hover>
                          <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'error.main' }}>{issue.field_path}</TableCell>
                          <TableCell>
                            <Chip label={meta.label} size="small" color={meta.color} sx={{ fontSize: '0.68rem', height: 20 }} />
                          </TableCell>
                          <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{issue.detail}</TableCell>
                          <TableCell sx={{ fontSize: '0.75rem' }}>{issue.suggestion}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </AccordionDetails>
          </Accordion>
        </>
      )}

      {/* ── History Section ─────────────────────────────────────────────────── */}
      <Divider sx={{ my: 2 }} />
      <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
        <HistoryOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant="body2" fontWeight={700} color="text.secondary">Session History</Typography>
        <Chip label={sessions.length} size="small" sx={{ fontSize: '0.65rem', height: 18 }} />
      </Stack>

      {sessions.length === 0 ? (
        <Typography variant="caption" color="text.disabled">No sessions yet — run your first analysis above</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem' }}>Summary</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.72rem', width: 80 }}>When</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id} hover>
                <TableCell sx={{ fontSize: '0.8rem', fontWeight: 500 }}>{s.name ?? `Session #${s.id}`}</TableCell>
                <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary', maxWidth: 0, width: '60%' }}>
                  <Typography variant="body2" fontSize="0.75rem" color="text.secondary"
                    sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {s.narrative ?? '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                  {formatRelative(s.created_at)}
                </TableCell>
                <TableCell>
                  <Tooltip title="Restore session">
                    <IconButton size="small" onClick={() => handleRestoreSession(s.id)}>
                      <RestoreOutlined sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  )
}
