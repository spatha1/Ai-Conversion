/**
 * StoriesPage — Development Hub
 *
 * Input modes: Manual / JIRA / ADO batch import
 * AI pipeline: Call A (parse/consolidate) → Call B (use case extraction) → Call C (model grouping)
 * Features: Save & History, Export SQL, Update Clarity, Refine, Data Model gated steps
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Button, TextField, Paper, Chip, CircularProgress,
  Alert, Stack, IconButton, Tooltip, Accordion, AccordionSummary,
  AccordionDetails, Divider, alpha, Card, CardContent,
  ToggleButtonGroup, ToggleButton, Drawer, List, ListItem,
  ListItemText, ListItemSecondaryAction, Select, MenuItem,
  FormControl, InputLabel, Dialog, DialogTitle, DialogContent,
  DialogActions, LinearProgress, Stepper, Step, StepLabel,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, AutoAwesomeOutlined, ExpandMoreOutlined,
  CodeOutlined, DashboardCustomizeOutlined,
  FactCheckOutlined, WarningAmberOutlined, InfoOutlined,
  CloudDownloadOutlined, TextFieldsOutlined, LinkOutlined,
  VerifiedOutlined, ErrorOutlined, SaveOutlined, HistoryOutlined,
  FileDownloadOutlined, PsychologyOutlined, CheckCircleOutlined,
  RefreshOutlined, CloseOutlined, NoteAddOutlined, SchemaOutlined,
  PlayArrowOutlined, LockOutlined,
  SearchOutlined, ViewModuleOutlined, ViewListOutlined,
  BarChartOutlined, ShowChartOutlined, CompareArrowsOutlined,
  TableRowsOutlined, OpenInNewOutlined, FilterListOutlined,
} from '@mui/icons-material'
import {
  Table, TableHead, TableBody, TableRow, TableCell,
  InputAdornment,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { storiesApi, integrationsApi, connectionsApi } from '@/api'
import { tokens } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'
import type {
  StoryInput, ExtractedUseCase, StoryAnalysisResult,
  ParsedStory, StoryConflict, SavedAnalysisOut, DataModel, SourceConnection,
} from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  high:   tokens.red600   ?? '#DC2626',
  medium: tokens.amber600 ?? '#D97706',
  low:    tokens.sky600   ?? '#0284C7',
}

const TYPE_LABELS: Record<string, string> = {
  trend:          'Trend',
  aggregation:    'Aggregation',
  reconciliation: 'Reconciliation',
  detail:         'Detail View',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StoryCard({
  story, index, onChange, onDelete, canDelete,
}: {
  story: StoryInput
  index: number
  onChange: (updated: StoryInput) => void
  onDelete: () => void
  canDelete: boolean
}) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          p: 3, borderRadius: 2.5,
          border: '1px solid',
          borderColor: isDark ? alpha('#ffffff', 0.07) : alpha(tokens.indigo600 ?? '#4F46E5', 0.1),
          bgcolor: isDark ? 'background.paper' : '#ffffff',
          boxShadow: isDark ? 'none' : '0 1px 6px rgba(0,0,0,0.05)',
          transition: 'box-shadow .2s ease, border-color .2s ease',
          '&:hover': {
            borderColor: isDark ? alpha(tokens.indigo400 ?? '#818CF8', 0.22) : alpha(tokens.indigo600 ?? '#4F46E5', 0.28),
            boxShadow: isDark ? 'none' : '0 4px 16px rgba(0,0,0,0.09)',
          },
        }}
      >
        {/* Card header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: `linear-gradient(135deg, ${alpha(tokens.indigo600 ?? '#4F46E5', 0.15)}, ${alpha(tokens.violet600 ?? '#7C3AED', 0.1)})`,
              border: '1px solid',
              borderColor: alpha(tokens.indigo600 ?? '#4F46E5', 0.2),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: tokens.indigo600 ?? '#4F46E5' }}>
                {index + 1}
              </Typography>
            </Box>
            <Typography variant="caption" fontWeight={700} sx={{
              textTransform: 'uppercase', letterSpacing: '0.08em',
              color: isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.4)',
            }}>
              Story {index + 1}
            </Typography>
          </Box>
          {canDelete && (
            <Tooltip title="Remove story" arrow>
              <IconButton
                size="small"
                onClick={() => setConfirmDelete(true)}
                sx={{
                  p: 0.6, color: 'text.disabled', borderRadius: 1.5,
                  '&:hover': { color: 'error.main', bgcolor: alpha('#ef4444', 0.07) },
                  transition: 'all .15s ease',
                }}
              >
                <DeleteOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        <Stack spacing={2.5}>
          <TextField label="Title" size="small" fullWidth value={story.title}
            onChange={(e) => onChange({ ...story, title: e.target.value })}
            placeholder="As a [user], I want to [goal] so that [reason]…"
            sx={{ '& .MuiInputBase-input': { fontSize: '0.875rem' } }} />

          <Box>
            <TextField label="Description" size="small" fullWidth multiline minRows={4}
              value={story.description}
              onChange={(e) => onChange({ ...story, description: e.target.value })}
              placeholder={'Describe requirements one per line:\nSystem shall calculate total premium grouped by policy status\nSystem shall support filtering by date range\nSystem shall display count of policies per status'}
              sx={{ '& .MuiInputBase-input': { fontSize: '0.82rem', lineHeight: 1.7 } }} />
            <Typography variant="caption" color="text.disabled" sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5, pl: 0.25 }}>
              <InfoOutlined sx={{ fontSize: 12 }} />
              One requirement per line for best AI extraction
            </Typography>
          </Box>

          <Box sx={{ pt: 0.5, borderTop: '1px dashed', borderColor: isDark ? alpha('#ffffff', 0.08) : alpha(tokens.indigo600 ?? '#4F46E5', 0.1) }}>
            <TextField label="Acceptance Criteria (optional)" size="small" fullWidth multiline minRows={2}
              value={story.acceptance_criteria ?? ''}
              onChange={(e) => onChange({ ...story, acceptance_criteria: e.target.value })}
              placeholder="Given… When… Then…"
              sx={{ '& .MuiInputBase-input': { fontSize: '0.82rem', lineHeight: 1.7 } }} />
          </Box>
        </Stack>
      </Paper>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700 }}>Remove Story?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will permanently remove <strong>Story {index + 1}</strong>
            {story.title ? ` — "${story.title}"` : ''}. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} size="small">Cancel</Button>
          <Button variant="contained" color="error" size="small"
            onClick={() => { setConfirmDelete(false); onDelete() }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

// ── Import section ────────────────────────────────────────────────────────────

function ImportSection({ onImported }: { onImported: (stories: StoryInput[]) => void }) {
  const { activeProject } = useAppStore()
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  const { enqueueSnackbar } = useSnackbar()
  const [source, setSource] = useState<'manual' | 'jira' | 'ado'>('manual')
  const [rawIds, setRawIds] = useState('')
  const [failedItems, setFailedItems] = useState<{ resource_id: string; error: string }[]>([])

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations', activeProject?.id],
    queryFn:  () => integrationsApi.list(activeProject?.id),
    staleTime: 60_000,
  })
  const jiraConfigured = integrations.some((i) => i.type === 'jira' && i.has_token)
  const adoConfigured  = integrations.some((i) => i.type === 'ado'  && i.has_token)

  const fetchMut = useMutation({
    mutationFn: () => {
      const ids = rawIds.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
      if (!ids.length) throw new Error('Enter at least one issue key or work item ID.')
      return storiesApi.fetchExternal({
        source_type: source as 'jira' | 'ado',
        resource_ids: ids,
        project_id: activeProject?.id ?? null,
      })
    },
    onSuccess: (res) => {
      setFailedItems(res.failed)
      if (res.stories.length) {
        onImported(res.stories)
        enqueueSnackbar(
          `Imported ${res.stories.length} ${source.toUpperCase()} ${res.stories.length === 1 ? 'story' : 'stories'}` +
          (res.failed.length ? ` (${res.failed.length} failed)` : ''),
          { variant: res.failed.length ? 'warning' : 'success' }
        )
      } else {
        enqueueSnackbar('No stories could be fetched — check IDs and integration config.', { variant: 'error' })
      }
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Fetch failed', { variant: 'error' }),
  })

  const isConfigured = source === 'jira' ? jiraConfigured : adoConfigured

  return (
    <Box>
      <ToggleButtonGroup
        value={source} exclusive
        onChange={(_, v) => { if (v) { setSource(v); setFailedItems([]) } }}
        size="small" fullWidth
        sx={{
          mb: 2,
          bgcolor: isDark ? alpha('#ffffff', 0.04) : alpha(tokens.indigo600 ?? '#4F46E5', 0.04),
          borderRadius: 2, p: 0.5,
          border: '1px solid',
          borderColor: isDark ? alpha('#ffffff', 0.08) : alpha(tokens.indigo600 ?? '#4F46E5', 0.1),
          '& .MuiToggleButtonGroup-grouped': { border: 'none !important', borderRadius: '8px !important', mx: 0.25 },
          '& .MuiToggleButton-root': {
            fontSize: '0.8rem', textTransform: 'none', gap: 0.75,
            color: 'text.secondary', fontWeight: 500, py: 0.9,
            transition: 'all .15s ease',
          },
          '& .MuiToggleButton-root.Mui-selected': {
            bgcolor: isDark ? alpha(tokens.indigo600 ?? '#4F46E5', 0.2) : '#ffffff',
            color: tokens.indigo600 ?? '#4F46E5',
            fontWeight: 700,
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
          },
        }}
      >
        <ToggleButton value="manual"><TextFieldsOutlined sx={{ fontSize: 15 }} /> Manual</ToggleButton>
        <ToggleButton value="jira"><LinkOutlined sx={{ fontSize: 15 }} /> JIRA</ToggleButton>
        <ToggleButton value="ado"><LinkOutlined sx={{ fontSize: 15 }} /> Azure DevOps</ToggleButton>
      </ToggleButtonGroup>

      {source === 'manual' && (
        <Box sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1,
          px: 1.5, py: 1, borderRadius: 1.5,
          bgcolor: alpha(tokens.indigo600 ?? '#4F46E5', 0.04),
          border: '1px solid',
          borderColor: alpha(tokens.indigo600 ?? '#4F46E5', 0.1),
        }}>
          <InfoOutlined sx={{ fontSize: 14, color: 'text.disabled', mt: 0.15, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.775rem', color: 'text.secondary', lineHeight: 1.5 }}>
            Add stories manually using the cards below, or switch to JIRA / ADO to import directly.
          </Typography>
        </Box>
      )}

      {(source === 'jira' || source === 'ado') && (
        <Stack spacing={1.5}>
          {(source === 'jira' ? jiraConfigured : adoConfigured) ? (
            <Chip icon={<VerifiedOutlined />} label={`${source === 'jira' ? 'JIRA' : 'Azure DevOps'} configured in Admin`} color="success" size="small" variant="outlined" />
          ) : (
            <Alert severity="warning" sx={{ fontSize: '0.78rem', py: 0.5 }}>
              {source === 'jira' ? 'JIRA' : 'ADO'} not configured. Go to <strong>Admin → Integrations</strong>.
            </Alert>
          )}
          <TextField
            label={source === 'jira' ? 'Issue Keys' : 'Work Item IDs'}
            size="small" fullWidth value={rawIds}
            onChange={(e) => setRawIds(e.target.value)}
            placeholder={source === 'jira' ? 'PROJ-123, PROJ-124' : '456, 457, 458'}
            helperText="Comma or space-separated. Max 20."
          />
          <Button
            variant="outlined" size="small" fullWidth
            startIcon={fetchMut.isPending ? <CircularProgress size={13} /> : <CloudDownloadOutlined />}
            onClick={() => fetchMut.mutate()}
            disabled={fetchMut.isPending || !rawIds.trim() || !isConfigured}
          >
            {fetchMut.isPending ? 'Fetching…' : `Import from ${source === 'jira' ? 'JIRA' : 'Azure DevOps'}`}
          </Button>
        </Stack>
      )}

      {failedItems.length > 0 && (
        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          {failedItems.map((f) => (
            <Alert key={f.resource_id} severity="error" icon={<ErrorOutlined fontSize="small" />} sx={{ fontSize: '0.75rem', py: 0.25 }}>
              <strong>{f.resource_id}</strong>: {f.error}
            </Alert>
          ))}
        </Stack>
      )}
    </Box>
  )
}

// ── Results sub-components ────────────────────────────────────────────────────

const USE_CASE_COLOR: Record<string, string> = {
  aggregation:    '#8B5CF6',
  trend:          '#059669',
  reconciliation: '#D97706',
  detail_view:    '#0284C7',
  other:          '#6B7280',
}

const USE_CASE_ICON: Record<string, React.ReactNode> = {
  aggregation:    <BarChartOutlined sx={{ fontSize: 18 }} />,
  trend:          <ShowChartOutlined sx={{ fontSize: 18 }} />,
  reconciliation: <CompareArrowsOutlined sx={{ fontSize: 18 }} />,
  detail_view:    <TableRowsOutlined sx={{ fontSize: 18 }} />,
  other:          <InfoOutlined sx={{ fontSize: 18 }} />,
}

function StoryGridCard({ ps, isDark }: { ps: ParsedStory; isDark: boolean }) {
  const ucColor = USE_CASE_COLOR[ps.use_case] ?? USE_CASE_COLOR.other
  const ucIcon  = USE_CASE_ICON[ps.use_case]  ?? USE_CASE_ICON.other
  return (
    <Paper elevation={0} sx={{
      borderRadius: 2.5, overflow: 'hidden',
      border: '1px solid',
      borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
      bgcolor: isDark ? alpha('#ffffff', 0.03) : '#ffffff',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      display: 'flex', flexDirection: 'column',
      transition: 'box-shadow .2s ease, border-color .2s ease, transform .2s ease',
      '&:hover': {
        boxShadow: '0 6px 24px rgba(0,0,0,0.11)',
        borderColor: alpha(ucColor, 0.4),
        transform: 'translateY(-2px)',
      },
    }}>
      {/* Type accent bar */}
      <Box sx={{ height: 3, bgcolor: ucColor, opacity: 0.75 }} />

      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1 }}>
        {/* Row: icon + ticket */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box sx={{
            width: 34, height: 34, borderRadius: 1.5, flexShrink: 0,
            bgcolor: alpha(ucColor, 0.1),
            color: ucColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {ucIcon}
          </Box>
          {ps.ticket_id && (
            <Chip
              label={ps.ticket_id} size="small"
              icon={<OpenInNewOutlined sx={{ fontSize: '11px !important' }} />}
              sx={{
                height: 20, fontSize: '0.63rem', fontWeight: 700,
                bgcolor: alpha(tokens.sky600 ?? '#0284C7', 0.08),
                color: tokens.sky600 ?? '#0284C7',
                border: '1px solid', borderColor: alpha(tokens.sky600 ?? '#0284C7', 0.22),
                cursor: 'default', '& .MuiChip-label': { px: 0.75 },
                '& .MuiChip-icon': { ml: 0.5 },
              }}
            />
          )}
        </Box>

        {/* Title + definition */}
        <Box>
          <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.3, mb: ps.definition ? 0.4 : 0 }}>
            {ps.title}
          </Typography>
          {ps.definition && (
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4, display: 'block' }}>
              {ps.definition}
            </Typography>
          )}
        </Box>

        {/* Type + Frequency badges */}
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          <Chip label={ps.use_case.replace(/_/g, ' ')} size="small"
            sx={{
              height: 20, fontSize: '0.63rem', fontWeight: 700,
              bgcolor: alpha(ucColor, 0.1), color: ucColor,
              border: '1px solid', borderColor: alpha(ucColor, 0.22),
              '& .MuiChip-label': { px: 0.85 },
            }}
          />
          <Chip
            label={ps.time_granularity === 'none' || !ps.time_granularity ? 'None' : ps.time_granularity}
            size="small" variant="outlined"
            sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.85 } }}
          />
        </Box>

        <Divider sx={{ opacity: 0.45 }} />

        {/* KPIs */}
        {ps.metrics.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'text.disabled', mb: 0.5 }}>
              KPIs
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
              {ps.metrics.map((m) => (
                <Chip key={m} label={m} size="small" color="secondary" variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.75 } }} />
              ))}
            </Box>
          </Box>
        )}

        {/* Entities */}
        {ps.entities.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'text.disabled', mb: 0.5 }}>
              Entities
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
              {ps.entities.map((e) => (
                <Chip key={e} label={e} size="small" color="primary" variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.75 } }} />
              ))}
            </Box>
          </Box>
        )}

        {/* Dimensions */}
        {ps.dimensions.length > 0 && (
          <Box sx={{ mt: 'auto' }}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'text.disabled', mb: 0.5 }}>
              Dimensions
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
              {ps.dimensions.map((d) => (
                <Chip key={d} label={d} size="small" variant="outlined"
                  sx={{ fontSize: '0.65rem', height: 20, color: 'text.secondary', '& .MuiChip-label': { px: 0.75 } }} />
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Paper>
  )
}

function StoryTableRow({ ps, isDark }: { ps: ParsedStory; isDark: boolean }) {
  const ucColor = USE_CASE_COLOR[ps.use_case] ?? USE_CASE_COLOR.other
  return (
    <TableRow sx={{
      '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.03) : alpha(tokens.indigo600 ?? '#4F46E5', 0.03) },
      transition: 'background-color .15s ease',
    }}>
      <TableCell sx={{ py: 1.25, pl: 2 }}>
        {ps.ticket_id
          ? <Chip label={ps.ticket_id} size="small"
              sx={{ height: 20, fontSize: '0.63rem', fontWeight: 700,
                bgcolor: alpha(tokens.sky600 ?? '#0284C7', 0.08), color: tokens.sky600 ?? '#0284C7',
                border: '1px solid', borderColor: alpha(tokens.sky600 ?? '#0284C7', 0.22),
                '& .MuiChip-label': { px: 0.75 },
              }} />
          : <Typography variant="caption" color="text.disabled">—</Typography>
        }
      </TableCell>
      <TableCell sx={{ py: 1.25 }}>
        <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>{ps.title}</Typography>
        {ps.definition && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{ps.definition}</Typography>
        )}
      </TableCell>
      <TableCell sx={{ py: 1.25 }}>
        <Chip label={ps.use_case.replace(/_/g, ' ')} size="small"
          sx={{ height: 20, fontSize: '0.63rem', fontWeight: 700,
            bgcolor: alpha(ucColor, 0.1), color: ucColor,
            border: '1px solid', borderColor: alpha(ucColor, 0.22),
            '& .MuiChip-label': { px: 0.85 },
          }} />
      </TableCell>
      <TableCell sx={{ py: 1.25 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {ps.time_granularity === 'none' || !ps.time_granularity ? '—' : ps.time_granularity}
        </Typography>
      </TableCell>
      <TableCell sx={{ py: 1.25 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
          {ps.metrics.map((m) => <Chip key={m} label={m} size="small" color="secondary" variant="outlined"
            sx={{ fontSize: '0.63rem', height: 18, '& .MuiChip-label': { px: 0.6 } }} />)}
        </Box>
      </TableCell>
      <TableCell sx={{ py: 1.25 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
          {ps.entities.map((e) => <Chip key={e} label={e} size="small" color="primary" variant="outlined"
            sx={{ fontSize: '0.63rem', height: 18, '& .MuiChip-label': { px: 0.6 } }} />)}
        </Box>
      </TableCell>
      <TableCell sx={{ py: 1.25, pr: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
          {ps.dimensions.map((d) => <Chip key={d} label={d} size="small" variant="outlined"
            sx={{ fontSize: '0.63rem', height: 18, color: 'text.secondary', '& .MuiChip-label': { px: 0.6 } }} />)}
        </Box>
      </TableCell>
    </TableRow>
  )
}

function ParsedStoriesAccordion({ stories }: { stories: ParsedStory[] }) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  const [searchTerm, setSearchTerm]   = useState('')
  const [filterType, setFilterType]   = useState('')
  const [viewMode,   setViewMode]     = useState<'card' | 'table'>('card')
  if (!stories.length) return null

  const typeOptions = [...new Set(stories.map((s) => s.use_case))]

  const filtered = stories.filter((ps) => {
    const q = searchTerm.toLowerCase()
    const matchSearch = !q
      || ps.title.toLowerCase().includes(q)
      || ps.definition?.toLowerCase().includes(q)
      || ps.metrics.some((m) => m.toLowerCase().includes(q))
      || ps.entities.some((e) => e.toLowerCase().includes(q))
      || ps.dimensions.some((d) => d.toLowerCase().includes(q))
      || (ps.ticket_id ?? '').toLowerCase().includes(q)
    const matchType = !filterType || ps.use_case === filterType
    return matchSearch && matchType
  })

  return (
    <Box>

      {/* ── Toolbar ──────────────────────────────────────────── */}
        <Box sx={{ display: 'flex', gap: 1.25, mb: 2.5, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Search */}
          <TextField
            size="small" placeholder="Search stories, KPIs, entities…"
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 260, '& .MuiInputBase-input': { fontSize: '0.82rem' } }}
          />
          {/* Type filter */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <FilterListOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Select
              size="small" value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              displayEmpty
              sx={{ minWidth: 140, fontSize: '0.82rem' }}
            >
              <MenuItem value=""><em>All Types</em></MenuItem>
              {typeOptions.map((t) => (
                <MenuItem key={t} value={t} sx={{ fontSize: '0.82rem' }}>
                  {t.replace(/_/g, ' ')}
                </MenuItem>
              ))}
            </Select>
          </Box>
          {/* Clear */}
          {(searchTerm || filterType) && (
            <Button size="small" variant="text" color="inherit"
              onClick={() => { setSearchTerm(''); setFilterType('') }}
              sx={{ fontSize: '0.75rem', color: 'text.secondary' }}
            >
              Clear
            </Button>
          )}
          {/* Result count */}
          <Typography variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>
            {filtered.length} of {stories.length}
          </Typography>
          {/* View toggle */}
          <ToggleButtonGroup value={viewMode} exclusive size="small"
            onChange={(_, v) => v && setViewMode(v)} sx={{ ml: 'auto' }}>
            <ToggleButton value="card" sx={{ px: 1.25 }}>
              <Tooltip title="Card view" arrow><ViewModuleOutlined sx={{ fontSize: 17 }} /></Tooltip>
            </ToggleButton>
            <ToggleButton value="table" sx={{ px: 1.25 }}>
              <Tooltip title="Table view" arrow><ViewListOutlined sx={{ fontSize: 17 }} /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* ── Card grid ────────────────────────────────────────── */}
        {viewMode === 'card' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
            {filtered.map((ps, i) => <StoryGridCard key={i} ps={ps} isDark={isDark} />)}
            {filtered.length === 0 && (
              <Box sx={{ gridColumn: '1/-1', textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.disabled">No stories match your search or filter.</Typography>
              </Box>
            )}
          </Box>
        )}

        {/* ── Table view ───────────────────────────────────────── */}
        {viewMode === 'table' && (
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: isDark ? alpha('#ffffff', 0.03) : '#F8F9FA' }}>
                  {['Ticket', 'Story', 'Type', 'Frequency', 'KPIs', 'Entities', 'Dimensions'].map((h) => (
                    <TableCell key={h} sx={{
                      py: 1, fontWeight: 700, fontSize: '0.7rem',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: 'text.secondary', borderBottom: '1px solid',
                      borderColor: 'divider', pl: h === 'Ticket' ? 2 : undefined,
                      pr: h === 'Dimensions' ? 2 : undefined,
                    }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((ps, i) => <StoryTableRow key={i} ps={ps} isDark={isDark} />)}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ textAlign: 'center', py: 3 }}>
                      <Typography variant="body2" color="text.disabled">No stories match your search or filter.</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        )}
    </Box>
  )
}

function UnifiedIntentAccordion({ intent }: { intent: StoryAnalysisResult['unified_intent'] }) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  if (!intent) return null
  const sections = [
    { label: 'Entities',    items: intent.entities,         color: 'primary'   as const },
    { label: 'KPIs',        items: intent.metrics,          color: 'secondary' as const },
    { label: 'Dimensions',  items: intent.dimensions,       color: 'default'   as const },
    { label: 'Filters',     items: intent.filters,          color: 'default'   as const },
    { label: 'Frequency',   items: intent.time_granularity, color: 'default'   as const },
  ]
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
      gap: 1.5,
    }}>
      {sections.filter(({ items }) => items?.length).map(({ label, items, color }) => (
            <Paper key={label} elevation={0} sx={{
              p: 1.75, borderRadius: 2,
              border: '1px solid',
              borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
              bgcolor: isDark ? alpha('#ffffff', 0.03) : '#FAFAFA',
            }}>
              <Typography variant="caption" fontWeight={700} color="text.disabled"
                sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', mb: 0.75 }}>
                {label}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {items.map((it) => (
                  <Chip key={it} label={it} size="small" color={color} variant="outlined" sx={{ fontSize: '0.68rem' }} />
                ))}
              </Box>
            </Paper>
      ))}
    </Box>
  )
}

function ConflictsSection({ conflicts }: { conflicts: StoryConflict[] }) {
  if (!conflicts.length) return null
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <WarningAmberOutlined sx={{ fontSize: 16, color: 'warning.main' }} />
        Conflicts Detected ({conflicts.length})
      </Typography>
      <Stack spacing={1}>
        {conflicts.map((c, i) => (
          <Alert key={i} severity="warning" icon={<WarningAmberOutlined fontSize="small" />}>
            <Typography variant="body2" fontWeight={600}>{c.type.replace(/_/g, ' ')}</Typography>
            <Typography variant="caption">{c.description}</Typography>
          </Alert>
        ))}
      </Stack>
    </Box>
  )
}

function UseCasesReferenceAccordion({ use_cases }: { use_cases: ExtractedUseCase[] }) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  if (!use_cases.length) return null
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
      {use_cases.map((uc, i) => {
            const priColor  = PRIORITY_COLORS[uc.priority] ?? '#6B7280'
            const typeColor = USE_CASE_COLOR[uc.type]      ?? USE_CASE_COLOR.other
            const typeIcon  = USE_CASE_ICON[uc.type]       ?? USE_CASE_ICON.other
            return (
              <Paper key={i} elevation={0} sx={{
                borderRadius: 2.5, overflow: 'hidden',
                border: '1px solid',
                borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
                bgcolor: isDark ? alpha('#ffffff', 0.03) : '#ffffff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                display: 'flex', flexDirection: 'column',
                transition: 'box-shadow .2s ease, border-color .2s ease, transform .2s ease',
                '&:hover': {
                  boxShadow: '0 6px 20px rgba(0,0,0,0.09)',
                  borderColor: alpha(typeColor, 0.35),
                  transform: 'translateY(-2px)',
                },
              }}>
                {/* Accent bar */}
                <Box sx={{ height: 3, bgcolor: typeColor, opacity: 0.75 }} />
                <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25, flex: 1 }}>
                  {/* Icon + priority */}
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <Box sx={{
                      width: 34, height: 34, borderRadius: 1.5,
                      bgcolor: alpha(typeColor, 0.1), color: typeColor,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {typeIcon}
                    </Box>
                    <Chip label={uc.priority.toUpperCase()} size="small"
                      sx={{
                        height: 20, fontSize: '0.63rem', fontWeight: 700,
                        bgcolor: alpha(priColor, 0.1), color: priColor,
                        border: '1px solid', borderColor: alpha(priColor, 0.22),
                        '& .MuiChip-label': { px: 0.85 },
                      }}
                    />
                  </Box>

                  {/* Name + description */}
                  <Box>
                    <Typography variant="body2" fontWeight={700} sx={{ lineHeight: 1.3, mb: uc.description ? 0.4 : 0 }}>
                      {uc.name}
                    </Typography>
                    {uc.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4, display: 'block' }}>
                        {uc.description}
                      </Typography>
                    )}
                  </Box>

                  {/* Type + Frequency */}
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    <Chip label={TYPE_LABELS[uc.type] ?? uc.type} size="small"
                      sx={{
                        height: 20, fontSize: '0.63rem', fontWeight: 700,
                        bgcolor: alpha(typeColor, 0.1), color: typeColor,
                        border: '1px solid', borderColor: alpha(typeColor, 0.22),
                        '& .MuiChip-label': { px: 0.85 },
                      }}
                    />
                    {uc.time_granularity?.length > 0 && (
                      <Chip label={uc.time_granularity[0]} size="small" variant="outlined"
                        sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.85 } }}
                      />
                    )}
                  </Box>

                  <Divider sx={{ opacity: 0.45 }} />

                  {/* KPIs */}
                  {uc.metrics?.length > 0 && (
                    <Box>
                      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'text.disabled', mb: 0.5 }}>KPIs</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
                        {uc.metrics.map((m) => <Chip key={m} label={m} size="small" color="secondary" variant="outlined"
                          sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.75 } }} />)}
                      </Box>
                    </Box>
                  )}

                  {/* Entities */}
                  {uc.entities?.length > 0 && (
                    <Box>
                      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'text.disabled', mb: 0.5 }}>Entities</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
                        {uc.entities.map((e) => <Chip key={e} label={e} size="small" color="primary" variant="outlined"
                          sx={{ fontSize: '0.65rem', height: 20, '& .MuiChip-label': { px: 0.75 } }} />)}
                      </Box>
                    </Box>
                  )}

                  {/* Dimensions */}
                  {uc.dimensions?.length > 0 && (
                    <Box sx={{ mt: 'auto' }}>
                      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'text.disabled', mb: 0.5 }}>Dimensions</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4 }}>
                        {uc.dimensions.map((d) => <Chip key={d} label={d} size="small" variant="outlined"
                          sx={{ fontSize: '0.65rem', height: 20, color: 'text.secondary', '& .MuiChip-label': { px: 0.75 } }} />)}
                      </Box>
                    </Box>
                  )}
                </Box>
              </Paper>
            )
      })}
    </Box>
  )
}

