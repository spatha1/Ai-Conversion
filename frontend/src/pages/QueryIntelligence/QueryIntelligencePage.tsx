import { useState, useCallback } from 'react'
import {
  Box, Typography, TextField, Button, Paper, Chip, CircularProgress,
  Alert, IconButton, Tooltip, Divider, Table, TableHead, TableRow,
  TableCell, TableBody, GlobalStyles, Collapse,
} from '@mui/material'
import {
  PsychologyOutlined,
  ContentCopyOutlined,
  PrintOutlined,
  ExpandMoreOutlined,
  ExpandLessOutlined,
  CheckCircleOutlineOutlined,
  WarningAmberOutlined,
  ErrorOutlineOutlined,
  LightbulbOutlined,
  SpeedOutlined,
  StorageOutlined,
  AutoFixHighOutlined,
} from '@mui/icons-material'
import { useMutation } from '@tanstack/react-query'
import { queryIntelligenceApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { QueryIntelligenceResult, QueryAntiPattern, QueryCostIssue } from '@/types'

// ── helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, 'success' | 'warning' | 'error'> = {
  low: 'success', medium: 'warning', high: 'error',
}

const SEVERITY_ICON: Record<string, JSX.Element> = {
  low:    <CheckCircleOutlineOutlined fontSize="small" color="success" />,
  medium: <WarningAmberOutlined      fontSize="small" color="warning" />,
  high:   <ErrorOutlineOutlined      fontSize="small" color="error"   />,
}

const COMPLEXITY_COLOR: Record<string, string> = {
  Simple:   '#2e7d32',
  Moderate: '#e65100',
  Complex:  '#b71c1c',
}

function SeverityChip({ severity }: { severity: string }) {
  return (
    <Chip
      label={severity.toUpperCase()}
      size="small"
      color={SEVERITY_COLOR[severity] ?? 'default'}
      variant="outlined"
      sx={{ fontWeight: 700, fontSize: '0.62rem', height: 20 }}
    />
  )
}

function SectionHeader({ icon, title }: { icon: JSX.Element; title: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      {icon}
      <Typography variant="subtitle2" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Typography>
    </Box>
  )
}

// ── print styles ──────────────────────────────────────────────────────────────

const printStyles = (
  <GlobalStyles styles={`
    @media print {
      .no-print { display: none !important; }
      .print-root { max-width: 210mm; margin: 0 auto; padding: 10mm; }
      .print-header { margin-bottom: 8mm; border-bottom: 2px solid #333; padding-bottom: 4mm; }
      .print-section { page-break-inside: avoid; margin-bottom: 6mm; border: 1px solid #ccc; padding: 4mm; border-radius: 4px; }
      body { background: white !important; }
      nav, header, aside { display: none !important; }
      * { box-shadow: none !important; }
    }
  `} />
)

// ── sub-components ────────────────────────────────────────────────────────────

