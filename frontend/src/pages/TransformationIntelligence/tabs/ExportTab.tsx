import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  Chip, ToggleButtonGroup, ToggleButton, Divider,
} from '@mui/material'
import {
  CodeOutlined, ContentCopyOutlined, DownloadOutlined, AutoAwesomeOutlined,
} from '@mui/icons-material'
import { useMutation } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TIExportResult, TIReconQuery } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

const FORMATS = [
  { value: 'sql_server', label: 'SQL Server', color: TEAL },
  { value: 'snowflake',  label: 'Snowflake',  color: tokens.sky600 },
  { value: 'python',     label: 'Python',     color: PURPLE },
  { value: 'json',       label: 'JSON Spec',  color: tokens.amber600 },
  { value: 'xml',        label: 'XML Spec',   color: tokens.emerald600 },
]

interface Props { connId: number | null }

export default function ExportTab({ connId }: Props) {
  const { enqueueSnackbar } = useSnackbar()

  const [format, setFormat]       = useState('sql_server')
  const [exportResult, setExport] = useState<TIExportResult | null>(null)
  const [reconResult, setRecon]   = useState<{ queries: TIReconQuery[] } | null>(null)

  const exportMut = useMutation({
    mutationFn: () => transformationApi.exportRules(connId!, format),
    onSuccess: (data) => setExport(data),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const reconMut = useMutation({
    mutationFn: () => transformationApi.generateReconQueries(connId!),
    onSuccess: (data) => setRecon(data),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => enqueueSnackbar('Copied', { variant: 'success', autoHideDuration: 1200 }),
      () => enqueueSnackbar('Copy failed', { variant: 'error' }),
    )
  }

  function downloadFile(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const selectedFormat = FORMATS.find(f => f.value === format)

  return (
    <Box sx={{ p: 2.5 }}>
      {/* Format selector */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <CodeOutlined sx={{ fontSize: 16, color: selectedFormat?.color ?? TEAL }} />
          <Typography variant="body2" fontWeight={700}>Export Transformation Rules</Typography>
        </Box>
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary"
            sx={{ fontSize: '0.65rem', display: 'block', mb: 0.75, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Output Format
          </Typography>
          <ToggleButtonGroup
            value={format} exclusive
            onChange={(_, v) => v && setFormat(v)}
            size="small"
            sx={{ flexWrap: 'wrap', gap: 0.5 }}
          >
            {FORMATS.map(f => (
              <ToggleButton key={f.value} value={f.value}
                sx={{ fontSize: '0.72rem', px: 1.5, py: 0.5, textTransform: 'none',
                  '&.Mui-selected': { color: f.color, bgcolor: alpha(f.color, 0.1),
                    borderColor: alpha(f.color, 0.4) } }}>
                {f.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="contained" size="small"
            startIcon={exportMut.isPending ? <CircularProgress size={12} color="inherit" /> : <CodeOutlined />}
            disabled={!connId || exportMut.isPending}
            onClick={() => exportMut.mutate()}
            sx={{ bgcolor: selectedFormat?.color ?? TEAL, '&:hover': { filter: 'brightness(0.9)' } }}
          >
            {exportMut.isPending ? 'Generating…' : `Generate ${selectedFormat?.label ?? ''}`}
          </Button>
        </Box>
      </Paper>

      {/* Export output */}
      {exportResult && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary"
              sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
              {exportResult.filename}
            </Typography>
            <Button size="small" startIcon={<ContentCopyOutlined sx={{ fontSize: 12 }} />}
              onClick={() => copyToClipboard(exportResult.content)}
              sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75, minWidth: 0 }}>
              Copy
            </Button>
            <Button size="small" variant="outlined" startIcon={<DownloadOutlined sx={{ fontSize: 12 }} />}
              onClick={() => downloadFile(exportResult.content, exportResult.filename)}
              sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75, minWidth: 0 }}>
              Download
            </Button>
          </Box>
          <Box component="pre" sx={{ m: 0, p: 1.5,
            bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc',
            borderRadius: 1, fontSize: '0.7rem', fontFamily: 'monospace',
            color: selectedFormat?.color ?? TEAL,
            border: 1, borderColor: 'divider',
            maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {exportResult.content}
          </Box>
        </Paper>
      )}

      <Divider sx={{ my: 2 }}>
        <Typography variant="caption" color="text.disabled">Reconciliation</Typography>
      </Divider>

      {/* Reconciliation query generation */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <AutoAwesomeOutlined sx={{ fontSize: 16, color: PURPLE }} />
          <Typography variant="body2" fontWeight={700}>Generate Reconciliation Queries</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.25, fontSize: '0.75rem' }}>
          AI generates source/target SQL validation queries from your approved transformation rules.
          Use these with the Testing / Recon tab to validate conversions end-to-end.
        </Typography>
        <Button
          variant="outlined" size="small"
          startIcon={reconMut.isPending ? <CircularProgress size={12} /> : <AutoAwesomeOutlined />}
          disabled={!connId || reconMut.isPending}
          onClick={() => reconMut.mutate()}
          sx={{ fontSize: '0.75rem' }}
        >
          {reconMut.isPending ? 'Generating…' : 'Generate Reconciliation Queries'}
        </Button>
      </Paper>

      {reconResult && reconResult.queries.length > 0 && (
        <Stack spacing={1.5}>
          {reconResult.queries.map((q, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 1.75, borderRadius: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, flex: 1 }}>{q.name}</Typography>
                <Chip label={q.validation_type} size="small"
                  sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
              </Box>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.4 }}>Source SQL</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                    <Box component="pre" sx={{ m: 0, p: 0.75, bgcolor: alpha(TEAL, 0.04), borderRadius: 1,
                      fontSize: '0.65rem', fontFamily: 'monospace', color: TEAL, flex: 1,
                      overflowX: 'auto', border: 1, borderColor: 'divider' }}>
                      {q.source_sql}
                    </Box>
                    <Button size="small" onClick={() => copyToClipboard(q.source_sql)}
                      sx={{ minWidth: 0, px: 0.5, py: 0.25 }}>
                      <ContentCopyOutlined sx={{ fontSize: 12 }} />
                    </Button>
                  </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.4 }}>Target SQL</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                    <Box component="pre" sx={{ m: 0, p: 0.75, bgcolor: alpha(PURPLE, 0.04), borderRadius: 1,
                      fontSize: '0.65rem', fontFamily: 'monospace', color: PURPLE, flex: 1,
                      overflowX: 'auto', border: 1, borderColor: 'divider' }}>
                      {q.target_sql}
                    </Box>
                    <Button size="small" onClick={() => copyToClipboard(q.target_sql)}
                      sx={{ minWidth: 0, px: 0.5, py: 0.25 }}>
                      <ContentCopyOutlined sx={{ fontSize: 12 }} />
                    </Button>
                  </Box>
                </Box>
              </Box>
            </Paper>
          ))}
        </Stack>
      )}

      {reconResult && reconResult.queries.length === 0 && (
        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
          No reconciliation queries generated. Make sure you have approved rules first.
        </Alert>
      )}
    </Box>
  )
}