// Detect whether a prompt string is SQL or natural language
function isSqlPrompt(text: string): boolean {
  const t = text.trim().toUpperCase()
  return /^(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|MERGE)\b/.test(t)
}

// ── Data Model constants ───────────────────────────────────────────────────────

const MODEL_TYPE_COLORS: Record<string, string> = {
  history:        tokens.sky600      ?? '#0284C7',
  aggregation:    tokens.emerald600  ?? '#059669',
  summary:        '#0D9488',
  reconciliation: tokens.amber600    ?? '#D97706',
}

const MODEL_TYPE_LABELS: Record<string, string> = {
  history:        'History',
  aggregation:    'Aggregation',
  summary:        'Summary',
  reconciliation: 'Reconciliation',
}

// ── Model step state ──────────────────────────────────────────────────────────

interface SchemaColumn { name: string; type: string; isPk: boolean }
interface SchemaTable  { name: string; schema?: string; columns: SchemaColumn[] }
interface SchemaRelation { parentTable: string; parentCol: string; refTable: string; refCol: string }
interface SchemaContext {
  tableCount: number
  tables:     SchemaTable[]
  relations:  SchemaRelation[]
}

interface ModelStepState {
  devDone:          boolean
  schemaConnId:     number | null
  schemaCollected:  boolean
  schemaCollecting: boolean
  schemaContext:    SchemaContext | null
}

