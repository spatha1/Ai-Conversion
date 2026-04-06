/**
 * AIDebugPanel — right-side Drawer with 3 tabs:
 *   1. AI Prompt  — intent / constraints / system prompt / schema
 *   2. Template JSON — full dashboard config viewer
 *   3. Widgets  — list + SQL editor + field mapping + per-widget regenerate
 */
import { useState, useEffect } from 'react'
import {
  Drawer, Box, Tabs, Tab, Typography, IconButton, Tooltip,
  Divider, Chip, Button, TextField, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails,
  List, ListItemButton, ListItemText, ListItemIcon,
  Alert, alpha,
} from '@mui/material'
import {
  CloseOutlined, ContentCopyOutlined, ExpandMoreOutlined,
  PlayArrowOutlined, AutoAwesomeOutlined, CheckOutlined,
  BarChartOutlined, TrendingUpOutlined, PieChartOutlined,
  TableChartOutlined, NumbersOutlined, BugReportOutlined,
  CodeOutlined, SchemaOutlined, AutoFixHighOutlined,
} from '@mui/icons-material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { connectionsApi, myDashboardsApi } from '@/api'
import type { DashboardConfigSchema, DashboardDebugMeta, DashboardWidget } from '@/types'

// ── helpers ───────────────────────────────────────────────────────────────────

const WIDGET_ICONS: Record<DashboardWidget['type'], React.ReactNode> = {
  kpi:      <NumbersOutlined fontSize="small" />,
  bar:      <BarChartOutlined fontSize="small" />,
  line:     <TrendingUpOutlined fontSize="small" />,
  pie:      <PieChartOutlined fontSize="small" />,
  doughnut: <PieChartOutlined fontSize="small" />,
  table:    <TableChartOutlined fontSize="small" />,
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <IconButton size="small" onClick={copy}>
        {copied ? <CheckOutlined fontSize="small" color="success" /> : <ContentCopyOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      fontWeight={700}
      sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary', mb: 0.5, display: 'block' }}
    >
      {children}
    </Typography>
  )
}

function MonoBox({ text, maxH = 180 }: { text: string; maxH?: number }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0, p: 1.5, borderRadius: 1,
        bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#000', 0.4) : alpha('#000', 0.04),
        border: '1px solid', borderColor: 'divider',
        fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.6,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: maxH, overflowY: 'auto',
      }}
    >
      {text}
    </Box>
  )
}

// ── Tab 1: AI Prompt ──────────────────────────────────────────────────────────

function PromptTab({ debug }: { debug: DashboardDebugMeta }) {
  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Source SQL (SQL-mode dashboards) */}
      {debug.source_sql && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <SectionLabel>Source SQL Query</SectionLabel>
            <CopyButton text={debug.source_sql} />
          </Box>
          <MonoBox text={debug.source_sql} maxH={160} />
        </Box>
      )}

      {/* Intent */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionLabel>{debug.source_sql ? 'Visualization Hint' : 'User Intent'}</SectionLabel>
          <CopyButton text={debug.user_prompt} />
        </Box>
        <MonoBox text={debug.user_prompt} maxH={100} />
      </Box>

      {/* Constraints */}
      {debug.constraints && (
        <Box>
          <SectionLabel>Constraints</SectionLabel>
          <MonoBox text={debug.constraints} maxH={80} />
        </Box>
      )}

      {/* Query Context */}
      {debug.query_context && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <SectionLabel>Query Context (from Admin)</SectionLabel>
            <CopyButton text={debug.query_context} />
          </Box>
          <MonoBox text={debug.query_context} maxH={120} />
        </Box>
      )}

      {/* Model */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SectionLabel>Model</SectionLabel>
        <Chip label={debug.model} size="small" color="primary" variant="outlined" />
      </Box>

      <Divider />

      {/* System Prompt */}
      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoFixHighOutlined fontSize="small" color="primary" />
            <Typography variant="body2" fontWeight={600}>System Prompt</Typography>
            <Chip label={`${debug.system_prompt.length} chars`} size="small" />
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, pb: 1, px: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
            <CopyButton text={debug.system_prompt} />
          </Box>
          <MonoBox text={debug.system_prompt} maxH={300} />
        </AccordionDetails>
      </Accordion>

      {/* Schema */}
      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SchemaOutlined fontSize="small" color="secondary" />
            <Typography variant="body2" fontWeight={600}>Schema Used</Typography>
            <Chip label={`${debug.schema_text.split('\n').filter(l => l.startsWith('Table:')).length} tables`} size="small" />
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, pb: 1, px: 1.5 }}>
          <MonoBox text={debug.schema_text} maxH={250} />
        </AccordionDetails>
      </Accordion>

      {/* Relationships */}
      {debug.relationships_text && debug.relationships_text !== 'No relationships found.' && (
        <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}>
            <Typography variant="body2" fontWeight={600}>Relationships</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0, pb: 1, px: 1.5 }}>
            <MonoBox text={debug.relationships_text} maxH={150} />
          </AccordionDetails>
        </Accordion>
      )}

      {/* Full user prompt sent to LLM */}
      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}>
          <Typography variant="body2" fontWeight={600}>Full Message Sent to LLM</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, pb: 1, px: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
            <CopyButton text={debug.full_user_prompt} />
          </Box>
          <MonoBox text={debug.full_user_prompt} maxH={300} />
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}