function AntiPatternList({ items }: { items: QueryAntiPattern[] }) {
  if (!items.length) {
    return <Typography variant="body2" color="success.main">No anti-patterns detected.</Typography>
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((p, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <Box sx={{ mt: 0.1 }}>{SEVERITY_ICON[p.severity] ?? SEVERITY_ICON.medium}</Box>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
              <Typography variant="body2" fontWeight={600}>{p.type}</Typography>
              <SeverityChip severity={p.severity} />
            </Box>
            <Typography variant="body2" color="text.secondary">{p.description}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function CostIssueList({ items }: { items: QueryCostIssue[] }) {
  if (!items.length) {
    return <Typography variant="body2" color="success.main">No significant cost issues detected.</Typography>
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((c, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
          <Box sx={{ mt: 0.1 }}>{SEVERITY_ICON[c.severity] ?? SEVERITY_ICON.medium}</Box>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
              <Typography variant="body2" fontWeight={600}>{c.issue}</Typography>
              <SeverityChip severity={c.severity} />
            </Box>
            <Typography variant="body2" color="text.secondary">{c.impact}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function RewriteBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(sql).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!sql) {
    return <Typography variant="body2" color="success.main">No rewrite needed — query looks good.</Typography>
  }

  return (
    <Box sx={{ position: 'relative' }}>
      <Tooltip title={copied ? 'Copied!' : 'Copy SQL'}>
        <IconButton
          size="small"
          onClick={handleCopy}
          sx={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}
          className="no-print"
        >
          <ContentCopyOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
      <Box
        component="pre"
        sx={{
          m: 0, p: 2, pr: 5,
          fontFamily: 'monospace',
          fontSize: '0.78rem',
          bgcolor: 'action.hover',
          borderRadius: 1,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {sql}
      </Box>
    </Box>
  )
}

function IndexTable({ items }: { items: QueryIntelligenceResult['index_recommendations'] }) {
  if (!items.length) {
    return <Typography variant="body2" color="text.secondary">No index recommendations.</Typography>
  }
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 700 }}>Table</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Columns</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((r, i) => (
          <TableRow key={i} hover>
            <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.table}</TableCell>
            <TableCell sx={{ fontFamily: 'monospace' }}>{r.columns.join(', ')}</TableCell>
            <TableCell>{r.reason}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── results panel ─────────────────────────────────────────────────────────────

function ResultsPanel({ result, sql }: { result: QueryIntelligenceResult; sql: string }) {
  const [showOriginal, setShowOriginal] = useState(false)
  const now = new Date().toLocaleString()

  return (
    <Box className="print-root">
      {/* print header (hidden on screen) */}
      <Box
        className="print-header"
        sx={{ display: 'none', '@media print': { display: 'block' } }}
      >
        <Typography variant="h5" fontWeight={700}>Query Intelligence Report</Typography>
        <Typography variant="body2" color="text.secondary">{now}</Typography>
        <Typography variant="body2" sx={{ mt: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}>
          {sql.slice(0, 300)}{sql.length > 300 ? '…' : ''}
        </Typography>
      </Box>

      {/* summary + meta row */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <Alert
          severity="info"
          icon={<PsychologyOutlined />}
          sx={{ flex: 1, minWidth: 220, py: 0.5 }}
        >
          {result.summary}
        </Alert>
        <Chip
          label={result.complexity}
          sx={{
            fontWeight: 700,
            color: 'white',
            bgcolor: COMPLEXITY_COLOR[result.complexity] ?? '#555',
          }}
        />
      </Box>

      {/* intent */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<LightbulbOutlined color="primary" />} title="Query Intent" />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>BUSINESS PURPOSE</Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>{result.intent.business}</Typography>
          </Box>
          <Divider />
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>TECHNICAL BREAKDOWN</Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>{result.intent.technical}</Typography>
          </Box>
        </Box>
      </Paper>

      {/* anti-patterns */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<WarningAmberOutlined color="warning" />} title={`Anti-Patterns (${result.anti_patterns.length})`} />
        <AntiPatternList items={result.anti_patterns} />
      </Paper>

      {/* cost issues */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<SpeedOutlined color="error" />} title={`Performance Issues (${result.cost_issues.length})`} />
        <CostIssueList items={result.cost_issues} />
      </Paper>

      {/* suggested rewrite */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<AutoFixHighOutlined color="success" />} title="Suggested Rewrite" />
        <RewriteBlock sql={result.suggested_rewrite} />
      </Paper>

      {/* index recommendations */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<StorageOutlined color="primary" />} title={`Index Recommendations (${result.index_recommendations.length})`} />
        <IndexTable items={result.index_recommendations} />
      </Paper>

      {/* original query toggle */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="no-print">
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          onClick={() => setShowOriginal((v) => !v)}
        >
          <Typography variant="subtitle2" fontWeight={600}>Original Query</Typography>
          {showOriginal ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
        </Box>
        <Collapse in={showOriginal}>
          <Box
            component="pre"
            sx={{
              mt: 1.5, m: 0, p: 2,
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              bgcolor: 'action.hover',
              borderRadius: 1,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {sql}
          </Box>
        </Collapse>
      </Paper>

      {/* token / latency footer */}
      <Typography variant="caption" color="text.secondary" className="no-print">
        {result.tokens_in.toLocaleString()}↑ {result.tokens_out.toLocaleString()}↓ &nbsp;·&nbsp; {result.latency_ms.toLocaleString()} ms
      </Typography>
    </Box>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function QueryIntelligencePage() {
  const themeMode        = useAppStore((s) => s.themeMode)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const isDark = themeMode === 'dark'

  const [sql, setSql]                  = useState('')
  const [extraContext, setExtraContext] = useState('')
  const [showExtra, setShowExtra]      = useState(false)
  const [result, setResult]            = useState<QueryIntelligenceResult | null>(null)
  const [analyzedSql, setAnalyzedSql]  = useState('')

  const analyze = useMutation({
    mutationFn: () =>
      queryIntelligenceApi.analyze({
        sql,
        dialect:       activeConnection?.dialect ?? undefined,
        conn_id:       activeConnection?.id ?? undefined,
        extra_context: extraContext.trim() || undefined,
      }),
    onSuccess: (data) => {
      setResult(data)
      setAnalyzedSql(sql)
    },
  })

  const handleAnalyze = useCallback(() => {
    if (!sql.trim()) return
    setResult(null)
    analyze.mutate()
  }, [sql, analyze])

  const handlePrint = () => window.print()

  return (
    <>
      {printStyles}

      <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* ── left: input panel ─────────────────────────────────────────── */}
        <Box
          className="no-print"
          sx={{
            width: { xs: '100%', md: 380 },
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: 1,
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          {/* header */}
          <Box sx={{ px: 2.5, pt: 2.5, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PsychologyOutlined color="primary" />
              <Typography variant="h6" fontWeight={700}>Query Intelligence</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Paste any SQL query to get intent analysis, anti-pattern detection, and optimization suggestions.
            </Typography>
          </Box>

          {/* scrollable form */}
          <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* active connection indicator */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <StorageOutlined sx={{ fontSize: 15, color: 'text.secondary' }} />
              {activeConnection ? (
                <Chip
                  label={`${activeConnection.name} · ${activeConnection.dialect ?? activeConnection.source_type}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ fontWeight: 600, fontSize: '0.72rem' }}
                />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  No connection selected — schema context unavailable
                </Typography>
              )}
            </Box>

            {/* SQL input */}
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
                SQL QUERY *
              </Typography>
              <TextField
                multiline
                minRows={12}
                maxRows={25}
                fullWidth
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder="SELECT * FROM Orders WHERE 1=1 ..."
                size="small"
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.82rem' } }}
              />
            </Box>

            {/* extra context (collapsible) */}
            <Box>
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', mb: 0.5 }}
                onClick={() => setShowExtra((v) => !v)}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  EXTRA CONTEXT (optional)
                </Typography>
                {showExtra ? <ExpandLessOutlined sx={{ fontSize: 14 }} /> : <ExpandMoreOutlined sx={{ fontSize: 14 }} />}
              </Box>
              <Collapse in={showExtra}>
                <TextField
                  multiline
                  minRows={3}
                  fullWidth
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  placeholder="e.g. This query runs on 50M row tables, peak hours at 09:00 UTC..."
                  size="small"
                />
              </Collapse>
            </Box>
          </Box>

          {/* sticky footer buttons */}
          <Box
            sx={{
              px: 2.5, py: 2,
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              gap: 1,
              bgcolor: isDark ? 'background.paper' : '#fafafa',
            }}
          >
            <Button
              variant="contained"
              fullWidth
              disabled={!sql.trim() || analyze.isPending}
              startIcon={analyze.isPending ? <CircularProgress size={16} color="inherit" /> : <PsychologyOutlined />}
              onClick={handleAnalyze}
            >
              {analyze.isPending ? 'Analyzing…' : 'Analyze Query'}
            </Button>
            {result && (
              <Tooltip title="Print / Save PDF">
                <Button variant="outlined" onClick={handlePrint} sx={{ minWidth: 44, px: 1.5 }}>
                  <PrintOutlined fontSize="small" />
                </Button>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* ── right: results panel ───────────────────────────────────────── */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 } }}>

          {/* error */}
          {analyze.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {(analyze.error as Error)?.message ?? 'Analysis failed. Please try again.'}
            </Alert>
          )}

          {/* loading skeleton */}
          {analyze.isPending && !result && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 2 }}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary">Analyzing query…</Typography>
            </Box>
          )}

          {/* empty state */}
          {!analyze.isPending && !result && !analyze.isError && (
            <Box
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '70%', gap: 2, opacity: 0.45,
              }}
            >
              <PsychologyOutlined sx={{ fontSize: 64, color: 'text.disabled' }} />
              <Typography variant="body1" color="text.secondary" align="center">
                Paste a SQL query on the left and click <strong>Analyze Query</strong>
              </Typography>
              <Typography variant="caption" color="text.disabled" align="center">
                Detects anti-patterns · Explains intent · Suggests rewrites · Recommends indexes
              </Typography>
            </Box>
          )}

          {/* results */}
          {result && <ResultsPanel result={result} sql={analyzedSql} />}
        </Box>
      </Box>
    </>
  )
}