const DEFAULT_STEP_STATE: ModelStepState = {
  devDone: false, schemaConnId: null, schemaCollected: false, schemaCollecting: false, schemaContext: null,
}

// Build a compact SchemaContext from the raw /admin/catalog response
function buildSchemaContext(data: Record<string, unknown>): SchemaContext {
  const byTable: Record<string, SchemaTable> = {}
  for (const col of (data.columns as Array<Record<string, unknown>>) ?? []) {
    const key = col.table_name as string
    if (!byTable[key]) byTable[key] = { name: key, schema: col.table_schema as string | undefined, columns: [] }
    byTable[key].columns.push({
      name:  col.column_name as string,
      type:  (col.data_type as string | undefined) ?? '',
      isPk:  !!(col.is_primary_key),
    })
  }
  return {
    tableCount: ((data.summary as Record<string, unknown>)?.table_count as number) ?? 0,
    tables:     Object.values(byTable),
    relations:  ((data.relations as Array<Record<string, unknown>>) ?? []).map((r) => ({
      parentTable: r.parent_table  as string,
      parentCol:   r.parent_column as string,
      refTable:    r.referenced_table  as string,
      refCol:      r.referenced_column as string,
    })),
  }
}

// Fuzzy entity→table match: table name contains entity word (case-insensitive)
function tableMatchesEntity(tableName: string, entities: string[]): boolean {
  const t = tableName.toLowerCase()
  return entities.some((e) => t.includes(e.toLowerCase()) || e.toLowerCase().includes(t))
}

