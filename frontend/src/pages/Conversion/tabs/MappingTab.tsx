import { useState, useId, useEffect, useRef } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, IconButton,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Alert, Paper, Tooltip, LinearProgress, Divider,
  Collapse, alpha, CircularProgress, Drawer, Dialog, DialogTitle,
  DialogContent, DialogActions, Tabs, Tab, Stack,
} from '@mui/material'
import {
  AutoAwesomeOutlined, AddOutlined, DeleteOutlined,
  SaveOutlined, CodeOutlined, ExpandMoreOutlined,
  ExpandLessOutlined, ArrowForwardOutlined, ContentCopyOutlined,
  PreviewOutlined, TransformOutlined, LinkOutlined, EditOutlined,
  TuneOutlined, CloseOutlined, SmartToyOutlined, PersonOutlined,
  StorageOutlined, OpenInNewOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { mappingApi, transformationApi } from '@/api'
import type {
  MappingRow, MappingRowTransformationRef, DebugPayload,
  TransformPreviewResult, TransformationRuleCreate,
} from '@/types'
import DebugStepsPanel from '@/components/ai/DebugStepsPanel'

// TI tab components — embedded in the Transformation Panel
import ExecutiveDashboardTab from '@/pages/TransformationIntelligence/tabs/ExecutiveDashboardTab'
import RuleRepositoryTab     from '@/pages/TransformationIntelligence/tabs/RuleRepositoryTab'
import RuleBuilderTab        from '@/pages/TransformationIntelligence/tabs/RuleBuilderTab'
import AIDiscoveryTab        from '@/pages/TransformationIntelligence/tabs/AIDiscoveryTab'
import SimulationTab         from '@/pages/TransformationIntelligence/tabs/SimulationTab'
import TestCasesTab          from '@/pages/TransformationIntelligence/tabs/TestCasesTab'
import LookupIntelligenceTab from '@/pages/TransformationIntelligence/tabs/LookupIntelligenceTab'
import RuleSetsAndPipelinesTab from '@/pages/TransformationIntelligence/tabs/RuleSetsAndPipelinesTab'
import ValidationTab         from '@/pages/TransformationIntelligence/tabs/ValidationTab'
import ExportTab             from '@/pages/TransformationIntelligence/tabs/ExportTab'

// ── CATEGORY_COLORS mirrors TI page ──────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  DirectMapping:     '#0ea5e9',
  LookupMapping:     '#f59e0b',
  ConditionalRule:   '#8b5cf6',
  DefaultValue:      '#64748b',
  Formula:           '#0284c7',
  DataValidation:    '#10b981',
  DataQualityRule:   '#ef4444',
  ReferenceDataRule: '#8b5cf6',
}

const ORIGIN_ICON: Record<string, JSX.Element> = {
  ai_discovery:       <SmartToyOutlined sx={{ fontSize: '0.85rem' }} />,
  user:               <PersonOutlined   sx={{ fontSize: '0.85rem' }} />,
  repository_attach:  <StorageOutlined  sx={{ fontSize: '0.85rem' }} />,
}

const RULE_CATEGORIES = [
  'LookupMapping', 'ConditionalRule', 'DefaultValue', 'Formula',
  'DataValidation', 'DirectMapping', 'DataQualityRule', 'ReferenceDataRule',
] as const

const TI_PANEL_TABS = [
  'Dashboard', 'Repository', 'Builder', 'AI Discovery', 'Simulation',
  'Test Cases', 'Lookup', 'Pipelines', 'Validation', 'Export',
]

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfidenceBadge({ value }: { value?: number }) {
  if (value == null) return <Chip label="Manual" size="small" variant="outlined" />
  const color = value >= 80 ? 'success' : value >= 55 ? 'warning' : 'error'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <LinearProgress
        variant="determinate"
        value={value}
        color={color}
        sx={{ width: 48, height: 6, borderRadius: 3 }}
      />
      <Typography variant="caption" fontWeight={600}>{value}%</Typography>
    </Box>
  )
}

