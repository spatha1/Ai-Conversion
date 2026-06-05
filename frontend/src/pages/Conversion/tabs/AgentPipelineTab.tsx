import { useState } from 'react'
import {
  Box, Typography, Button, Paper, Chip, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip,
  Alert, Stack, alpha, Accordion, AccordionSummary, AccordionDetails,
  Collapse, LinearProgress, Tab, Tabs, Grid, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider,
  FormControlLabel, Checkbox, Popover,
} from '@mui/material'
import {
  PlayArrowOutlined, ExpandMoreOutlined, ExpandLessOutlined, CheckCircleOutlined,
  ErrorOutlined, HistoryOutlined, StorageOutlined, AssessmentOutlined,
  AutoFixHighOutlined, EditOutlined, DeleteOutlined, BugReportOutlined,
  ThumbUpOutlined, ThumbDownOutlined, OutputOutlined, AutoAwesomeOutlined,
  ClearOutlined, CodeOutlined, TuneOutlined, SaveOutlined, CloseOutlined,
  BiotechOutlined, LightbulbOutlined, AccountTreeOutlined, VerifiedOutlined,
  MapOutlined,
} from '@mui/icons-material'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { conversionAgentApi, mappingApi } from '@/api'
import type { MappingRowEntry, TransformResult } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'
import type { AgentRunLog, QueryVersion, ValidationResultEntry, ColumnProfile, ValueMapping } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

const RUN_STATUS_COLORS: Record<string, string> = {
  success: tokens.emerald600,
  partial: tokens.amber600,
  failed:  tokens.red600,
  running: tokens.sky600,
}
const MAPPING_TYPE_COLOR: Record<string, string> = {
  manual:         tokens.emerald600,
  ai:             tokens.sky600,
  rule:           PURPLE,
  pending_review: tokens.amber600,
}
const MAPPING_STATUS_COLOR: Record<string, string> = {
  approved: tokens.emerald600,
  pending:  tokens.amber600,
  rejected: tokens.red600,
}

