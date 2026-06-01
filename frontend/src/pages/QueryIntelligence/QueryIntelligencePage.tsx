import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Box, Typography, TextField, Button, Paper, Chip, CircularProgress,
  Alert, IconButton, Tooltip, Divider, Table, TableHead, TableRow,
  TableCell, TableBody, GlobalStyles, Collapse, Tabs, Tab,
  ToggleButtonGroup, ToggleButton, LinearProgress, Dialog,
  DialogTitle, DialogContent, DialogActions, Checkbox, Badge,
  Select, MenuItem, FormControl, InputLabel,
} from '@mui/material'
import {
  PsychologyOutlined, ContentCopyOutlined, PrintOutlined,
  ExpandMoreOutlined, ExpandLessOutlined, CheckCircleOutlineOutlined,
  WarningAmberOutlined, ErrorOutlineOutlined, LightbulbOutlined,
  SpeedOutlined, StorageOutlined, AutoFixHighOutlined,
  AccountTreeOutlined, BoltOutlined, VerifiedOutlined,
  BugReportOutlined, BookmarksOutlined, SaveOutlined,
  EditNoteOutlined, SwapHorizOutlined, TableChartOutlined,
  LinkOutlined, BarChartOutlined, ManageSearchOutlined,
  ChatOutlined, SendOutlined, SmartToyOutlined, PersonOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { queryIntelligenceApi, knowledgeApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type {
  QueryIntelligenceResult, QueryAntiPattern, QueryCostIssue,
  QueryExtractionResult, QueryEnhanceResult, QueryKbArtifact,
  QuerySourceObject, QueryFieldMapping, QueryJoinAnalysis,
  QueryBusinessRule, QueryKpiDetection, QueryAccountMapping,
  QueryValidationCheck, QueryTroubleshootingItem,
  QueryKbChatResponse,
} from '@/types'

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
  Simple: '#2e7d32', Moderate: '#e65100', Complex: '#b71c1c',
}
const SOURCE_TYPE_COLOR: Record<string, string> = {
  base_table:       '#1565c0',
  view:             '#6a1b9a',
  cte:              '#00695c',
  temp_table:       '#e65100',
  stored_procedure: '#c62828',
}
const RULE_TYPE_COLOR: Record<string, 'primary' | 'secondary' | 'warning' | 'info' | 'default'> = {
  CASE: 'primary', FILTER: 'warning', HARDCODED: 'secondary',
  COALESCE: 'info', DECODE: 'primary', IFF: 'primary',
}

function SeverityChip({ severity }: { severity: string }) {
  return (
    <Chip label={severity.toUpperCase()} size="small"
      color={SEVERITY_COLOR[severity] ?? 'default'} variant="outlined"
      sx={{ fontWeight: 700, fontSize: '0.62rem', height: 20 }} />
  )
}
function SectionHeader({ icon, title, count }: { icon: JSX.Element; title: string; count?: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      {icon}
      <Typography variant="subtitle2" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Typography>
      {count !== undefined && (
        <Chip label={count} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
      )}
    </Box>
  )
}
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handle = () => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Tooltip title={copied ? 'Copied!' : label}>
      <IconButton size="small" onClick={handle}><ContentCopyOutlined fontSize="small" /></IconButton>
    </Tooltip>
  )
}
function MonoBlock({ code }: { code: string }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}>
        <CopyButton text={code} label="Copy SQL" />
      </Box>
      <Box component="pre" sx={{
        m: 0, p: 2, pr: 5, fontFamily: 'monospace', fontSize: '0.78rem',
        bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {code}
      </Box>
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

// ══════════════════════════════════════════════════════════════════════════════
//  QUICK ANALYSIS — existing panels
// ══════════════════════════════════════════════════════════════════════════════

function AntiPatternList({ items }: { items: QueryAntiPattern[] }) {
  if (!items.length) return <Typography variant="body2" color="success.main">No anti-patterns detected.</Typography>
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
  if (!items.length) return <Typography variant="body2" color="success.main">No significant cost issues detected.</Typography>
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

function AnalysisResultsPanel({ result, sql }: { result: QueryIntelligenceResult; sql: string }) {
  const [showOriginal, setShowOriginal] = useState(false)
  return (
    <Box className="print-root">
      <Box className="print-header" sx={{ display: 'none', '@media print': { display: 'block' } }}>
        <Typography variant="h5" fontWeight={700}>Query Intelligence Report</Typography>
        <Typography variant="body2" color="text.secondary">{new Date().toLocaleString()}</Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <Alert severity="info" icon={<PsychologyOutlined />} sx={{ flex: 1, minWidth: 220, py: 0.5 }}>
          {result.summary}
        </Alert>
        <Chip label={result.complexity} sx={{ fontWeight: 700, color: 'white', bgcolor: COMPLEXITY_COLOR[result.complexity] ?? '#555' }} />
      </Box>

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

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<WarningAmberOutlined color="warning" />} title={`Anti-Patterns (${result.anti_patterns.length})`} />
        <AntiPatternList items={result.anti_patterns} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<SpeedOutlined color="error" />} title={`Performance Issues (${result.cost_issues.length})`} />
        <CostIssueList items={result.cost_issues} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<AutoFixHighOutlined color="success" />} title="Suggested Rewrite" />
        {result.suggested_rewrite
          ? <MonoBlock code={result.suggested_rewrite} />
          : <Typography variant="body2" color="success.main">No rewrite needed — query looks good.</Typography>}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="print-section">
        <SectionHeader icon={<StorageOutlined color="primary" />} title={`Index Recommendations (${result.index_recommendations.length})`} />
        {result.index_recommendations.length === 0
          ? <Typography variant="body2" color="text.secondary">No index recommendations.</Typography>
          : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Table</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Columns</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.index_recommendations.map((r, i) => (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.table}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{r.columns.join(', ')}</TableCell>
                    <TableCell>{r.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }} className="no-print">
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
          onClick={() => setShowOriginal((v) => !v)}>
          <Typography variant="subtitle2" fontWeight={600}>Original Query</Typography>
          {showOriginal ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
        </Box>
        <Collapse in={showOriginal}><MonoBlock code={sql} /></Collapse>
      </Paper>

      <Typography variant="caption" color="text.secondary" className="no-print">
        {result.tokens_in.toLocaleString()}↑ {result.tokens_out.toLocaleString()}↓ &nbsp;·&nbsp; {result.latency_ms.toLocaleString()} ms
      </Typography>
    </Box>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
//  EXTRACTION — tab sub-panels
// ══════════════════════════════════════════════════════════════════════════════

function OverviewTab({ r }: { r: QueryExtractionResult }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* session name banner */}
      <Alert severity="info" icon={<ManageSearchOutlined />} sx={{ py: 0.5 }}>
        <Typography variant="body2" fontWeight={700}>Session: {r.session_name}</Typography>
        <Typography variant="body2">{r.query_summary.purpose}</Typography>
      </Alert>

      {/* summary grid */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<LightbulbOutlined color="primary" />} title="Query Summary" />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1.5 }}>
          {[
            { label: 'KPI',    value: r.query_summary.kpi },
            { label: 'Domain', value: r.query_summary.domain },
            { label: 'Country', value: r.query_summary.country },
            { label: 'Process', value: r.query_summary.process },
          ].map(({ label, value }) => (
            <Box key={label} sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>{label.toUpperCase()}</Typography>
              <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>{value}</Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700}>BUSINESS OBJECTIVE</Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>{r.query_summary.business_objective}</Typography>
        </Box>
      </Paper>

      {/* KPI detection */}
      {r.kpi_detection.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <SectionHeader icon={<BarChartOutlined color="secondary" />} title="KPI Detection" count={r.kpi_detection.length} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {r.kpi_detection.map((k: QueryKpiDetection, i: number) => (
              <Box key={i} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight={600}>{k.kpi_name}</Typography>
                    <Chip label={`${Math.round(k.confidence * 100)}% confidence`} size="small"
                      color={k.confidence >= 0.8 ? 'success' : k.confidence >= 0.5 ? 'warning' : 'default'}
                      variant="outlined" sx={{ fontSize: '0.62rem', height: 20 }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">{k.evidence}</Typography>
                </Box>
                <LinearProgress variant="determinate" value={k.confidence * 100}
                  sx={{ width: 80, mt: 1, borderRadius: 1, height: 6 }} color={k.confidence >= 0.8 ? 'success' : 'warning'} />
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* source objects */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<StorageOutlined color="primary" />} title="Source Objects" count={r.source_objects.length} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {r.source_objects.map((obj: QuerySourceObject, i: number) => (
            <Box key={i} sx={{ p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider', minWidth: 180 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SOURCE_TYPE_COLOR[obj.type] ?? '#888' }} />
                <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {obj.schema ? `${obj.schema}.` : ''}{obj.name}
                </Typography>
              </Box>
              <Chip label={obj.type.replace('_', ' ')} size="small" sx={{ fontSize: '0.6rem', height: 18, mb: 0.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{obj.purpose}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  )
}

function FieldMappingTab({ r }: { r: QueryExtractionResult }) {
  const [filter, setFilter] = useState('')
  const items = filter
    ? r.field_mappings.filter((f: QueryFieldMapping) =>
        [f.output_field, f.source_table, f.source_field].some((v) => v.toLowerCase().includes(filter.toLowerCase()))
      )
    : r.field_mappings

  if (!r.field_mappings.length) {
    return <Typography variant="body2" color="text.secondary">No field mappings extracted.</Typography>
  }
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TextField size="small" placeholder="Filter fields…" value={filter}
          onChange={(e) => setFilter(e.target.value)} sx={{ width: 220 }} />
        <Typography variant="caption" color="text.secondary">{items.length} / {r.field_mappings.length} fields</Typography>
      </Box>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Output Field</TableCell>
            <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Source Table</TableCell>
            <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Source Field</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Transformation</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((f: QueryFieldMapping, i: number) => (
            <TableRow key={i} hover>
              <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.78rem' }}>{f.output_field}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', color: SOURCE_TYPE_COLOR.base_table }}>{f.source_table}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{f.source_field}</TableCell>
              <TableCell>
                {f.transformation_logic === 'Direct'
                  ? <Chip label="Direct" size="small" color="success" variant="outlined" sx={{ fontSize: '0.62rem', height: 18 }} />
                  : <Typography variant="body2" color="text.secondary" fontSize="0.78rem">{f.transformation_logic}</Typography>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}

function JoinsRulesTab({ r }: { r: QueryExtractionResult }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* joins */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<LinkOutlined color="primary" />} title="Join Analysis" count={r.join_analysis.length} />
        {!r.join_analysis.length
          ? <Typography variant="body2" color="text.secondary">No joins detected.</Typography>
          : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {r.join_analysis.map((j: QueryJoinAnalysis, i: number) => (
                <Box key={i} sx={{ p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Chip label={j.join_type} size="small" color="primary" variant="outlined" sx={{ fontWeight: 700, fontSize: '0.65rem', height: 20 }} />
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {j.left_table}
                    </Typography>
                    <SwapHorizOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                      {j.right_table}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                    {j.join_keys.join(' AND ')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{j.purpose}</Typography>
                </Box>
              ))}
            </Box>
          )}
      </Paper>

      {/* business rules */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<BoltOutlined color="warning" />} title="Business Rules" count={r.business_rules.length} />
        {!r.business_rules.length
          ? <Typography variant="body2" color="text.secondary">No business rules extracted.</Typography>
          : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, width: 120 }}>Rule Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Field</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Condition</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {r.business_rules.map((rule: QueryBusinessRule, i: number) => (
                  <TableRow key={i} hover>
                    <TableCell>
                      <Chip label={rule.rule_type} size="small"
                        color={RULE_TYPE_COLOR[rule.rule_type] ?? 'default'}
                        variant="outlined" sx={{ fontSize: '0.62rem', height: 18 }} />
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{rule.field ?? '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', maxWidth: 280, wordBreak: 'break-word' }}>{rule.condition}</TableCell>
                    <TableCell sx={{ fontSize: '0.78rem', maxWidth: 180, wordBreak: 'break-word' }}>{rule.result}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Paper>
    </Box>
  )
}

function AccountsLineageTab({ r }: { r: QueryExtractionResult }) {
  const [copiedMermaid, setCopiedMermaid] = useState(false)
  const copyMermaid = () => {
    navigator.clipboard.writeText(r.data_lineage.mermaid_diagram).catch(() => {})
    setCopiedMermaid(true)
    setTimeout(() => setCopiedMermaid(false), 1500)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* account mappings */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<TableChartOutlined color="primary" />} title="Account Mappings" count={r.account_mappings.length} />
        {!r.account_mappings.length
          ? <Typography variant="body2" color="text.secondary">No GL account codes detected.</Typography>
          : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, width: 130 }}>Account Number</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Account Name</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 100 }}>Indicator</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {r.account_mappings.map((a: QueryAccountMapping, i: number) => (
                  <TableRow key={i} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.85rem' }}>{a.account_number}</TableCell>
                    <TableCell>{a.account_name}</TableCell>
                    <TableCell>
                      {a.indicator
                        ? <Chip label={a.indicator} size="small"
                            color={a.indicator === 'Debit' ? 'error' : 'success'}
                            variant="outlined" sx={{ fontSize: '0.62rem', height: 18 }} />
                        : <Typography variant="body2" color="text.disabled">—</Typography>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Paper>

      {/* data lineage */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<AccountTreeOutlined color="secondary" />} title="Data Lineage" />
        {r.data_lineage.description && (
          <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.7 }}>{r.data_lineage.description}</Typography>
        )}
        {r.data_lineage.mermaid_diagram ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>MERMAID DIAGRAM</Typography>
              <Tooltip title={copiedMermaid ? 'Copied!' : 'Copy Mermaid code'}>
                <Button size="small" startIcon={<ContentCopyOutlined fontSize="small" />} onClick={copyMermaid} sx={{ fontSize: '0.72rem' }}>
                  {copiedMermaid ? 'Copied' : 'Copy'}
                </Button>
              </Tooltip>
            </Box>
            <Box component="pre" sx={{
              m: 0, p: 2, fontFamily: 'monospace', fontSize: '0.78rem',
              bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              borderLeft: 3, borderColor: 'secondary.main',
            }}>
              {r.data_lineage.mermaid_diagram}
            </Box>
            <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
              Paste this code into Mermaid Live Editor (mermaid.live) to render the diagram.
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">No lineage diagram generated.</Typography>
        )}
      </Paper>
    </Box>
  )
}

function ValidationTab({ r }: { r: QueryExtractionResult }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* validation guidance */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<VerifiedOutlined color="success" />} title="Validation Guidance" count={r.validation_guidance.length} />
        {!r.validation_guidance.length
          ? <Typography variant="body2" color="text.secondary">No validation checks generated.</Typography>
          : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {r.validation_guidance.map((v: QueryValidationCheck, i: number) => (
                <Box key={i} sx={{ p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Chip label={v.check_type} size="small" color="success" variant="outlined" sx={{ fontSize: '0.62rem', height: 18 }} />
                  </Box>
                  <Typography variant="body2" sx={{ mb: 0.75 }}>{v.description}</Typography>
                  {v.suggested_query && <MonoBlock code={v.suggested_query} />}
                </Box>
              ))}
            </Box>
          )}
      </Paper>

      {/* troubleshooting */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <SectionHeader icon={<BugReportOutlined color="error" />} title="Troubleshooting Guidance" count={r.troubleshooting_guidance.length} />
        {!r.troubleshooting_guidance.length
          ? <Typography variant="body2" color="text.secondary">No troubleshooting items generated.</Typography>
          : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {r.troubleshooting_guidance.map((t: QueryTroubleshootingItem, i: number) => (
                <Box key={i} sx={{ p: 1.5, borderRadius: 1, border: 1, borderColor: 'error.light', bgcolor: 'error.50' }}>
                  <Typography variant="body2" fontWeight={700} color="error.main" sx={{ mb: 0.25 }}>{t.issue}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                    <strong>Cause:</strong> {t.likely_cause}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    <strong>Resolution:</strong> {t.resolution_hint}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
      </Paper>
    </Box>
  )
}

// ── Schema + Session save dialog ──────────────────────────────────────────────

function KbSaveDialog({
  open, onClose, artifacts, sql, onSaved,
}: {
  open:      boolean
  onClose:   () => void
  artifacts: QueryKbArtifact[]
  sql:       string
  onSaved:   (ids: number[]) => void
}) {
  const [schemaId, setSchemaId]   = useState<number | ''>('')
  const [sessionId, setSessionId] = useState<number | ''>('')

  const { data: schemas = [] } = useQuery({
    queryKey: ['kb-schemas-qidialog'],
    queryFn:  () => knowledgeApi.listSchemas(),
    enabled:  open,
  })
  const { data: sessions = [] } = useQuery({
    queryKey: ['kb-sessions-qidialog', schemaId],
    queryFn:  () => knowledgeApi.listSessions({ kb_schema_id: schemaId as number, limit: 100 }),
    enabled:  open && !!schemaId,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      queryIntelligenceApi.saveToKb(
        artifacts,
        sql,
        schemaId  !== '' ? schemaId  : undefined,
        sessionId !== '' ? sessionId : undefined,
      ),
    onSuccess: (data) => {
      onSaved(data.ids)
      onClose()
    },
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SaveOutlined color="success" fontSize="small" />
        Save {artifacts.length} artifacts to Knowledge Base
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
          <FormControl fullWidth size="small" required>
            <InputLabel>KB Schema</InputLabel>
            <Select
              value={schemaId}
              label="KB Schema"
              onChange={(e) => { setSchemaId(e.target.value as number); setSessionId('') }}
            >
              {schemas.map((s: any) => (
                <MenuItem key={s.id} value={s.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color_hex ?? '#6366f1' }} />
                    {s.name}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small" disabled={!schemaId}>
            <InputLabel>Session (optional)</InputLabel>
            <Select
              value={sessionId}
              label="Session (optional)"
              onChange={(e) => setSessionId(e.target.value as number)}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {sessions.map((s: any) => (
                <MenuItem key={s.id} value={s.id}>{s.title}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {saveMutation.isError && (
            <Alert severity="error" sx={{ py: 0.5 }}>
              {(saveMutation.error as Error)?.message ?? 'Save failed.'}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saveMutation.isPending}>Cancel</Button>
        <Button
          variant="contained" color="success"
          disabled={!schemaId || saveMutation.isPending}
          startIcon={saveMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save to KB'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── KB Artifacts tab ──────────────────────────────────────────────────────────

function KbArtifactsTab({
  r, sql, onSaved,
}: { r: QueryExtractionResult; sql: string; onSaved: (ids: number[]) => void }) {
  const [selected, setSelected]       = useState<boolean[]>(r.kb_artifacts.map(() => true))
  const [expanded, setExpanded]       = useState<boolean[]>(r.kb_artifacts.map(() => false))
  const [dialogOpen, setDialogOpen]   = useState(false)
  const [saveResult, setSaveResult]   = useState<{ saved: number } | null>(null)

  const toggle       = (i: number) => setSelected((prev) => prev.map((v, j) => j === i ? !v : v))
  const toggleExpand = (i: number) => setExpanded((prev) => prev.map((v, j) => j === i ? !v : v))
  const selectedCount = selected.filter(Boolean).length
  const selectedArtifacts = r.kb_artifacts.filter((_, i) => selected[i]) as QueryKbArtifact[]

  const KB_TYPE_COLOR: Record<string, string> = {
    Process: '#1565c0', View: '#6a1b9a', Configuration: '#00695c',
    Lineage: '#e65100', Troubleshooting: '#c62828',
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {selectedCount} of {r.kb_artifacts.length} artifacts selected for saving
        </Typography>
        {saveResult
          ? <Alert severity="success" sx={{ py: 0, px: 1.5 }}>{saveResult.saved} KB entries saved!</Alert>
          : (
            <Button
              variant="contained" color="success" size="small"
              startIcon={<SaveOutlined />}
              disabled={selectedCount === 0}
              onClick={() => setDialogOpen(true)}
            >
              Save {selectedCount} to KB
            </Button>
          )}
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {r.kb_artifacts.map((art, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 0, overflow: 'hidden', opacity: selected[i] ? 1 : 0.45 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1, gap: 1, bgcolor: 'action.hover' }}>
              <Checkbox checked={selected[i]} onChange={() => toggle(i)} size="small" sx={{ p: 0.5 }} />
              <Chip label={art.kb_type} size="small"
                sx={{ fontSize: '0.62rem', height: 18, bgcolor: KB_TYPE_COLOR[art.kb_type] ?? '#555', color: 'white' }} />
              <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{art.title}</Typography>
              <IconButton size="small" onClick={() => toggleExpand(i)}>
                {expanded[i] ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
              </IconButton>
            </Box>
            <Collapse in={expanded[i]}>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.82rem' }}>
                  {art.content}
                </Typography>
              </Box>
            </Collapse>
          </Paper>
        ))}
      </Box>

      <KbSaveDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        artifacts={selectedArtifacts}
        sql={sql}
        onSaved={(ids) => {
          setSaveResult({ saved: ids.length })
          onSaved(ids)
        }}
      />
    </Box>
  )
}

// ── KB Chat tab ───────────────────────────────────────────────────────────────

interface ChatMsg {
  role:      'user' | 'assistant'
  text?:     string
  response?: QueryKbChatResponse
}

function KbChatTab({
  entryIds, sessionName, dialect, connId,
}: { entryIds: number[]; sessionName: string; dialect?: string; connId?: number }) {
  const [input, setInput]       = useState('')
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const bottomRef               = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const history = messages.map((m) => ({
    role:    m.role,
    content: m.role === 'user' ? (m.text ?? '') : (m.response?.explanation ?? ''),
  }))

  const chatMutation = useMutation({
    mutationFn: (question: string) =>
      queryIntelligenceApi.chat({
        question,
        entry_ids: entryIds,
        history,
        dialect,
        conn_id: connId,
      }),
    onSuccess: (data, question) => {
      setMessages((prev) => [
        ...prev,
        { role: 'user',      text: question },
        { role: 'assistant', response: data },
      ])
      setInput('')
    },
  })

  const handleSend = () => {
    const q = input.trim()
    if (!q || chatMutation.isPending) return
    chatMutation.mutate(q)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 420 }}>
      {/* header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <ChatOutlined color="primary" fontSize="small" />
        <Typography variant="subtitle2" fontWeight={700}>Chat — {sessionName}</Typography>
        <Chip label={`${entryIds.length} KB entries`} size="small" color="success" variant="outlined"
          sx={{ fontSize: '0.62rem', height: 18 }} />
      </Box>

      {/* messages area */}
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, pb: 1 }}>
        {messages.length === 0 && !chatMutation.isPending && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 1.5, opacity: 0.5 }}>
            <ChatOutlined sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary" align="center">
              Ask anything about this query — get an explanation and a generated SQL query.
            </Typography>
          </Box>
        )}

        {messages.map((msg, i) => (
          <Box key={i}>
            {msg.role === 'user' ? (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Paper variant="outlined" sx={{ p: 1.5, maxWidth: '80%', bgcolor: 'primary.50' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                    <PersonOutlined sx={{ fontSize: 14, color: 'primary.main' }} />
                    <Typography variant="caption" color="primary.main" fontWeight={700}>You</Typography>
                  </Box>
                  <Typography variant="body2">{msg.text}</Typography>
                </Paper>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <SmartToyOutlined sx={{ fontSize: 14, color: 'secondary.main' }} />
                  <Typography variant="caption" color="secondary.main" fontWeight={700}>KB Assistant</Typography>
                  {msg.response && (
                    <Typography variant="caption" color="text.disabled">
                      · {msg.response.tokens_in + msg.response.tokens_out} tokens · {msg.response.latency_ms} ms
                    </Typography>
                  )}
                </Box>

                {/* Explanation card */}
                {msg.response?.explanation && (
                  <Paper variant="outlined" sx={{ p: 2, borderLeft: 3, borderColor: 'primary.main' }}>
                    <Typography variant="caption" color="primary.main" fontWeight={700} sx={{ mb: 0.75, display: 'block' }}>
                      EXPLANATION
                    </Typography>
                    <Typography variant="body2" sx={{ lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                      {msg.response.explanation}
                    </Typography>
                  </Paper>
                )}

                {/* SQL card */}
                {msg.response?.sql_query && (
                  <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden', borderLeft: 3, borderColor: 'success.main' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 0.75, bgcolor: 'action.hover' }}>
                      <Typography variant="caption" color="success.main" fontWeight={700}>GENERATED SQL</Typography>
                      <CopyButton text={msg.response.sql_query} label="Copy SQL" />
                    </Box>
                    <Box component="pre" sx={{
                      m: 0, p: 2, fontFamily: 'monospace', fontSize: '0.78rem',
                      overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {msg.response.sql_query}
                    </Box>
                  </Paper>
                )}

                {/* Sources */}
                {msg.response?.sources && msg.response.sources.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {msg.response.sources.slice(0, 3).map((src, si) => (
                      <Chip key={si} label={`${src.title} (${Math.round(src.score * 100)}%)`}
                        size="small" variant="outlined" color="default"
                        sx={{ fontSize: '0.6rem', height: 18 }} />
                    ))}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        ))}

        {/* loading bubble */}
        {chatMutation.isPending && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SmartToyOutlined sx={{ fontSize: 14, color: 'secondary.main' }} />
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.secondary">Thinking…</Typography>
          </Box>
        )}

        {chatMutation.isError && (
          <Alert severity="error" sx={{ py: 0.5 }}>
            {(chatMutation.error as Error)?.message ?? 'Request failed.'}
          </Alert>
        )}

        <div ref={bottomRef} />
      </Box>

      {/* input */}
      <Box sx={{ pt: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1 }}>
        <TextField
          fullWidth size="small" multiline maxRows={4}
          placeholder="Ask about this query, its business rules, or request a SQL query…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          disabled={chatMutation.isPending}
        />
        <Button
          variant="contained" size="small" sx={{ minWidth: 44, px: 1.5 }}
          disabled={!input.trim() || chatMutation.isPending}
          onClick={handleSend}
        >
          {chatMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <SendOutlined fontSize="small" />}
        </Button>
      </Box>
    </Box>
  )
}

// ── full extraction results ────────────────────────────────────────────────────

function ExtractionResultsPanel({
  result, sql, dialect, connId,
}: { result: QueryExtractionResult; sql: string; dialect?: string; connId?: number }) {
  const [tab, setTab]         = useState(0)
  const [savedIds, setSavedIds] = useState<number[]>([])

  const handleSaved = (ids: number[]) => {
    setSavedIds(ids)
    setTab(6)  // jump to Chat tab automatically
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* session name + token bar */}
      <Box sx={{ pb: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Alert severity="success" icon={<ManageSearchOutlined />} sx={{ flex: 1, py: 0.25 }}>
          <Typography variant="body2" fontWeight={700}>{result.session_name}</Typography>
        </Alert>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {result.tokens_in.toLocaleString()}↑ {result.tokens_out.toLocaleString()}↓ &nbsp;·&nbsp; {result.latency_ms.toLocaleString()} ms
        </Typography>
      </Box>

      {/* tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, minHeight: 40 }}>
        <Tab label="Overview" icon={<LightbulbOutlined fontSize="small" />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.78rem' }} />
        <Tab label={`Field Mapping (${result.field_mappings.length})`} icon={<TableChartOutlined fontSize="small" />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.78rem' }} />
        <Tab label={`Joins & Rules (${result.join_analysis.length + result.business_rules.length})`} icon={<LinkOutlined fontSize="small" />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.78rem' }} />
        <Tab label="Accounts & Lineage" icon={<AccountTreeOutlined fontSize="small" />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.78rem' }} />
        <Tab label="Validation & Troubleshooting" icon={<VerifiedOutlined fontSize="small" />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.78rem' }} />
        <Tab
          label={
            <Badge badgeContent={savedIds.length || undefined} color="success">
              KB Artifacts ({result.kb_artifacts.length})
            </Badge>
          }
          icon={<BookmarksOutlined fontSize="small" />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.78rem' }}
        />
        <Tab
          disabled={savedIds.length === 0}
          label={
            <Badge variant="dot" color="primary" invisible={savedIds.length === 0}>
              Chat with KB
            </Badge>
          }
          icon={<ChatOutlined fontSize="small" />} iconPosition="start" sx={{ minHeight: 40, fontSize: '0.78rem' }}
        />
      </Tabs>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {tab === 0 && <OverviewTab r={result} />}
        {tab === 1 && <FieldMappingTab r={result} />}
        {tab === 2 && <JoinsRulesTab r={result} />}
        {tab === 3 && <AccountsLineageTab r={result} />}
        {tab === 4 && <ValidationTab r={result} />}
        {tab === 5 && <KbArtifactsTab r={result} sql={sql} onSaved={handleSaved} />}
        {tab === 6 && savedIds.length > 0 && (
          <KbChatTab
            entryIds={savedIds}
            sessionName={result.session_name}
            dialect={dialect}
            connId={connId}
          />
        )}
      </Box>
    </Box>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
//  QUERY ENHANCEMENT PANEL
// ══════════════════════════════════════════════════════════════════════════════

function EnhancementPanel({
  sql, dialect, connId,
}: { sql: string; dialect?: string; connId?: number }) {
  const [request, setRequest] = useState('')
  const [result, setResult] = useState<QueryEnhanceResult | null>(null)
  const [open, setOpen] = useState(false)

  const enhance = useMutation({
    mutationFn: () =>
      queryIntelligenceApi.enhance({
        sql,
        enhancement_request: request,
        dialect,
        conn_id: connId,
      }),
    onSuccess: (data) => {
      setResult(data)
      setOpen(true)
    },
  })

  return (
    <>
      <Box sx={{ borderTop: 1, borderColor: 'divider', px: 2.5, pt: 2, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <EditNoteOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant="caption" color="text.secondary" fontWeight={700}>ENHANCE QUERY</Typography>
        </Box>
        <TextField
          multiline minRows={2} fullWidth size="small"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. Add Product field, Add APRA dimension, Filter by country = AU, Optimize for large tables…"
        />
        <Button
          size="small" variant="outlined" fullWidth sx={{ mt: 1 }}
          startIcon={enhance.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighOutlined />}
          disabled={!request.trim() || enhance.isPending}
          onClick={() => enhance.mutate()}
        >
          {enhance.isPending ? 'Applying…' : 'Apply Enhancement'}
        </Button>
        {enhance.isError && (
          <Alert severity="error" sx={{ mt: 1, py: 0.25 }}>Enhancement failed.</Alert>
        )}
      </Box>

      {/* result dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHighOutlined color="success" />
          Enhanced SQL
        </DialogTitle>
        <DialogContent dividers>
          {result && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Alert severity="info">{result.changes_summary}</Alert>
              {result.warnings.length > 0 && (
                <Alert severity="warning">
                  {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </Alert>
              )}
              <MonoBlock code={result.revised_sql} />
              <Typography variant="caption" color="text.secondary">
                {result.tokens_in.toLocaleString()}↑ {result.tokens_out.toLocaleString()}↓ &nbsp;·&nbsp; {result.latency_ms.toLocaleString()} ms
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
          {result && (
            <Button variant="contained" onClick={() => {
              navigator.clipboard.writeText(result.revised_sql).catch(() => {})
              setOpen(false)
            }}>
              Copy & Close
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

type Mode = 'analyze' | 'extract'

export default function QueryIntelligencePage() {
  const themeMode        = useAppStore((s) => s.themeMode)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const isDark = themeMode === 'dark'

  const [sql, setSql]                   = useState('')
  const [extraContext, setExtraContext]  = useState('')
  const [showExtra, setShowExtra]        = useState(false)
  const [mode, setMode]                  = useState<Mode>('analyze')

  const [analysisResult, setAnalysisResult]   = useState<QueryIntelligenceResult | null>(null)
  const [extractionResult, setExtractionResult] = useState<QueryExtractionResult | null>(null)
  const [analyzedSql, setAnalyzedSql]         = useState('')

  const analyze = useMutation({
    mutationFn: () =>
      queryIntelligenceApi.analyze({
        sql,
        dialect:       activeConnection?.dialect ?? undefined,
        conn_id:       activeConnection?.id ?? undefined,
        extra_context: extraContext.trim() || undefined,
      }),
    onSuccess: (data) => { setAnalysisResult(data); setAnalyzedSql(sql) },
  })

  const extract = useMutation({
    mutationFn: () =>
      queryIntelligenceApi.extract({
        sql,
        dialect:       activeConnection?.dialect ?? undefined,
        conn_id:       activeConnection?.id ?? undefined,
        extra_context: extraContext.trim() || undefined,
      }),
    onSuccess: (data) => { setExtractionResult(data); setAnalyzedSql(sql) },
  })

  const isRunning = analyze.isPending || extract.isPending

  const handleRun = useCallback(() => {
    if (!sql.trim()) return
    setAnalysisResult(null)
    setExtractionResult(null)
    if (mode === 'analyze') analyze.mutate()
    else extract.mutate()
  }, [sql, mode, analyze, extract])

  const showEnhance = mode === 'extract' && extractionResult !== null

  return (
    <>
      {printStyles}

      <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* ── left: input panel ──────────────────────────────────────────── */}
        <Box className="no-print" sx={{
          width: { xs: '100%', md: 400 },
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: 1,
          borderColor: 'divider',
          overflow: 'hidden',
        }}>
          {/* header */}
          <Box sx={{ px: 2.5, pt: 2.5, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PsychologyOutlined color="primary" />
              <Typography variant="h6" fontWeight={700}>Query Intelligence</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Analyze SQL for anti-patterns, or deep-extract business knowledge and KB artifacts.
            </Typography>
          </Box>

          {/* scrollable form */}
          <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* mode toggle */}
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ mb: 0.75, display: 'block' }}>
                MODE
              </Typography>
              <ToggleButtonGroup
                value={mode} exclusive size="small" fullWidth
                onChange={(_, v) => { if (v) { setMode(v); setAnalysisResult(null); setExtractionResult(null) } }}
              >
                <ToggleButton value="analyze" sx={{ fontSize: '0.75rem', gap: 0.5 }}>
                  <SpeedOutlined sx={{ fontSize: 15 }} /> Quick Analyze
                </ToggleButton>
                <ToggleButton value="extract" sx={{ fontSize: '0.75rem', gap: 0.5 }}>
                  <ManageSearchOutlined sx={{ fontSize: 15 }} /> Deep Extract
                </ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
                {mode === 'analyze'
                  ? 'Intent, anti-patterns, performance issues, index recommendations'
                  : '11-section extraction: summary, field mapping, joins, rules, KPIs, lineage, KB artifacts'}
              </Typography>
            </Box>

            {/* active connection */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <StorageOutlined sx={{ fontSize: 15, color: 'text.secondary' }} />
              {activeConnection
                ? <Chip label={`${activeConnection.name} · ${activeConnection.dialect ?? activeConnection.source_type}`}
                    size="small" color="primary" variant="outlined" sx={{ fontWeight: 600, fontSize: '0.72rem' }} />
                : <Typography variant="caption" color="text.secondary">No connection — schema context unavailable</Typography>}
            </Box>

            {/* SQL input */}
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>
                SQL QUERY *
              </Typography>
              <TextField
                multiline minRows={12} maxRows={25} fullWidth
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                placeholder="SELECT * FROM Orders WHERE 1=1 ..."
                size="small"
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.82rem' } }}
              />
            </Box>

            {/* extra context */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', mb: 0.5 }}
                onClick={() => setShowExtra((v) => !v)}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>EXTRA CONTEXT (optional)</Typography>
                {showExtra ? <ExpandLessOutlined sx={{ fontSize: 14 }} /> : <ExpandMoreOutlined sx={{ fontSize: 14 }} />}
              </Box>
              <Collapse in={showExtra}>
                <TextField
                  multiline minRows={3} fullWidth
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  placeholder="e.g. This is an Australian GL query for UPR calculation…"
                  size="small"
                />
              </Collapse>
            </Box>
          </Box>

          {/* sticky action footer */}
          <Box sx={{
            px: 2.5, py: 2, borderTop: 1, borderColor: 'divider',
            bgcolor: isDark ? 'background.paper' : '#fafafa',
          }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained" fullWidth
                disabled={!sql.trim() || isRunning}
                startIcon={isRunning
                  ? <CircularProgress size={16} color="inherit" />
                  : mode === 'analyze' ? <PsychologyOutlined /> : <ManageSearchOutlined />}
                onClick={handleRun}
              >
                {isRunning
                  ? mode === 'analyze' ? 'Analyzing…' : 'Extracting…'
                  : mode === 'analyze' ? 'Analyze Query' : 'Extract Knowledge'}
              </Button>
              {(analysisResult || extractionResult) && (
                <Tooltip title="Print / Save PDF">
                  <Button variant="outlined" onClick={() => window.print()} sx={{ minWidth: 44, px: 1.5 }}>
                    <PrintOutlined fontSize="small" />
                  </Button>
                </Tooltip>
              )}
            </Box>
          </Box>

          {/* query enhancement (only after extraction) */}
          {showEnhance && (
            <EnhancementPanel
              sql={analyzedSql}
              dialect={activeConnection?.dialect}
              connId={activeConnection?.id}
            />
          )}
        </Box>

        {/* ── right: results panel ───────────────────────────────────────── */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, md: 3 }, display: 'flex', flexDirection: 'column' }}>

          {/* errors */}
          {(analyze.isError || extract.isError) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {((analyze.error || extract.error) as Error)?.message ?? 'Operation failed. Please try again.'}
            </Alert>
          )}

          {/* loading */}
          {isRunning && !analysisResult && !extractionResult && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: 2 }}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary">
                {mode === 'analyze' ? 'Analyzing query…' : 'Extracting knowledge (this may take 15-30 seconds)…'}
              </Typography>
            </Box>
          )}

          {/* empty state */}
          {!isRunning && !analysisResult && !extractionResult && !analyze.isError && !extract.isError && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70%', gap: 2, opacity: 0.45 }}>
              <PsychologyOutlined sx={{ fontSize: 64, color: 'text.disabled' }} />
              <Typography variant="body1" color="text.secondary" align="center">
                Paste a SQL query and click{' '}
                <strong>{mode === 'analyze' ? 'Analyze Query' : 'Extract Knowledge'}</strong>
              </Typography>
              <Typography variant="caption" color="text.disabled" align="center" sx={{ maxWidth: 400 }}>
                {mode === 'analyze'
                  ? 'Detects anti-patterns · Explains intent · Suggests rewrites · Recommends indexes'
                  : 'Query summary · Field mapping · Join analysis · Business rules · KPI detection · Account codes · Data lineage · Validation · Troubleshooting · KB artifacts'}
              </Typography>
            </Box>
          )}

          {/* quick analysis results */}
          {mode === 'analyze' && analysisResult && (
            <AnalysisResultsPanel result={analysisResult} sql={analyzedSql} />
          )}

          {/* extraction results */}
          {mode === 'extract' && extractionResult && (
            <ExtractionResultsPanel
              result={extractionResult}
              sql={analyzedSql}
              dialect={activeConnection?.dialect}
              connId={activeConnection?.id}
            />
          )}
        </Box>
      </Box>
    </>
  )
}
