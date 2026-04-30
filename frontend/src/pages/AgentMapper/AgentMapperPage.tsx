import { useState } from 'react'
import {
  Box, Typography, TextField, Button, Paper, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Tooltip,
  CircularProgress, Alert, Divider, alpha,
} from '@mui/material'
import {
  AutoAwesomeOutlined,
  ContentCopyOutlined,
  DownloadOutlined,
  RestoreOutlined,
  CheckOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentMapperApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type {
  AgentMapperResult,
  AgentMapperSession,
  AgentMapperGridRow,
} from '@/types'

// ── Type chip colors ──────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  base:       { bg: '#64748b22', text: '#64748b' },
  derived:    { bg: '#f59e0b22', text: '#b45309' },
  user:       { bg: '#0ea5e922', text: '#0369a1' },
  iterator:   { bg: '#1e3a5f22', text: '#1e3a5f' },
  reference:  { bg: '#8b5cf622', text: '#6d28d9' },
  extra:      { bg: '#10b98122', text: '#059669' },
  controller: { bg: '#6b728022', text: '#374151' },
  risk:       { bg: '#ef444422', text: '#b91c1c' },
}
const RULE_COLORS: Record<string, { bg: string; text: string }> = {
  OOTB:        { bg: '#22c55e22', text: '#15803d' },
  conditional: { bg: '#f97316'  + '22', text: '#c2410c' },
  direct:      { bg: '#3b82f622', text: '#1d4ed8' },
  reference:   { bg: '#8b5cf622', text: '#6d28d9' },
  extra:       { bg: '#10b98122', text: '#059669' },
}

function TypeChip({ label }: { label: string }) {
  const c = TYPE_COLORS[label] ?? { bg: '#e5e7eb', text: '#374151' }
  return (
    <Chip
      label={label}
      size="small"
      sx={{ bgcolor: c.bg, color: c.text, fontWeight: 700, fontSize: '0.68rem', height: 20, border: 'none' }}
    />
  )
}

function RuleChip({ label }: { label: string }) {
  const c = RULE_COLORS[label] ?? { bg: '#e5e7eb', text: '#374151' }
  return (
    <Chip
      label={label}
      size="small"
      sx={{ bgcolor: c.bg, color: c.text, fontWeight: 600, fontSize: '0.68rem', height: 20, border: 'none' }}
    />
  )
}