export default function AgentPipelineTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const activeConnection  = useAppStore((s) => s.activeConnection)
  const setConversionTab  = useAppStore((s) => s.setConversionTab)
  const connId = activeConnection?.id ?? null

  const [running, setRunning]         = useState(false)
  const [generatingXml, setGeneratingXml] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [profiling, setProfiling]   = useState(false)
  const [lastResult, setLastResult] = useState<{
    status: string; attempts: number; version: number; errors: string[]
    validation_summary: { passed: boolean; checks: Array<{ name: string; passed: boolean }>; xml_count: number }
  } | null>(null)
  const [editingMid, setEditingMid] = useState<number | null>(null)
  const [editValue, setEditValue]   = useState('')
  const [editingIdentifier, setEditingIdentifier] = useState(false)
  const [identifierEdit, setIdentifierEdit]       = useState('')
  const [innerTab, setInnerTab]             = useState(0)   // 0=column profiles, 1=value mappings
  const [validationOpen, setValidationOpen] = useState(true)
  const [versionsOpen, setVersionsOpen]     = useState(false)  // collapsed by default (can be many versions)
  const [profilesOpen, setProfilesOpen]     = useState(false)  // collapsed by default
  const [summaryOpen, setSummaryOpen]       = useState(true)
  const [detailStep, setDetailStep]         = useState<string | null>(null)
  const [detailAnchorEl, setDetailAnchorEl] = useState<HTMLElement | null>(null)
  const [agentOpen, setAgentOpen] = useState<Record<string, boolean>>({ manager: false, mapper: false, validator: false })
  const toggleAgent = (name: string) => setAgentOpen((p) => ({ ...p, [name]: !p[name] }))
  const [traceOpen, setTraceOpen] = useState<Record<string, boolean>>({})
  const toggleTrace = (name: string) => setTraceOpen((p) => ({ ...p, [name]: !p[name] }))
  const [editingRowId, setEditingRowId]     = useState<number | null>(null)
  const [editRowCol, setEditRowCol]         = useState('')
  const [rematchingRowId, setRematchingRowId] = useState<number | null>(null)
  const [mappingOpen, setMappingOpen]       = useState(true)

  // AI Transform dialog state
  const [transformRow, setTransformRow]           = useState<MappingRowEntry | null>(null)
  const [transformInstruction, setTransformInstruction] = useState('')
  const [transformEditMode, setTransformEditMode] = useState(false)
  const [transformEditSql, setTransformEditSql]   = useState('')
  const [transformEditPy, setTransformEditPy]     = useState('')
  const [transformSaving, setTransformSaving]     = useState(false)
  const [transformResult, setTransformResult]     = useState<TransformResult | null>(null)
  const [transformLoading, setTransformLoading]   = useState(false)

  // Additional instructions for pipeline re-run
  const [hintsOpen, setHintsOpen]     = useState(false)
  const [userHints, setUserHints]     = useState('')
  const [skipMapping, setSkipMapping] = useState(false)

  // SQL preview state (Mapper panel)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewRows, setPreviewRows]       = useState<Record<string, string>[] | null>(null)
  const [previewError, setPreviewError]     = useState<string | null>(null)
  const [previewOpen, setPreviewOpen]       = useState(false)

  // SQL edit state (Mapper panel)
  const [sqlEditing, setSqlEditing]     = useState(false)
  const [sqlDraft, setSqlDraft]         = useState('')
  const [sqlSaving, setSqlSaving]       = useState(false)

  const enabled = connId != null

  const { data: runLogs = [], refetch: refetchLogs } = useQuery<AgentRunLog[]>({
    queryKey: ['conv-run-logs', connId],
    queryFn:  () => conversionAgentApi.getRunLogs(connId!),
    enabled,
    refetchInterval: running ? 3000 : false,
  })
  const { data: versions = [] } = useQuery<QueryVersion[]>({
    queryKey: ['conv-versions', connId],
    queryFn:  () => conversionAgentApi.getVersions(connId!),
    enabled,
  })
  const { data: validations = [] } = useQuery<ValidationResultEntry[]>({
    queryKey: ['conv-validation', connId],
    queryFn:  () => conversionAgentApi.getValidation(connId!),
    enabled,
  })
  const { data: profiles = [] } = useQuery<ColumnProfile[]>({
    queryKey: ['conv-profiles', connId],
    queryFn:  () => conversionAgentApi.getProfiles(connId!),
    enabled,
  })
  const { data: mappings = [], refetch: refetchMappings } = useQuery<ValueMapping[]>({
    queryKey: ['conv-mappings', connId],
    queryFn:  () => conversionAgentApi.getValueMappings(connId!),
    enabled,
  })
  const { data: mappingRowData, refetch: refetchMappingRows } = useQuery<{
    identifier_column: string | null
    identifier_table:  string | null
    rows: MappingRowEntry[]
  }>({
    queryKey: ['conv-mapping-rows', connId],
    queryFn:  () => conversionAgentApi.getMappingRows(connId!),
    enabled,
  })
  const mappingRows       = mappingRowData?.rows ?? []
  const identifierColumn  = mappingRowData?.identifier_column ?? null
  const identifierTable   = mappingRowData?.identifier_table  ?? null

  // ── Identifier mutation ───────────────────────────────────────────────────

  const identifierMutation = useMutation({
    mutationFn: (col: string) => mappingApi.updateIdentifier(connId!, col.trim() || null, identifierTable),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conv-mapping-rows', connId] })
      setEditingIdentifier(false)
      enqueueSnackbar('Identifier updated', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  function handleIdentifierSave() {
    if (!connId) return
    identifierMutation.mutate(identifierEdit)
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleRun() {
    if (!connId) return
    setRunning(true); setLastResult(null)
    try {
      const hints = userHints.trim() ? userHints.trim().split('\n').map(h => h.trim()).filter(Boolean) : []
      const res = await conversionAgentApi.run(connId, 3, hints, skipMapping)
      setLastResult(res)
      qc.invalidateQueries({ queryKey: ['conv-run-logs',      connId] })
      qc.invalidateQueries({ queryKey: ['conv-versions',      connId] })
      qc.invalidateQueries({ queryKey: ['conv-validation',    connId] })
      qc.invalidateQueries({ queryKey: ['conv-mapping-rows',  connId] })

      // Auto-generate XML records if pipeline produced a valid SQL
      if (res.status !== 'failed') {
        setGeneratingXml(true)
        try {
          const xmlRes = await mappingApi.generateAllXml(connId)
          qc.invalidateQueries({ queryKey: ['mapping-xml', connId] })
          enqueueSnackbar(
            `Pipeline ${res.status} — v${res.version} · ${xmlRes.generated} XML records generated`,
            { variant: res.status === 'success' ? 'success' : 'warning' },
          )
        } catch {
          enqueueSnackbar(
            `Pipeline ${res.status} — v${res.version} (XML generation failed, check Output tab)`,
            { variant: 'warning' },
          )
        } finally { setGeneratingXml(false) }
      } else {
        enqueueSnackbar(
          `Pipeline failed after ${res.attempts} attempt${res.attempts !== 1 ? 's' : ''}`,
          { variant: 'error' },
        )
      }
    } catch (e: unknown) {
      enqueueSnackbar(
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Pipeline failed',
        { variant: 'error' },
      )
    } finally { setRunning(false); refetchLogs() }
  }

  async function handleProfile() {
    if (!connId) return
    setProfiling(true)
    try {
      const res = await conversionAgentApi.triggerProfile(connId)
      qc.invalidateQueries({ queryKey: ['conv-profiles', connId] })
      enqueueSnackbar(`Profiled ${res.profiled_columns} columns`, { variant: 'success' })
    } catch { enqueueSnackbar('Profiling failed', { variant: 'error' }) }
    finally { setProfiling(false) }
  }

  async function handleSuggest() {
    if (!connId) return
    setSuggesting(true)
    try {
      const res = await conversionAgentApi.suggestValueMappings(connId)
      await refetchMappings()
      enqueueSnackbar(`${res.new_mappings} new mappings across ${res.categorical_columns_checked} columns`, { variant: 'success' })
    } catch { enqueueSnackbar('Suggest failed', { variant: 'error' }) }
    finally { setSuggesting(false) }
  }

  async function handleApprove(m: ValueMapping) {
    await conversionAgentApi.updateValueMapping(connId!, m.id, { status: 'approved' })
    refetchMappings()
  }
  async function handleReject(m: ValueMapping) {
    await conversionAgentApi.updateValueMapping(connId!, m.id, { status: 'rejected' })
    refetchMappings()
  }
  async function handleSaveEdit(m: ValueMapping) {
    await conversionAgentApi.updateValueMapping(connId!, m.id, { target_value: editValue })
    setEditingMid(null); refetchMappings()
  }
  async function handleSaveRowEdit(row: MappingRowEntry) {
    await conversionAgentApi.updateMappingRow(connId!, row.id, { source_column: editRowCol })
    setEditingRowId(null)
    refetchMappingRows()
  }

  async function handleRematch(row: MappingRowEntry) {
    setRematchingRowId(row.id)
    try {
      await conversionAgentApi.rematchMappingRow(connId!, row.id)
      refetchMappingRows()
      enqueueSnackbar(`Re-matched: ${row.target_path}`, { variant: 'success' })
    } catch {
      enqueueSnackbar('Re-match failed', { variant: 'error' })
    } finally { setRematchingRowId(null) }
  }

  async function handleDelete(m: ValueMapping) {
    await conversionAgentApi.deleteValueMapping(connId!, m.id)
    refetchMappings()
  }

  function openTransformDialog(row: MappingRowEntry) {
    setTransformRow(row)
    setTransformInstruction('')
    setTransformEditMode(false)
    setTransformEditSql('')
    setTransformEditPy('')
    setTransformResult(row.transform_expression
      ? { id: row.id, target_path: row.target_path ?? '', source_column: row.source_column ?? '',
          sql_expression: row.transform_sql ?? '', python_expression: row.transform_expression ?? '',
          explanation: '', transform_expression: row.transform_expression ?? '',
          transform_sql: row.transform_sql ?? '' }
      : null
    )
  }

  function enterTransformEditMode() {
    setTransformEditSql(transformResult?.sql_expression ?? '')
    setTransformEditPy(transformResult?.python_expression ?? '')
    setTransformEditMode(true)
  }

  async function handleSaveTransformManual() {
    if (!connId || !transformRow) return
    setTransformSaving(true)
    try {
      const res = await conversionAgentApi.saveTransformManual(
        connId, transformRow.id, transformEditSql.trim(), transformEditPy.trim(),
      )
      setTransformResult({ ...res, explanation: '', id: transformRow.id,
        target_path: transformRow.target_path ?? '', source_column: transformRow.source_column ?? '' })
      setTransformEditMode(false)
      refetchMappingRows()
      enqueueSnackbar('Transform saved', { variant: 'success' })
    } catch {
      enqueueSnackbar('Save failed', { variant: 'error' })
    } finally { setTransformSaving(false) }
  }

  async function handleAiTransform() {
    if (!connId || !transformRow || !transformInstruction.trim()) return
    setTransformLoading(true)
    try {
      const res = await conversionAgentApi.aiTransformRow(
        connId, transformRow.id, transformInstruction.trim(),
        (activeConnection as { dialect?: string })?.dialect ?? 'mssql',
      )
      setTransformResult(res)
      refetchMappingRows()
      enqueueSnackbar('Transform generated — will apply on next XML generation', { variant: 'success' })
    } catch {
      enqueueSnackbar('AI transform failed', { variant: 'error' })
    } finally { setTransformLoading(false) }
  }

  async function handleClearTransform(row: MappingRowEntry) {
    try {
      await conversionAgentApi.clearTransform(connId!, row.id)
      refetchMappingRows()
      enqueueSnackbar('Transform cleared', { variant: 'success' })
    } catch { enqueueSnackbar('Clear failed', { variant: 'error' }) }
  }

  async function handlePreviewSql() {
    if (!connId) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewRows(null)
    try {
      const res = await mappingApi.previewQuery(connId)
      const cols: string[] = res.columns ?? []
      // API returns rows as objects (Record<string,unknown>), not arrays
      const rawRows = (res.rows ?? []) as Record<string, unknown>[]
      const rows = rawRows.slice(0, 10).map((r) =>
        Object.fromEntries(cols.map((c) => [c, r[c] == null ? '' : String(r[c])]))
      )
      setPreviewRows(rows)
      setPreviewOpen(true)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Preview failed'
      setPreviewError(msg)
    } finally { setPreviewLoading(false) }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => enqueueSnackbar('Copied to clipboard', { variant: 'success', autoHideDuration: 1500 }),
      () => enqueueSnackbar('Copy failed', { variant: 'error' }),
    )
  }

  function startSqlEdit(currentSql: string) {
    setSqlDraft(currentSql)
    setSqlEditing(true)
    setPreviewOpen(false)
  }

  async function handleSaveQuery() {
    if (!connId || !sqlDraft.trim()) return
    setSqlSaving(true)
    try {
      await conversionAgentApi.updateQuery(connId, sqlDraft.trim())
      qc.invalidateQueries({ queryKey: ['conv-versions', connId] })
      setSqlEditing(false)
      enqueueSnackbar('Query saved — re-run pipeline or Generate XML to apply', { variant: 'success' })
    } catch {
      enqueueSnackbar('Failed to save query', { variant: 'error' })
    } finally { setSqlSaving(false) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const lastManagerLog = runLogs.find((l) => l.agent_name === 'manager')
  const lastMapperLog  = runLogs.find((l) => l.agent_name === 'mapper')
  const lastValidLog   = runLogs.find((l) => l.agent_name === 'validator')

  const profilesByTable: Record<string, ColumnProfile[]> = {}
  for (const p of profiles) {
    if (!profilesByTable[p.table_name]) profilesByTable[p.table_name] = []
    profilesByTable[p.table_name].push(p)
  }

  // ── No connection ─────────────────────────────────────────────────────────

  if (!activeConnection) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
          No connection selected — pick one from the header bar first.
        </Alert>
      </Box>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── Action bar ── */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="contained" size="small"
          startIcon={(running || generatingXml) ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlined />}
          onClick={handleRun} disabled={running || generatingXml}>
          {running ? 'Running Pipeline…' : generatingXml ? 'Generating XML…' : 'Run Pipeline'}
        </Button>
        <Button variant="outlined" size="small"
          startIcon={profiling ? <CircularProgress size={14} /> : <AssessmentOutlined />}
          onClick={handleProfile} disabled={profiling || running}>
          {profiling ? 'Profiling…' : 'Re-Profile Columns'}
        </Button>
        <Tooltip title={hintsOpen ? 'Hide additional instructions' : 'Add instructions to guide the next pipeline run'}>
          <Button variant="outlined" size="small"
            color={userHints.trim() ? 'secondary' : 'inherit'}
            startIcon={<TuneOutlined />}
            onClick={() => setHintsOpen((o) => !o)}>
            Instructions {userHints.trim() ? '•' : ''}
          </Button>
        </Tooltip>
        <Tooltip title="Skip re-generating mappings and use your existing mapping conditions as-is">
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={skipMapping}
                onChange={(e) => setSkipMapping(e.target.checked)}
                disabled={running || generatingXml}
              />
            }
            label={<Typography variant="caption">Keep existing mappings</Typography>}
            sx={{ ml: 0.5, mr: 0 }}
          />
        </Tooltip>
        {lastResult && lastResult.status !== 'failed' && (
          <Button variant="outlined" size="small" color="success"
            startIcon={<OutputOutlined />}
            onClick={() => setConversionTab(3)}>
            View XML Output
          </Button>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          Connection: <strong>{activeConnection.name}</strong>
        </Typography>
      </Box>

      {/* ── Additional Instructions panel ── */}
      <Collapse in={hintsOpen}>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha(PURPLE, 0.03) }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary"
            sx={{ display: 'block', mb: 0.75, textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: 0.5 }}>
            Additional Instructions for Pipeline Run
          </Typography>
          <TextField
            multiline minRows={2} maxRows={5} fullWidth
            size="small"
            placeholder={'One instruction per line, e.g.:\n"Focus on PolicyID as the identifier"\n"Status column should map to Active/Inactive"'}
            value={userHints}
            onChange={(e) => setUserHints(e.target.value)}
            sx={{ '& textarea': { fontSize: '0.78rem' } }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            These are injected as initial hints to the Mapper agent on the next run.
          </Typography>
        </Paper>
      </Collapse>

      {(running || generatingXml) && (
        <Box>
          <LinearProgress sx={{ borderRadius: 1 }} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {generatingXml ? 'Generating XML records from pipeline output…' : 'Running agents (Manager → Mapper → Validator)…'}
          </Typography>
        </Box>
      )}

      {/* ── Agent output panels ── */}
      {(() => {
        // Parse mapping snapshot from latest version
        let snapshot: Record<string, unknown> = {}
        if (versions.length > 0 && versions[0].mapping_snapshot) {
          try { snapshot = JSON.parse(versions[0].mapping_snapshot as string) } catch { /* */ }
        }
        const fieldConf   = (snapshot['field_confidence']   ?? {}) as Record<string, number>
        const colLineage  = (snapshot['column_lineage']    ?? {}) as Record<string, string>
        const snapIdCol   = snapshot['identifier_column'] as string | undefined
        const snapIdTbl   = snapshot['identifier_table']  as string | undefined

        // Parse mapper output_summary
        let mapperSummary: Record<string, unknown> = {}
        if (lastMapperLog?.output_summary) {
          try { mapperSummary = JSON.parse(lastMapperLog.output_summary) } catch { /* */ }
        }

        // Confidence stats
        const confVals: number[] = Object.values(fieldConf).map(Number)
        const avgConf  = confVals.length ? Math.round(confVals.reduce((a: number, b: number) => a + b, 0) / confVals.length * 100) : null
        const lowConf  = Object.entries(fieldConf).filter(([, v]) => (v as number) < 0.4)

        // Validator checks from live query
        const passedCount = validations.filter((v) => v.passed).length
        const failedChecks = validations.filter((v) => !v.passed)

        const agentDefs = [
          { key: 'manager',   label: 'Manager',   log: lastManagerLog,  color: tokens.sky600 },
          { key: 'mapper',    label: 'Mapper',     log: lastMapperLog,   color: PURPLE        },
          { key: 'validator', label: 'Validator',  log: lastValidLog,    color: tokens.emerald600 },
        ]

        return (
          <Stack spacing={1}>
            {agentDefs.map(({ key, label, log, color }) => (
              <Paper key={key} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                {/* ── Card header ── */}
                <Box
                  onClick={() => log && toggleAgent(key)}
                  sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1,
                    cursor: log ? 'pointer' : 'default',
                    '&:hover': log ? { bgcolor: 'action.hover' } : {} }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%',
                    bgcolor: log ? (RUN_STATUS_COLORS[log.status] ?? '#64748B') : '#94A3B8',
                    flexShrink: 0 }} />
                  <Typography variant="body2" fontWeight={700} sx={{ color }}>{label} Agent</Typography>
                  {log ? (
                    <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap">
                      <Chip label={log.status} size="small"
                        sx={{ height: 18, fontSize: '0.65rem',
                          bgcolor: alpha(RUN_STATUS_COLORS[log.status] ?? '#64748B', 0.12),
                          color:   RUN_STATUS_COLORS[log.status] ?? '#64748B' }} />
                      {log.attempt > 1 && (
                        <Chip label={`Attempt ${log.attempt}`} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
                      )}
                      {log.duration_ms != null && (
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                          {(log.duration_ms / 1000).toFixed(1)}s
                        </Typography>
                      )}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.disabled">No runs yet</Typography>
                  )}
                  {log && (
                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {(log.input_summary || log.output_summary) && (
                        <Tooltip title="Show AI trace">
                          <IconButton size="small"
                            onClick={(e) => { e.stopPropagation(); toggleTrace(key) }}
                            sx={{ p: 0.25, color: traceOpen[key] ? PURPLE : 'text.disabled' }}>
                            <BiotechOutlined sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                      <ExpandMoreOutlined sx={{
                        fontSize: 18, color: 'text.disabled',
                        transform: agentOpen[key] ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                      }} />
                    </Box>
                  )}
                </Box>

                {/* ── Manager detail ── */}
                {key === 'manager' && (
                  <Collapse in={agentOpen.manager}>
                    <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
                      <Stack spacing={0.75}>
                        {lastResult && (
                          <>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                              <Chip label={`v${lastResult.version}`} size="small"
                                sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
                              <Chip label={`${lastResult.attempts} attempt${lastResult.attempts !== 1 ? 's' : ''}`}
                                size="small" sx={{ height: 20, fontSize: '0.68rem' }} />
                              <Chip
                                label={lastResult.validation_summary.passed ? 'Validation passed' : 'Validation failed'}
                                size="small"
                                sx={{ height: 20, fontSize: '0.68rem',
                                  bgcolor: alpha(lastResult.validation_summary.passed ? tokens.emerald600 : tokens.red600, 0.12),
                                  color: lastResult.validation_summary.passed ? tokens.emerald600 : tokens.red600 }} />
                              {lastResult.validation_summary.xml_count != null && (
                                <Chip label={`${lastResult.validation_summary.xml_count} XML records`}
                                  size="small" sx={{ height: 20, fontSize: '0.68rem' }} />
                              )}
                            </Box>
                            {lastResult.errors.length > 0 && (
                              <Alert severity="warning" sx={{ fontSize: '0.75rem', py: 0.5 }}>
                                {lastResult.errors.map((e, i) => <div key={i}>• {e}</div>)}
                              </Alert>
                            )}
                          </>
                        )}
                        {!lastResult && log?.output_summary && (
                          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>
                            {log.output_summary}
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  </Collapse>
                )}

                {/* ── Mapper detail ── */}
                {key === 'mapper' && (
                  <Collapse in={agentOpen.mapper}>
                    <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
                      <Stack spacing={1}>
                        {/* Identifier — editable */}
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', minWidth: 80 }}>
                            Identifier:
                          </Typography>
                          {editingIdentifier ? (
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                              <TextField
                                size="small"
                                autoFocus
                                value={identifierEdit}
                                onChange={(e) => setIdentifierEdit(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleIdentifierSave()
                                  if (e.key === 'Escape') setEditingIdentifier(false)
                                }}
                                placeholder="e.g. EMPNO"
                                sx={{ '& .MuiInputBase-input': { fontSize: '0.72rem', py: 0.3, px: 0.75 }, width: 140 }}
                              />
                              <Tooltip title="Save">
                                <IconButton size="small" onClick={handleIdentifierSave} disabled={identifierMutation.isPending}
                                  sx={{ p: 0.25, color: 'success.main' }}>
                                  <SaveOutlined sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Cancel">
                                <IconButton size="small" onClick={() => setEditingIdentifier(false)}
                                  sx={{ p: 0.25, color: 'text.disabled' }}>
                                  <CloseOutlined sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          ) : (
                            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                              <Chip
                                label={(snapIdCol ?? identifierColumn)
                                  ? `${(snapIdTbl ?? identifierTable) ? `${snapIdTbl ?? identifierTable}.` : ''}${snapIdCol ?? identifierColumn}`
                                  : 'not set'}
                                size="small"
                                sx={{ height: 18, fontSize: '0.65rem',
                                  bgcolor: (snapIdCol ?? identifierColumn) ? alpha(TEAL, 0.1) : alpha('#999', 0.1),
                                  color:   (snapIdCol ?? identifierColumn) ? TEAL : 'text.disabled' }} />
                              <Tooltip title="Edit identifier column">
                                <IconButton size="small"
                                  onClick={() => {
                                    setIdentifierEdit(identifierColumn ?? '')
                                    setEditingIdentifier(true)
                                  }}
                                  sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'primary.main' } }}>
                                  <EditOutlined sx={{ fontSize: 12 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )}
                        </Box>
                        {/* Confidence */}
                        {avgConf != null && (
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', minWidth: 80 }}>
                              Avg confidence:
                            </Typography>
                            <Chip label={`${avgConf}%`} size="small"
                              sx={{ height: 18, fontSize: '0.65rem',
                                bgcolor: alpha(avgConf >= 70 ? tokens.emerald600 : avgConf >= 40 ? tokens.amber600 : tokens.red600, 0.12),
                                color:   avgConf >= 70 ? tokens.emerald600 : avgConf >= 40 ? tokens.amber600 : tokens.red600 }} />
                            <Chip label={`${Object.keys(colLineage).length} fields mapped`} size="small"
                              sx={{ height: 18, fontSize: '0.65rem' }} />
                            {lowConf.length > 0 && (
                              <Chip label={`${lowConf.length} low confidence`} size="small"
                                sx={{ height: 18, fontSize: '0.65rem',
                                  bgcolor: alpha(tokens.amber600, 0.12), color: tokens.amber600 }} />
                            )}
                          </Box>
                        )}
                        {/* SQL Preview */}
                        {versions.length > 0 && versions[0].sql_text && (
                          <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <Typography variant="caption" fontWeight={700} color="text.secondary"
                                sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, flex: 1 }}>
                                Generated SQL (v{versions[0].version})
                              </Typography>
                              {!sqlEditing && (
                                <>
                                  <Tooltip title="Edit SQL">
                                    <IconButton size="small"
                                      onClick={() => startSqlEdit(versions[0].sql_text)}>
                                      <EditOutlined sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="Copy SQL">
                                    <IconButton size="small"
                                      onClick={() => copyToClipboard(versions[0].sql_text)}>
                                      <CodeOutlined sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                  <Button size="small" variant="outlined"
                                    startIcon={previewLoading ? <CircularProgress size={12} /> : <AssessmentOutlined />}
                                    onClick={handlePreviewSql}
                                    disabled={previewLoading}
                                    sx={{ fontSize: '0.7rem', py: 0.25, px: 1, minWidth: 0 }}>
                                    {previewLoading ? 'Loading…' : 'Preview Data'}
                                  </Button>
                                </>
                              )}
                              {sqlEditing && (
                                <>
                                  <Button size="small" variant="contained" color="primary"
                                    onClick={handleSaveQuery}
                                    disabled={sqlSaving || !sqlDraft.trim()}
                                    sx={{ fontSize: '0.7rem', py: 0.25, px: 1, minWidth: 0 }}>
                                    {sqlSaving ? 'Saving…' : 'Save'}
                                  </Button>
                                  <Button size="small" variant="outlined"
                                    onClick={() => setSqlEditing(false)}
                                    sx={{ fontSize: '0.7rem', py: 0.25, px: 1, minWidth: 0 }}>
                                    Cancel
                                  </Button>
                                </>
                              )}
                            </Box>
                            {sqlEditing ? (
                              <TextField
                                multiline fullWidth
                                value={sqlDraft}
                                onChange={(e) => setSqlDraft(e.target.value)}
                                minRows={6} maxRows={20}
                                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.68rem' } }}
                                sx={{ '& .MuiOutlinedInput-root': { bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f1f5f9' } }}
                              />
                            ) : (
                              <Box component="pre"
                                sx={{ m: 0, p: 1.25,
                                  bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f1f5f9',
                                  borderRadius: 1, fontSize: '0.68rem', fontFamily: 'monospace',
                                  overflowX: 'auto', whiteSpace: 'pre-wrap',
                                  border: 1, borderColor: 'divider', maxHeight: 200, overflow: 'auto',
                                  color: TEAL }}>
                                {versions[0].sql_text}
                              </Box>
                            )}
                            {/* Preview error */}
                            {previewError && (
                              <Alert severity="error" sx={{ mt: 1, fontSize: '0.75rem', py: 0.5 }}>
                                {previewError}
                              </Alert>
                            )}
                            {/* Preview data table */}
                            <Collapse in={previewOpen && !!previewRows}>
                              <Box sx={{ mt: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                                    sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, flex: 1 }}>
                                    Preview (first {previewRows?.length} rows)
                                  </Typography>
                                  <IconButton size="small" onClick={() => setPreviewOpen(false)}>
                                    <ClearOutlined sx={{ fontSize: 14 }} />
                                  </IconButton>
                                </Box>
                                <Box sx={{ overflowX: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                  <Table size="small" sx={{ minWidth: 400 }}>
                                    <TableHead>
                                      <TableRow>
                                        {previewRows && previewRows.length > 0 &&
                                          Object.keys(previewRows[0]).slice(0, 12).map((col) => (
                                            <TableCell key={col}
                                              sx={{ fontSize: '0.62rem', fontFamily: 'monospace',
                                                whiteSpace: 'nowrap', maxWidth: 140,
                                                overflow: 'hidden', textOverflow: 'ellipsis',
                                                py: 0.5, px: 1 }}>
                                              {col}
                                            </TableCell>
                                          ))
                                        }
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(previewRows ?? []).map((row, ri) => (
                                        <TableRow key={ri}>
                                          {Object.values(row).slice(0, 12).map((val, ci) => (
                                            <TableCell key={ci}
                                              sx={{ fontSize: '0.68rem', py: 0.4, px: 1,
                                                maxWidth: 140, overflow: 'hidden',
                                                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {val}
                                            </TableCell>
                                          ))}
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </Box>
                              </Box>
                            </Collapse>
                          </Box>
                        )}
                        {/* Low-confidence fields */}
                        {lowConf.length > 0 && (
                          <Box>
                            <Typography variant="caption" fontWeight={700} color="text.secondary"
                              sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5 }}>
                              Low Confidence Fields (&lt;40%)
                            </Typography>
                            <Stack spacing={0.25}>
                              {lowConf.map(([path, score]) => (
                                <Box key={path} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'text.secondary', flex: 1 }}>
                                    {path}
                                  </Typography>
                                  <Chip label={`${Math.round((score as number) * 100)}%`} size="small"
                                    sx={{ height: 16, fontSize: '0.6rem',
                                      bgcolor: alpha(tokens.amber600, 0.12), color: tokens.amber600 }} />
                                </Box>
                              ))}
                            </Stack>
                          </Box>
                        )}
                        {/* Raw output summary fallback */}
                        {!!mapperSummary['sql_preview'] && !versions.length && (
                          <Box component="pre"
                            sx={{ m: 0, p: 1.25, bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f1f5f9',
                              borderRadius: 1, fontSize: '0.68rem', fontFamily: 'monospace',
                              overflowX: 'auto', whiteSpace: 'pre-wrap', border: 1, borderColor: 'divider', color: TEAL }}>
                            {String(mapperSummary['sql_preview'])}
                          </Box>
                        )}
                      </Stack>
                    </Box>
                  </Collapse>
                )}

                {/* ── Validator detail ── */}
                {key === 'validator' && (
                  <Collapse in={agentOpen.validator}>
                    <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
                      {validations.length === 0 ? (
                        <Typography variant="caption" color="text.disabled">No validation results yet.</Typography>
                      ) : (
                        <Stack spacing={0.5}>
                          <Box sx={{ display: 'flex', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                            <Chip label={`${passedCount}/${validations.length} passed`} size="small"
                              sx={{ height: 20, fontSize: '0.68rem',
                                bgcolor: alpha(passedCount === validations.length ? tokens.emerald600 : tokens.amber600, 0.12),
                                color:   passedCount === validations.length ? tokens.emerald600 : tokens.amber600 }} />
                            {failedChecks.length > 0 && (
                              <Chip label={`${failedChecks.length} failed`} size="small"
                                sx={{ height: 20, fontSize: '0.68rem',
                                  bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600 }} />
                            )}
                          </Box>
                          {validations.map((v) => (
                            <Box key={v.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start',
                              p: 0.75, borderRadius: 1,
                              bgcolor: v.passed ? alpha(tokens.emerald600, 0.04) : alpha(tokens.red600, 0.06) }}>
                              <Box sx={{ mt: 0.2, flexShrink: 0 }}>
                                {v.passed
                                  ? <CheckCircleOutlined sx={{ fontSize: 13, color: tokens.emerald600 }} />
                                  : <ErrorOutlined sx={{ fontSize: 13, color: tokens.red600 }} />}
                              </Box>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant="caption" fontWeight={600}
                                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem',
                                    color: v.passed ? tokens.emerald600 : tokens.red600 }}>
                                  {v.check_name}
                                </Typography>
                                {v.detail && (
                                  <Typography variant="caption" color="text.secondary" display="block"
                                    sx={{ fontSize: '0.67rem', mt: 0.1 }}>
                                    {v.detail}
                                  </Typography>
                                )}
                              </Box>
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </Box>
                  </Collapse>
                )}

                {/* ── Trace panel ── */}
                {log && (log.input_summary || log.output_summary) && (
                  <Collapse in={!!traceOpen[key]}>
                    <Box sx={{ borderTop: 1, borderColor: 'divider', px: 2, py: 1.5,
                      bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#000', 0.3) : alpha(PURPLE, 0.02) }}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary"
                        sx={{ display: 'block', mb: 1, textTransform: 'uppercase',
                          fontSize: '0.6rem', letterSpacing: 0.5, color: PURPLE }}>
                        AI Trace
                      </Typography>
                      <Stack spacing={1}>
                        {log.input_summary && (() => {
                          let parsed: Record<string, unknown> | null = null
                          try { parsed = JSON.parse(log.input_summary) } catch { /* */ }
                          return (
                            <Box>
                              <Typography variant="caption" fontWeight={700} color="text.secondary"
                                sx={{ textTransform: 'uppercase', fontSize: '0.58rem', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                                Input
                              </Typography>
                              {parsed ? (
                                <Stack spacing={0.4}>
                                  {Object.entries(parsed).map(([k, v]) => (
                                    <Box key={k} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                      <Typography variant="caption"
                                        sx={{ fontFamily: 'monospace', fontSize: '0.65rem',
                                          color: 'text.disabled', minWidth: 100, flexShrink: 0 }}>
                                        {k}
                                      </Typography>
                                      <Typography variant="caption"
                                        sx={{ fontFamily: 'monospace', fontSize: '0.65rem',
                                          color: 'text.primary', wordBreak: 'break-all', flex: 1 }}>
                                        {Array.isArray(v)
                                          ? v.length === 0 ? '—' : v.map((x) => String(x)).join(', ')
                                          : v == null ? '—' : String(v)}
                                      </Typography>
                                    </Box>
                                  ))}
                                </Stack>
                              ) : (
                                <Box component="pre"
                                  sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1,
                                    fontSize: '0.65rem', fontFamily: 'monospace', overflowX: 'auto',
                                    whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                                  {log.input_summary}
                                </Box>
                              )}
                            </Box>
                          )
                        })()}
                        {log.output_summary && (() => {
                          let parsed: Record<string, unknown> | null = null
                          try { parsed = JSON.parse(log.output_summary) } catch { /* */ }
                          return (
                            <Box>
                              <Typography variant="caption" fontWeight={700} color="text.secondary"
                                sx={{ textTransform: 'uppercase', fontSize: '0.58rem', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                                Output
                              </Typography>
                              {parsed ? (
                                <Stack spacing={0.4}>
                                  {Object.entries(parsed).map(([k, v]) => (
                                    <Box key={k} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                      <Typography variant="caption"
                                        sx={{ fontFamily: 'monospace', fontSize: '0.65rem',
                                          color: 'text.disabled', minWidth: 100, flexShrink: 0 }}>
                                        {k}
                                      </Typography>
                                      <Typography variant="caption"
                                        sx={{ fontFamily: 'monospace', fontSize: '0.65rem',
                                          color: 'text.primary', wordBreak: 'break-all', flex: 1 }}>
                                        {Array.isArray(v)
                                          ? v.length === 0 ? '—' : v.map((x) => String(x)).join(', ')
                                          : v == null ? '—' : String(v)}
                                      </Typography>
                                    </Box>
                                  ))}
                                </Stack>
                              ) : (
                                <Box component="pre"
                                  sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1,
                                    fontSize: '0.65rem', fontFamily: 'monospace', overflowX: 'auto',
                                    whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>
                                  {log.output_summary}
                                </Box>
                              )}
                            </Box>
                          )
                        })()}
                      </Stack>
                    </Box>
                  </Collapse>
                )}
              </Paper>
            ))}
          </Stack>
        )
      })()}

      {/* ── Last-run result banner ── */}
      {lastResult && lastResult.errors.length > 0 && (
        <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
          <strong>Pipeline errors:</strong>
          {lastResult.errors.map((e, i) => <div key={i}>• {e}</div>)}
        </Alert>
      )}

      {/* ── Field Mapping Review ── */}
      {mappingRows.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            onClick={() => setMappingOpen((o) => !o)}
            sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' } }}>
            <StorageOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={700}>Field Mappings</Typography>
            {identifierColumn && (
              <Chip
                label={`Identifier: ${identifierTable ? `${identifierTable}.` : ''}${identifierColumn}`}
                size="small"
                sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
            )}
            <Chip label={`${mappingRows.length} fields`} size="small"
              sx={{ height: 18, fontSize: '0.65rem' }} />
            <ExpandMoreOutlined sx={{
              ml: 'auto', fontSize: 18, color: 'text.disabled',
              transform: mappingOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }} />
          </Box>
          <Collapse in={mappingOpen}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: '0.68rem' }}>XML Path (Target)</TableCell>
                  <TableCell sx={{ fontSize: '0.68rem' }}>Source Table</TableCell>
                  <TableCell sx={{ fontSize: '0.68rem' }}>Source Column</TableCell>
                  <TableCell sx={{ fontSize: '0.68rem' }}>Transform Logic</TableCell>
                  <TableCell sx={{ fontSize: '0.68rem', width: 80 }}>Confidence</TableCell>
                  <TableCell sx={{ fontSize: '0.68rem', width: 80 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mappingRows.map((row) => {
                  const conf = row.confidence
                  const confColor = conf == null ? '#64748B'
                    : conf >= 70 ? tokens.emerald600
                    : conf >= 40 ? tokens.amber600
                    : tokens.red600
                  const hasTransform = !!row.transform_expression
                  return (
                    <TableRow key={row.id}
                      sx={{ '&:hover': { bgcolor: 'action.hover' },
                            bgcolor: hasTransform ? alpha(PURPLE, 0.03) : undefined }}>
                      <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'text.secondary' }}>
                        {row.target_path}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.72rem' }}>{row.source_table ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', minWidth: 140 }}>
                        {editingRowId === row.id ? (
                          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                            <TextField size="small" value={editRowCol}
                              onChange={(e) => setEditRowCol(e.target.value)}
                              placeholder="column name"
                              sx={{ width: 130, '& input': { fontSize: '0.75rem', py: 0.5 } }}
                              autoFocus />
                            <Tooltip title="Save">
                              <IconButton size="small" color="success" onClick={() => handleSaveRowEdit(row)}>
                                <CheckCircleOutlined sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Cancel">
                              <IconButton size="small" onClick={() => setEditingRowId(null)}>
                                <ErrorOutlined sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        ) : (
                          <span>{row.source_column ?? '—'}</span>
                        )}
                      </TableCell>

                      {/* ── Transform Logic cell ── */}
                      <TableCell sx={{ maxWidth: 220 }}>
                        {hasTransform ? (
                          <Box>
                            <Tooltip title={`Python: ${row.transform_expression}`} arrow>
                              <Chip
                                icon={<CodeOutlined sx={{ fontSize: '0.75rem !important' }} />}
                                label={row.transform_sql
                                  ? row.transform_sql.length > 40
                                    ? row.transform_sql.slice(0, 38) + '…'
                                    : row.transform_sql
                                  : row.transform_expression!.length > 40
                                    ? row.transform_expression!.slice(0, 38) + '…'
                                    : row.transform_expression!
                                }
                                size="small"
                                sx={{ height: 18, fontSize: '0.6rem', fontFamily: 'monospace',
                                  bgcolor: alpha(PURPLE, 0.1), color: PURPLE,
                                  maxWidth: 200, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                              />
                            </Tooltip>
                          </Box>
                        ) : (
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                            no transform
                          </Typography>
                        )}
                      </TableCell>

                      <TableCell>
                        {conf != null ? (
                          <Chip label={`${conf}%`} size="small"
                            sx={{ height: 16, fontSize: '0.6rem',
                              bgcolor: alpha(confColor, 0.12), color: confColor }} />
                        ) : (
                          <Chip label="manual" size="small"
                            sx={{ height: 16, fontSize: '0.6rem',
                              bgcolor: alpha(tokens.emerald600, 0.1), color: tokens.emerald600 }} />
                        )}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.25 }}>
                          <Tooltip title="Override source column">
                            <IconButton size="small"
                              onClick={() => { setEditingRowId(row.id); setEditRowCol(row.source_column ?? '') }}>
                              <EditOutlined sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Re-match with AI embeddings">
                            <IconButton size="small"
                              disabled={rematchingRowId === row.id}
                              onClick={() => handleRematch(row)}>
                              {rematchingRowId === row.id
                                ? <CircularProgress size={13} />
                                : <AutoFixHighOutlined sx={{ fontSize: 13 }} />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={hasTransform ? 'Edit AI transform' : 'Add AI transform'}>
                            <IconButton size="small" color="secondary"
                              onClick={() => openTransformDialog(row)}>
                              <AutoAwesomeOutlined sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                          {hasTransform && (
                            <Tooltip title="Clear transform">
                              <IconButton size="small" color="error"
                                onClick={() => handleClearTransform(row)}>
                                <ClearOutlined sx={{ fontSize: 13 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Collapse>
        </Paper>
      )}

      {/* ── Validation results ── */}
      {validations.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            onClick={() => setValidationOpen((o) => !o)}
            sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' } }}>
            <BugReportOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={700}>Validation Checks</Typography>
            <Chip label={`${validations.filter(v => v.passed).length}/${validations.length} passed`}
              size="small"
              sx={{ height: 18, fontSize: '0.65rem',
                bgcolor: alpha(validations.every(v => v.passed) ? tokens.emerald600 : tokens.amber600, 0.12),
                color:   validations.every(v => v.passed) ? tokens.emerald600 : tokens.amber600 }} />
            <ExpandMoreOutlined sx={{
              ml: 'auto', fontSize: 18, color: 'text.disabled',
              transform: validationOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }} />
          </Box>
          <Collapse in={validationOpen}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: '0.7rem', width: 200 }}>Check</TableCell>
                  <TableCell sx={{ fontSize: '0.7rem', width: 80  }}>Status</TableCell>
                  <TableCell sx={{ fontSize: '0.7rem' }}>Detail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {validations.slice(0, 30).map((v) => (
                  <TableRow key={v.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                    <TableCell sx={{ fontSize: '0.72rem', fontFamily: 'monospace' }}>{v.check_name}</TableCell>
                    <TableCell>
                      <Chip label={v.passed ? 'Pass' : 'Fail'} size="small"
                        sx={{ height: 18, fontSize: '0.65rem',
                          bgcolor: alpha(v.passed ? tokens.emerald600 : tokens.red600, 0.12),
                          color:   v.passed ? tokens.emerald600 : tokens.red600 }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{v.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Collapse>
        </Paper>
      )}

      {/* ── Version history ── */}
      {versions.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            onClick={() => setVersionsOpen(v => !v)}
            sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
              borderBottom: versionsOpen ? 1 : 0, borderColor: 'divider' }}
          >
            <HistoryOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={700}>Generated SQL Versions</Typography>
            <Chip label={versions.length} size="small" sx={{ height: 18, fontSize: '0.65rem', ml: 0.5 }} />
            <Box sx={{ flex: 1 }} />
            {versionsOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />}
          </Box>
          <Collapse in={versionsOpen}>
            {versions.map((v) => (
              <Accordion key={v.id} disableGutters elevation={0}
                sx={{ '&:before': { display: 'none' }, borderBottom: 1, borderColor: 'divider' }}>
                <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                  <Stack direction="row" alignItems="center" gap={1.5}>
                    <Chip label={`v${v.version}`} size="small"
                      sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
                    <Typography variant="body2" sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                      {v.created_at.slice(0, 19).replace('T', ' ')}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0, bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc' }}>
                  <Box component="pre" sx={{ m: 0, p: 2, fontSize: '0.7rem', overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {v.sql_text}
                  </Box>
                </AccordionDetails>
              </Accordion>
            ))}
          </Collapse>
        </Paper>
      )}

      {/* ── Column Profiles + Value Mappings ── */}
      {(profiles.length > 0 || mappings.length > 0) && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {/* Collapsible header */}
          <Box
            onClick={() => setProfilesOpen(v => !v)}
            sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
              borderBottom: profilesOpen ? 1 : 0, borderColor: 'divider' }}
          >
            <StorageOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={700}>Column Profiles &amp; Value Mappings</Typography>
            <Chip label={profiles.length + mappings.length} size="small" sx={{ height: 18, fontSize: '0.65rem', ml: 0.5 }} />
            <Box sx={{ flex: 1 }} />
            {profilesOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />}
          </Box>
          <Collapse in={profilesOpen}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={innerTab} onChange={(_, v) => setInnerTab(v)} sx={{ minHeight: 38 }}>
              <Tab label={`Column Profiles (${profiles.length})`}
                sx={{ minHeight: 38, fontSize: '0.78rem', textTransform: 'none' }} />
              <Tab label={`Value Mappings (${mappings.length})`}
                sx={{ minHeight: 38, fontSize: '0.78rem', textTransform: 'none' }} />
            </Tabs>
          </Box>

          {/* Column Profiles */}
          {innerTab === 0 && (
            <Box>
              {Object.entries(profilesByTable).map(([tbl, cols]) => (
                <Box key={tbl}>
                  <Box sx={{ px: 2, py: 0.75, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <StorageOutlined sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="caption" fontWeight={700}
                      sx={{ textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: 0.5 }}>
                      {tbl}
                    </Typography>
                  </Box>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Column</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Null %</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Distinct</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Pattern</TableCell>
                        <TableCell sx={{ fontSize: '0.68rem' }}>Min / Max</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {cols.map((c) => (
                        <TableRow key={c.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                          <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{c.column_name}</TableCell>
                          <TableCell sx={{ fontSize: '0.72rem' }}>
                            {c.null_pct != null ? `${Number(c.null_pct).toFixed(1)}%` : '—'}
                          </TableCell>
                          <TableCell sx={{ fontSize: '0.72rem' }}>{c.distinct_count ?? '—'}</TableCell>
                          <TableCell>
                            {c.pattern_hint && (
                              <Chip label={c.pattern_hint} size="small"
                                sx={{ height: 16, fontSize: '0.6rem',
                                  bgcolor: alpha(c.pattern_hint === 'categorical' ? PURPLE : TEAL, 0.1),
                                  color:   c.pattern_hint === 'categorical' ? PURPLE : TEAL }} />
                            )}
                          </TableCell>
                          <TableCell sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                            {c.min_val && c.max_val ? `${c.min_val} / ${c.max_val}` : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ))}
            </Box>
          )}

          {/* Value Mappings */}
          {innerTab === 1 && (
            <Box>
              <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
                <Button size="small" variant="outlined"
                  startIcon={suggesting ? <CircularProgress size={12} /> : <AutoFixHighOutlined />}
                  onClick={handleSuggest} disabled={suggesting}>
                  {suggesting ? 'Suggesting…' : 'Suggest Mappings'}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {mappings.length} mapping{mappings.length !== 1 ? 's' : ''}
                  {' · '}
                  <span style={{ color: tokens.amber600 }}>
                    {mappings.filter((m) => m.status === 'pending').length} pending
                  </span>
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Table.Column</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Source Value</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Target Value</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Type</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Status</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow key={m.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                      <TableCell sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'text.secondary' }}>
                        {m.table_name}.{m.column_name}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>{m.source_value}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', minWidth: 130 }}>
                        {editingMid === m.id ? (
                          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                            <TextField size="small" value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              sx={{ width: 120, '& input': { fontSize: '0.75rem', py: 0.5 } }}
                              autoFocus />
                            <Tooltip title="Save">
                              <IconButton size="small" color="success" onClick={() => handleSaveEdit(m)}>
                                <CheckCircleOutlined sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Cancel">
                              <IconButton size="small" onClick={() => setEditingMid(null)}>
                                <ErrorOutlined sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <span>{m.target_value ?? '—'}</span>
                            <Tooltip title="Edit">
                              <IconButton size="small"
                                onClick={() => { setEditingMid(m.id); setEditValue(m.target_value ?? '') }}>
                                <EditOutlined sx={{ fontSize: 12 }} />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip label={m.mapping_type} size="small"
                          sx={{ height: 16, fontSize: '0.6rem',
                            bgcolor: alpha(MAPPING_TYPE_COLOR[m.mapping_type] ?? '#64748B', 0.12),
                            color:   MAPPING_TYPE_COLOR[m.mapping_type] ?? '#64748B' }} />
                      </TableCell>
                      <TableCell>
                        <Chip label={m.status} size="small"
                          sx={{ height: 16, fontSize: '0.6rem',
                            bgcolor: alpha(MAPPING_STATUS_COLOR[m.status] ?? '#64748B', 0.12),
                            color:   MAPPING_STATUS_COLOR[m.status] ?? '#64748B' }} />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.25 }}>
                          {m.status === 'pending' && (
                            <>
                              <Tooltip title="Approve">
                                <IconButton size="small" color="success" onClick={() => handleApprove(m)}>
                                  <ThumbUpOutlined sx={{ fontSize: 13 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Reject">
                                <IconButton size="small" color="error" onClick={() => handleReject(m)}>
                                  <ThumbDownOutlined sx={{ fontSize: 13 }} />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          <Tooltip title="Delete">
                            <IconButton size="small" onClick={() => handleDelete(m)}>
                              <DeleteOutlined sx={{ fontSize: 13 }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
          </Collapse>
        </Paper>
      )}

      {/* ── Agent Run Summary (SDLC pipeline view) ── */}
      {(lastManagerLog || lastMapperLog || lastValidLog || versions.length > 0) && (() => {
        let snap: Record<string, unknown> = {}
        if (versions.length > 0 && versions[0].mapping_snapshot) {
          try { snap = JSON.parse(versions[0].mapping_snapshot as string) } catch { /* */ }
        }
        const snapFieldConf  = (snap['field_confidence']  ?? {}) as Record<string, number>
        const snapColLineage = (snap['column_lineage']   ?? {}) as Record<string, string>
        const snapIdCol      = snap['identifier_column'] as string | undefined
        const snapIdTbl      = snap['identifier_table']  as string | undefined

        const confValues    = Object.values(snapFieldConf).map(Number)
        const avgConfPct    = confValues.length ? Math.round(confValues.reduce((a, b) => a + b, 0) / confValues.length * 100) : null
        const highConfCount = confValues.filter(v => v >= 0.7).length
        const midConfCount  = confValues.filter(v => v >= 0.4 && v < 0.7).length
        const lowConfCount  = confValues.filter(v => v < 0.4).length
        const totalMapped   = Object.keys(snapColLineage).length

        const sqlText    = versions.length > 0 ? versions[0].sql_text : ''
        const joinCount  = (sqlText.match(/\bJOIN\b/gi) ?? []).length
        const tableCount = joinCount + (sqlText ? 1 : 0)
        const usedFkJoins = joinCount > 0
        const sqlVersion = versions.length > 0 ? versions[0].version : null

        const uniqueSrcTables = [...new Set(mappingRows.map(r => r.source_table).filter(Boolean))]

        const passedCount = validations.filter(v => v.passed).length
        const totalChecks = validations.length
        const failedChecks = validations.filter(v => !v.passed)

        const idLabel = (snapIdTbl ?? identifierTable) && (snapIdCol ?? identifierColumn)
          ? `${snapIdTbl ?? identifierTable}.${snapIdCol ?? identifierColumn}`
          : (snapIdCol ?? identifierColumn) ?? null

        const xmlCount = lastResult?.validation_summary?.xml_count ?? null

        // Status helpers
        const schemaStatus  = profiles.length > 0 ? 'done' : 'pending'
        const queryStatus   = sqlText ? (lastMapperLog?.status ?? 'done') : 'pending'
        const mappingStatus = totalMapped > 0 || mappingRows.length > 0
          ? (lowConfCount > totalMapped * 0.4 ? 'warn' : 'done') : 'pending'
        const validStatus   = totalChecks > 0
          ? (failedChecks.length === 0 ? 'done' : failedChecks.length <= totalChecks * 0.2 ? 'warn' : 'failed') : 'pending'
        const outputStatus  = xmlCount != null && xmlCount > 0 ? 'done' : lastResult?.status === 'failed' ? 'failed' : 'pending'

        const STATUS_COLOR: Record<string, string> = {
          done: tokens.emerald600, warn: tokens.amber600, failed: tokens.red600,
          pending: '#94A3B8', running: tokens.sky600,
        }

        // AI trace data from agent logs
        const managerTrace = lastManagerLog ? (() => {
          let inp: Record<string,unknown> = {}; let out: Record<string,unknown> = {}
          try { inp = JSON.parse(lastManagerLog.input_summary ?? '{}') } catch { /* */ }
          try { out = JSON.parse(lastManagerLog.output_summary ?? '{}') } catch { /* */ }
          return { inp, out }
        })() : null
        const mapperTrace = lastMapperLog ? (() => {
          let inp: Record<string,unknown> = {}; let out: Record<string,unknown> = {}
          try { inp = JSON.parse(lastMapperLog.input_summary ?? '{}') } catch { /* */ }
          try { out = JSON.parse(lastMapperLog.output_summary ?? '{}') } catch { /* */ }
          return { inp, out }
        })() : null
        const validatorTrace = lastValidLog ? (() => {
          let inp: Record<string,unknown> = {}; let out: Record<string,unknown> = {}
          try { inp = JSON.parse(lastValidLog.input_summary ?? '{}') } catch { /* */ }
          try { out = JSON.parse(lastValidLog.output_summary ?? '{}') } catch { /* */ }
          return { inp, out }
        })() : null

        type SDLCStep = {
          key: string
          label: string
          sublabel: string
          icon: React.ReactNode
          accent: string
          status: string
          stats: Array<{ value: string | number; label: string; color?: string }>
          tooltipRows: Array<{ label: string; value: React.ReactNode }>
          tooltipTip?: string
          hasDetail?: boolean
        }

        const steps: SDLCStep[] = [
          {
            key: 'schema',
            label: 'Schema Collection',
            sublabel: 'Admin → Collect Schema',
            icon: <StorageOutlined sx={{ fontSize: 20 }} />,
            accent: '#64748B',
            status: schemaStatus,
            stats: profiles.length > 0
              ? [
                  { value: profiles.length, label: 'Columns' },
                  { value: joinCount > 0 ? joinCount : 0, label: 'FK Rels', color: joinCount > 0 ? tokens.emerald600 : undefined },
                  { value: uniqueSrcTables.length || '—', label: 'Tables' },
                ]
              : [
                  { value: '—', label: 'Columns' },
                  { value: '—', label: 'FK Rels' },
                  { value: '—', label: 'Tables' },
                ],
            tooltipRows: [
              { label: 'What it does', value: 'Scans the source DB schema — discovers tables, columns, data types, FK relationships, and sample values.' },
              { label: 'Columns profiled', value: profiles.length > 0 ? `${profiles.length} columns across ${uniqueSrcTables.length} tables` : 'Not run yet' },
              { label: 'FK relationships', value: joinCount > 0 ? `${joinCount} FK links found → enables multi-table JOINs` : 'None found — single-table queries only' },
              { label: 'Embeddings', value: 'Run Admin → Generate Embeddings after schema collection to enable semantic field matching' },
              { label: 'Tables found', value: uniqueSrcTables.length > 0 ? uniqueSrcTables.map(String).join(', ') : 'None yet' },
            ],
            tooltipTip: 'Re-run Admin → Collect Schema whenever your source schema changes to keep FK joins up to date.',
          },
          {
            key: 'query',
            label: 'Query Building',
            sublabel: 'Mapper Agent → BFS SQL',
            icon: <AccountTreeOutlined sx={{ fontSize: 20 }} />,
            accent: TEAL,
            status: queryStatus === 'success' ? 'done' : queryStatus === 'failed' ? 'failed' : sqlText ? 'done' : 'pending',
            stats: sqlText
              ? [
                  { value: `v${sqlVersion}`, label: 'Version', color: TEAL },
                  { value: joinCount, label: 'JOINs', color: joinCount > 0 ? tokens.emerald600 : undefined },
                  { value: tableCount, label: 'Tables' },
                ]
              : [
                  { value: '—', label: 'Version' },
                  { value: '—', label: 'JOINs' },
                  { value: '—', label: 'Tables' },
                ],
            tooltipRows: [
              { label: 'What it does', value: 'Mapper Agent builds a SQL SELECT using BFS traversal of the FK graph — automatically joining related tables.' },
              { label: 'Strategy', value: usedFkJoins ? `BFS FK graph → ${joinCount} JOIN${joinCount !== 1 ? 's' : ''} across ${tableCount} tables` : 'Single-table (no FK relations in schema)' },
              { label: 'Identifier', value: idLabel ?? 'Not set — edit in Mapper Agent panel above' },
              { label: 'SQL version', value: sqlVersion != null ? `v${sqlVersion} (${versions.length} version${versions.length !== 1 ? 's' : ''} total)` : 'No SQL yet' },
              { label: 'AI trace', value: mapperTrace ? `Duration: ${lastMapperLog?.duration_ms ? (lastMapperLog.duration_ms / 1000).toFixed(1) + 's' : '—'}, Attempt: ${lastMapperLog?.attempt ?? 1}` : 'No trace yet' },
            ],
            tooltipTip: 'Click "View SQL" to inspect or edit the generated query before running XML generation.',
            hasDetail: !!sqlText,
          },
          {
            key: 'mapping',
            label: 'Field Mapping',
            sublabel: 'Mapper Agent → Embeddings',
            icon: <MapOutlined sx={{ fontSize: 20 }} />,
            accent: PURPLE,
            status: mappingStatus,
            stats: totalMapped > 0
              ? [
                  { value: totalMapped, label: 'Fields', color: PURPLE },
                  { value: avgConfPct != null ? `${avgConfPct}%` : '—', label: 'Avg Conf',
                    color: avgConfPct != null ? (avgConfPct >= 70 ? tokens.emerald600 : avgConfPct >= 40 ? tokens.amber600 : tokens.red600) : undefined },
                  { value: lowConfCount, label: 'Low Conf', color: lowConfCount > 0 ? tokens.red600 : tokens.emerald600 },
                ]
              : [
                  { value: mappingRows.length || '—', label: 'Fields' },
                  { value: '—', label: 'Avg Conf' },
                  { value: '—', label: 'Low Conf' },
                ],
            tooltipRows: [
              { label: 'What it does', value: 'Uses OpenAI embedding cosine similarity to match source columns → target XML paths.' },
              { label: 'Fields mapped', value: totalMapped > 0 ? `${totalMapped} fields via semantic similarity` : mappingRows.length > 0 ? `${mappingRows.length} manual mappings` : 'No mappings yet' },
              { label: 'Confidence', value: avgConfPct != null
                  ? <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.3 }}>
                      <Chip label={`${highConfCount} high ≥70%`} size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(tokens.emerald600, 0.15), color: tokens.emerald600 }} />
                      <Chip label={`${midConfCount} mid 40-70%`} size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(tokens.amber600, 0.15), color: tokens.amber600 }} />
                      <Chip label={`${lowConfCount} low <40%`} size="small" sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(tokens.red600, 0.15), color: tokens.red600 }} />
                    </Box>
                  : 'No confidence data yet' },
              { label: 'Low confidence fields', value: lowConfCount > 0
                  ? Object.entries(snapFieldConf).filter(([,v]) => v < 0.4).slice(0, 5).map(([k, v]) =>
                      `${k} (${Math.round(v * 100)}%)`).join(', ') + (lowConfCount > 5 ? ` +${lowConfCount - 5} more` : '')
                  : 'All fields above 40%' },
              { label: 'AI trace', value: mapperTrace ? `Attempt ${lastMapperLog?.attempt ?? 1}, ${lastMapperLog?.duration_ms ? (lastMapperLog.duration_ms / 1000).toFixed(1) + 's' : '—'}` : 'No trace' },
            ],
            tooltipTip: 'Use Re-match (wand icon) on low-confidence rows or run Generate Embeddings again after schema changes.',
            hasDetail: totalMapped > 0,
          },
          {
            key: 'validation',
            label: 'Validation',
            sublabel: 'Validator Agent → Checks',
            icon: <VerifiedOutlined sx={{ fontSize: 20 }} />,
            accent: tokens.emerald600,
            status: validStatus,
            stats: totalChecks > 0
              ? [
                  { value: passedCount, label: 'Passed', color: passedCount === totalChecks ? tokens.emerald600 : tokens.amber600 },
                  { value: failedChecks.length, label: 'Failed', color: failedChecks.length > 0 ? tokens.red600 : tokens.emerald600 },
                  { value: totalChecks, label: 'Total' },
                ]
              : [
                  { value: '—', label: 'Passed' },
                  { value: '—', label: 'Failed' },
                  { value: '—', label: 'Total' },
                ],
            tooltipRows: [
              { label: 'What it does', value: 'Validator Agent runs structured checks on the mapping and SQL output — verifying data coverage, types, and row counts.' },
              { label: 'Result', value: totalChecks > 0 ? `${passedCount}/${totalChecks} checks passed (${Math.round(passedCount / totalChecks * 100)}%)` : 'No validation run yet' },
              { label: 'Check categories', value: 'Null coverage, data type alignment, identifier presence, row count sanity, field mapping coverage' },
              { label: 'Failed checks', value: failedChecks.length > 0
                  ? <Stack spacing={0.3} sx={{ mt: 0.3 }}>
                      {failedChecks.slice(0, 5).map(v => (
                        <Typography key={v.id} variant="caption" sx={{ fontSize: '0.68rem', fontFamily: 'monospace', color: tokens.red600 }}>
                          ✗ {v.check_name}{v.detail ? ` — ${v.detail}` : ''}
                        </Typography>
                      ))}
                      {failedChecks.length > 5 && <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>+{failedChecks.length - 5} more — see Validation Checks above</Typography>}
                    </Stack>
                  : 'All checks passed' },
              { label: 'AI trace', value: validatorTrace ? `Attempt ${lastValidLog?.attempt ?? 1}, ${lastValidLog?.duration_ms ? (lastValidLog.duration_ms / 1000).toFixed(1) + 's' : '—'}` : 'No trace' },
            ],
            tooltipTip: failedChecks.length > 0 ? 'Fix the failed checks then re-run the pipeline or manually override mappings.' : 'All checks passed — pipeline output is clean.',
            hasDetail: totalChecks > 0,
          },
          {
            key: 'output',
            label: 'XML Output',
            sublabel: 'Output Tab → Records',
            icon: <OutputOutlined sx={{ fontSize: 20 }} />,
            accent: '#8B5CF6',
            status: outputStatus,
            stats: [
              { value: xmlCount ?? '—', label: 'Records', color: xmlCount ? '#8B5CF6' : undefined },
              { value: lastResult?.attempts ?? '—', label: 'Attempts' },
              { value: lastResult ? `v${lastResult.version}` : '—', label: 'Version', color: '#8B5CF6' },
            ],
            tooltipRows: [
              { label: 'What it does', value: 'Applies field mappings + transform expressions to generate one XML record per source row using the configured template.' },
              { label: 'Records generated', value: xmlCount != null ? `${xmlCount} XML record${xmlCount !== 1 ? 's' : ''}` : 'None yet — run pipeline first' },
              { label: 'Pipeline result', value: lastResult ? `${lastResult.status} after ${lastResult.attempts} attempt${lastResult.attempts !== 1 ? 's' : ''}` : 'No run yet' },
              { label: 'Transforms applied', value: mappingRows.filter(r => !!r.transform_expression).length > 0
                  ? `${mappingRows.filter(r => !!r.transform_expression).length} field${mappingRows.filter(r => !!r.transform_expression).length !== 1 ? 's' : ''} with custom transform`
                  : 'No transforms — direct field mapping' },
              { label: 'Next steps', value: 'Download from Output tab or configure Dispatch to send via API / Azure Blob / SFTP' },
            ],
            tooltipTip: xmlCount ? `${xmlCount} records ready — go to Output tab to download or dispatch.` : 'XML will be auto-generated after a successful pipeline run.',
          },
        ]

        const activePopoverStep = steps.find(s => s.key === detailStep)

        return (
          <>
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Box
              onClick={() => setSummaryOpen(o => !o)}
              sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
                borderBottom: summaryOpen ? 1 : 0, borderColor: 'divider' }}>
              <AutoAwesomeOutlined sx={{ fontSize: 16, color: PURPLE }} />
              <Typography variant="body2" fontWeight={700}>Pipeline Summary</Typography>
              <Chip label="SDLC Flow" size="small"
                sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(PURPLE, 0.1), color: PURPLE }} />
              <Typography variant="caption" color="text.disabled" sx={{ ml: 1, fontSize: '0.65rem' }}>
                Hover a step for details · click Details for full trace
              </Typography>
              <Box sx={{ flex: 1 }} />
              {summaryOpen
                ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />
                : <ExpandMoreOutlined  sx={{ fontSize: 18, color: 'text.secondary' }} />}
            </Box>
            <Collapse in={summaryOpen}>
              <Box sx={{ p: 2.5 }}>
                {/* ── Flow row ── */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', pb: 0.5 }}>
                  {steps.map((step, idx) => (
                    <Box key={step.key} sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 170 }}>
                      {/* ── Step card ── */}
                      <Tooltip
                        placement="top"
                        arrow
                        componentsProps={{
                          tooltip: {
                            sx: {
                              bgcolor: (t) => t.palette.mode === 'dark' ? '#1e293b' : '#fff',
                              color: 'text.primary',
                              boxShadow: 6,
                              border: 1,
                              borderColor: alpha(step.accent, 0.3),
                              borderRadius: 2,
                              p: 1.5,
                              maxWidth: 340,
                            },
                          },
                          arrow: { sx: { color: (t) => t.palette.mode === 'dark' ? '#1e293b' : '#fff' } },
                        }}
                        title={
                          <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                              <Box sx={{ color: step.accent }}>{step.icon}</Box>
                              <Box>
                                <Typography fontWeight={700} sx={{ fontSize: '0.82rem', color: step.accent, lineHeight: 1 }}>
                                  {step.label}
                                </Typography>
                                <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>{step.sublabel}</Typography>
                              </Box>
                              <Chip label={step.status === 'done' ? 'Complete' : step.status === 'warn' ? 'Warning' : step.status === 'failed' ? 'Failed' : 'Pending'}
                                size="small" sx={{ ml: 'auto', height: 18, fontSize: '0.6rem',
                                  bgcolor: alpha(STATUS_COLOR[step.status], 0.15), color: STATUS_COLOR[step.status] }} />
                            </Box>
                            <Divider sx={{ mb: 1, borderColor: alpha(step.accent, 0.2) }} />
                            <Stack spacing={0.75}>
                              {step.tooltipRows.map((row, ri) => (
                                <Box key={ri}>
                                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
                                    letterSpacing: 0.5, color: 'text.disabled', mb: 0.2 }}>
                                    {row.label}
                                  </Typography>
                                  {typeof row.value === 'string'
                                    ? <Typography sx={{ fontSize: '0.72rem', color: 'text.primary', lineHeight: 1.4 }}>{row.value}</Typography>
                                    : row.value}
                                </Box>
                              ))}
                            </Stack>
                            {step.tooltipTip && (
                              <Box sx={{ mt: 1.25, pt: 1, borderTop: 1, borderColor: alpha(step.accent, 0.2),
                                display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                                <LightbulbOutlined sx={{ fontSize: 12, color: tokens.amber600, mt: 0.2, flexShrink: 0 }} />
                                <Typography sx={{ fontSize: '0.68rem', color: tokens.amber600, lineHeight: 1.4 }}>
                                  {step.tooltipTip}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        }
                      >
                        <Paper
                          variant="outlined"
                          onClick={(e) => {
                            if (step.hasDetail) {
                              e.stopPropagation()
                              setDetailAnchorEl(e.currentTarget)
                              setDetailStep(step.key)
                            }
                          }}
                          sx={{
                            flex: 1, borderRadius: 2, overflow: 'hidden',
                            borderColor: alpha(STATUS_COLOR[step.status], 0.3),
                            cursor: step.hasDetail ? 'pointer' : 'default',
                            transition: 'box-shadow 0.15s, transform 0.15s',
                            '&:hover': step.hasDetail ? {
                              boxShadow: `0 4px 16px ${alpha(step.accent, 0.2)}`,
                              transform: 'translateY(-1px)',
                            } : {},
                          }}
                        >
                          {/* Colored top accent bar */}
                          <Box sx={{ height: 4, bgcolor: STATUS_COLOR[step.status], borderRadius: '2px 2px 0 0' }} />

                          <Box sx={{ p: 1.75 }}>
                            {/* Header row */}
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.25 }}>
                              <Box sx={{ color: step.accent, mt: 0.1 }}>{step.icon}</Box>
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography fontWeight={700} sx={{ fontSize: '0.78rem', color: step.accent, lineHeight: 1.2 }}>
                                  {step.label}
                                </Typography>
                                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', mt: 0.2 }}>
                                  {step.sublabel}
                                </Typography>
                              </Box>
                              <Box sx={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                bgcolor: STATUS_COLOR[step.status],
                                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                                  {idx + 1}
                                </Typography>
                              </Box>
                            </Box>

                            {/* Status chip */}
                            <Chip
                              label={step.status === 'done' ? 'Complete' : step.status === 'warn' ? 'Warning' : step.status === 'failed' ? 'Failed' : 'Pending'}
                              size="small"
                              sx={{ height: 18, fontSize: '0.62rem', mb: 1.5,
                                bgcolor: alpha(STATUS_COLOR[step.status], 0.12),
                                color: STATUS_COLOR[step.status], fontWeight: 600 }}
                            />

                            {/* Stats row */}
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              {step.stats.map((stat, si) => (
                                <Box key={si} sx={{ flex: 1, textAlign: 'center', p: 0.75, borderRadius: 1,
                                  bgcolor: alpha(step.accent, 0.06), border: 1,
                                  borderColor: alpha(step.accent, 0.12) }}>
                                  <Typography sx={{ fontSize: '1rem', fontWeight: 800, lineHeight: 1,
                                    color: stat.color ?? step.accent, fontFamily: 'monospace' }}>
                                    {stat.value}
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', mt: 0.3, lineHeight: 1 }}>
                                    {stat.label}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>

                            {/* Confidence bar (mapping step only) */}
                            {step.key === 'mapping' && confValues.length > 0 && (
                              <Box sx={{ mt: 1.25 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                                  <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>Confidence</Typography>
                                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700,
                                    color: avgConfPct != null && avgConfPct >= 70 ? tokens.emerald600 : tokens.amber600 }}>
                                    {avgConfPct}%
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 6, borderRadius: 3, bgcolor: alpha(step.accent, 0.12), overflow: 'hidden' }}>
                                  <Box sx={{ height: '100%', borderRadius: 3,
                                    width: `${avgConfPct ?? 0}%`,
                                    bgcolor: avgConfPct != null && avgConfPct >= 70 ? tokens.emerald600
                                      : avgConfPct != null && avgConfPct >= 40 ? tokens.amber600 : tokens.red600,
                                    transition: 'width 0.6s ease' }} />
                                </Box>
                              </Box>
                            )}

                            {/* Validation progress bar */}
                            {step.key === 'validation' && totalChecks > 0 && (
                              <Box sx={{ mt: 1.25 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                                  <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>Pass rate</Typography>
                                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700,
                                    color: passedCount === totalChecks ? tokens.emerald600 : tokens.amber600 }}>
                                    {Math.round(passedCount / totalChecks * 100)}%
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 6, borderRadius: 3, bgcolor: alpha(tokens.red600, 0.12), overflow: 'hidden' }}>
                                  <Box sx={{ height: '100%', borderRadius: 3,
                                    width: `${Math.round(passedCount / totalChecks * 100)}%`,
                                    bgcolor: passedCount === totalChecks ? tokens.emerald600 : tokens.amber600,
                                    transition: 'width 0.6s ease' }} />
                                </Box>
                              </Box>
                            )}

                            {/* "Details" button for steps with detail popovers */}
                            {step.hasDetail && (
                              <Box sx={{ mt: 1.25, display: 'flex', justifyContent: 'flex-end' }}>
                                <Typography sx={{ fontSize: '0.6rem', color: step.accent, fontWeight: 600,
                                  cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
                                  Details →
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        </Paper>
                      </Tooltip>

                      {/* Arrow connector */}
                      {idx < steps.length - 1 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 1, flexShrink: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Box sx={{ width: 24, height: 2,
                              background: `linear-gradient(90deg, ${alpha(STATUS_COLOR[step.status], 0.5)}, ${alpha(STATUS_COLOR[steps[idx+1].status], 0.5)})` }} />
                            <Box sx={{ width: 0, height: 0,
                              borderTop: '5px solid transparent',
                              borderBottom: '5px solid transparent',
                              borderLeft: `7px solid ${alpha(STATUS_COLOR[steps[idx+1].status], 0.6)}`,
                            }} />
                          </Box>
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>

                {/* ── AI Trace row ── */}
                {(lastManagerLog || lastMapperLog || lastValidLog) && (
                  <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {[
                      { key: 'manager', label: 'Manager', log: lastManagerLog, color: tokens.sky600 },
                      { key: 'mapper',  label: 'Mapper',  log: lastMapperLog,  color: PURPLE },
                      { key: 'validator', label: 'Validator', log: lastValidLog, color: tokens.emerald600 },
                    ].map(({ key, label, log, color }) => log && (
                      <Tooltip key={key} placement="top" arrow
                        componentsProps={{ tooltip: { sx: { bgcolor: (t) => t.palette.mode === 'dark' ? '#1e293b' : '#fff',
                          color: 'text.primary', boxShadow: 6, border: 1, borderColor: alpha(color, 0.3),
                          borderRadius: 2, p: 1.5, maxWidth: 360 } },
                          arrow: { sx: { color: (t) => t.palette.mode === 'dark' ? '#1e293b' : '#fff' } } }}
                        title={
                          <Box>
                            <Typography fontWeight={700} sx={{ fontSize: '0.78rem', color, mb: 1 }}>{label} Agent — AI Trace</Typography>
                            <Divider sx={{ mb: 1, borderColor: alpha(color, 0.2) }} />
                            {log.input_summary && (() => {
                              let parsed: Record<string,unknown> | null = null
                              try { parsed = JSON.parse(log.input_summary) } catch { /* */ }
                              return (
                                <Box sx={{ mb: 1 }}>
                                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
                                    letterSpacing: 0.5, color: 'text.disabled', mb: 0.5 }}>Input</Typography>
                                  {parsed
                                    ? Object.entries(parsed).slice(0, 4).map(([k, v]) => (
                                        <Box key={k} sx={{ display: 'flex', gap: 1, mb: 0.3 }}>
                                          <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', minWidth: 80, flexShrink: 0 }}>{k}</Typography>
                                          <Typography sx={{ fontSize: '0.65rem', color: 'text.primary', wordBreak: 'break-all' }}>
                                            {Array.isArray(v) ? (v.length === 0 ? '—' : v.map(String).join(', ')) : v == null ? '—' : String(v).slice(0, 80)}
                                          </Typography>
                                        </Box>
                                      ))
                                    : <Typography sx={{ fontSize: '0.65rem' }}>{log.input_summary.slice(0, 120)}</Typography>
                                  }
                                </Box>
                              )
                            })()}
                            {log.output_summary && (() => {
                              let parsed: Record<string,unknown> | null = null
                              try { parsed = JSON.parse(log.output_summary) } catch { /* */ }
                              return (
                                <Box>
                                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
                                    letterSpacing: 0.5, color: 'text.disabled', mb: 0.5 }}>Output</Typography>
                                  {parsed
                                    ? Object.entries(parsed).slice(0, 4).map(([k, v]) => (
                                        <Box key={k} sx={{ display: 'flex', gap: 1, mb: 0.3 }}>
                                          <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', minWidth: 80, flexShrink: 0 }}>{k}</Typography>
                                          <Typography sx={{ fontSize: '0.65rem', color: 'text.primary', wordBreak: 'break-all' }}>
                                            {Array.isArray(v) ? (v.length === 0 ? '—' : v.map(String).join(', ')) : v == null ? '—' : String(v).slice(0, 80)}
                                          </Typography>
                                        </Box>
                                      ))
                                    : <Typography sx={{ fontSize: '0.65rem' }}>{log.output_summary.slice(0, 120)}</Typography>
                                  }
                                </Box>
                              )
                            })()}
                          </Box>
                        }
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.75,
                          borderRadius: 1.5, border: 1, borderColor: alpha(color, 0.25),
                          bgcolor: alpha(color, 0.04), cursor: 'pointer',
                          '&:hover': { bgcolor: alpha(color, 0.08) } }}>
                          <BiotechOutlined sx={{ fontSize: 13, color }} />
                          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color }}>{label}</Typography>
                          <Chip label={log.status} size="small"
                            sx={{ height: 16, fontSize: '0.58rem',
                              bgcolor: alpha(RUN_STATUS_COLORS[log.status] ?? '#64748B', 0.12),
                              color: RUN_STATUS_COLORS[log.status] ?? '#64748B' }} />
                          {log.duration_ms != null && (
                            <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>
                              {(log.duration_ms / 1000).toFixed(1)}s
                            </Typography>
                          )}
                          {log.attempt > 1 && (
                            <Typography sx={{ fontSize: '0.6rem', color: tokens.amber600 }}>
                              ×{log.attempt}
                            </Typography>
                          )}
                        </Box>
                      </Tooltip>
                    ))}
                  </Box>
                )}

                {/* ── Query Intelligence tip bar ── */}
                <Box sx={{ mt: 2, p: 1.5, borderRadius: 1.5, border: 1,
                  borderColor: alpha(tokens.amber600, 0.25), bgcolor: alpha(tokens.amber600, 0.03),
                  display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <LightbulbOutlined sx={{ fontSize: 15, color: tokens.amber600, mt: 0.2, flexShrink: 0 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.72rem', lineHeight: 1.6 }}>
                    <strong>Query Intelligence:</strong>{' '}
                    <strong>Admin → Collect Schema</strong> discovers FK relationships → enables multi-table JOIN generation via BFS traversal.{' '}
                    <strong>Admin → Generate Embeddings</strong> builds OpenAI semantic vectors per column → Mapper uses cosine similarity to score source↔target field matches.
                    {!usedFkJoins && sqlText && (
                      <span style={{ color: tokens.amber600 }}>{' '}No JOINs used — run Collect Schema to unlock cross-table queries.</span>
                    )}
                    {avgConfPct != null && avgConfPct < 60 && (
                      <span style={{ color: tokens.amber600 }}>{' '}Low avg confidence ({avgConfPct}%) — re-run Generate Embeddings after schema updates.</span>
                    )}
                  </Typography>
                </Box>
              </Box>
            </Collapse>
          </Paper>

          {/* ── Detail Popover (Query Build / Field Mapping / Validation) ── */}
          <Popover
            open={!!detailStep && !!detailAnchorEl}
            anchorEl={detailAnchorEl}
            onClose={() => { setDetailAnchorEl(null); setDetailStep(null) }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            PaperProps={{ sx: { borderRadius: 2, boxShadow: 8, border: 1,
              borderColor: alpha(activePopoverStep?.accent ?? PURPLE, 0.3),
              maxWidth: 560, width: '90vw' } }}
          >
            {activePopoverStep && (
              <Box sx={{ p: 2.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Box sx={{ color: activePopoverStep.accent }}>{activePopoverStep.icon}</Box>
                  <Typography fontWeight={700} sx={{ fontSize: '0.95rem', color: activePopoverStep.accent }}>
                    {activePopoverStep.label} — Details
                  </Typography>
                  <IconButton size="small" sx={{ ml: 'auto' }}
                    onClick={() => { setDetailAnchorEl(null); setDetailStep(null) }}>
                    <CloseOutlined sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
                <Divider sx={{ mb: 2 }} />

                {/* Query Build detail */}
                {detailStep === 'query' && sqlText && (
                  <Stack spacing={1.5}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Chip label={`v${sqlVersion}`} size="small" sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
                      <Chip label={usedFkJoins ? `${joinCount} JOINs — BFS FK graph` : 'Single table'} size="small" sx={{ height: 20, fontSize: '0.68rem' }} />
                      {idLabel && <Chip label={`Identifier: ${idLabel}`} size="small" sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />}
                    </Box>
                    {uniqueSrcTables.length > 0 && (
                      <Box>
                        <Typography variant="caption" fontWeight={700} color="text.secondary"
                          sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                          Tables Joined
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {uniqueSrcTables.map(t => (
                            <Chip key={String(t)} label={String(t)} size="small"
                              sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace',
                                bgcolor: alpha(TEAL, 0.08), color: TEAL }} />
                          ))}
                        </Box>
                      </Box>
                    )}
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                        <Typography variant="caption" fontWeight={700} color="text.secondary"
                          sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5 }}>
                          Generated SQL (v{sqlVersion})
                        </Typography>
                        <Button size="small" variant="outlined" sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75, minWidth: 0 }}
                          onClick={() => copyToClipboard(sqlText)}>
                          Copy
                        </Button>
                      </Box>
                      <Box component="pre" sx={{ m: 0, p: 1.5,
                        bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f1f5f9',
                        borderRadius: 1, fontSize: '0.7rem', fontFamily: 'monospace',
                        border: 1, borderColor: 'divider', maxHeight: 260, overflow: 'auto',
                        color: TEAL, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {sqlText}
                      </Box>
                    </Box>
                    {mapperTrace && (
                      <Box>
                        <Typography variant="caption" fontWeight={700} color="text.secondary"
                          sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                          AI Trace — Mapper Agent
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                          {Object.entries(mapperTrace.inp).slice(0, 4).map(([k, v]) => (
                            <Box key={k} sx={{ flex: '1 1 45%', p: 0.75, borderRadius: 1,
                              bgcolor: alpha(PURPLE, 0.05), border: 1, borderColor: alpha(PURPLE, 0.15) }}>
                              <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</Typography>
                              <Typography sx={{ fontSize: '0.67rem', color: 'text.primary', wordBreak: 'break-all' }}>
                                {Array.isArray(v) ? v.length + ' items' : v == null ? '—' : String(v).slice(0, 60)}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Stack>
                )}

                {/* Field Mapping detail */}
                {detailStep === 'mapping' && (
                  <Stack spacing={1.5}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {avgConfPct != null && <Chip label={`Avg ${avgConfPct}%`} size="small" sx={{ height: 20, fontSize: '0.68rem',
                        bgcolor: alpha(avgConfPct >= 70 ? tokens.emerald600 : tokens.amber600, 0.12),
                        color: avgConfPct >= 70 ? tokens.emerald600 : tokens.amber600 }} />}
                      <Chip label={`${highConfCount} high`} size="small" sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600 }} />
                      <Chip label={`${midConfCount} mid`}  size="small" sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(tokens.amber600,  0.12), color: tokens.amber600 }} />
                      <Chip label={`${lowConfCount} low`}  size="small" sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(tokens.red600,    0.12), color: tokens.red600 }} />
                    </Box>
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary"
                        sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 0.75 }}>
                        Field Confidence Breakdown
                      </Typography>
                      <Stack spacing={0.4} sx={{ maxHeight: 220, overflow: 'auto' }}>
                        {Object.entries(snapFieldConf).sort(([,a],[,b]) => a - b).map(([path, score]) => {
                          const pct = Math.round((score as number) * 100)
                          const col = pct >= 70 ? tokens.emerald600 : pct >= 40 ? tokens.amber600 : tokens.red600
                          return (
                            <Box key={path} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                              <Typography sx={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'text.secondary', flex: 1, minWidth: 0,
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{path}</Typography>
                              <Box sx={{ width: 60, height: 5, borderRadius: 2, bgcolor: alpha(col, 0.15), flexShrink: 0 }}>
                                <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 2, bgcolor: col }} />
                              </Box>
                              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: col, minWidth: 28, textAlign: 'right' }}>
                                {pct}%
                              </Typography>
                            </Box>
                          )
                        })}
                      </Stack>
                    </Box>
                  </Stack>
                )}

                {/* Validation detail */}
                {detailStep === 'validation' && totalChecks > 0 && (
                  <Stack spacing={1.5}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Chip label={`${passedCount} passed`} size="small" sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600 }} />
                      <Chip label={`${failedChecks.length} failed`} size="small" sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600 }} />
                      <Chip label={`${Math.round(passedCount / totalChecks * 100)}% pass rate`} size="small" sx={{ height: 20, fontSize: '0.68rem' }} />
                    </Box>
                    <LinearProgress variant="determinate" value={Math.round(passedCount / totalChecks * 100)}
                      sx={{ height: 6, borderRadius: 3,
                        '& .MuiLinearProgress-bar': { bgcolor: passedCount === totalChecks ? tokens.emerald600 : tokens.amber600 } }} />
                    <Box>
                      <Typography variant="caption" fontWeight={700} color="text.secondary"
                        sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 0.75 }}>
                        All Checks
                      </Typography>
                      <Stack spacing={0.3} sx={{ maxHeight: 240, overflow: 'auto' }}>
                        {validations.map(v => (
                          <Box key={v.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', p: 0.75, borderRadius: 1,
                            bgcolor: v.passed ? alpha(tokens.emerald600, 0.04) : alpha(tokens.red600, 0.06) }}>
                            {v.passed
                              ? <CheckCircleOutlined sx={{ fontSize: 13, color: tokens.emerald600, mt: 0.1, flexShrink: 0 }} />
                              : <ErrorOutlined sx={{ fontSize: 13, color: tokens.red600, mt: 0.1, flexShrink: 0 }} />}
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography sx={{ fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 600,
                                color: v.passed ? tokens.emerald600 : tokens.red600 }}>
                                {v.check_name}
                              </Typography>
                              {v.detail && (
                                <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', mt: 0.1 }}>
                                  {v.detail}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        ))}
                      </Stack>
                    </Box>
                    {validatorTrace && (
                      <Box sx={{ pt: 0.5 }}>
                        <Typography variant="caption" fontWeight={700} color="text.secondary"
                          sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                          AI Trace — Validator Agent
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                          {Object.entries(validatorTrace.out).slice(0, 4).map(([k, v]) => (
                            <Box key={k} sx={{ flex: '1 1 45%', p: 0.75, borderRadius: 1,
                              bgcolor: alpha(tokens.emerald600, 0.05), border: 1, borderColor: alpha(tokens.emerald600, 0.15) }}>
                              <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</Typography>
                              <Typography sx={{ fontSize: '0.67rem', color: 'text.primary', wordBreak: 'break-all' }}>
                                {Array.isArray(v) ? v.length + ' items' : v == null ? '—' : String(v).slice(0, 60)}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Stack>
                )}
              </Box>
            )}
          </Popover>
          </>
        )
      })()}

      {/* ── Empty state ── */}
      {profiles.length === 0 && mappings.length === 0 && !running && (
        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
          Click <strong>Re-Profile Columns</strong> to scan the source schema, then <strong>Run Pipeline</strong> to generate mappings and XML.
          Generated XML records will appear in the <strong>Output</strong> tab.
        </Alert>
      )}

      {/* ── AI Transform Dialog ── */}
      <Dialog open={!!transformRow} onClose={() => { setTransformRow(null); setTransformResult(null) }}
        fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoAwesomeOutlined sx={{ color: PURPLE }} />
            <Typography fontWeight={700} fontSize="0.95rem">AI Transform</Typography>
          </Box>
          {transformRow && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              <strong>Field:</strong> {transformRow.target_path}
              {' · '}
              <strong>Source:</strong> {transformRow.source_table ? `${transformRow.source_table}.` : ''}{transformRow.source_column ?? '—'}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              label="Describe the transformation"
              fullWidth multiline minRows={2}
              size="small"
              placeholder={'e.g. "Convert M to Male, F to Female"\n"Format date as YYYY-MM-DD"\n"Multiply by 100 for percentage"'}
              value={transformInstruction}
              onChange={(e) => setTransformInstruction(e.target.value)}
              sx={{ '& textarea': { fontSize: '0.82rem' } }}
            />

            {/* Show existing or newly generated result */}
            {transformResult && (
              <Box>
                <Divider sx={{ mb: 1.5 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                  {transformResult.explanation && !transformEditMode && (
                    <Typography variant="caption" color="text.secondary"
                      sx={{ flex: 1, fontStyle: 'italic' }}>
                      {transformResult.explanation}
                    </Typography>
                  )}
                  {!transformEditMode && (
                    <Tooltip title="Manually edit the expressions">
                      <IconButton size="small" sx={{ ml: 'auto' }} onClick={enterTransformEditMode}>
                        <EditOutlined sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>

                {transformEditMode ? (
                  <Stack spacing={1.5}>
                    <TextField
                      label="SQL Expression (applied in SELECT)"
                      fullWidth multiline minRows={2}
                      size="small"
                      value={transformEditSql}
                      onChange={(e) => setTransformEditSql(e.target.value)}
                      InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.78rem', color: TEAL } }}
                    />
                    <TextField
                      label="Python Expression (applied at XML generation)"
                      fullWidth multiline minRows={2}
                      size="small"
                      helperText="value = raw field value from SQL result"
                      value={transformEditPy}
                      onChange={(e) => setTransformEditPy(e.target.value)}
                      InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.78rem', color: PURPLE } }}
                    />
                  </Stack>
                ) : (
                  <Stack spacing={0.5}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary"
                      sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5 }}>
                      SQL Expression (applied in SELECT)
                    </Typography>
                    <Box component="pre"
                      sx={{ m: 0, p: 1.25, bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f1f5f9',
                        borderRadius: 1, fontSize: '0.74rem', fontFamily: 'monospace',
                        overflowX: 'auto', whiteSpace: 'pre-wrap', border: 1, borderColor: 'divider',
                        color: TEAL }}>
                      {transformResult.sql_expression || '(none)'}
                    </Box>
                    <Typography variant="caption" fontWeight={700} color="text.secondary"
                      sx={{ pt: 0.75, textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5 }}>
                      Python Expression (applied at XML generation)
                    </Typography>
                    <Box component="pre"
                      sx={{ m: 0, p: 1.25, bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f1f5f9',
                        borderRadius: 1, fontSize: '0.74rem', fontFamily: 'monospace',
                        overflowX: 'auto', whiteSpace: 'pre-wrap', border: 1, borderColor: 'divider',
                        color: PURPLE }}>
                      {'# value = raw field value from SQL result\n'}
                      {transformResult.python_expression || '(none)'}
                    </Box>
                    <Typography variant="caption" color={tokens.emerald600} sx={{ fontSize: '0.7rem' }}>
                      ✓ Applied — re-run "Generate XML" or "Run Pipeline" to see the updated output.
                    </Typography>
                  </Stack>
                )}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {transformEditMode ? (
            <>
              <Button size="small" onClick={() => setTransformEditMode(false)} disabled={transformSaving}>
                Cancel
              </Button>
              <Button size="small" variant="contained"
                startIcon={transformSaving ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
                disabled={transformSaving}
                onClick={handleSaveTransformManual}>
                {transformSaving ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <Button size="small" onClick={() => { setTransformRow(null); setTransformResult(null); setTransformEditMode(false) }}>
                Close
              </Button>
              <Button size="small" variant="contained" color="secondary"
                startIcon={transformLoading ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeOutlined />}
                disabled={transformLoading || !transformInstruction.trim()}
                onClick={handleAiTransform}>
                {transformLoading ? 'Generating…' : transformResult ? 'Re-Generate' : 'Generate Transform'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  )
}