// ── Rule chips for a mapping row ──────────────────────────────────────────────
function RuleChips({
  row,
  onAdd,
  onAttach,
}: {
  row: MappingRow
  onAdd: (row: MappingRow) => void
  onAttach: (row: MappingRow) => void
}) {
  const refs = row.transformations ?? []
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, alignItems: 'center' }}>
      {refs.map((t, i) => (
        <Chip
          key={i}
          size="small"
          icon={ORIGIN_ICON[t.discovery_source] ?? <LinkOutlined sx={{ fontSize: '0.85rem' }} />}
          label={`[${t.category}] ${t.rule_name}`}
          sx={{
            height: 20,
            fontSize: '0.68rem',
            fontWeight: 600,
            bgcolor: alpha(CATEGORY_COLORS[t.category] ?? '#64748b', 0.12),
            color: CATEGORY_COLORS[t.category] ?? 'text.secondary',
            '& .MuiChip-icon': { color: 'inherit' },
          }}
        />
      ))}
      {refs.length === 0 && (
        <Button
          size="small"
          variant="text"
          sx={{ fontSize: '0.72rem', minWidth: 0, py: 0, px: 0.75, color: 'text.disabled' }}
          onClick={() => onAdd(row)}
        >
          + Add Rule
        </Button>
      )}
      {refs.length > 0 && (
        <Tooltip title="Add another rule">
          <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onAdd(row)}>
            <AddOutlined sx={{ fontSize: '0.9rem', color: 'text.disabled' }} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Attach existing rule">
        <IconButton size="small" sx={{ p: 0.25 }} onClick={() => onAttach(row)}>
          <LinkOutlined sx={{ fontSize: '0.9rem', color: 'text.disabled' }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

// ── LookupMapping pair editor ─────────────────────────────────────────────────
function LookupPairsEditor({
  pairs, onChange,
}: {
  pairs: { src: string; tgt: string }[]
  onChange: (pairs: { src: string; tgt: string }[]) => void
}) {
  return (
    <Box>
      {pairs.map((p, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.75, alignItems: 'center' }}>
          <TextField size="small" placeholder="Source value" value={p.src}
            onChange={(e) => { const n = [...pairs]; n[i] = { ...p, src: e.target.value }; onChange(n) }}
            sx={{ flex: 1 }} />
          <ArrowForwardOutlined fontSize="small" color="disabled" />
          <TextField size="small" placeholder="Target value" value={p.tgt}
            onChange={(e) => { const n = [...pairs]; n[i] = { ...p, tgt: e.target.value }; onChange(n) }}
            sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => onChange(pairs.filter((_, j) => j !== i))}>
            <CloseOutlined fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddOutlined />}
        onClick={() => onChange([...pairs, { src: '', tgt: '' }])}>
        Add pair
      </Button>
    </Box>
  )
}

// ── Add Rule Dialog ───────────────────────────────────────────────────────────
function AddRuleDialog({
  open, row, connId, onClose, onCreated,
}: {
  open: boolean
  row: MappingRow | null
  connId: number
  onClose: () => void
  onCreated: (row: MappingRow, ref: MappingRowTransformationRef) => void
}) {
  const { enqueueSnackbar } = useSnackbar()
  const [category, setCategory] = useState<string>('LookupMapping')
  const [ruleName, setRuleName] = useState('')
  const [lookupPairs, setLookupPairs] = useState<{ src: string; tgt: string }[]>([{ src: '', tgt: '' }])
  const [condField, setCondField] = useState('')
  const [condOp, setCondOp]       = useState('=')
  const [condVal, setCondVal]     = useState('')
  const [condThen, setCondThen]   = useState('')
  const [condElse, setCondElse]   = useState('')
  const [defValue, setDefValue]   = useState('')
  const [formula, setFormula]     = useState('')
  const [valCond, setValCond]     = useState('')

  useEffect(() => {
    if (open && row) {
      setRuleName(`${row.source_column ?? ''} ${category}`.trim())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row])

  useEffect(() => {
    setCondField(row?.source_column ?? '')
  }, [row])

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!row || !connId) throw new Error('Missing row/conn')
      let condJson: string | undefined
      let transJson: string

      if (category === 'LookupMapping') {
        const cases = lookupPairs
          .filter((p) => p.src)
          .map((p) => ({ when: { field: row.source_column, operator: '=', value: p.src }, then: p.tgt }))
        transJson = JSON.stringify({ action: 'set', target_field: row.source_column, cases })
      } else if (category === 'ConditionalRule') {
        condJson  = JSON.stringify({ field: condField, operator: condOp, value: condVal })
        transJson = JSON.stringify({
          action: 'set',
          target_field: row.source_column,
          cases: [
            { when: { field: condField, operator: condOp, value: condVal }, then: condThen },
            { else: condElse },
          ],
        })
      } else if (category === 'DefaultValue') {
        condJson  = JSON.stringify({ field: row.source_column, operator: 'isnull', value: '' })
        transJson = JSON.stringify({ action: 'default', target_field: row.source_column, value: defValue })
      } else if (category === 'Formula') {
        transJson = JSON.stringify({ action: 'formula', target_field: row.source_column, expression: formula })
      } else {
        condJson  = valCond ? JSON.stringify({ field: row.source_column, operator: '!=', value: '' }) : undefined
        transJson = JSON.stringify({ action: 'set', target_field: row.source_column, cases: [{ else: valCond }] })
      }

      const data: TransformationRuleCreate = {
        conn_id: connId,
        rule_name: ruleName || `${row.source_column} ${category}`,
        category: category as TransformationRuleCreate['category'],
        execution_stage: 'Transform',
        source_column: row.source_column ?? undefined,
        target_path: row.target_path ?? undefined,
        condition_json: condJson,
        transformation_json: transJson,
      }
      const created = await transformationApi.createRule(data)

      // Link to the row if it has a DB id
      const rowIdNum = row.id ? parseInt(row.id.replace(/\D/g, ''), 10) : NaN
      if (!isNaN(rowIdNum)) {
        const ref = await mappingApi.linkRule(rowIdNum, created.id, 'user')
        return ref
      }
      // Row not yet saved — return a client-side ref
      return {
        rule_id: created.id,
        rule_name: created.rule_name,
        category: created.category,
        execution_order: 0,
        discovery_source: 'user',
      } as MappingRowTransformationRef
    },
    onSuccess: (ref) => {
      if (row) onCreated(row, ref)
      enqueueSnackbar('Rule created and linked', { variant: 'success' })
      onClose()
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TransformOutlined fontSize="small" />
        Add Transformation Rule
        {row && (
          <Chip label={row.source_column} size="small" sx={{ ml: 1 }} />
        )}
        <IconButton size="small" sx={{ ml: 'auto' }} onClick={onClose}>
          <CloseOutlined fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Rule Name"
            size="small"
            fullWidth
            value={ruleName}
            onChange={(e) => setRuleName(e.target.value)}
          />
          <FormControl size="small" fullWidth>
            <InputLabel>Category</InputLabel>
            <Select
              value={category}
              label="Category"
              onChange={(e) => setCategory(e.target.value)}
            >
              {RULE_CATEGORIES.map((c) => (
                <MenuItem key={c} value={c}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{
                      width: 8, height: 8, borderRadius: '50%',
                      bgcolor: CATEGORY_COLORS[c] ?? '#64748b',
                    }} />
                    {c}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Category-specific form */}
          {category === 'LookupMapping' && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                Source value → Target value pairs
              </Typography>
              <LookupPairsEditor pairs={lookupPairs} onChange={setLookupPairs} />
            </Box>
          )}

          {category === 'ConditionalRule' && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                IF condition THEN / ELSE
              </Typography>
              <Stack spacing={1.5}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField size="small" label="Field" value={condField}
                    onChange={(e) => setCondField(e.target.value)} sx={{ flex: 1 }} />
                  <Select size="small" value={condOp}
                    onChange={(e) => setCondOp(e.target.value)} sx={{ minWidth: 80 }}>
                    {['=', '!=', '>', '<', 'contains', 'isnull'].map((op) => (
                      <MenuItem key={op} value={op}>{op}</MenuItem>
                    ))}
                  </Select>
                  <TextField size="small" label="Value" value={condVal}
                    onChange={(e) => setCondVal(e.target.value)} sx={{ flex: 1 }} />
                </Box>
                <TextField size="small" label="THEN (result)" fullWidth value={condThen}
                  onChange={(e) => setCondThen(e.target.value)} />
                <TextField size="small" label="ELSE (default)" fullWidth value={condElse}
                  onChange={(e) => setCondElse(e.target.value)} />
              </Stack>
            </Box>
          )}

          {category === 'DefaultValue' && (
            <TextField
              size="small"
              label="Default value (applied when source is null)"
              fullWidth
              value={defValue}
              onChange={(e) => setDefValue(e.target.value)}
            />
          )}

          {category === 'Formula' && (
            <TextField
              size="small"
              label="Expression"
              fullWidth
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="UPPER({col}), CONCAT({first}, ' ', {last})"
              helperText="Use {ColumnName} placeholders"
              inputProps={{ style: { fontFamily: 'monospace' } }}
            />
          )}

          {(category === 'DataValidation' || category === 'DataQualityRule') && (
            <TextField
              size="small"
              label="Condition / error message"
              fullWidth
              value={valCond}
              onChange={(e) => setValCond(e.target.value)}
              placeholder="e.g. must not be null"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button
          variant="contained"
          size="small"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !ruleName}
        >
          {saveMut.isPending ? 'Saving…' : 'Save Rule'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Attach Existing Rule Dialog ───────────────────────────────────────────────
function AttachRuleDialog({
  open, row, connId, onClose, onAttached,
}: {
  open: boolean
  row: MappingRow | null
  connId: number
  onClose: () => void
  onAttached: (row: MappingRow, ref: MappingRowTransformationRef) => void
}) {
  const { enqueueSnackbar } = useSnackbar()
  const [search, setSearch] = useState('')

  const { data: rulesData } = useQuery({
    queryKey: ['ti-rules', connId, search],
    queryFn: () => transformationApi.listRules({ conn_id: connId, limit: 50 }),
    enabled: open && Boolean(connId),
  })

  const items = rulesData?.items ?? []
  const filtered = search
    ? items.filter((r: { rule_name: string; category: string }) =>
        r.rule_name.toLowerCase().includes(search.toLowerCase()) ||
        r.category.toLowerCase().includes(search.toLowerCase())
      )
    : items

  const attachMut = useMutation({
    mutationFn: async (ruleId: number) => {
      if (!row) throw new Error('No row selected')
      const rowIdNum = row.id ? parseInt(row.id.replace(/\D/g, ''), 10) : NaN
      if (isNaN(rowIdNum)) {
        const r = items.find((x: { id: number }) => x.id === ruleId)
        return {
          rule_id: ruleId,
          rule_name: r?.rule_name ?? '',
          category: r?.category ?? '',
          execution_order: 0,
          discovery_source: 'repository_attach',
        } as MappingRowTransformationRef
      }
      return mappingApi.linkRule(rowIdNum, ruleId, 'repository_attach')
    },
    onSuccess: (ref) => {
      if (row) onAttached(row, ref)
      enqueueSnackbar('Rule attached', { variant: 'success' })
      onClose()
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LinkOutlined fontSize="small" />
        Attach Existing Rule
        {row && <Chip label={row.source_column} size="small" sx={{ ml: 1 }} />}
        <IconButton size="small" sx={{ ml: 'auto' }} onClick={onClose}>
          <CloseOutlined fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <TextField
          size="small"
          fullWidth
          placeholder="Search rules…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1.5 }}
        />
        <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
          {filtered.map((r: { id: number; rule_name: string; category: string }) => (
            <Box
              key={r.id}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                px: 1.5, py: 0.75, borderRadius: 1, cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                bgcolor: CATEGORY_COLORS[r.category] ?? '#64748b',
              }} />
              <Box sx={{ flex: 1, overflow: 'hidden' }}>
                <Typography variant="body2" fontWeight={600} noWrap>{r.rule_name}</Typography>
                <Typography variant="caption" color="text.secondary">{r.category}</Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                disabled={attachMut.isPending}
                onClick={() => attachMut.mutate(r.id)}
              >
                Attach
              </Button>
            </Box>
          ))}
          {filtered.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No rules found
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Close</Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Transformation Preview Panel ──────────────────────────────────────────────
function TransformPreviewDrawer({
  open, result, onClose,
}: {
  open: boolean
  result: TransformPreviewResult | null
  onClose: () => void
}) {
  return (
    <Drawer anchor="bottom" open={open} onClose={onClose}
      PaperProps={{ sx: { maxHeight: '55vh', borderRadius: '12px 12px 0 0', p: 0 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <PreviewOutlined sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1, fontSize: '0.95rem' }}>
          Transformation Preview
          {result && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              ({result.sample_count} sample rows)
            </Typography>
          )}
        </Typography>
        <IconButton size="small" onClick={onClose}><CloseOutlined fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ overflow: 'auto', p: 2 }}>
        {!result && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            No preview available
          </Typography>
        )}
        {result?.previews.map((item, i) => (
          <Paper key={i} variant="outlined" sx={{ mb: 1.5, p: 1.5, borderRadius: 1.5 }}>
            <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'monospace', display: 'block', mb: 0.75 }}>
              {item.source_column} → {item.target_path}
            </Typography>
            {item.rules.map((r, j) => (
              <Box key={j} sx={{ display: 'flex', gap: 2, alignItems: 'center', py: 0.4 }}>
                <Chip size="small" label={r.category}
                  sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(CATEGORY_COLORS[r.category] ?? '#64748b', 0.12), color: CATEGORY_COLORS[r.category] }} />
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{r.input}</Typography>
                <ArrowForwardOutlined sx={{ fontSize: '0.85rem', color: r.applied ? 'success.main' : 'text.disabled' }} />
                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: r.applied ? 'success.main' : 'text.secondary', fontWeight: 600 }}>{r.output}</Typography>
                {!r.applied && (
                  <Typography variant="caption" color="text.disabled">(condition not met)</Typography>
                )}
              </Box>
            ))}
          </Paper>
        ))}
      </Box>
    </Drawer>
  )
}

