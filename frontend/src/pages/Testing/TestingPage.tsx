/**
 * Testing / Reconciliation Page
 *
 * Tabs:
 *   1. Test Cases  — test cases grouped by group_name, create/edit/delete
 *   2. Run & Results — run individual / all, grouped results
 *   3. Dashboard   — summary stats + per-group breakdown
 */
import {
  Box, Typography, Tabs, Tab, Button, Chip, IconButton,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Select, FormControl, InputLabel,
  CircularProgress, Alert, Tooltip, alpha, Divider, Grid,
  Card, CardContent, Collapse,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, PlayArrowOutlined,
  AutoAwesomeOutlined, RefreshOutlined, CheckCircleOutlined,
  CancelOutlined, ErrorOutlined, FactCheckOutlined,
  AssessmentOutlined, EditOutlined, ExpandMoreOutlined,
  ExpandLessOutlined, FolderOutlined, PlayCircleOutlined,
  ScheduleOutlined, VisibilityOutlined,
} from '@mui/icons-material'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { testsApi, connectionsApi } from '@/api'
import type {
  AITestCase, AITestCaseCreate, AITestResult,
  TestSummaryRow, ValidationTypeEnum, SourceConnection,
} from '@/types'
import { tokens } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'

// ── constants ──────────────────────────────────────────────────

const UNGROUPED = '(Ungrouped)'

const VTYPES: { value: ValidationTypeEnum; label: string; group: string }[] = [
  { value: 'count',        label: 'Row Count Match',     group: 'Aggregate' },
  { value: 'sum',          label: 'Sum Match',           group: 'Aggregate' },
  { value: 'null_check',   label: 'Null Check',          group: 'Aggregate' },
  { value: 'duplicate',    label: 'Duplicate Check',     group: 'Aggregate' },
  { value: 'custom',       label: 'Custom SQL',          group: 'Aggregate' },
  { value: 'row_level',    label: 'Row-Level Compare',   group: 'Row-Level' },
  { value: 'column_level', label: 'Column Compare',      group: 'Row-Level' },
]

const ROW_LEVEL_TYPES: ValidationTypeEnum[] = ['row_level', 'column_level']

// ── helpers ────────────────────────────────────────────────────

function vtypeLabel(v: string) {
  return VTYPES.find((t) => t.value === v)?.label ?? v
}

function ResultChip({ result }: { result: string }) {
  if (result === 'pass')
    return <Chip icon={<CheckCircleOutlined />} label="Pass" color="success" size="small" />
  if (result === 'fail')
    return <Chip icon={<CancelOutlined />} label="Fail" color="error" size="small" />
  if (result === 'error')
    return <Chip icon={<ErrorOutlined />} label="Error" color="warning" size="small" />
  return <Chip label="—" size="small" variant="outlined" />
}

/** Compact inline row-level summary (no expand — use eye button for details) */
function RowLevelSummary({ res, isDark }: { res: AITestResult; isDark: boolean }) {
  const { mismatch_count: mc, missing_source_count: msc, missing_target_count: mtc } = res
  if (mc == null && msc == null && mtc == null) return null
  const total = (mc ?? 0) + (msc ?? 0) + (mtc ?? 0)
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
      mt: 0.5, px: 1, py: 0.25, borderRadius: 1, fontSize: '0.72rem',
      bgcolor: total > 0 ? alpha('#ef4444', isDark ? 0.1 : 0.06) : alpha('#22c55e', isDark ? 0.08 : 0.04),
      color: total > 0 ? 'error.main' : 'success.main',
      border: '1px solid', borderColor: total > 0 ? alpha('#ef4444', 0.22) : alpha('#22c55e', 0.18),
    }}>
      {mtc != null && <span>⬇ target: <strong>{mtc}</strong></span>}
      {msc != null && <span>⬆ source: <strong>{msc}</strong></span>}
      {mc  != null && <span>≠ diff: <strong>{mc}</strong></span>}
    </Box>
  )
}