// ── DataModelCard ─────────────────────────────────────────────────────────────

function DataModelCard({
  model, index, stepState, onStepChange, connections,
}: {
  model: DataModel
  index: number
  stepState: ModelStepState
  onStepChange: (s: ModelStepState) => void
  connections: SourceConnection[]
}) {
  const navigate            = useNavigate()
  const { enqueueSnackbar } = useSnackbar()
  const [devDialogOpen, setDevDialogOpen] = useState(false)
  const typeColor = MODEL_TYPE_COLORS[model.type] ?? (tokens.indigo600 ?? '#4F46E5')

  // ── Schema helpers — mirror AdminPage's streamPost pattern exactly ──────────
  const fetchCatalog = async (connId: number): Promise<SchemaContext> => {
    const token = useAppStore.getState().user?.token
    const res = await fetch(`/api/admin/catalog/${connId}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as any).detail || `Catalog fetch failed (${res.status})`)
    }
    return buildSchemaContext(await res.json())
  }

  const runSseDiscovery = async (connId: number, delta: boolean): Promise<void> => {
    const token = useAppStore.getState().user?.token
    const res = await fetch(`/api/admin/discover/${connId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ delta }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as any).detail || `Discovery failed (${res.status})`)
    }
    const reader  = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue
          let evt: { type: string; msg?: string } | null = null
          try { evt = JSON.parse(line.slice(6)) } catch { continue }
          if (evt?.type === 'error') throw new Error(evt.msg ?? 'Schema collection error')
        }
      }
    }
  }

  // ── Collect Schema — delta by default, full only on force re-collect ───────
  const handleCollectSchema = async (forceRediscover = false) => {
    if (!stepState.schemaConnId) {
      enqueueSnackbar('Select a connection first', { variant: 'warning' })
      return
    }
    const connId = stepState.schemaConnId
    onStepChange({ ...stepState, schemaCollecting: true })
    try {
      await runSseDiscovery(connId, !forceRediscover)
      const ctx = await fetchCatalog(connId)
      onStepChange({ ...stepState, schemaCollecting: false, schemaCollected: true, schemaContext: ctx })
      const verb = forceRediscover ? 'Re-collected' : 'Synced'
      enqueueSnackbar(`${verb} — ${ctx.tableCount} tables, Reports & Dashboards unlocked`, { variant: 'success' })
    } catch (err) {
      onStepChange({ ...stepState, schemaCollecting: false })
      const msg = (err as Error).message ?? ''
      enqueueSnackbar(
        msg.length > 0 && msg.length < 200
          ? `Schema collection failed: ${msg}`
          : 'Schema collection failed — check connection and retry',
        { variant: 'error' },
      )
    }
  }

  const activeStep = stepState.schemaCollected ? 4 : stepState.devDone ? 1 : 0

  const lockedOverlay = (
    <Box sx={{
      position: 'absolute', inset: 0, borderRadius: 1.5,
      bgcolor: alpha('#9CA3AF', 0.18),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 1,
    }}>
      <Tooltip title="Collect schema first">
        <LockOutlined sx={{ color: 'text.disabled', fontSize: 20 }} />
      </Tooltip>
    </Box>
  )

  const isDarkModel = useAppStore((s) => s.themeMode) === 'dark'

  return (
    <Stack spacing={2}>

      {/* ── Box 1: Analysis Overview ──────────────────────────────────────── */}
      <Paper elevation={0} sx={{
        borderRadius: 2.5, overflow: 'hidden',
        border: '1px solid',
        borderColor: isDarkModel ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
        bgcolor: isDarkModel ? alpha('#ffffff', 0.03) : '#ffffff',
        boxShadow: isDarkModel ? 'none' : '0 1px 6px rgba(0,0,0,0.05)',
      }}>
        <Box sx={{ height: 3, bgcolor: typeColor, opacity: 0.8 }} />
        <Box sx={{ p: 2.5 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <Box sx={{
              width: 36, height: 36, borderRadius: 1.5, flexShrink: 0,
              bgcolor: alpha(typeColor, 0.1), color: typeColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <BarChartOutlined sx={{ fontSize: 18 }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>{model.name}</Typography>
              <Typography variant="caption" color="text.secondary">{model.grain}</Typography>
            </Box>
          </Box>
          <Chip
            label={MODEL_TYPE_LABELS[model.type] ?? model.type}
            size="small"
            sx={{ bgcolor: alpha(typeColor, 0.12), color: typeColor, fontWeight: 700, fontSize: '0.65rem' }}
          />
        </Box>

          {/* Chip groups — labeled grid matching Unified Intent style */}
          {(() => {
            const groups = [
              { label: 'Entities',          items: model.entities,        color: 'primary'   as const, customColor: undefined as string | undefined },
              { label: 'KPIs',              items: model.metrics,         color: 'secondary' as const, customColor: undefined },
              { label: 'Derived Metrics',   items: model.derived_metrics, color: 'default'   as const, customColor: '#7C3AED' },
              { label: 'Dimensions',        items: model.dimensions,      color: 'default'   as const, customColor: undefined },
              { label: 'Use Cases Covered', items: model.use_cases,       color: 'info'      as const, customColor: undefined },
            ].filter((g) => g.items.length > 0)
            if (!groups.length) return null
            return (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1.5 }}>
                {groups.map(({ label, items, color, customColor }) => (
                  <Paper key={label} elevation={0} sx={{
                    p: 1.75, borderRadius: 2,
                    border: '1px solid',
                    borderColor: isDarkModel ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
                    bgcolor: isDarkModel ? alpha('#ffffff', 0.03) : '#FAFAFA',
                  }}>
                    <Typography variant="caption" fontWeight={700} color="text.disabled"
                      sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', mb: 0.75 }}>
                      {label}
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {items.map((it) => customColor ? (
                        <Chip key={it} label={it} size="small" variant="outlined"
                          sx={{ fontSize: '0.68rem', color: customColor, borderColor: alpha(customColor, 0.4), bgcolor: alpha(customColor, 0.07) }} />
                      ) : (
                        <Chip key={it} label={it} size="small" color={color} variant="outlined" sx={{ fontSize: '0.68rem' }} />
                      ))}
                    </Box>
                  </Paper>
                ))}
              </Box>
            )
          })()}
        </Box>
      </Paper>

      {/* ── Box 2: Execution Workflow ──────────────────────────────────────── */}
      <Paper elevation={0} sx={{
        borderRadius: 2.5, overflow: 'hidden',
        border: '1px solid',
        borderColor: isDarkModel ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
        bgcolor: isDarkModel ? alpha('#ffffff', 0.03) : '#ffffff',
        boxShadow: isDarkModel ? 'none' : '0 1px 6px rgba(0,0,0,0.05)',
      }}>
        <Box sx={{ height: 3, bgcolor: tokens.indigo600 ?? '#4F46E5', opacity: 0.8 }} />
        <Box sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: 1.5, flexShrink: 0,
              bgcolor: alpha(tokens.indigo600 ?? '#4F46E5', 0.1), color: tokens.indigo600 ?? '#4F46E5',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PlayArrowOutlined sx={{ fontSize: 16 }} />
            </Box>
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>Execution Workflow</Typography>
              <Typography variant="caption" color="text.secondary">Step-by-step build pipeline for {model.name}</Typography>
            </Box>
          </Box>

          <Stepper activeStep={activeStep} sx={{ mb: 2.5 }} alternativeLabel>
            {['Development', 'Collect Schema', 'Reports', 'Dashboards', 'Testing'].map((label) => (
              <Step key={label}><StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: '0.7rem' } }}>{label}</StepLabel></Step>
            ))}
          </Stepper>

          <Stack spacing={2}>
          {/* ── Step 1: Development ─────────────────────────────────── */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
              Step 1 — Development
            </Typography>
            <TextField
              value={model.development_prompt} multiline minRows={3} maxRows={6}
              size="small" fullWidth
              InputProps={{ readOnly: true, sx: { fontSize: '0.73rem', fontFamily: 'monospace' } }}
              sx={{ mb: 1 }}
            />
            {!stepState.devDone ? (
              <Button
                variant="contained" size="small"
                startIcon={<CodeOutlined sx={{ fontSize: 14 }} />}
                onClick={() => navigate('/development', { state: { prefillPrompt: model.development_prompt } })}
                sx={{ bgcolor: tokens.indigo600 ?? '#4F46E5', '&:hover': { bgcolor: tokens.indigo600, filter: 'brightness(0.88)' }, fontSize: '0.74rem', mr: 1 }}
              >
                Run Development
              </Button>
            ) : null}
            <Button
              variant={stepState.devDone ? 'outlined' : 'text'}
              size="small" color={stepState.devDone ? 'success' : 'inherit'}
              startIcon={stepState.devDone ? <CheckCircleOutlined sx={{ fontSize: 14 }} /> : undefined}
              onClick={() => !stepState.devDone && setDevDialogOpen(true)}
              disabled={stepState.devDone}
              sx={{ fontSize: '0.74rem' }}
            >
              {stepState.devDone ? 'Development Complete' : 'Mark Development Done'}
            </Button>
          </Box>

          {/* ── Step 2: Collect Schema ───────────────────────────────── */}
          <Box sx={{ opacity: stepState.devDone ? 1 : 0.45, transition: 'opacity 0.2s', pointerEvents: stepState.devDone ? 'auto' : 'none' }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
              Step 2 — Collect Schema {!stepState.devDone && <Chip label="locked" size="small" sx={{ fontSize: '0.6rem', ml: 0.5, height: 16 }} />}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel sx={{ fontSize: '0.78rem' }}>Connection</InputLabel>
                <Select
                  value={stepState.schemaConnId ?? ''}
                  label="Connection"
                  onChange={(e) => onStepChange({ ...stepState, schemaConnId: e.target.value as number || null })}
                  sx={{ fontSize: '0.78rem' }}
                  disabled={stepState.schemaCollecting}
                >
                  <MenuItem value=""><em>Select connection…</em></MenuItem>
                  {connections.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined" size="small"
                startIcon={stepState.schemaCollecting
                  ? <CircularProgress size={13} />
                  : stepState.schemaCollected
                    ? <CheckCircleOutlined sx={{ fontSize: 14 }} />
                    : <SchemaOutlined sx={{ fontSize: 14 }} />
                }
                onClick={() => handleCollectSchema(false)}
                disabled={stepState.schemaCollecting || !stepState.schemaConnId}
                color={stepState.schemaCollected ? 'success' : 'primary'}
                sx={{ fontSize: '0.74rem' }}
              >
                {stepState.schemaCollecting ? 'Syncing…' : stepState.schemaCollected ? 'Schema Ready' : 'Collect Schema'}
              </Button>
              {stepState.schemaCollected && (
                <Tooltip title="Force full re-scan of the database schema">
                  <Button
                    variant="text" size="small" color="inherit"
                    startIcon={<RefreshOutlined sx={{ fontSize: 13 }} />}
                    onClick={() => handleCollectSchema(true)}
                    disabled={stepState.schemaCollecting}
                    sx={{ fontSize: '0.7rem', color: 'text.secondary' }}
                  >
                    Re-collect
                  </Button>
                </Tooltip>
              )}
            </Box>
            {stepState.schemaCollecting && <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />}

            {/* Schema Context Panel */}
            {stepState.schemaContext && stepState.schemaContext.tableCount > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Accordion disableGutters elevation={0}
                  sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <SchemaOutlined sx={{ fontSize: 15, color: 'text.secondary' }} />
                      <Typography variant="caption" fontWeight={700} color="text.secondary">
                        Schema Definitions — {stepState.schemaContext.tableCount} tables
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails sx={{ pt: 0.5 }}>
                    <Stack spacing={1}>
                      {stepState.schemaContext.tables.map((tbl) => {
                        const isMatch = tableMatchesEntity(tbl.name, model.entities)
                        return (
                          <Accordion key={tbl.name} disableGutters elevation={0}
                            sx={{
                              border: '1px solid', borderRadius: '6px !important',
                              borderColor: isMatch ? alpha(tokens.emerald600 ?? '#059669', 0.5) : 'divider',
                              bgcolor: isMatch ? alpha(tokens.emerald600 ?? '#059669', 0.04) : 'transparent',
                              '&:before': { display: 'none' },
                            }}
                          >
                            <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 14 }} />} sx={{ minHeight: 32, '& .MuiAccordionSummary-content': { my: 0.25 } }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'monospace', color: isMatch ? (tokens.emerald600 ?? '#059669') : 'text.primary' }}>
                                  {tbl.name}
                                </Typography>
                                {isMatch && <Chip label="matched" size="small" color="success" variant="outlined" sx={{ fontSize: '0.58rem', height: 16 }} />}
                                <Typography variant="caption" color="text.secondary">({tbl.columns.length} cols)</Typography>
                              </Box>
                            </AccordionSummary>
                            <AccordionDetails sx={{ pt: 0, pb: 0.5 }}>
                              <Stack spacing={0.25}>
                                {tbl.columns.map((col) => (
                                  <Box key={col.name} sx={{ display: 'flex', gap: 1, alignItems: 'center', px: 0.5 }}>
                                    {col.isPk && <Chip label="PK" size="small" color="primary" sx={{ fontSize: '0.55rem', height: 14, fontWeight: 700 }} />}
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: col.isPk ? 700 : 400 }}>{col.name}</Typography>
                                    {col.type && <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>{col.type}</Typography>}
                                  </Box>
                                ))}
                              </Stack>
                            </AccordionDetails>
                          </Accordion>
                        )
                      })}
                      {stepState.schemaContext.relations.length > 0 && (
                        <Box sx={{ pt: 0.5 }}>
                          <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            Relationships ({stepState.schemaContext.relations.length})
                          </Typography>
                          <Stack spacing={0.25}>
                            {stepState.schemaContext.relations.map((r, i) => (
                              <Typography key={i} variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'text.secondary' }}>
                                {r.parentTable}.{r.parentCol} → {r.refTable}.{r.refCol}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Box>
            )}
          </Box>

          {/* ── Step 3: Reports ──────────────────────────────────────── */}
          <Box sx={{ position: 'relative' }}>
            {!stepState.schemaCollected && lockedOverlay}
            <Accordion disableGutters elevation={0}
              sx={{
                border: '1px solid', borderColor: 'divider', borderRadius: '8px !important',
                '&:before': { display: 'none' },
                opacity: stepState.schemaCollected ? 1 : 0.5,
              }}
            >
              <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Step 3 — Reports ({model.reports.length})
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  {model.reports.map((report, ri) => (
                    <Paper key={ri} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{report.name}</Typography>
                      {report.description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>{report.description}</Typography>
                      )}
                      <TextField
                        value={report.prompt} multiline minRows={2} maxRows={4}
                        size="small" fullWidth
                        InputProps={{ readOnly: true, sx: { fontSize: '0.72rem', fontFamily: 'monospace' } }}
                        sx={{ mb: 1 }}
                      />
                      <Button
                        variant="contained" size="small"
                        startIcon={<PlayArrowOutlined sx={{ fontSize: 14 }} />}
                        onClick={() => navigate('/reports', {
                          state: isSqlPrompt(report.prompt)
                            ? { prefillSql: report.prompt }
                            : { prefillPrompt: report.prompt },
                        })}
                        disabled={!stepState.schemaCollected}
                        sx={{ bgcolor: tokens.emerald600 ?? '#059669', '&:hover': { bgcolor: tokens.emerald600, filter: 'brightness(0.88)' }, fontSize: '0.72rem' }}
                      >
                        Run Report
                      </Button>
                    </Paper>
                  ))}
                </Stack>
              </AccordionDetails>
            </Accordion>
          </Box>

          {/* ── Step 4: Dashboard ────────────────────────────────────── */}
          <Box sx={{ position: 'relative' }}>
            {!stepState.schemaCollected && lockedOverlay}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, opacity: stepState.schemaCollected ? 1 : 0.5 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                Step 4 — Dashboard
              </Typography>
              <TextField
                value={model.dashboard_prompt} multiline minRows={3} maxRows={6}
                size="small" fullWidth
                InputProps={{ readOnly: true, sx: { fontSize: '0.73rem', fontFamily: 'monospace' } }}
                sx={{ mb: 1 }}
              />
              <Button
                variant="contained" size="small"
                startIcon={<DashboardCustomizeOutlined sx={{ fontSize: 14 }} />}
                onClick={() => navigate('/dashboards', { state: { prefillPrompt: model.dashboard_prompt } })}
                disabled={!stepState.schemaCollected}
                sx={{ bgcolor: tokens.violet600 ?? '#7C3AED', '&:hover': { bgcolor: tokens.violet600, filter: 'brightness(0.88)' }, fontSize: '0.74rem' }}
              >
                Run Dashboard
              </Button>
            </Box>
          </Box>

          {/* ── Step 5: Testing ──────────────────────────────────────── */}
          <Box sx={{ position: 'relative' }}>
            {!stepState.schemaCollected && lockedOverlay}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, opacity: stepState.schemaCollected ? 1 : 0.5 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', mb: 0.75 }}>
                Step 5 — Testing
              </Typography>
              <TextField
                value={model.testing_prompt} multiline minRows={3} maxRows={6}
                size="small" fullWidth
                InputProps={{ readOnly: true, sx: { fontSize: '0.73rem', fontFamily: 'monospace' } }}
                sx={{ mb: 1 }}
              />
              <Button
                variant="contained" size="small"
                startIcon={<FactCheckOutlined sx={{ fontSize: 14 }} />}
                onClick={() => navigate('/testing', { state: { prefillPrompt: model.testing_prompt } })}
                disabled={!stepState.schemaCollected}
                sx={{ bgcolor: tokens.amber600 ?? '#D97706', '&:hover': { bgcolor: tokens.amber600, filter: 'brightness(0.88)' }, fontSize: '0.74rem' }}
              >
                Run Testing
              </Button>
            </Box>
          </Box>
          </Stack>
        </Box>
      </Paper>

      {/* Confirm Development Done dialog */}
      <Dialog open={devDialogOpen} onClose={() => setDevDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem', fontWeight: 700 }}>Confirm Development Complete</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Confirm that you have built <strong>{model.name}</strong> in the Development module before unlocking the next step.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDevDialogOpen(false)} size="small">Cancel</Button>
          <Button
            variant="contained" color="success" size="small"
            onClick={() => {
              setDevDialogOpen(false)
              onStepChange({ ...stepState, devDone: true })
            }}
          >
            Yes, Mark Complete
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

// ── Session-storage helpers (project-scoped) ─────────────────────────────────

function ssKey(suffix: string, projectId?: number) {
  return `stories_page_${suffix}_${projectId ?? 'none'}`
}

function loadStories(key: string): StoryInput[] {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return [{ title: '', description: '', acceptance_criteria: '' }]
}

function loadResult(key: string): StoryAnalysisResult | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

function loadRefinement(key: string): string {
  try { return sessionStorage.getItem(key) ?? '' } catch { return '' }
}

const BLANK_STORY: StoryInput = { title: '', description: '', acceptance_criteria: '' }

// ── History drawer ────────────────────────────────────────────────────────────

function HistoryDrawer({
  open, onClose, onRestore, activeProjectId,
}: {
  open: boolean
  onClose: () => void
  onRestore: (stories: StoryInput[], result: StoryAnalysisResult) => void
  activeProjectId?: number
}) {
  const { enqueueSnackbar } = useSnackbar()

  const { data: analyses = [], refetch } = useQuery<SavedAnalysisOut[]>({
    queryKey: ['story-analyses', activeProjectId],
    queryFn:  () => storiesApi.listAnalyses(activeProjectId ?? null),
    enabled:  open,
    staleTime: 0,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => storiesApi.deleteAnalysis(id),
    onSuccess: () => { refetch(); enqueueSnackbar('Analysis deleted', { variant: 'info' }) },
    onError: () => enqueueSnackbar('Delete failed', { variant: 'error' }),
  })

  const handleRestore = async (id: number) => {
    try {
      const full = await storiesApi.getAnalysis(id)
      onRestore(full.stories, full.result)
      onClose()
      enqueueSnackbar(`Restored: ${full.title}`, { variant: 'success' })
    } catch {
      enqueueSnackbar('Could not load analysis', { variant: 'error' })
    }
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: 380 } }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryOutlined /> Analysis History
        </Typography>
        <IconButton size="small" onClick={onClose}><CloseOutlined fontSize="small" /></IconButton>
      </Box>
      {analyses.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">No saved analyses yet.</Typography>
          <Typography variant="caption" color="text.secondary">Run an analysis and click Save to add one.</Typography>
        </Box>
      ) : (
        <List dense disablePadding>
          {analyses.map((a) => (
            <ListItem
              key={a.id}
              divider
              button
              onClick={() => handleRestore(a.id)}
              sx={{ alignItems: 'flex-start', py: 1.5 }}
            >
              <ListItemText
                primary={
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ maxWidth: 260 }}>
                    {a.title}
                  </Typography>
                }
                secondary={
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                    <Chip label={`${a.use_case_count} use case${a.use_case_count !== 1 ? 's' : ''}`} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                    {a.model && <Chip label={a.model} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />}
                    <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                      {new Date(a.created_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <Tooltip title="Delete">
                  <IconButton
                    size="small" edge="end" color="error"
                    onClick={(e) => { e.stopPropagation(); deleteMut.mutate(a.id) }}
                    disabled={deleteMut.isPending}
                  >
                    <DeleteOutlined sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </ListItemSecondaryAction>
            </ListItem>
          ))}
        </List>
      )}
    </Drawer>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StoriesPage() {
  const { enqueueSnackbar }   = useSnackbar()
  const isDark                = useAppStore((s) => s.themeMode) === 'dark'
  const { activeProject }     = useAppStore()
  const projectId             = activeProject?.id

  // Project-scoped sessionStorage keys
  const ssStories    = ssKey('cards',     projectId)
  const ssResult     = ssKey('result',    projectId)
  const ssRefinement = ssKey('refinement', projectId)

  // Core state — restored from project-scoped sessionStorage
  const [stories, setStories]             = useState<StoryInput[]>(() => loadStories(ssStories))
  const [result,  setResult]              = useState<StoryAnalysisResult | null>(() => loadResult(ssResult))

  // Single model step state (project-scoped sessionStorage)
  const ssModelStep = ssKey('model_step', projectId)
  const [modelStep, setModelStep] = useState<ModelStepState>(() => {
    try {
      const raw = sessionStorage.getItem(ssKey('model_step', projectId))
      if (raw) return JSON.parse(raw)
    } catch { /* ignore */ }
    return DEFAULT_STEP_STATE
  })

  // Pipeline stage navigation
  const [activeStage, setActiveStage]     = useState(0)
  const [collapsed, setCollapsed]         = useState<Record<string, boolean>>({})
  const toggleSection = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))

  // Save / history state
  const [saveTitle, setSaveTitle]         = useState('')
  const [isSaved,   setIsSaved]           = useState(false)
  const [historyOpen, setHistoryOpen]     = useState(false)

  // Refine state
  const [refinementText, setRefinementText] = useState<string>(() => loadRefinement(ssRefinement))

  // Clarity state
  const [clarityConnId, setClarityConnId] = useState<number | ''>('')
  const [clarityDone,   setClarityDone]   = useState(false)

  // Persist model step state to project-scoped sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem(ssModelStep, JSON.stringify(modelStep)) } catch { /* ignore */ }
  }, [modelStep, ssModelStep])

  // ── Reset state when project changes ────────────────────────────────────────
  const prevProjectIdRef = useRef(projectId)
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId
      const newSsStories    = ssKey('cards',       projectId)
      const newSsResult     = ssKey('result',      projectId)
      const newSsRefinement = ssKey('refinement',  projectId)
      setStories(loadStories(newSsStories))
      setResult(loadResult(newSsResult))
      setRefinementText(loadRefinement(newSsRefinement))
      setSaveTitle('')
      setIsSaved(false)
      setClarityDone(false)
      setModelStep(DEFAULT_STEP_STATE)
      setActiveStage(0)
      setCollapsed({})
    }
  }, [projectId])

  // Auto-populate save title from first story
  useEffect(() => {
    if (!saveTitle && stories[0]?.title) {
      setSaveTitle(stories[0].title)
    }
  }, [stories]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to project-scoped sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem(ssStories, JSON.stringify(stories)) } catch { /* ignore */ }
  }, [stories, ssStories])

  useEffect(() => {
    try {
      if (result) sessionStorage.setItem(ssResult, JSON.stringify(result))
      else        sessionStorage.removeItem(ssResult)
    } catch { /* ignore */ }
  }, [result, ssResult])

  useEffect(() => {
    try { sessionStorage.setItem(ssRefinement, refinementText) } catch { /* ignore */ }
  }, [refinementText, ssRefinement])

  // Connections for Clarity selector — always fresh so global project/connection changes are reflected
  const { data: connections = [] } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn:  () => connectionsApi.list(activeProject?.id),
    staleTime: 0,
  })

  // ── Mutations ───────────────────────────────────────────────────────────────

  const analyzeMut = useMutation({
    mutationFn: (opts?: { refinement?: string; prev?: StoryAnalysisResult }) => {
      const filled = stories.filter((s) => s.title.trim() || s.description.trim())
      if (!filled.length) throw new Error('Add at least one story with a title or description.')
      return storiesApi.analyze(filled, 'gpt-4o-mini', opts?.refinement, opts?.prev ?? null)
    },
    onSuccess: (data, opts) => {
      setResult(data)
      setIsSaved(false)
      setClarityDone(false)
      setModelStep(DEFAULT_STEP_STATE)
      setActiveStage(1)
      enqueueSnackbar(
        opts?.refinement
          ? `Re-analysis complete — ${data.use_cases.length} use case${data.use_cases.length !== 1 ? 's' : ''} refined`
          : `Analysis complete — ${data.use_cases.length} use case${data.use_cases.length !== 1 ? 's' : ''} extracted`,
        { variant: 'success' }
      )
    },
    onError: (e: unknown) =>
      enqueueSnackbar((e as Error).message || 'Analysis failed', { variant: 'error' }),
  })

  const saveMut = useMutation({
    mutationFn: () => {
      if (!result) throw new Error('No result to save.')
      const title = saveTitle.trim() || `Analysis — ${new Date().toLocaleDateString()}`
      return storiesApi.saveAnalysis({
        title,
        stories_json: JSON.stringify(stories),
        result_json:  JSON.stringify(result),
        project_id:   activeProject?.id ?? null,
        model:        'gpt-4o-mini',
      })
    },
    onSuccess: () => {
      setIsSaved(true)
      enqueueSnackbar('Analysis saved', { variant: 'success' })
    },
    onError: () => enqueueSnackbar('Save failed', { variant: 'error' }),
  })

  const exportMut = useMutation({
    mutationFn: () => {
      if (!result?.use_cases?.length) throw new Error('No use cases to export.')
      return storiesApi.exportSql(result.use_cases, result.models ?? [])
    },
    onSuccess: () => enqueueSnackbar('SQL exported — check your downloads', { variant: 'success' }),
    onError:   () => enqueueSnackbar('Export failed', { variant: 'error' }),
  })

  const clarityMut = useMutation({
    mutationFn: () => {
      if (!result?.use_cases?.length) throw new Error('No use cases to push.')
      return storiesApi.pushToClarity({
        use_cases:  result.use_cases,
        models:     result.models ?? [],
        conn_id:    clarityConnId !== '' ? clarityConnId : null,
        project_id: activeProject?.id ?? null,
      })
    },
    onSuccess: (data) => {
      setClarityDone(true)
      enqueueSnackbar(
        `Clarity updated — ${data.query_contexts_added} context${data.query_contexts_added !== 1 ? 's' : ''} + ${data.query_examples_added} example${data.query_examples_added !== 1 ? 's' : ''} added`,
        { variant: 'success' }
      )
    },
    onError: () => enqueueSnackbar('Update Clarity failed', { variant: 'error' }),
  })

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const handleNewAnalysis = () => {
    setStories([{ ...BLANK_STORY }])
    setResult(null)
    setRefinementText('')
    setSaveTitle('')
    setIsSaved(false)
    setClarityDone(false)
    setModelStep(DEFAULT_STEP_STATE)
    setActiveStage(0)
    setCollapsed({})
    try {
      sessionStorage.removeItem(ssStories)
      sessionStorage.removeItem(ssResult)
      sessionStorage.removeItem(ssRefinement)
      sessionStorage.removeItem(ssModelStep)
    } catch { /* ignore */ }
  }

  const handleImported = (fetched: StoryInput[]) => {
    // backend returns resource_id for JIRA/ADO imports — map it to ticket_id
    const mapped = fetched.map((s) => {
      const raw = s as StoryInput & { resource_id?: string }
      return raw.resource_id ? { ...s, ticket_id: raw.resource_id } : s
    })
    setStories((prev) => {
      const hasOnlyBlank = prev.length === 1 && !prev[0].title && !prev[0].description
      return hasOnlyBlank ? mapped : [...prev, ...mapped]
    })
    setResult(null)
    setIsSaved(false)
  }

  const addStory = () => {
    if (stories.length >= 20) {
      enqueueSnackbar('Maximum 20 stories per analysis', { variant: 'warning' })
      return
    }
    setStories((prev) => [...prev, { title: '', description: '', acceptance_criteria: '' }])
  }

  // ── Pipeline config ─────────────────────────────────────────────────────────

  const STAGE_COLORS = [
    tokens.sky600     ?? '#0284C7',
    tokens.violet600  ?? '#7C3AED',
    tokens.emerald600 ?? '#059669',
    tokens.amber600   ?? '#D97706',
    tokens.indigo600  ?? '#4F46E5',
  ]
  const STAGE_LABELS = ['Import', 'Analysis', 'Use Cases', 'Data Model', 'Save']
  const STAGE_BADGES = [
    `${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`,
    result ? `${result.parsed_stories.length} parsed` : 'Pending',
    result ? `${result.use_cases.length} use cases` : '—',
    result?.models?.[0] ? '1 model' : '—',
    isSaved ? 'Saved ✓' : 'Unsaved',
  ]

  const getStageIcon = (idx: number, isActive: boolean, isCompleted: boolean, color: string) => {
    if (isCompleted) return <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
    const s = { fontSize: 14, color: isActive ? color : 'inherit' }
    const icons = [
      <CloudDownloadOutlined sx={s} />, <AutoAwesomeOutlined sx={s} />,
      <PsychologyOutlined sx={s} />, <SchemaOutlined sx={s} />, <SaveOutlined sx={s} />,
    ]
    return icons[idx]
  }

  const stageUnlocked = (idx: number) => {
    if (idx === 0) return true
    if (idx === 1) return stories.some((s) => s.title.trim() || s.description.trim())
    return result !== null
  }

  const hasStories = stories.some((s) => s.title.trim() || s.description.trim())

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ width: '100%', bgcolor: isDark ? 'transparent' : '#F7F8FA', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Page header ───────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 2.5, pb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoAwesomeOutlined sx={{ color: tokens.indigo600 ?? '#4F46E5', fontSize: 20 }} />
          <Typography variant="h6" fontWeight={800}>Development Hub</Typography>
          <Typography variant="body2" color="text.secondary">— Story Analysis Pipeline</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="contained" size="small" startIcon={<NoteAddOutlined />} onClick={handleNewAnalysis}
            sx={{
              whiteSpace: 'nowrap',
              background: `linear-gradient(135deg, ${tokens.indigo600 ?? '#4F46E5'}, ${tokens.violet600 ?? '#7C3AED'})`,
              boxShadow: `0 2px 8px ${alpha(tokens.indigo600 ?? '#4F46E5', 0.3)}`,
              '&:hover': { filter: 'brightness(1.08)' },
            }}>
            New Analysis
          </Button>
          <Button variant="outlined" size="small" startIcon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}
            sx={{ whiteSpace: 'nowrap' }}>
            Saved Analyses
          </Button>
        </Stack>
      </Box>

      {/* ── Pipeline header ────────────────────────────────────────── */}
      <Paper elevation={0} sx={{
        mx: 3, mb: 2, borderRadius: 2.5,
        border: '1px solid',
        borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
        bgcolor: isDark ? 'background.paper' : '#ffffff',
        boxShadow: isDark ? 'none' : '0 1px 6px rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {/* Stage pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flex: 1, flexWrap: 'wrap' }}>
            {STAGE_LABELS.map((label, idx) => {
              const color       = STAGE_COLORS[idx]
              const isActive    = activeStage === idx
              const isCompleted = idx < activeStage && (idx === 0 || result !== null)
              const isLocked    = !stageUnlocked(idx)
              return (
                <Box key={idx} sx={{ display: 'flex', alignItems: 'center' }}>
                  {idx > 0 && (
                    <Box sx={{ color: 'text.disabled', fontSize: '0.75rem', px: 0.5, userSelect: 'none' }}>›</Box>
                  )}
                  <Box
                    onClick={() => !isLocked && setActiveStage(idx)}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 0.75,
                      px: 1.5, py: 0.65, borderRadius: 2,
                      border: '1px solid',
                      borderColor: isActive ? alpha(color, isDark ? 0.5 : 0.35) : 'transparent',
                      bgcolor: isActive
                        ? alpha(color, isDark ? 0.15 : 0.08)
                        : isDark ? alpha('#ffffff', 0.02) : 'transparent',
                      color: isActive ? color : isLocked ? 'text.disabled' : 'text.secondary',
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      opacity: isLocked ? 0.4 : 1,
                      transition: 'all .15s ease',
                      '&:hover': isLocked ? {} : {
                        bgcolor: alpha(color, isDark ? 0.1 : 0.06),
                        borderColor: alpha(color, 0.25),
                        color: color,
                      },
                    }}
                  >
                    {getStageIcon(idx, isActive, isCompleted, color)}
                    <Box>
                      <Typography sx={{ fontSize: '0.72rem', fontWeight: isActive ? 700 : 600, lineHeight: 1.2, color: 'inherit' }}>
                        {label}
                      </Typography>
                      <Typography sx={{ fontSize: '0.6rem', color: isActive ? alpha(color, 0.8) : 'text.disabled', lineHeight: 1.2 }}>
                        {STAGE_BADGES[idx]}
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              )
            })}
          </Box>

          {/* Analyze button */}
          {hasStories && (
            <Button size="small"
              startIcon={analyzeMut.isPending ? <CircularProgress size={13} color="inherit" /> : <AutoAwesomeOutlined sx={{ fontSize: 15 }} />}
              onClick={() => analyzeMut.mutate(undefined)}
              disabled={analyzeMut.isPending}
              variant="contained"
              sx={{
                ml: 1.5, whiteSpace: 'nowrap', py: 0.65, px: 2, fontSize: '0.78rem', fontWeight: 700, flexShrink: 0,
                background: `linear-gradient(135deg, ${tokens.indigo600 ?? '#4F46E5'}, ${tokens.violet600 ?? '#7C3AED'})`,
                boxShadow: `0 2px 8px ${alpha(tokens.indigo600 ?? '#4F46E5', 0.35)}`,
                '&:hover': { filter: 'brightness(1.08)' },
              }}
            >
              {analyzeMut.isPending ? 'Analyzing…' : result ? 'Re-analyze' : 'Analyze Stories'}
            </Button>
          )}
        </Box>

        {/* Progress bar */}
        <LinearProgress variant="determinate" value={(activeStage / 4) * 100}
          sx={{
            height: 3,
            bgcolor: isDark ? alpha('#ffffff', 0.05) : alpha(tokens.indigo600 ?? '#4F46E5', 0.07),
            '& .MuiLinearProgress-bar': {
              background: `linear-gradient(90deg, ${tokens.indigo600 ?? '#4F46E5'}, ${tokens.violet600 ?? '#7C3AED'})`,
            },
          }}
        />
      </Paper>

      {/* ── Stage content ──────────────────────────────────────────── */}
      <Box sx={{ px: 3, pb: 3, flex: 1 }}>

        {/* Stage 0 — Import */}
        {activeStage === 0 && (
          <Stack spacing={2.5}>
            <Paper elevation={0} sx={{
              borderRadius: 2.5, overflow: 'hidden',
              border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
              bgcolor: isDark ? 'background.paper' : '#ffffff',
              boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <Box
                onClick={() => toggleSection('import')}
                sx={{ px: 2.5, py: 1.5, borderBottom: collapsed['import'] ? 'none' : '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.sky600 ?? '#0284C7', 0.03) } }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>Import Stories</Typography>
                  <Typography variant="caption" color="text.secondary">Import from JIRA / Azure DevOps, or add stories manually below.</Typography>
                </Box>
                <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled', transition: 'transform .2s ease', transform: collapsed['import'] ? 'rotate(-90deg)' : 'none' }} />
              </Box>
              {!collapsed['import'] && <Box sx={{ p: 2.5 }}><ImportSection onImported={handleImported} /></Box>}
            </Paper>

            <Paper elevation={0} sx={{
              borderRadius: 2.5, overflow: 'hidden',
              border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
              bgcolor: isDark ? 'background.paper' : '#ffffff',
              boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <Box
                onClick={() => toggleSection('stories')}
                sx={{ px: 2.5, py: 1.5, borderBottom: collapsed['stories'] ? 'none' : '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.sky600 ?? '#0284C7', 0.03) } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>Stories</Typography>
                  <Chip label={stories.length} size="small"
                    sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, '& .MuiChip-label': { px: 0.75 } }} />
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" startIcon={<AddOutlined />} onClick={addStory} variant="outlined"
                    sx={{ py: 0.4, px: 1.25, fontSize: '0.78rem', fontWeight: 600 }}>
                    Add Story
                  </Button>
                  <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled', transition: 'transform .2s ease', transform: collapsed['stories'] ? 'rotate(-90deg)' : 'none', cursor: 'pointer' }} onClick={() => toggleSection('stories')} />
                </Box>
              </Box>
              {!collapsed['stories'] && (
                <Box sx={{ p: 2.5 }}>
                  <Stack spacing={2}>
                    {stories.map((story, i) => (
                      <StoryCard key={i} story={story} index={i}
                        onChange={(updated) => setStories((prev) => prev.map((s, idx) => idx === i ? updated : s))}
                        onDelete={() => setStories((prev) => prev.filter((_, idx) => idx !== i))}
                        canDelete={stories.length > 1}
                      />
                    ))}
                  </Stack>
                </Box>
              )}
            </Paper>
          </Stack>
        )}

        {/* Stage 1 — Analysis */}
        {activeStage === 1 && (
          <>
            {!result ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 12, textAlign: 'center' }}>
                <Box sx={{
                  width: 72, height: 72, borderRadius: '50%', mb: 3,
                  bgcolor: alpha(tokens.violet600 ?? '#7C3AED', 0.08),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <AutoAwesomeOutlined sx={{ fontSize: 32, color: tokens.violet600 ?? '#7C3AED' }} />
                </Box>
                <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>Ready to Analyze</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400 }}>
                  Click "Analyze Stories" above to extract use cases, unified intent, and build a data model
                  from your {stories.length} {stories.length === 1 ? 'story' : 'stories'}.
                </Typography>
                {analyzeMut.isPending && <CircularProgress size={28} />}
              </Box>
            ) : (
              <Stack spacing={3}>
                {/* Stats bar */}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
                  <Typography variant="caption" fontWeight={600} color="success.main" sx={{ mr: 1 }}>Analysis complete</Typography>
                  <Chip label={`${result.tokens_in + result.tokens_out} tokens`} size="small" icon={<InfoOutlined />} variant="outlined"
                    sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.75 } }} />
                  <Chip label={`${(result.latency_ms / 1000).toFixed(1)}s`} size="small" variant="outlined"
                    sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.75 } }} />
                  <Chip label={`${result.use_cases.length} use case${result.use_cases.length !== 1 ? 's' : ''}`}
                    size="small" color="primary" variant="outlined"
                    sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.75 } }} />
                  {result.conflicts.length > 0 && (
                    <Chip label={`${result.conflicts.length} conflict${result.conflicts.length !== 1 ? 's' : ''}`}
                      size="small" color="warning" variant="outlined" icon={<WarningAmberOutlined />}
                      sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.75 } }} />
                  )}
                </Box>

                {/* Parsed Stories */}
                <Paper elevation={0} sx={{
                  borderRadius: 2.5, overflow: 'hidden',
                  border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
                  bgcolor: isDark ? 'background.paper' : '#ffffff',
                  boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <Box
                    onClick={() => toggleSection('parsed')}
                    sx={{ px: 2.5, py: 1.5, borderBottom: collapsed['parsed'] ? 'none' : '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.violet600 ?? '#7C3AED', 0.03) } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="subtitle2" fontWeight={700}>Parsed Stories</Typography>
                      <Chip label={result.parsed_stories.length} size="small"
                        sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, '& .MuiChip-label': { px: 0.75 } }} />
                      <Typography variant="caption" color="text.disabled">— AI-extracted analytics catalog</Typography>
                    </Box>
                    <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled', transition: 'transform .2s ease', transform: collapsed['parsed'] ? 'rotate(-90deg)' : 'none' }} />
                  </Box>
                  {!collapsed['parsed'] && (
                    <Box sx={{ p: 2.5 }}>
                      <ParsedStoriesAccordion stories={result.parsed_stories} />
                    </Box>
                  )}
                </Paper>

                {/* Unified Intent */}
                {result.unified_intent && (
                  <Paper elevation={0} sx={{
                    borderRadius: 2.5, overflow: 'hidden',
                    border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
                    bgcolor: isDark ? 'background.paper' : '#ffffff',
                    boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
                  }}>
                    <Box
                      onClick={() => toggleSection('intent')}
                      sx={{ px: 2.5, py: 1.5, borderBottom: collapsed['intent'] ? 'none' : '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.violet600 ?? '#7C3AED', 0.03) } }}>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={700}>Unified Intent</Typography>
                        <Typography variant="caption" color="text.secondary">Consolidated entities, KPIs, and dimensions across all stories</Typography>
                      </Box>
                      <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled', transition: 'transform .2s ease', transform: collapsed['intent'] ? 'rotate(-90deg)' : 'none' }} />
                    </Box>
                    {!collapsed['intent'] && (
                      <Box sx={{ p: 2.5 }}>
                        <UnifiedIntentAccordion intent={result.unified_intent} />
                      </Box>
                    )}
                  </Paper>
                )}
              </Stack>
            )}
          </>
        )}

        {/* Stage 2 — Use Cases */}
        {activeStage === 2 && result && (
          <Stack spacing={2.5}>
            <ConflictsSection conflicts={result.conflicts} />
            <Paper elevation={0} sx={{
              borderRadius: 2.5, overflow: 'hidden',
              border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
              bgcolor: isDark ? 'background.paper' : '#ffffff',
              boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <Box
                onClick={() => toggleSection('usecases')}
                sx={{ px: 2.5, py: 1.5, borderBottom: collapsed['usecases'] ? 'none' : '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.emerald600 ?? '#059669', 0.03) } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>Extracted Use Cases</Typography>
                  <Chip label={result.use_cases.length} size="small"
                    sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700, '& .MuiChip-label': { px: 0.75 } }} />
                </Box>
                <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled', transition: 'transform .2s ease', transform: collapsed['usecases'] ? 'rotate(-90deg)' : 'none' }} />
              </Box>
              {!collapsed['usecases'] && (
                <Box sx={{ p: 2.5 }}>
                  <UseCasesReferenceAccordion use_cases={result.use_cases} />
                </Box>
              )}
            </Paper>
          </Stack>
        )}

        {/* Stage 3 — Data Model */}
        {activeStage === 3 && result && (
          result.models?.[0] ? (
            <Paper elevation={0} sx={{
              borderRadius: 2.5, overflow: 'hidden',
              border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : 'rgba(0,0,0,0.08)',
              bgcolor: isDark ? 'background.paper' : '#ffffff',
              boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <Box
                onClick={() => toggleSection('datamodel')}
                sx={{ px: 2.5, py: 1.5, borderBottom: collapsed['datamodel'] ? 'none' : '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.amber600 ?? '#D97706', 0.03) } }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>Project Data Model</Typography>
                  <Typography variant="caption" color="text.secondary">Complete each step in order — collect schema before running reports or dashboards.</Typography>
                </Box>
                <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled', transition: 'transform .2s ease', transform: collapsed['datamodel'] ? 'rotate(-90deg)' : 'none' }} />
              </Box>
              {!collapsed['datamodel'] && (
                <Box sx={{ p: 2.5 }}>
                  <DataModelCard model={result.models[0]} index={0} stepState={modelStep} onStepChange={setModelStep} connections={connections} />
                </Box>
              )}
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 12, textAlign: 'center' }}>
              <SchemaOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" fontWeight={700} color="text.secondary">No Data Model Generated</Typography>
              <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>Re-run the analysis to generate a data model for your use cases.</Typography>
            </Box>
          )
        )}

        {/* Stage 4 — Save */}
        {activeStage === 4 && result && (
          <Stack spacing={2.5}>
            <Paper elevation={0} sx={{
              borderRadius: 2.5, overflow: 'hidden',
              border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : alpha(tokens.indigo600 ?? '#4F46E5', 0.18),
              bgcolor: isDark ? 'background.paper' : '#ffffff',
              boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <Box sx={{
                px: 2.5, py: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap',
                borderBottom: '1px solid', borderColor: 'divider',
                bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.indigo600 ?? '#4F46E5', 0.03),
              }}>
                <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
                <Typography variant="caption" fontWeight={600} color="success.main" sx={{ mr: 1 }}>Analysis complete</Typography>
                <Chip label={`${result.tokens_in + result.tokens_out} tokens`} size="small" icon={<InfoOutlined />} variant="outlined"
                  sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.75 } }} />
                <Chip label={`${(result.latency_ms / 1000).toFixed(1)}s`} size="small" variant="outlined"
                  sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.75 } }} />
                <Chip label={`${result.use_cases.length} use case${result.use_cases.length !== 1 ? 's' : ''}`}
                  size="small" color="primary" variant="outlined"
                  sx={{ height: 20, fontSize: '0.63rem', '& .MuiChip-label': { px: 0.75 } }} />
              </Box>
              <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <TextField size="small" placeholder="Analysis title…"
                  value={saveTitle} onChange={(e) => { setSaveTitle(e.target.value); setIsSaved(false) }}
                  sx={{ flex: 1, minWidth: 220, '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
                <Button variant="contained" size="small"
                  startIcon={isSaved ? <CheckCircleOutlined /> : (saveMut.isPending ? <CircularProgress size={13} color="inherit" /> : <SaveOutlined />)}
                  onClick={() => saveMut.mutate()} disabled={saveMut.isPending || isSaved} color={isSaved ? 'success' : 'primary'}
                  sx={{
                    whiteSpace: 'nowrap',
                    background: isSaved ? undefined : `linear-gradient(135deg, ${tokens.indigo600 ?? '#4F46E5'}, ${tokens.violet600 ?? '#7C3AED'})`,
                    boxShadow: isSaved ? undefined : `0 2px 8px ${alpha(tokens.indigo600 ?? '#4F46E5', 0.3)}`,
                  }}>
                  {isSaved ? '✓ Saved' : 'Save Analysis'}
                </Button>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel sx={{ fontSize: '0.78rem' }}>Clarity Connection</InputLabel>
                  <Select value={clarityConnId} label="Clarity Connection"
                    onChange={(e) => { setClarityConnId(e.target.value as number | ''); setClarityDone(false) }}
                    sx={{ fontSize: '0.78rem' }}>
                    <MenuItem value=""><em>Global (no connection)</em></MenuItem>
                    {connections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Button variant="outlined" size="small"
                  startIcon={clarityDone ? <CheckCircleOutlined /> : (clarityMut.isPending ? <CircularProgress size={13} /> : <PsychologyOutlined />)}
                  onClick={() => clarityMut.mutate()} disabled={clarityMut.isPending || clarityDone}
                  color={clarityDone ? 'success' : 'primary'} sx={{ whiteSpace: 'nowrap' }}>
                  {clarityDone ? '✓ Clarity Updated' : 'Update Clarity'}
                </Button>
              </Box>
            </Paper>

            <Paper elevation={0} sx={{
              borderRadius: 2.5, overflow: 'hidden',
              border: '1px solid', borderColor: isDark ? alpha('#ffffff', 0.07) : 'divider',
              bgcolor: isDark ? 'background.paper' : '#ffffff',
              boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.04)',
            }}>
              <Box
                onClick={() => toggleSection('refine')}
                sx={{ px: 2.5, py: 1.5, borderBottom: collapsed['refine'] ? 'none' : '1px solid', borderColor: 'divider', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', '&:hover': { bgcolor: isDark ? alpha('#ffffff', 0.02) : alpha(tokens.indigo600 ?? '#4F46E5', 0.03) } }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <RefreshOutlined sx={{ fontSize: 16, color: tokens.indigo600 ?? '#4F46E5' }} />
                  Refine Analysis
                </Typography>
                <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.disabled', transition: 'transform .2s ease', transform: collapsed['refine'] ? 'rotate(-90deg)' : 'none' }} />
              </Box>
              {!collapsed['refine'] && (
                <Box sx={{ p: 2.5 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                    Review the use cases, then type feedback below to re-analyze with your guidance.
                  </Typography>
                  <TextField fullWidth multiline minRows={2} size="small"
                    value={refinementText} onChange={(e) => setRefinementText(e.target.value)}
                    placeholder='e.g. "Focus more on monthly trends, add a reconciliation use case…"'
                    sx={{ mb: 1.5 }}
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button variant="contained" size="small"
                      startIcon={analyzeMut.isPending ? <CircularProgress size={13} color="inherit" /> : <RefreshOutlined />}
                      onClick={() => analyzeMut.mutate({ refinement: refinementText, prev: result })}
                      disabled={analyzeMut.isPending || !refinementText.trim()}
                      sx={{ background: `linear-gradient(135deg, ${tokens.indigo600 ?? '#4F46E5'}, ${tokens.violet600 ?? '#7C3AED'})` }}>
                      {analyzeMut.isPending ? 'Re-analyzing…' : 'Re-analyze with Feedback'}
                    </Button>
                  </Box>
                </Box>
              )}
            </Paper>
          </Stack>
        )}

      </Box>

      {/* ── History drawer ─────────────────────────────────────────── */}
      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        activeProjectId={activeProject?.id}
        onRestore={(s, r) => {
          setStories(s)
          setResult(r)
          setIsSaved(true)
          setSaveTitle('')
          setClarityDone(false)
          setActiveStage(1)
        }}
      />
    </Box>
  )
}