// ── Tab 2: Template JSON ──────────────────────────────────────────────────────

function TemplateTab({ config }: { config: DashboardConfigSchema }) {
  const formatted = JSON.stringify(config, null, 2)
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="body2" fontWeight={600}>Dashboard Config JSON</Typography>
        <CopyButton text={formatted} />
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0, p: 1.5, borderRadius: 1,
          bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#000', 0.4) : alpha('#000', 0.04),
          border: '1px solid', borderColor: 'divider',
          fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          overflowY: 'auto',
          maxHeight: 'calc(100vh - 200px)',
        }}
      >
        {formatted}
      </Box>
    </Box>
  )
}

// ── Tab 3: Widgets ────────────────────────────────────────────────────────────

function WidgetsTab({
  config,
  connId,
  originalIntent,
  onWidgetUpdate,
}: {
  config: DashboardConfigSchema
  connId: number
  originalIntent: string
  onWidgetUpdate: (widget: DashboardWidget) => void
}) {
  const { enqueueSnackbar } = useSnackbar()
  const [selectedId, setSelectedId]   = useState<string>(config.widgets[0]?.id ?? '')
  const [editSql, setEditSql]         = useState('')
  const [refinement, setRefinement]   = useState('')
  const [queryResult, setQueryResult] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [queryError, setQueryError]   = useState<string | null>(null)

  const selected = config.widgets.find((w) => w.id === selectedId) ?? config.widgets[0]

  // When user selects a different widget, reset SQL editor to that widget's SQL
  const handleSelect = (id: string) => {
    setSelectedId(id)
    const w = config.widgets.find((ww) => ww.id === id)
    setEditSql(w?.dataBinding.sql ?? '')
    setQueryResult(null)
    setQueryError(null)
    setRefinement('')
  }

  // Sync editor when the selected widget's SQL changes from outside (e.g. regenerate)
  useEffect(() => {
    if (selected) setEditSql(selected.dataBinding.sql)
  }, [selected?.dataBinding.sql])  // eslint-disable-line react-hooks/exhaustive-deps

  // Run query mutation
  const runMutation = useMutation({
    mutationFn: () => connectionsApi.runQuery(connId, editSql),
    onSuccess: (r) => {
      setQueryResult(r)
      setQueryError(null)
    },
    onError: (e: Error) => {
      setQueryError(e.message)
      setQueryResult(null)
    },
  })

  // Apply SQL change to widget (updates widget in parent config)
  const handleApplySql = () => {
    if (!selected) return
    onWidgetUpdate({ ...selected, dataBinding: { ...selected.dataBinding, sql: editSql } })
    enqueueSnackbar('SQL updated on widget', { variant: 'success' })
  }

  // Regenerate widget mutation
  const regenMutation = useMutation({
    mutationFn: () =>
      myDashboardsApi.regenerateWidget(
        selected.id,
        selected,
        refinement,
        connId,
        originalIntent,
      ),
    onSuccess: (r) => {
      onWidgetUpdate(r.widget)
      setEditSql(r.widget.dataBinding.sql)
      setRefinement('')
      setQueryResult(null)
      enqueueSnackbar('Widget regenerated!', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  if (!selected) return <Typography sx={{ p: 2 }}>No widgets</Typography>

  const binding = selected.dataBinding

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Widget list */}
      <Box sx={{ width: 160, flexShrink: 0, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
        <List dense disablePadding>
          {config.widgets.map((w) => (
            <ListItemButton
              key={w.id}
              selected={w.id === selectedId}
              onClick={() => handleSelect(w.id)}
              sx={{ px: 1.5, py: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: w.id === selectedId ? 'primary.main' : 'text.secondary' }}>
                {WIDGET_ICONS[w.type]}
              </ListItemIcon>
              <ListItemText
                primary={w.title}
                secondary={w.type}
                primaryTypographyProps={{ variant: 'caption', fontWeight: w.id === selectedId ? 700 : 400, noWrap: true }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>

      {/* Widget detail */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip icon={<>{WIDGET_ICONS[selected.type]}</>} label={selected.type} size="small" color="primary" variant="outlined" />
          <Typography variant="body2" fontWeight={700}>{selected.title}</Typography>
          <Chip label={`id: ${selected.id}`} size="small" />
        </Box>

        <Divider />

        {/* SQL Editor */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <SectionLabel>SQL Query</SectionLabel>
            <CopyButton text={editSql} />
          </Box>
          <TextField
            fullWidth multiline minRows={4} maxRows={10} size="small"
            value={editSql}
            onChange={(e) => setEditSql(e.target.value)}
            inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          <Box sx={{ display: 'flex', gap: 1, mt: 0.75 }}>
            <Button
              size="small" variant="contained"
              startIcon={runMutation.isPending ? <CircularProgress size={12} color="inherit" /> : <PlayArrowOutlined />}
              disabled={!editSql.trim() || runMutation.isPending}
              onClick={() => runMutation.mutate()}
            >
              Run
            </Button>
            <Button
              size="small" variant="outlined"
              disabled={editSql === selected.dataBinding.sql}
              onClick={handleApplySql}
            >
              Apply to Widget
            </Button>
          </Box>
        </Box>

        {/* Query result preview */}
        {queryError && (
          <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{queryError}</Alert>
        )}
        {queryResult && (
          <Box>
            <SectionLabel>Query Result Preview</SectionLabel>
            <Box sx={{ overflowX: 'auto', maxHeight: 160, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead>
                  <tr>
                    {queryResult.columns.map((c) => (
                      <th key={c} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #ddd', background: 'rgba(0,0,0,0.04)', whiteSpace: 'nowrap' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {queryResult.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {queryResult.columns.map((c) => (
                        <td key={c} style={{ padding: '3px 8px', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>
                          {String(row[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Showing first 5 of {queryResult.rows.length} rows · {queryResult.columns.length} columns
            </Typography>
          </Box>
        )}

        <Divider />

        {/* Data Binding */}
        <Box>
          <SectionLabel>Data Binding</SectionLabel>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {(Object.entries(binding) as [string, string][])
              .filter(([k]) => k !== 'sql')
              .map(([k, v]) => (
                <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 90, fontFamily: 'monospace' }}>{k}</Typography>
                  <Chip label={v ?? '—'} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: 11 }} />
                </Box>
              ))}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 90, fontFamily: 'monospace' }}>layout</Typography>
              <Chip
                label={`x:${selected.layout.x} y:${selected.layout.y} w:${selected.layout.w} h:${selected.layout.h}`}
                size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: 11 }}
              />
            </Box>
          </Box>
        </Box>

        <Divider />

        {/* AI Regenerate */}
        <Box sx={{ p: 1.5, borderRadius: 1, border: '1px solid', borderColor: (t) => alpha(t.palette.primary.main, 0.3), bgcolor: (t) => alpha(t.palette.primary.main, 0.03) }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            <AutoAwesomeOutlined fontSize="small" color="primary" />
            <Typography variant="body2" fontWeight={600}>Regenerate with AI</Typography>
          </Box>
          <TextField
            fullWidth size="small"
            placeholder='e.g. "Show median salary instead of average" or "Group by job title"'
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            multiline minRows={2}
          />
          <Button
            fullWidth size="small" variant="contained" color="primary"
            startIcon={regenMutation.isPending ? <CircularProgress size={12} color="inherit" /> : <AutoAwesomeOutlined />}
            disabled={!refinement.trim() || regenMutation.isPending}
            onClick={() => regenMutation.mutate()}
            sx={{ mt: 1 }}
          >
            {regenMutation.isPending ? 'Regenerating…' : 'Regenerate Widget'}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface AIDebugPanelProps {
  open:            boolean
  onClose:         () => void
  config:          DashboardConfigSchema
  debug:           DashboardDebugMeta | null
  connId:          number
  originalIntent:  string
  onWidgetUpdate:  (widget: DashboardWidget) => void
}

export default function AIDebugPanel({
  open, onClose, config, debug, connId, originalIntent, onWidgetUpdate,
}: AIDebugPanelProps) {
  const [tab, setTab] = useState(0)

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100vw', sm: 520 },
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1,
          borderBottom: 1, borderColor: 'divider', flexShrink: 0,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
        }}
      >
        <BugReportOutlined color="primary" />
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          AI Debug Panel
        </Typography>
        <Chip label={config.widgets.length + ' widgets'} size="small" />
        <Tooltip title="Close">
          <IconButton size="small" onClick={onClose}>
            <CloseOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Tab
          label="AI Prompt"
          icon={<AutoFixHighOutlined fontSize="small" />}
          iconPosition="start"
          sx={{ minHeight: 48, fontSize: '0.8rem' }}
        />
        <Tab
          label="Template JSON"
          icon={<CodeOutlined fontSize="small" />}
          iconPosition="start"
          sx={{ minHeight: 48, fontSize: '0.8rem' }}
        />
        <Tab
          label="Widgets"
          icon={<BarChartOutlined fontSize="small" />}
          iconPosition="start"
          sx={{ minHeight: 48, fontSize: '0.8rem' }}
        />
      </Tabs>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tab === 0 && (
          debug
            ? <PromptTab debug={debug} />
            : (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary" variant="body2">
                  No AI debug data available.
                </Typography>
                <Typography color="text.secondary" variant="caption" sx={{ mt: 0.5, display: 'block' }}>
                  Generate a new dashboard or load one that was saved with debug data.
                </Typography>
              </Box>
            )
        )}
        {tab === 1 && <TemplateTab config={config} />}
        {tab === 2 && (
          <Box sx={{ height: '100%' }}>
            <WidgetsTab
              config={config}
              connId={connId}
              originalIntent={originalIntent}
              onWidgetUpdate={onWidgetUpdate}
            />
          </Box>
        )}
      </Box>
    </Drawer>
  )
}