/** Full detail dialog opened by the eye button */
function TestDetailDialog({
  open, onClose, tc, res, isDark,
}: {
  open: boolean; onClose: () => void
  tc: AITestCase; res: AITestResult | null; isDark: boolean
}) {
  if (!res) return null

  let mismatches: import('@/types').MismatchEntry[] = []
  let missingSrc: string[] = []
  let missingTgt: string[] = []
  try { mismatches = JSON.parse(res.sample_mismatches ?? '[]') } catch { mismatches = [] }
  try { missingSrc = JSON.parse(res.sample_missing_source ?? '[]') } catch { missingSrc = [] }
  try { missingTgt = JSON.parse(res.sample_missing_target ?? '[]') } catch { missingTgt = [] }

  const isRowLevel = ROW_LEVEL_TYPES.includes(tc.validation_type)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" fontWeight={700}>{tc.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {vtypeLabel(tc.validation_type)} &nbsp;·&nbsp; ran {new Date(res.ran_at).toLocaleString()}
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {/* Summary bar */}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', px: 3, py: 2,
          bgcolor: isDark ? alpha('#fff', 0.03) : alpha('#000', 0.02) }}>
          <Box sx={{ textAlign: 'center', minWidth: 70 }}>
            <Typography variant="h5" fontWeight={700}>{res.source_value ?? '—'}</Typography>
            <Typography variant="caption" color="text.secondary">Source rows</Typography>
          </Box>
          <Box sx={{ textAlign: 'center', minWidth: 70 }}>
            <Typography variant="h5" fontWeight={700}>{res.target_value ?? '—'}</Typography>
            <Typography variant="caption" color="text.secondary">Target rows</Typography>
          </Box>
          {isRowLevel && <>
            <Box sx={{ textAlign: 'center', minWidth: 70 }}>
              <Typography variant="h5" fontWeight={700} color={
                (res.missing_target_count ?? 0) > 0 ? 'error.main' : 'success.main'}>
                {res.missing_target_count ?? 0}
              </Typography>
              <Typography variant="caption" color="text.secondary">Missing in target</Typography>
            </Box>
            <Box sx={{ textAlign: 'center', minWidth: 70 }}>
              <Typography variant="h5" fontWeight={700} color={
                (res.missing_source_count ?? 0) > 0 ? 'error.main' : 'success.main'}>
                {res.missing_source_count ?? 0}
              </Typography>
              <Typography variant="caption" color="text.secondary">Missing in source</Typography>
            </Box>
            <Box sx={{ textAlign: 'center', minWidth: 70 }}>
              <Typography variant="h5" fontWeight={700} color={
                (res.mismatch_count ?? 0) > 0 ? 'warning.main' : 'success.main'}>
                {res.mismatch_count ?? 0}
              </Typography>
              <Typography variant="caption" color="text.secondary">Value mismatches</Typography>
            </Box>
          </>}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
            {res.result === 'pass'
              ? <Chip icon={<CheckCircleOutlined />} label="Pass" color="success" />
              : res.result === 'fail'
              ? <Chip icon={<CancelOutlined />} label="Fail" color="error" />
              : <Chip icon={<ErrorOutlined />} label="Error" color="warning" />}
          </Box>
        </Box>

        <Box sx={{ px: 3, py: 1.5 }}>
          {/* Remarks / details */}
          {res.remarks && (
            <Box sx={{ mb: 2, p: 1.5, borderRadius: 1, bgcolor: isDark ? alpha('#fff', 0.04) : alpha('#000', 0.03),
              fontFamily: 'monospace', fontSize: '0.78rem', color: 'text.secondary', wordBreak: 'break-all' }}>
              {res.remarks}
            </Box>
          )}

          {/* Missing in target */}
          {missingTgt.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} color="error.main" sx={{ mb: 0.5 }}>
                Missing in Target ({res.missing_target_count} rows) — showing up to {missingTgt.length}
              </Typography>
              <Box sx={{ maxHeight: 160, overflow: 'auto', borderRadius: 1,
                border: '1px solid', borderColor: alpha('#ef4444', 0.25) }}>
                <Table size="small">
                  <TableBody>
                    {missingTgt.map((key) => (
                      <TableRow key={key}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', py: 0.3 }}>{key}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}

          {/* Missing in source */}
          {missingSrc.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} color="error.main" sx={{ mb: 0.5 }}>
                Missing in Source ({res.missing_source_count} rows) — showing up to {missingSrc.length}
              </Typography>
              <Box sx={{ maxHeight: 160, overflow: 'auto', borderRadius: 1,
                border: '1px solid', borderColor: alpha('#ef4444', 0.25) }}>
                <Table size="small">
                  <TableBody>
                    {missingSrc.map((key) => (
                      <TableRow key={key}>
                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem', py: 0.3 }}>{key}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}

          {/* Value mismatches */}
          {isRowLevel && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} color="warning.main" sx={{ mb: 0.5 }}>
                Value Mismatches ({res.mismatch_count} rows) — showing up to {mismatches.length}
              </Typography>
              {mismatches.length === 0 ? (
                <Typography variant="caption" color="success.main">No value mismatches found.</Typography>
              ) : (
                <Box sx={{ maxHeight: 300, overflow: 'auto', borderRadius: 1,
                  border: '1px solid', borderColor: alpha('#f59e0b', 0.3) }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', py: 0.5 }}>Key</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', py: 0.5 }}>Column</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', py: 0.5 }}>Source Value</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem', py: 0.5 }}>Target Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {mismatches.flatMap((s) =>
                        Object.entries(s.differences).map(([col, diff]) => (
                          <TableRow key={`${s.key}-${col}`}>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', py: 0.3 }}>{s.key}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', py: 0.3 }}>{col}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', py: 0.3, color: 'error.light' }}>{diff.source}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem', py: 0.3, color: 'warning.main' }}>{diff.target}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

const emptyForm = (): Partial<AITestCaseCreate> => ({
  group_name: '',
  name: '',
  source_conn_id: undefined,
  target_conn_id: undefined,
  source_query: '',
  target_query: '',
  validation_type: 'count',
  threshold: '0',
  identifier_column: '',
  reconciliation_type: 'aggregate',
  columns_to_compare: '',
})

// ── CaseFormDialog ─────────────────────────────────────────────

interface CaseFormProps {
  open: boolean
  initial: Partial<AITestCaseCreate>
  connections: SourceConnection[]
  existingGroups: string[]
  onSave: (data: AITestCaseCreate) => void
  onClose: () => void
  title: string
}

function CaseFormDialog({
  open, initial, connections, existingGroups, onSave, onClose, title,
}: CaseFormProps) {
  const [form, setForm] = useState<Partial<AITestCaseCreate>>(initial)
  useEffect(() => { setForm(initial) }, [initial, open])

  const set = (k: keyof AITestCaseCreate, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }))

  const valid =
    !!form.name?.trim() &&
    !!form.source_query?.trim() &&
    !!form.target_query?.trim() &&
    !!form.validation_type

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>

        {/* Group name — free-type with suggestions from existing groups */}
        <TextField
          label="Group Name"
          value={form.group_name ?? ''}
          onChange={(e) => set('group_name', e.target.value)}
          fullWidth
          helperText="Groups related tests together (e.g. Employee Checks, Premium Validation)"
          select={existingGroups.length > 0 ? undefined : undefined}
          inputProps={{ list: 'group-suggestions' }}
        />
        {existingGroups.length > 0 && (
          <datalist id="group-suggestions">
            {existingGroups.map((g) => <option key={g} value={g} />)}
          </datalist>
        )}

        <TextField
          label="Test Name"
          value={form.name ?? ''}
          onChange={(e) => set('name', e.target.value)}
          fullWidth required
        />

        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Source Connection</InputLabel>
            <Select value={form.source_conn_id ?? ''} label="Source Connection"
              onChange={(e) => set('source_conn_id', e.target.value || undefined)}>
              <MenuItem value=""><em>None</em></MenuItem>
              {connections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Target Connection</InputLabel>
            <Select value={form.target_conn_id ?? ''} label="Target Connection"
              onChange={(e) => set('target_conn_id', e.target.value || undefined)}>
              <MenuItem value=""><em>Same as source</em></MenuItem>
              {connections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Validation Type</InputLabel>
            <Select value={form.validation_type ?? 'count'} label="Validation Type"
              onChange={(e) => {
                const vt = e.target.value as ValidationTypeEnum
                set('validation_type', vt)
                set('reconciliation_type', ROW_LEVEL_TYPES.includes(vt) ? 'row_level' : 'aggregate')
              }}>
              <MenuItem disabled sx={{ fontSize: '0.7rem', color: 'text.disabled', fontWeight: 700 }}>— Aggregate —</MenuItem>
              {VTYPES.filter((v) => v.group === 'Aggregate').map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}
              <MenuItem disabled sx={{ fontSize: '0.7rem', color: 'text.disabled', fontWeight: 700, mt: 1 }}>— Row-Level —</MenuItem>
              {VTYPES.filter((v) => v.group === 'Row-Level').map((v) => <MenuItem key={v.value} value={v.value}>{v.label}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            label="Threshold"
            value={form.threshold ?? '0'}
            onChange={(e) => set('threshold', e.target.value)}
            helperText="Acceptable difference (0 = exact)"
            sx={{ width: 160 }}
          />
        </Box>

        {/* Row-level fields — shown only for row_level / column_level types */}
        {ROW_LEVEL_TYPES.includes(form.validation_type as ValidationTypeEnum) && (
          <>
            <TextField
              label="Identifier Columns — ON clause (join key)"
              value={form.identifier_column ?? ''}
              onChange={(e) => set('identifier_column', e.target.value)}
              fullWidth required
              placeholder="e.g. EMPNO   or   CMLNUMBER,SOURCECOLUMN"
              helperText="Comma-separated. Rows are matched between source and target using these columns as the JOIN ON clause."
            />
            <TextField
              label="Columns to Compare (leave blank to compare all)"
              value={form.columns_to_compare ?? ''}
              onChange={(e) => set('columns_to_compare', e.target.value)}
              fullWidth
              placeholder="e.g. COLUMNVALUE,STATUS,AMOUNT"
              helperText="Comma-separated column names to diff. Leave blank to compare every non-key column."
            />
          </>
        )}

        <TextField
          label="Source Query"
          value={form.source_query ?? ''} multiline rows={4}
          onChange={(e) => set('source_query', e.target.value)}
          fullWidth required
          placeholder={
            ROW_LEVEL_TYPES.includes(form.validation_type as ValidationTypeEnum)
              ? 'SELECT EMPNO, ENAME, SAL FROM source_table'
              : 'SELECT COUNT(*) AS cnt FROM source_table'
          }
          helperText={
            ROW_LEVEL_TYPES.includes(form.validation_type as ValidationTypeEnum)
              ? 'Return identifier + columns to compare (multiple rows)'
              : 'Must return exactly one scalar value'
          }
        />
        <TextField
          label="Target Query"
          value={form.target_query ?? ''} multiline rows={4}
          onChange={(e) => set('target_query', e.target.value)}
          fullWidth required
          placeholder={
            ROW_LEVEL_TYPES.includes(form.validation_type as ValidationTypeEnum)
              ? 'SELECT EMPNO, ENAME, SAL FROM target_table'
              : 'SELECT COUNT(*) AS cnt FROM target_table'
          }
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid}
          onClick={() => onSave(form as AITestCaseCreate)}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── AIGenDialog ────────────────────────────────────────────────

interface AIGenDialogProps {
  open: boolean
  connections: SourceConnection[]
  existingGroups: string[]
  defaultConnId?: number
  onGenerate: (
    description: string,
    sourceConnId: number,
    targetConnId?: number,
    groupOverride?: string,
    identifierColumn?: string,
    reconciliationType?: string,
  ) => void
  onClose: () => void
  loading: boolean
}

function AIGenDialog({ open, connections, existingGroups, defaultConnId, onGenerate, onClose, loading }: AIGenDialogProps) {
  const [description,        setDescription]        = useState('')
  const [srcId,              setSrcId]              = useState<number | ''>(defaultConnId ?? '')
  const [tgtId,              setTgtId]              = useState<number | ''>('')
  const [groupOverride,      setGroupOverride]      = useState('')
  const [identifierColumn,   setIdentifierColumn]   = useState('')
  const [reconciliationType, setReconciliationType] = useState<'aggregate' | 'row_level'>('aggregate')

  useEffect(() => { if (open) { setSrcId(defaultConnId ?? ''); setIdentifierColumn(''); setReconciliationType('aggregate') } }, [open, defaultConnId])

  const sameConn = !tgtId || tgtId === srcId
  const valid = description.trim().length > 0 && srcId !== ''

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoAwesomeOutlined color="primary" /> AI Generate Test Cases
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>

        {/* Reconciliation type toggle */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          {(['aggregate', 'row_level'] as const).map((t) => (
            <Button
              key={t}
              variant={reconciliationType === t ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setReconciliationType(t)}
              sx={{ flex: 1, textTransform: 'none' }}
            >
              {t === 'aggregate' ? 'Aggregate (COUNT / SUM)' : 'Row-Level (record comparison)'}
            </Button>
          ))}
        </Box>

        {reconciliationType === 'row_level' && (
          <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
            Row-level mode compares individual records. AI will generate queries that return multiple
            columns joined on your identifier column.
          </Alert>
        )}

        <TextField
          label="Describe what to validate"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline rows={3} fullWidth
          placeholder={reconciliationType === 'row_level'
            ? 'e.g. "Compare PARTY records by PARTY_ID — check NAME, ADDRESS, STATUS fields"'
            : 'e.g. "Validate employee and department data — check counts, salary sums, null IDs"'}
        />

        {/* Identifier column (key for row_level) */}
        <TextField
          label={`Identifier Column${reconciliationType === 'row_level' ? ' (join key)' : ' (optional — helps AI detect PK)'}`}
          value={identifierColumn}
          onChange={(e) => setIdentifierColumn(e.target.value)}
          fullWidth
          placeholder="e.g. PARTY_ID, EMPNO, CUSTOMER_ID"
          helperText={reconciliationType === 'row_level'
            ? 'Column used to match rows between source and target. Leave blank for AI to detect.'
            : 'Helps AI identify the primary key. Leave blank to let AI infer.'}
        />

        <TextField
          label="Group Name (optional)"
          value={groupOverride}
          onChange={(e) => setGroupOverride(e.target.value)}
          fullWidth
          helperText="Leave blank to let AI decide."
          inputProps={{ list: 'ai-group-suggestions' }}
        />
        {existingGroups.length > 0 && (
          <datalist id="ai-group-suggestions">
            {existingGroups.map((g) => <option key={g} value={g} />)}
          </datalist>
        )}

        <FormControl fullWidth required>
          <InputLabel>Source Connection</InputLabel>
          <Select value={srcId} label="Source Connection"
            onChange={(e) => setSrcId(e.target.value as number)}>
            {connections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </Select>
        </FormControl>

        <FormControl fullWidth>
          <InputLabel>Target Connection</InputLabel>
          <Select value={tgtId} label="Target Connection"
            onChange={(e) => setTgtId(e.target.value as number)}>
            <MenuItem value=""><em>Same as source</em></MenuItem>
            {connections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </Select>
        </FormControl>

        {sameConn && srcId !== '' && (
          <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
            Source and target are the <strong>same connection</strong>. Edit the generated target
            queries to point at your actual target tables.
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!valid || loading}
          startIcon={loading ? <CircularProgress size={16} /> : <AutoAwesomeOutlined />}
          onClick={() => onGenerate(
            description, srcId as number, tgtId || undefined,
            groupOverride.trim() || undefined,
            identifierColumn.trim() || undefined,
            reconciliationType,
          )}
        >
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── GroupSection ───────────────────────────────────────────────

interface GroupSectionProps {
  groupName: string
  rows: Array<{ tc: AITestCase; res?: AITestResult }>
  isDark: boolean
  connName: (id: number | null) => string
  running: number | 'all' | null
  runningGroup: string | null
  onRun: (id: number) => void
  onRunGroup?: (groupName: string) => void
  onSchedule?: (groupName: string, currentCron: string) => void
  onEdit: (tc: AITestCase) => void
  onDelete: (id: number) => void
  showResultColumns?: boolean
  groupSchedule?: string | null
}

function GroupSection({
  groupName, rows, isDark, connName, running, runningGroup,
  onRun, onRunGroup, onSchedule, onEdit, onDelete, showResultColumns, groupSchedule,
}: GroupSectionProps) {
  const [open, setOpen] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTc, setDetailTc] = useState<AITestCase | null>(null)
  const [detailRes, setDetailRes] = useState<AITestResult | null>(null)

  const openDetail = (tc: AITestCase, res?: AITestResult) => {
    setDetailTc(tc); setDetailRes(res ?? null); setDetailOpen(true)
  }
  const isRunningThisGroup = runningGroup === groupName

  const passed  = rows.filter((r) => r.res?.result === 'pass').length
  const failed  = rows.filter((r) => r.res?.result === 'fail').length
  const errors  = rows.filter((r) => r.res?.result === 'error').length
  const notRun  = rows.filter((r) => !r.res).length

  return (
    <Box sx={{ mb: 2 }}>
      {/* Group header */}
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: 2, py: 1, borderRadius: 2,
          bgcolor: isDark ? alpha(tokens.indigo500, 0.1) : alpha(tokens.indigo600, 0.06),
          border: '1px solid',
          borderColor: isDark ? alpha(tokens.indigo400, 0.2) : alpha(tokens.indigo600, 0.14),
          cursor: 'pointer',
          userSelect: 'none',
          '&:hover': {
            bgcolor: isDark ? alpha(tokens.indigo500, 0.15) : alpha(tokens.indigo600, 0.1),
          },
        }}
      >
        <FolderOutlined sx={{ color: isDark ? tokens.indigo400 : tokens.indigo600, fontSize: 18 }} />
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1,
          color: isDark ? tokens.indigo300 : tokens.indigo700 }}>
          {groupName}
        </Typography>
        <Chip label={`${rows.length} test${rows.length !== 1 ? 's' : ''}`} size="small"
          sx={{ fontSize: '0.7rem', height: 20,
            bgcolor: alpha(tokens.indigo500, 0.15),
            color: isDark ? tokens.indigo300 : tokens.indigo700 }} />
        {passed > 0  && <Chip label={`${passed} pass`}  size="small" color="success" sx={{ fontSize: '0.7rem', height: 20 }} />}
        {failed > 0  && <Chip label={`${failed} fail`}  size="small" color="error"   sx={{ fontSize: '0.7rem', height: 20 }} />}
        {errors > 0  && <Chip label={`${errors} err`}   size="small" color="warning" sx={{ fontSize: '0.7rem', height: 20 }} />}
        {notRun > 0  && <Chip label={`${notRun} pending`} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />}
        {groupSchedule && (
          <Chip
            icon={<ScheduleOutlined sx={{ fontSize: '12px !important' }} />}
            label={groupSchedule}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ fontSize: '0.65rem', height: 20, fontFamily: 'monospace' }}
          />
        )}
        {onSchedule && (
          <Tooltip title={groupSchedule ? `Schedule: ${groupSchedule} — click to edit` : 'Set schedule'}>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onSchedule(groupName, groupSchedule ?? '') }}
              sx={{ color: groupSchedule ? 'primary.main' : 'text.disabled' }}
            >
              <ScheduleOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
        {onRunGroup && (
          <Tooltip title="Run all tests in this group">
            <span>
              <IconButton
                size="small"
                color="primary"
                disabled={isRunningThisGroup || running === 'all'}
                onClick={(e) => { e.stopPropagation(); onRunGroup(groupName) }}
              >
                {isRunningThisGroup
                  ? <CircularProgress size={14} />
                  : <PlayCircleOutlined sx={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {open ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.disabled' }} />
              : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled' }} />}
      </Box>

      <Collapse in={open}>
        <TableContainer component={Paper} variant="outlined"
          sx={{ borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Test Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Source Conn</TableCell>
                <TableCell>Target Conn</TableCell>
                <TableCell>Threshold</TableCell>
                {showResultColumns && <>
                  <TableCell>Result</TableCell>
                  <TableCell>Source Value</TableCell>
                  <TableCell>Target Value</TableCell>
                  <TableCell>Difference</TableCell>
                  <TableCell>Remarks</TableCell>
                </>}
                {!showResultColumns && <TableCell>Last Result</TableCell>}
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(({ tc, res }) => (
                <TableRow key={tc.id} hover
                  sx={res?.result === 'fail'
                    ? { bgcolor: alpha('#ef4444', isDark ? 0.08 : 0.04) }
                    : res?.result === 'pass'
                    ? { bgcolor: alpha('#22c55e', isDark ? 0.06 : 0.03) }
                    : {}}>
                  <TableCell sx={{ fontWeight: 600 }}>
                    {tc.name}
                    {tc.identifier_column && (
                      <Typography variant="caption" color="text.disabled" display="block">
                        key: {tc.identifier_column}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={vtypeLabel(tc.validation_type)} size="small" variant="outlined"
                      color={ROW_LEVEL_TYPES.includes(tc.validation_type) ? 'secondary' : 'default'} />
                  </TableCell>
                  <TableCell>{connName(tc.source_conn_id)}</TableCell>
                  <TableCell>{connName(tc.target_conn_id)}</TableCell>
                  <TableCell>{tc.threshold ?? '0'}</TableCell>
                  {showResultColumns && <>
                    <TableCell><ResultChip result={res?.result ?? ''} /></TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{res?.source_value ?? '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{res?.target_value ?? '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem',
                      color: res?.result === 'fail' ? 'error.main' : 'inherit' }}>
                      {res?.difference ?? '—'}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260, fontSize: '0.75rem', color: 'text.secondary' }}>
                      {res && ROW_LEVEL_TYPES.includes(tc.validation_type) ? (
                        <RowLevelSummary res={res} isDark={isDark} />
                      ) : (
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {res?.remarks ?? '—'}
                        </span>
                      )}
                    </TableCell>
                  </>}
                  {!showResultColumns && (
                    <TableCell><ResultChip result={res?.result ?? ''} /></TableCell>
                  )}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {res && (
                      <Tooltip title="View report">
                        <IconButton size="small" color="info" onClick={() => openDetail(tc, res)}>
                          <VisibilityOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => onEdit(tc)}>
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Run">
                      <IconButton size="small" color="primary"
                        disabled={running === tc.id}
                        onClick={() => onRun(tc.id)}>
                        {running === tc.id
                          ? <CircularProgress size={16} />
                          : <PlayArrowOutlined fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => onDelete(tc.id)}>
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>

      {detailTc && (
        <TestDetailDialog
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          tc={detailTc}
          res={detailRes}
          isDark={isDark}
        />
      )}
    </Box>
  )
}

// ── Main page ──────────────────────────────────────────────────

export default function TestingPage() {
  const isDark          = useAppStore((s) => s.themeMode) === 'dark'
  const activeConn      = useAppStore((s) => s.activeConnection)
  const connId          = activeConn?.id ?? undefined
  const [tab, setTab]   = useState(0)

  const [testCases, setTestCases]     = useState<AITestCase[]>([])
  const [summary, setSummary]         = useState<TestSummaryRow[]>([])
  const [connections, setConnections] = useState<SourceConnection[]>([])
  const [runResults, setRunResults]   = useState<Record<number, AITestResult>>({})

  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [running, setRunning]   = useState<number | 'all' | null>(null)
  const [runningGroup, setRunningGroup] = useState<string | null>(null)

  const [formOpen, setFormOpen]     = useState(false)
  const [editTarget, setEditTarget] = useState<AITestCase | null>(null)
  const [aiOpen, setAiOpen]         = useState(false)
  const [aiLoading, setAiLoading]   = useState(false)

  // Schedule dialog
  const [schedDialog, setSchedDialog] = useState<{ groupName: string; cron: string } | null>(null)
  const [schedSaving, setSchedSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cases, sum, conns] = await Promise.all([
        testsApi.list(connId),
        testsApi.results(connId),
        connectionsApi.list(),
      ])
      setTestCases(cases)
      setSummary(sum)
      setConnections(conns)
      const map: Record<number, AITestResult> = {}
      sum.forEach((s) => { if (s.latest_result) map[s.test_case.id] = s.latest_result })
      setRunResults(map)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [connId])

  useEffect(() => { load() }, [load])

  const handleSave = async (data: AITestCaseCreate) => {
    try {
      if (editTarget) {
        await testsApi.update(editTarget.id, data)
      } else {
        await testsApi.create(data)
      }
      setFormOpen(false)
      setEditTarget(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this test case?')) return
    try {
      await testsApi.delete(id)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const handleRun = async (id: number) => {
    setRunning(id)
    setError(null)
    try {
      const res = await testsApi.run(id)
      setRunResults((prev) => ({ ...prev, [id]: res }))
      // Refresh summary so Dashboard source/target values update
      const sum = await testsApi.results(connId)
      setSummary(sum)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunning(null)
    }
  }

  const handleRunGroup = async (groupName: string) => {
    setRunningGroup(groupName)
    setError(null)
    try {
      const res = await testsApi.runGroup(groupName, connId)
      const map: Record<number, AITestResult> = { ...runResults }
      res.results.forEach((r) => {
        map[r.test_case_id] = {
          id: 0, test_case_id: r.test_case_id,
          execution_time:        r.execution_time,
          result:                r.result as AITestResult['result'],
          source_value:          r.source_value,
          target_value:          r.target_value,
          difference:            r.difference,
          remarks:               r.remarks,
          mismatch_count:        r.mismatch_count ?? null,
          missing_source_count:  r.missing_source_count ?? null,
          missing_target_count:  r.missing_target_count ?? null,
          sample_mismatches:     r.sample_mismatches ?? null,
          sample_missing_source: null,
          sample_missing_target: null,
          ran_at: new Date().toISOString(),
        }
      })
      setRunResults(map)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `Run group "${groupName}" failed`)
    } finally {
      setRunningGroup(null)
    }
  }

  const handleSaveSchedule = async () => {
    if (!schedDialog) return
    setSchedSaving(true)
    try {
      await testsApi.setGroupSchedule(schedDialog.groupName, schedDialog.cron, connId)
      await load()
      setSchedDialog(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save schedule')
    } finally {
      setSchedSaving(false)
    }
  }

  const handleRunAll = async () => {
    setRunning('all')
    setError(null)
    try {
      const res = await testsApi.runAll(connId)
      const map: Record<number, AITestResult> = {}
      res.results.forEach((r) => {
        map[r.test_case_id] = {
          id: 0, test_case_id: r.test_case_id,
          execution_time:        r.execution_time,
          result:                r.result as AITestResult['result'],
          source_value:          r.source_value,
          target_value:          r.target_value,
          difference:            r.difference,
          remarks:               r.remarks,
          mismatch_count:        r.mismatch_count ?? null,
          missing_source_count:  r.missing_source_count ?? null,
          missing_target_count:  r.missing_target_count ?? null,
          sample_mismatches:     r.sample_mismatches ?? null,
          sample_missing_source: null,
          sample_missing_target: null,
          ran_at: new Date().toISOString(),
        }
      })
      setRunResults(map)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Run all failed')
    } finally {
      setRunning(null)
    }
  }

  const handleAIGenerate = async (
    description: string,
    sourceConnId: number,
    targetConnId?: number,
    groupOverride?: string,
    identifierColumn?: string,
    reconciliationType?: string,
  ) => {
    setAiLoading(true)
    setError(null)
    try {
      const fullDescription = groupOverride
        ? `${description}\n\nIMPORTANT: Put ALL generated test cases into the group named "${groupOverride}".`
        : description
      await testsApi.generate({
        description:          fullDescription,
        source_conn_id:       sourceConnId,
        target_conn_id:       targetConnId,
        identifier_column:    identifierColumn,
        reconciliation_type:  reconciliationType,
      })
      setAiOpen(false)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'AI generation failed')
    } finally {
      setAiLoading(false)
    }
  }

  const connName = (id: number | null) =>
    connections.find((c) => c.id === id)?.name ?? (id ? String(id) : '—')

  // Group test cases by group_name
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ tc: AITestCase; res?: AITestResult }>>()
    testCases.forEach((tc) => {
      const key = tc.group_name?.trim() || UNGROUPED
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ tc, res: runResults[tc.id] })
    })
    // Named groups first, ungrouped last
    const sorted: Array<[string, Array<{ tc: AITestCase; res?: AITestResult }>]> = []
    map.forEach((rows, key) => {
      if (key !== UNGROUPED) sorted.push([key, rows])
    })
    sorted.sort((a, b) => a[0].localeCompare(b[0]))
    if (map.has(UNGROUPED)) sorted.push([UNGROUPED, map.get(UNGROUPED)!])
    return sorted
  }, [testCases, runResults])

  // Same grouping for summary tab
  const groupedSummary = useMemo(() => {
    const map = new Map<string, TestSummaryRow[]>()
    summary.forEach((row) => {
      const key = row.test_case.group_name?.trim() || UNGROUPED
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    })
    const sorted: Array<[string, TestSummaryRow[]]> = []
    map.forEach((rows, key) => {
      if (key !== UNGROUPED) sorted.push([key, rows])
    })
    sorted.sort((a, b) => a[0].localeCompare(b[0]))
    if (map.has(UNGROUPED)) sorted.push([UNGROUPED, map.get(UNGROUPED)!])
    return sorted
  }, [summary])

  // Stats
  const totalTests = testCases.length
  const totalRan   = summary.filter((s) => s.latest_result).length
  const passed     = summary.filter((s) => s.latest_result?.result === 'pass').length
  const failed     = summary.filter((s) => s.latest_result?.result === 'fail').length
  const errors     = summary.filter((s) => s.latest_result?.result === 'error').length
  const notRan     = summary.filter((s) => !s.latest_result).length

  const existingGroups = useMemo(
    () => [...new Set(testCases.map((t) => t.group_name).filter(Boolean) as string[])].sort(),
    [testCases],
  )

  // Map group_name → schedule_cron (first non-null wins)
  const groupSchedules = useMemo(() => {
    const map: Record<string, string> = {}
    testCases.forEach((tc) => {
      const key = tc.group_name?.trim() || UNGROUPED
      if (tc.schedule_cron && !map[key]) map[key] = tc.schedule_cron
    })
    return map
  }, [testCases])

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <FactCheckOutlined sx={{ color: isDark ? tokens.indigo400 : tokens.indigo600, fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={800} sx={{ lineHeight: 1.1 }}>
              Testing &amp; Reconciliation
            </Typography>
            <Typography variant="caption" color="text.disabled">
              Automated data validation across source and target systems
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={load} disabled={loading}><RefreshOutlined /></IconButton>
          </Tooltip>
          <Button variant="outlined" startIcon={<AutoAwesomeOutlined />}
            onClick={() => setAiOpen(true)}>
            AI Generate
          </Button>
          <Button variant="contained" startIcon={<AddOutlined />}
            onClick={() => { setEditTarget(null); setFormOpen(true) }}>
            New Test
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {!connId && (
        <Alert severity="info">
          Select a connection in the sidebar to see test cases scoped to that source.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab label={`Test Cases (${testCases.length})`} />
        <Tab label="Run &amp; Results" />
        <Tab label="Dashboard" />
      </Tabs>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* ── Tab 0: Test Cases (grouped) ─────────────────────── */}
      {!loading && tab === 0 && (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {testCases.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8, color: 'text.disabled' }}>
              <FactCheckOutlined sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
              <Typography>No test cases yet — use AI Generate or create one manually.</Typography>
            </Box>
          ) : (
            grouped.map(([groupName, rows]) => (
              <GroupSection
                key={groupName}
                groupName={groupName}
                rows={rows}
                isDark={isDark}
                connName={connName}
                running={running}
                runningGroup={runningGroup}
                onRun={handleRun}
                onRunGroup={groupName !== UNGROUPED ? handleRunGroup : undefined}
                onSchedule={groupName !== UNGROUPED ? (gn, cron) => setSchedDialog({ groupName: gn, cron }) : undefined}
                onEdit={(tc) => { setEditTarget(tc); setFormOpen(true) }}
                onDelete={handleDelete}
                showResultColumns={false}
                groupSchedule={groupSchedules[groupName]}
              />
            ))
          )}
        </Box>
      )}

      {/* ── Tab 1: Run & Results (grouped) ─────────────────── */}
      {!loading && tab === 1 && (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained" color="primary"
              startIcon={running === 'all'
                ? <CircularProgress size={16} color="inherit" />
                : <PlayCircleOutlined />}
              disabled={running === 'all' || testCases.length === 0}
              onClick={handleRunAll}
            >
              Run All Tests
            </Button>
          </Box>

          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {summary.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 8, color: 'text.disabled' }}>
                <Typography>No test cases — add some in the Test Cases tab first.</Typography>
              </Box>
            ) : (
              groupedSummary.map(([groupName, rows]) => (
                <GroupSection
                  key={groupName}
                  groupName={groupName}
                  rows={rows.map((r) => ({ tc: r.test_case, res: runResults[r.test_case.id] ?? r.latest_result ?? undefined }))}
                  isDark={isDark}
                  connName={connName}
                  running={running}
                  runningGroup={runningGroup}
                  onRun={handleRun}
                  onRunGroup={groupName !== UNGROUPED ? handleRunGroup : undefined}
                  onSchedule={groupName !== UNGROUPED ? (gn, cron) => setSchedDialog({ groupName: gn, cron }) : undefined}
                  onEdit={(tc) => { setEditTarget(tc); setFormOpen(true) }}
                  onDelete={handleDelete}
                  showResultColumns
                  groupSchedule={groupSchedules[groupName]}
                />
              ))
            )}
          </Box>
        </Box>
      )}

      {/* ── Tab 2: Dashboard ────────────────────────────────── */}
      {!loading && tab === 2 && (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {/* Summary cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {[
              { label: 'Total Tests',  value: totalTests, color: tokens.indigo500, icon: <AssessmentOutlined /> },
              { label: 'Ran',          value: totalRan,   color: tokens.violet600, icon: <PlayCircleOutlined /> },
              { label: 'Passed',       value: passed,     color: '#22c55e',        icon: <CheckCircleOutlined /> },
              { label: 'Failed',       value: failed,     color: '#ef4444',        icon: <CancelOutlined /> },
              { label: 'Errors',       value: errors,     color: '#f59e0b',        icon: <ErrorOutlined /> },
              { label: 'Pending',      value: notRan,     color: tokens.slate400,  icon: <FactCheckOutlined /> },
            ].map(({ label, value, color, icon }) => (
              <Grid item xs={6} sm={4} md={2} key={label}>
                <Card variant="outlined" sx={{
                  borderColor: alpha(color, 0.3),
                  bgcolor: alpha(color, isDark ? 0.08 : 0.04),
                }}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: '12px !important' }}>
                    <Box sx={{ color, fontSize: 28 }}>{icon}</Box>
                    <Box>
                      <Typography variant="h5" fontWeight={800} sx={{ color, lineHeight: 1 }}>{value}</Typography>
                      <Typography variant="caption" color="text.secondary">{label}</Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          <Divider sx={{ mb: 2 }} />

          {/* Per-group breakdown */}
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>Results by Group</Typography>
          {groupedSummary.map(([groupName, rows]) => {
            const gPassed = rows.filter((r) => r.latest_result?.result === 'pass').length
            const gFailed = rows.filter((r) => r.latest_result?.result === 'fail').length
            const gErrors = rows.filter((r) => r.latest_result?.result === 'error').length
            const gPending = rows.filter((r) => !r.latest_result).length
            return (
              <Box key={groupName} sx={{ mb: 2 }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 1,
                  px: 2, py: 1, borderRadius: '8px 8px 0 0',
                  bgcolor: isDark ? alpha(tokens.indigo500, 0.1) : alpha(tokens.indigo600, 0.06),
                  border: '1px solid',
                  borderBottom: 'none',
                  borderColor: isDark ? alpha(tokens.indigo400, 0.2) : alpha(tokens.indigo600, 0.14),
                }}>
                  <FolderOutlined sx={{ color: isDark ? tokens.indigo400 : tokens.indigo600, fontSize: 16 }} />
                  <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1,
                    color: isDark ? tokens.indigo300 : tokens.indigo700 }}>
                    {groupName}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {gPassed > 0  && <Chip label={`${gPassed}P`}  size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />}
                    {gFailed > 0  && <Chip label={`${gFailed}F`}  size="small" color="error"   sx={{ height: 20, fontSize: '0.7rem' }} />}
                    {gErrors > 0  && <Chip label={`${gErrors}E`}  size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />}
                    {gPending > 0 && <Chip label={`${gPending}?`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />}
                  </Box>
                </Box>
                <TableContainer component={Paper} variant="outlined"
                  sx={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Test Name</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Result</TableCell>
                        <TableCell>Source Value</TableCell>
                        <TableCell>Target Value</TableCell>
                        <TableCell>Difference</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map(({ test_case: tc, latest_result: r }) => (
                        <TableRow key={tc.id} hover
                          sx={r?.result === 'fail'
                            ? { bgcolor: alpha('#ef4444', isDark ? 0.08 : 0.04) }
                            : r?.result === 'pass'
                            ? { bgcolor: alpha('#22c55e', isDark ? 0.06 : 0.03) }
                            : {}}>
                          <TableCell sx={{ fontWeight: 600 }}>{tc.name}</TableCell>
                          <TableCell>
                            <Chip label={vtypeLabel(tc.validation_type)} size="small" variant="outlined" />
                          </TableCell>
                          <TableCell><ResultChip result={r?.result ?? ''} /></TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{r?.source_value ?? '—'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{r?.target_value ?? '—'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem',
                            color: r?.result === 'fail' ? 'error.main' : 'inherit' }}>
                            {r?.difference ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )
          })}
        </Box>
      )}

      {/* ── Dialogs ────────────────────────────────────────── */}
      <CaseFormDialog
        open={formOpen}
        title={editTarget ? 'Edit Test Case' : 'New Test Case'}
        connections={connections}
        existingGroups={existingGroups}
        initial={editTarget
          ? {
              group_name:          editTarget.group_name ?? '',
              name:                editTarget.name,
              source_conn_id:      editTarget.source_conn_id ?? undefined,
              target_conn_id:      editTarget.target_conn_id ?? undefined,
              source_query:        editTarget.source_query,
              target_query:        editTarget.target_query,
              validation_type:     editTarget.validation_type,
              threshold:           editTarget.threshold ?? '0',
              identifier_column:   editTarget.identifier_column ?? '',
              reconciliation_type: editTarget.reconciliation_type ?? 'aggregate',
              columns_to_compare:  editTarget.columns_to_compare ?? '',
            }
          : emptyForm()
        }
        onSave={handleSave}
        onClose={() => { setFormOpen(false); setEditTarget(null) }}
      />

      <AIGenDialog
        open={aiOpen}
        connections={connections}
        existingGroups={existingGroups}
        defaultConnId={connId}
        onGenerate={handleAIGenerate}
        onClose={() => setAiOpen(false)}
        loading={aiLoading}
      />

      {/* ── Schedule dialog ────────────────────────────────── */}
      <Dialog open={!!schedDialog} onClose={() => setSchedDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ScheduleOutlined color="primary" />
          Schedule Group: {schedDialog?.groupName}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
            Enter a cron expression to schedule automatic runs of this test group.
            Leave blank to clear the schedule.
          </Alert>
          <TextField
            label="Cron Expression"
            value={schedDialog?.cron ?? ''}
            onChange={(e) => setSchedDialog((d) => d ? { ...d, cron: e.target.value } : d)}
            placeholder="0 6 * * *  (daily at 6 AM UTC)"
            fullWidth
            inputProps={{ style: { fontFamily: 'monospace' } }}
            helperText="Examples: 0 6 * * * (daily 6AM) · 0 */4 * * * (every 4h) · 0 8 * * 1 (weekly Mon)"
          />
          {schedDialog?.cron && (
            <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
              Schedule is stored — backend execution engine will honour it when implemented.
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSchedDialog(null)}>Cancel</Button>
          {schedDialog?.cron && (
            <Button
              color="error"
              onClick={() => setSchedDialog((d) => d ? { ...d, cron: '' } : d)}
            >
              Clear Schedule
            </Button>
          )}
          <Button
            variant="contained"
            disabled={schedSaving}
            startIcon={schedSaving ? <CircularProgress size={16} /> : <ScheduleOutlined />}
            onClick={handleSaveSchedule}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