// ── Transformation Intelligence Panel (right-side drawer) ─────────────────────
function TransformationPanel({
  open, connId, selectedRuleId, onClose,
}: {
  open: boolean
  connId: number | null
  selectedRuleId: number | null
  onClose: () => void
}) {
  const [tab, setTab] = useState(0)

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', md: '55%' }, display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', px: 2, py: 1.5,
        borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0,
      }}>
        <TuneOutlined sx={{ mr: 1, color: 'primary.main' }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1, fontSize: '0.95rem' }}>
          Transformation Intelligence
        </Typography>
        <Tooltip title="Open full page">
          <IconButton size="small" href="/transformation-intelligence" target="_blank">
            <OpenInNewOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={onClose} sx={{ ml: 0.5 }}>
          <CloseOutlined fontSize="small" />
        </IconButton>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ flexShrink: 0, borderBottom: 1, borderColor: 'divider', minHeight: 36,
              '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: '0.72rem' } }}
      >
        {TI_PANEL_TABS.map((label) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 0 }}>
        {tab === 0 && <ExecutiveDashboardTab connId={connId} onNavigateTab={setTab} />}
        {tab === 1 && (
          <RuleRepositoryTab
            connId={connId}
            selectedRuleId={selectedRuleId}
            onSelectRule={(id) => { /* handled via selectedRuleId prop */ void id }}
            onNavigateTab={setTab}
          />
        )}
        {tab === 2 && <RuleBuilderTab connId={connId} />}
        {tab === 3 && <AIDiscoveryTab connId={connId} />}
        {tab === 4 && <SimulationTab connId={connId} selectedRuleId={selectedRuleId} />}
        {tab === 5 && <TestCasesTab connId={connId} selectedRuleId={selectedRuleId} />}
        {tab === 6 && <LookupIntelligenceTab connId={connId} />}
        {tab === 7 && <RuleSetsAndPipelinesTab connId={connId} />}
        {tab === 8 && <ValidationTab connId={connId} selectedRuleId={selectedRuleId} />}
        {tab === 9 && <ExportTab connId={connId} />}
      </Box>
    </Drawer>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main component