// ── Copy button with brief tick feedback ──────────────────────────────────────
function CopyButton({ text, size = 'small' }: { text: string; size?: 'small' | 'medium' }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'} arrow>
      <IconButton size={size} onClick={handle}>
        {copied ? <CheckOutlined sx={{ fontSize: 16, color: 'success.main' }} /> : <ContentCopyOutlined sx={{ fontSize: 16 }} />}
      </IconButton>
    </Tooltip>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        bgcolor: isDark ? 'rgba(255,255,255,.03)' : '#fafafa',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.disabled' }}>
          {title}
        </Typography>
        {badge && (
          <Chip label={badge} size="small" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, bgcolor: alpha(tokens.indigo600, 0.1), color: tokens.indigo700, border: 'none' }} />
        )}
      </Box>
      {children}
    </Paper>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mb: 0.5 }}>
      <Typography variant="caption" color="text.disabled" sx={{ minWidth: 90, fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{value}</Typography>
    </Box>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentMapperPage() {
  const activeProject = useAppStore((s) => s.activeProject)
  const qc = useQueryClient()

  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState<AgentMapperResult | null>(null)

  const generate = useMutation({
    mutationFn: () => agentMapperApi.generate(instruction.trim(), activeProject?.id),
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['agent-mapper-sessions'] })
    },
  })

  const { data: sessions = [] } = useQuery<AgentMapperSession[]>({
    queryKey: ['agent-mapper-sessions'],
    queryFn: () => agentMapperApi.sessions(20),
  })

  const restore = useMutation({
    mutationFn: (id: number) => agentMapperApi.session(id),
    onSuccess: (detail) => {
      setInstruction(detail.user_input)
      setResult({
        session_id:    detail.id,
        user_input:    detail.user_input,
        parsed_intent: detail.parsed_intent,
        mapping_model: detail.mapping_model,
        generated_xml: detail.generated_xml,
        grid:          detail.grid,
        tokens_in:     0,
        tokens_out:    0,
        latency_ms:    0,
      })
    },
  })

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([result.generated_xml], { type: 'application/xml' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${result.mapping_model.lob}_${result.mapping_model.entity}_${result.mapping_model.template_name}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <AutoAwesomeOutlined sx={{ color: tokens.indigo600, fontSize: 28 }} />
        <Box>
          <Typography variant="h5" fontWeight={700}>Agent Mapper</Typography>
          <Typography variant="caption" color="text.secondary">DCT Extract Manuscript Generator</Typography>
        </Box>
      </Box>

      {/* ① Instruction input */}
      <Section title="1 · User Instruction">
        <TextField
          fullWidth
          multiline
          minRows={2}
          placeholder='e.g. "Add VehicleVIN to Risk for Auto"'
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && instruction.trim() && !generate.isPending) {
              generate.mutate()
            }
          }}
          sx={{ mb: 1.5, '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.9rem' } }}
        />
        <Button
          variant="contained"
          startIcon={generate.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeOutlined />}
          disabled={!instruction.trim() || generate.isPending}
          onClick={() => generate.mutate()}
          sx={{ background: `linear-gradient(135deg, ${tokens.indigo600}, ${tokens.violet600})` }}
        >
          {generate.isPending ? 'Generating…' : 'Generate Manuscript'}
        </Button>

        {generate.isError && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {(generate.error as Error)?.message ?? 'Generation failed'}
          </Alert>
        )}
      </Section>

      {result && (
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* ② Intent */}
          <Section
            title="2 · Intent Extraction (AI)"
            badge={`gpt-4o-mini · ${result.latency_ms}ms · ${result.tokens_in}↑ ${result.tokens_out}↓`}
          >
            <KV label="entity" value={<TypeChip label={result.parsed_intent.entity} />} />
            <KV label="field"  value={result.parsed_intent.field || '—'} />
            <KV label="source" value={result.parsed_intent.source || '—'} />
            <KV label="type"   value={<TypeChip label={result.parsed_intent.type} />} />
            <KV label="lob"    value={result.parsed_intent.lob} />
          </Section>

          {/* ③ Mapping Model */}
          <Section title="3 · Mapping Model (Rule Engine)" badge={`template: ${result.mapping_model.template_name}`}>
            <KV label="target"  value={result.mapping_model.target ?? '(none — controller)'} />
            <KV label="inherit" value={result.mapping_model.inherit ?? '—'} />
            <KV label="include" value={result.mapping_model.include.join(', ') || '—'} />
            <KV label="lob"     value={result.mapping_model.lob} />
          </Section>

          {/* ④ Generated XML */}
          <Section title="4 · Generated Manuscript XML">
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 1 }}>
              <CopyButton text={result.generated_xml} />
              <Tooltip title="Download XML" arrow>
                <IconButton size="small" onClick={handleDownload}>
                  <DownloadOutlined sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
            <Box
              component="pre"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.78rem',
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                p: 1.5,
                overflow: 'auto',
                maxHeight: 320,
                m: 0,
                whiteSpace: 'pre',
              }}
            >
              {result.generated_xml}
            </Box>
          </Section>

          {/* ⑤ Mapping Grid */}
          {result.grid.length > 0 && (
            <Section title="5 · Mapping Grid" badge={`${result.grid.length} fieldMap${result.grid.length !== 1 ? 's' : ''}`}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {['Entity', 'Target Table', 'Target Field', 'Source', 'Type', 'Rule', 'Inherit'].map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.grid.map((row: AgentMapperGridRow, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontSize: '0.78rem' }}>{row.entity}</TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{row.target_table}</TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{row.target_field}</TableCell>
                        <TableCell sx={{ fontSize: '0.78rem', fontFamily: 'monospace', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <Tooltip title={row.source} arrow>
                            <span>{row.source}</span>
                          </Tooltip>
                        </TableCell>
                        <TableCell><TypeChip label={row.type} /></TableCell>
                        <TableCell><RuleChip label={row.rule} /></TableCell>
                        <TableCell sx={{ fontSize: '0.72rem', color: 'text.disabled', fontFamily: 'monospace' }}>
                          {row.inherit ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Section>
          )}
        </Box>
      )}

      {/* ⑥ History */}
      {sessions.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.disabled' }}>
            6 · History (last 20)
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mt: 1.5, borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['#', 'LOB', 'Entity', 'Template', 'Field', 'Time', ''].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 700, fontSize: '0.72rem' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>{s.id}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>{s.lob ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>{s.entity ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{s.mapping_type ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{s.field ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                      {new Date(s.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Tooltip title="Restore" arrow>
                        <IconButton
                          size="small"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(s.id)}
                        >
                          <RestoreOutlined sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  )
}