// ══════════════════════════════════════════════════════════════════════════════
export default function MappingTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const uid = useId()
  const {
    mappingRows, setMappingRows,
    generatedSql, setGeneratedSql,
    sourceSheets, xmlPaths,
    setConversionTab,
  } = useAppStore()

  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const prevConnIdRef = useRef<number | ''>(connId)

  const [identifierCol, setIdentifierCol]   = useState('')
  const [sqlExpanded, setSqlExpanded]       = useState(true)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [debugPayload, setDebugPayload]     = useState<DebugPayload | null>(null)
  const [mappingOpen, setMappingOpen]       = useState(true)
  const [previewData, setPreviewData]       = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)

  // Rule-related state
  const [rulesSummary, setRulesSummary] = useState<{ category: string; count: number }[]>([])
  const [addRuleRow, setAddRuleRow]     = useState<MappingRow | null>(null)
  const [attachRuleRow, setAttachRuleRow] = useState<MappingRow | null>(null)
  const [previewResult, setPreviewResult] = useState<TransformPreviewResult | null>(null)
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false)
  const [mappingId, setMappingId] = useState<number | null>(null)

  // TI Panel state
  const [panelOpen, setPanelOpen]           = useState(false)
  const [selectedRow, setSelectedRow]       = useState<MappingRow | null>(null)
  const selectedRuleId = (selectedRow?.transformations ?? [])[0]?.rule_id ?? null

  const allColumns = sourceSheets.flatMap((s) =>
    s.columns.map((c) => ({ sheet: s.name, column: c })),
  )

  // ── Load saved mapping + SQL ──────────────────────────────────────────────
  const { data: savedMapping } = useQuery({
    queryKey: ['mapping', connId],
    queryFn: () => mappingApi.get(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })
  const { data: savedQuery } = useQuery({
    queryKey: ['mapping-query', connId],
    queryFn: () => mappingApi.getQuery(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })

  // Reset on connection change
  useEffect(() => {
    if (prevConnIdRef.current !== connId) {
      prevConnIdRef.current = connId
      setMappingRows([])
      setGeneratedSql('')
      setIdentifierCol('')
      setPreviewData(null)
      setRulesSummary([])
      setMappingId(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId])

  // Hydrate from saved mapping (preserving transformations)
  useEffect(() => {
    if (!savedMapping) return
    if (savedMapping.rows?.length && mappingRows.length === 0) {
      setMappingRows(
        savedMapping.rows.map((row, i) => ({
          id: `saved-${i}`,
          source_sheet:          row.source_sheet,
          source_column:         row.source_column,
          transform:             (row as Record<string, unknown>).formula as string | undefined,
          target_path:           row.target_path,
          confidence:            row.confidence,
          transform_sql:         row.transform_sql,
          rule_confidence_boost: row.rule_confidence_boost,
          transformations:       row.transformations ?? [],
        })),
      )
    }
    if (savedMapping.identifier_column && !identifierCol) {
      setIdentifierCol(savedMapping.identifier_column)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMapping])

  useEffect(() => {
    if (savedQuery?.query_sql) setGeneratedSql(savedQuery.query_sql)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedQuery])

  // ── Mutations ─────────────────────────────────────────────────────────────
  const genQueryMutation = useMutation({
    mutationFn: () => mappingApi.generateQuery(connId as number),
    onSuccess: (r) => {
      setGeneratedSql(r.query_sql)
      setSqlExpanded(true)
      if (r.identifier_column) setIdentifierCol(r.identifier_column)
      setDebugPayload(r.debug ?? null)
      enqueueSnackbar('SQL query generated', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const discoverRulesMutation = useMutation({
    mutationFn: () => transformationApi.discoverRules({
      conn_id: connId as number,
      use_knowledge: true,
      max_rules: 20,
    }),
    onSuccess: (r) => {
      const counts: Record<string, number> = {}
      ;(r.rules ?? []).forEach((rule: { category: string }) => {
        counts[rule.category] = (counts[rule.category] ?? 0) + 1
      })
      setRulesSummary(Object.entries(counts).map(([category, count]) => ({ category, count })))
      enqueueSnackbar(`${r.rules?.length ?? 0} rules discovered`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const previewMutation = useMutation({
    mutationFn: () => mappingApi.previewQuery(connId as number, generatedSql || undefined),
    onSuccess: (r) => {
      setPreviewData({ columns: r.columns, rows: r.rows })
      setPreviewExpanded(true)
      enqueueSnackbar(`${r.row_count} rows fetched`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const genMappingMutation = useMutation({
    mutationFn: () => mappingApi.generateRows(connId as number),
    onSuccess: (r) => {
      setMappingRows(
        r.rows.map((row, i) => ({
          id: `ai-${i}`,
          source_sheet:          row.source_sheet,
          source_column:         row.source_column,
          transform:             (row as Record<string, unknown>).formula as string | undefined,
          target_path:           row.target_path,
          confidence:            row.confidence,
          transform_sql:         (row as Record<string, unknown>).transform_sql as string | undefined,
          rule_confidence_boost: (row as Record<string, unknown>).rule_confidence_boost as number | undefined,
          transformations:       (row as Record<string, unknown>).transformations as MappingRowTransformationRef[] | undefined ?? [],
        })),
      )
      enqueueSnackbar(`${r.rows.length} mappings generated`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const previewTransformsMutation = useMutation({
    mutationFn: () => {
      if (!mappingId) throw new Error('Save the mapping first to run Preview.')
      return mappingApi.previewTransformations(mappingId)
    },
    onSuccess: (r) => {
      setPreviewResult(r)
      setPreviewDrawerOpen(true)
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveQueryMutation = useMutation({
    mutationFn: () => mappingApi.saveQuery(connId as number, generatedSql),
    onSuccess: () => {
      qc.setQueryData(['mapping-query', connId], (old: Record<string, unknown> | undefined) =>
        old ? { ...old, query_sql: generatedSql } : old,
      )
      enqueueSnackbar('Query saved', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      mappingApi.save({
        conn_id: connId as number,
        identifier_column: identifierCol || undefined,
        query_sql: generatedSql || undefined,
        rows: mappingRows.map((r) => ({
          ...r,
          formula: r.transform,
          transformations: r.transformations ?? [],
        })),
      }),
    onSuccess: (res: { mapping_id: number; rows_saved: number }) => {
      if (res?.mapping_id) setMappingId(res.mapping_id)
      if (generatedSql) {
        qc.setQueryData(['mapping-query', connId], (old: Record<string, unknown> | undefined) =>
          old ? { ...old, query_sql: generatedSql } : old,
        )
      }
      enqueueSnackbar('Mapping saved', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  // ── Row helpers ───────────────────────────────────────────────────────────
  const addRow = () => {
    setMappingRows([
      ...mappingRows,
      { id: `${uid}-${Date.now()}`, source_sheet: '', source_column: '', target_path: '', transformations: [] },
    ])
  }

  const updateRow = (id: string, field: keyof MappingRow, value: string) => {
    setMappingRows(mappingRows.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const deleteRow = (id: string) => {
    setMappingRows(mappingRows.filter((r) => r.id !== id))
  }

  const appendTransformationToRow = (row: MappingRow, ref: MappingRowTransformationRef) => {
    setMappingRows(mappingRows.map((r) =>
      r.id === row.id
        ? { ...r, transformations: [...(r.transformations ?? []), ref] }
        : r,
    ))
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* ── Step bar ──────────────────────────────────────────────────────── */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2 }}>
          <Grid container spacing={1.5} alignItems="center">
            {/* Step 1 */}
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="secondary"
                size="small"
                startIcon={genQueryMutation.isPending ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
                onClick={() => genQueryMutation.mutate()}
                disabled={!connId || genQueryMutation.isPending}
              >
                {genQueryMutation.isPending ? 'Generating…' : 'Step 1: Generate Query'}
              </Button>
            </Grid>

            {/* Step 2: Discover Rules */}
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="warning"
                size="small"
                startIcon={discoverRulesMutation.isPending ? <CircularProgress size={14} /> : <SmartToyOutlined />}
                onClick={() => discoverRulesMutation.mutate()}
                disabled={!connId || !generatedSql || discoverRulesMutation.isPending}
              >
                {discoverRulesMutation.isPending ? 'Discovering…' : 'Step 2: Discover Rules'}
              </Button>
            </Grid>

            {/* Step 3: AI Map Fields */}
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="secondary"
                size="small"
                startIcon={genMappingMutation.isPending ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
                onClick={() => genMappingMutation.mutate()}
                disabled={!connId || genMappingMutation.isPending}
              >
                {genMappingMutation.isPending ? 'Mapping…' : 'Step 3: AI Map Fields'}
              </Button>
            </Grid>

            {/* Step 4: Preview Transformations */}
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="info"
                size="small"
                startIcon={previewTransformsMutation.isPending ? <CircularProgress size={14} /> : <PreviewOutlined />}
                onClick={() => previewTransformsMutation.mutate()}
                disabled={!mappingId || previewTransformsMutation.isPending}
              >
                {previewTransformsMutation.isPending ? 'Loading…' : 'Step 4: Preview'}
              </Button>
            </Grid>

            {/* Preview Data */}
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="info"
                size="small"
                startIcon={previewMutation.isPending ? <CircularProgress size={14} /> : <PreviewOutlined />}
                onClick={() => previewMutation.mutate()}
                disabled={!connId || !generatedSql || previewMutation.isPending}
              >
                {previewMutation.isPending ? 'Loading…' : 'Preview Data'}
              </Button>
            </Grid>

            {/* Add Row */}
            <Grid item xs={12} sm="auto">
              <Button variant="outlined" size="small" startIcon={<AddOutlined />} onClick={addRow}>
                Add Row
              </Button>
            </Grid>

            {/* Transformation Panel toggle */}
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                size="small"
                startIcon={<TuneOutlined />}
                onClick={() => setPanelOpen(true)}
                disabled={!connId}
                color={panelOpen ? 'primary' : 'inherit'}
              >
                Transformation Intelligence
              </Button>
            </Grid>

            {/* Save (right-aligned) */}
            <Grid item xs={12} sm="auto" sx={{ ml: 'auto' }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<SaveOutlined />}
                onClick={() => saveMutation.mutate()}
                disabled={!connId || mappingRows.length === 0 || saveMutation.isPending}
              >
                Save Mapping
              </Button>
            </Grid>
          </Grid>

          {/* Rule discovery summary chips */}
          {rulesSummary.length > 0 && (
            <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>
                Rules discovered:
              </Typography>
              {rulesSummary.map(({ category, count }) => (
                <Chip
                  key={category}
                  size="small"
                  label={`${count} ${category}`}
                  sx={{
                    height: 20,
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    bgcolor: alpha(CATEGORY_COLORS[category] ?? '#64748b', 0.12),
                    color: CATEGORY_COLORS[category] ?? 'text.secondary',
                  }}
                />
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ── Identifier column ──────────────────────────────────────────────── */}
      {connId !== '' && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              Identifier Column:
            </Typography>
            {allColumns.length > 0 ? (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Column</InputLabel>
                <Select
                  value={identifierCol}
                  label="Column"
                  onChange={(e) => setIdentifierCol(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {allColumns.map(({ sheet, column }) => (
                    <MenuItem key={`${sheet}.${column}`} value={column}>
                      {sheet} · {column}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <TextField
                size="small"
                label="Column name"
                value={identifierCol}
                onChange={(e) => setIdentifierCol(e.target.value)}
                placeholder="e.g. EMPNO"
                sx={{ minWidth: 180 }}
                helperText="Auto-filled when you Generate Query"
              />
            )}
            <Typography variant="caption" color="text.secondary">
              One XML file will be generated per unique value of this column
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* ── SQL Editor ──────────────────────────────────────────────────────── */}
      {connId !== '' && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 0 }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
              onClick={() => setSqlExpanded(!sqlExpanded)}
            >
              <CodeOutlined sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                SQL Query
                {!generatedSql && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    (paste or type manually, or use Step 1 to generate)
                  </Typography>
                )}
              </Typography>
              {generatedSql && (
                <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Copy SQL">
                    <IconButton size="small" onClick={() => { navigator.clipboard.writeText(generatedSql); enqueueSnackbar('SQL copied', { variant: 'info' }) }}>
                      <ContentCopyOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Save edited SQL">
                    <IconButton size="small" color="primary" disabled={saveQueryMutation.isPending || !connId} onClick={() => saveQueryMutation.mutate()}>
                      <SaveOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              {sqlExpanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            </Box>
            <Collapse in={sqlExpanded}>
              <Divider />
              <TextField
                value={generatedSql}
                onChange={(e) => setGeneratedSql(e.target.value)}
                multiline fullWidth minRows={4}
                placeholder="Paste or type your SQL query here…"
                sx={{
                  '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.813rem', bgcolor: (t) => alpha(t.palette.primary.main, 0.02) },
                  '& fieldset': { border: 'none' },
                }}
              />
            </Collapse>
          </CardContent>
        </Card>
      )}

      {debugPayload && <DebugStepsPanel debug={debugPayload} module="mapping" />}

      {/* ── Data preview table ──────────────────────────────────────────────── */}
      {previewData && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 0 }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
              onClick={() => setPreviewExpanded(!previewExpanded)}
            >
              <PreviewOutlined sx={{ mr: 1, color: 'info.main' }} />
              <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                Data Preview <Chip label={`${previewData.rows.length} rows`} size="small" sx={{ ml: 1 }} />
              </Typography>
              {previewExpanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            </Box>
            <Collapse in={previewExpanded}>
              <Divider />
              <Box sx={{ overflow: 'auto', maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {previewData.columns.map((col) => (
                        <TableCell key={col} sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                          {col}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewData.rows.slice(0, 20).map((row, i) => (
                      <TableRow key={i} hover>
                        {previewData.columns.map((col) => (
                          <TableCell key={col} sx={{ fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                            {row[col] == null ? <em style={{ color: '#94a3b8' }}>null</em> : String(row[col])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </CardContent>
        </Card>
      )}

      {/* ── Field Mapping table ──────────────────────────────────────────────── */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, cursor: 'pointer' }}
            onClick={() => setMappingOpen(v => !v)}
          >
            {mappingOpen ? <ExpandLessOutlined sx={{ mr: 1, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ mr: 1, color: 'text.secondary' }} />}
            <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
              Field Mappings
              {mappingRows.length > 0 && <Chip label={mappingRows.length} size="small" sx={{ ml: 1 }} />}
            </Typography>
          </Box>
          <Collapse in={mappingOpen}>
            <Divider />
            {mappingRows.length === 0 ? (
              <Box sx={{ py: 8, textAlign: 'center' }}>
                <ArrowForwardOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body1" color="text.secondary" fontWeight={500}>No mappings yet</Typography>
                <Typography variant="body2" color="text.disabled">
                  Select a connection and use AI Generate, or click "Add Row" manually
                </Typography>
              </Box>
            ) : (
              <Box sx={{ overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Source Sheet</TableCell>
                      <TableCell>Source Column</TableCell>
                      <TableCell>Transform</TableCell>
                      <TableCell sx={{ textAlign: 'center' }}>→</TableCell>
                      <TableCell>Target XML Path</TableCell>
                      <TableCell>Confidence</TableCell>
                      <TableCell>Rules</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {mappingRows.map((row) => (
                      <TableRow
                        key={row.id}
                        hover
                        selected={selectedRow?.id === row.id}
                        onClick={() => { setSelectedRow(row); if (!panelOpen && (row.transformations?.length ?? 0) > 0) setPanelOpen(true) }}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <TextField
                            value={row.source_sheet ?? ''}
                            onChange={(e) => updateRow(row.id!, 'source_sheet', e.target.value)}
                            size="small" variant="standard" placeholder="Sheet" sx={{ minWidth: 100 }}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <TextField
                            value={row.source_column ?? ''}
                            onChange={(e) => updateRow(row.id!, 'source_column', e.target.value)}
                            size="small" variant="standard" placeholder="Column" sx={{ minWidth: 120 }}
                          />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <TextField
                            value={row.transform ?? ''}
                            onChange={(e) => updateRow(row.id!, 'transform', e.target.value)}
                            size="small" variant="standard" placeholder="UPPER({col})"
                            sx={{ minWidth: 140, fontFamily: 'monospace' }}
                          />
                        </TableCell>
                        <TableCell sx={{ textAlign: 'center' }}>
                          <ArrowForwardOutlined fontSize="small" color="disabled" />
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <FormControl size="small" sx={{ minWidth: 180 }}>
                            <Select
                              value={row.target_path ?? ''}
                              onChange={(e) => updateRow(row.id!, 'target_path', e.target.value)}
                              variant="standard" displayEmpty
                              renderValue={(v) => v || <em style={{ color: '#94a3b8' }}>Select path…</em>}
                            >
                              {xmlPaths.map((p) => (
                                <MenuItem key={p} value={p}>
                                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{p}</Typography>
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </TableCell>
                        <TableCell>
                          <ConfidenceBadge value={row.confidence} />
                          {(row.rule_confidence_boost ?? 0) > 0 && (
                            <Typography variant="caption" color="success.main" sx={{ display: 'block', fontSize: '0.62rem' }}>
                              +{row.rule_confidence_boost} from rules
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()} sx={{ minWidth: 220 }}>
                          <RuleChips
                            row={row}
                            onAdd={(r) => setAddRuleRow(r)}
                            onAttach={(r) => setAttachRuleRow(r)}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); deleteRow(row.id!) }}>
                            <DeleteOutlined fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>

      {mappingRows.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={() => setConversionTab(3)} endIcon={<ArrowForwardOutlined />}>
            Next: Generate XML
          </Button>
        </Box>
      )}

      {/* ── Dialogs & drawers ──────────────────────────────────────────────── */}
      <AddRuleDialog
        open={Boolean(addRuleRow)}
        row={addRuleRow}
        connId={connId as number}
        onClose={() => setAddRuleRow(null)}
        onCreated={(row, ref) => { appendTransformationToRow(row, ref); setAddRuleRow(null) }}
      />

      <AttachRuleDialog
        open={Boolean(attachRuleRow)}
        row={attachRuleRow}
        connId={connId as number}
        onClose={() => setAttachRuleRow(null)}
        onAttached={(row, ref) => { appendTransformationToRow(row, ref); setAttachRuleRow(null) }}
      />

      <TransformPreviewDrawer
        open={previewDrawerOpen}
        result={previewResult}
        onClose={() => setPreviewDrawerOpen(false)}
      />

      <TransformationPanel
        open={panelOpen}
        connId={connId as number | null}
        selectedRuleId={selectedRuleId}
        onClose={() => setPanelOpen(false)}
      />
    </Box>
  )
}
