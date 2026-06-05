import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  TextField, Chip, Table, TableHead, TableRow, TableCell, TableBody,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel,
} from '@mui/material'
import {
  FactCheckOutlined, AddOutlined, PlayArrowOutlined, DeleteOutlined,
  CheckCircleOutlined, ErrorOutlined, EditOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { RuleTestCase, RuleTestCaseCreate } from '@/types'

interface Props { connId: number | null; selectedRuleId: number | null }

const EMPTY: RuleTestCaseCreate = {
  rule_id: 0, conn_id: undefined, test_name: '', description: '',
  input_json: '[\n  { "PolicyNumber": "POL-001", "Premium": 15000 }\n]',
  expected_output_json: '[\n  { "PolicyNumber": "POL-001", "Premium": 15000, "Tier": "Gold" }\n]',
  created_by: undefined,
}

export default function TestCasesTab({ connId, selectedRuleId }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTc, setEditTc]         = useState<RuleTestCase | null>(null)
  const [form, setForm]             = useState<RuleTestCaseCreate>(EMPTY)
  const [filterRuleId, setFilterRuleId] = useState<number | null>(selectedRuleId)

  const { data: testCases = [], isLoading } = useQuery<RuleTestCase[]>({
    queryKey: ['ti-test-cases', connId, filterRuleId],
    queryFn: () => transformationApi.listTestCases({
      conn_id: connId ?? undefined,
      rule_id: filterRuleId ?? undefined,
    }),
    enabled: connId != null,
  })

  const { data: rulesResult } = useQuery({
    queryKey: ['ti-rules', connId, '', '', ''],
    queryFn: () => transformationApi.listRules({ conn_id: connId ?? undefined, is_active: true, limit: 100 }),
    enabled: connId != null,
  })
  const rules = rulesResult?.items ?? []

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ti-test-cases', connId] })

  const createMut = useMutation({
    mutationFn: (data: RuleTestCaseCreate) => transformationApi.createTestCase({ ...data, conn_id: connId ?? undefined }),
    onSuccess: () => { invalidate(); setDialogOpen(false); enqueueSnackbar('Test case created', { variant: 'success' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => transformationApi.deleteTestCase(id),
    onSuccess: () => { invalidate(); enqueueSnackbar('Deleted', { variant: 'info' }) },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const runMut = useMutation({
    mutationFn: (id: number) => transformationApi.runTestCase(id),
    onSuccess: (res, id) => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['ti-readiness', connId] })
      enqueueSnackbar(res.passed ? `Test #${id} passed` : `Test #${id} failed`, {
        variant: res.passed ? 'success' : 'error',
      })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const runAllMut = useMutation({
    mutationFn: () => transformationApi.runAllTestCases(connId!),
    onSuccess: (res) => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['ti-readiness', connId] })
      enqueueSnackbar(`${res.passed}/${res.total} tests passed`, {
        variant: res.failed === 0 ? 'success' : 'warning',
      })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  function openCreate() {
    setEditTc(null)
    setForm({ ...EMPTY, rule_id: filterRuleId ?? 0 })
    setDialogOpen(true)
  }

  const passed = testCases.filter(tc => tc.passed === true).length
  const failed = testCases.filter(tc => tc.passed === false).length
  const notRun = testCases.filter(tc => tc.passed === null).length

  return (
    <Box sx={{ p: 2.5 }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel sx={{ fontSize: '0.78rem' }}>Filter by Rule</InputLabel>
          <Select value={filterRuleId ?? ''} onChange={(e) => setFilterRuleId(e.target.value ? Number(e.target.value) : null)}
            label="Filter by Rule" sx={{ fontSize: '0.78rem' }}>
            <MenuItem value="">All Rules</MenuItem>
            {rules.map(r => <MenuItem key={r.id} value={r.id} sx={{ fontSize: '0.78rem' }}>{r.rule_name}</MenuItem>)}
          </Select>
        </FormControl>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <Chip label={`${passed} passed`} size="small"
            sx={{ height: 20, fontSize: '0.62rem', bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600 }} />
          <Chip label={`${failed} failed`} size="small"
            sx={{ height: 20, fontSize: '0.62rem', bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600 }} />
          <Chip label={`${notRun} not run`} size="small"
            sx={{ height: 20, fontSize: '0.62rem', bgcolor: alpha('#64748B', 0.12), color: '#64748B' }} />
        </Box>
        <Button size="small" variant="outlined"
          startIcon={runAllMut.isPending ? <CircularProgress size={12} /> : <PlayArrowOutlined />}
          disabled={!connId || runAllMut.isPending || testCases.length === 0}
          onClick={() => runAllMut.mutate()}
          sx={{ fontSize: '0.75rem', ml: 'auto' }}>
          Run All
        </Button>
        <Button size="small" variant="contained" startIcon={<AddOutlined />}
          onClick={openCreate} sx={{ fontSize: '0.75rem' }}>
          Add Test Case
        </Button>
      </Box>

      {isLoading && <Box sx={{ display: 'flex', gap: 1 }}><CircularProgress size={16} /><Typography variant="caption">Loading…</Typography></Box>}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Test Name</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Rule</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Result</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Last Run</TableCell>
              <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700, width: 100 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {testCases.map((tc) => {
              const rule = rules.find(r => r.id === tc.rule_id)
              return (
                <TableRow key={tc.id} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>{tc.test_name}</Typography>
                    {tc.description && (
                      <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>{tc.description}</Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                    {rule?.rule_name ?? `#${tc.rule_id}`}
                  </TableCell>
                  <TableCell>
                    {tc.passed === null ? (
                      <Chip label="Not run" size="small"
                        sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha('#64748B', 0.12), color: '#64748B' }} />
                    ) : tc.passed ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <CheckCircleOutlined sx={{ fontSize: 14, color: tokens.emerald600 }} />
                        <Typography sx={{ fontSize: '0.7rem', color: tokens.emerald600, fontWeight: 600 }}>Passed</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <ErrorOutlined sx={{ fontSize: 14, color: tokens.red600 }} />
                        <Typography sx={{ fontSize: '0.7rem', color: tokens.red600, fontWeight: 600 }}>Failed</Typography>
                      </Box>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>
                    {tc.last_run_at ? new Date(tc.last_run_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.25 }}>
                      <Tooltip title="Run test">
                        <IconButton size="small" color="primary"
                          disabled={runMut.isPending}
                          onClick={() => runMut.mutate(tc.id)}>
                          <PlayArrowOutlined sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error"
                          onClick={() => deleteMut.mutate(tc.id)}>
                          <DeleteOutlined sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              )
            })}
            {testCases.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={5} sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="caption" color="text.disabled">
                    No test cases yet. Click <strong>Add Test Case</strong> to create formal tests for your rules.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 700 }}>Add Test Case</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Rule</InputLabel>
              <Select value={form.rule_id || ''} onChange={(e) => setForm(f => ({ ...f, rule_id: Number(e.target.value) }))} label="Rule">
                {rules.map(r => <MenuItem key={r.id} value={r.id} sx={{ fontSize: '0.78rem' }}>{r.rule_name}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="Test Name" size="small" fullWidth required
              value={form.test_name} onChange={(e) => setForm(f => ({ ...f, test_name: e.target.value }))} />
            <TextField label="Description" size="small" fullWidth
              value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
                Input Records (JSON array)
              </Typography>
              <TextField multiline minRows={4} fullWidth size="small"
                value={form.input_json}
                onChange={(e) => setForm(f => ({ ...f, input_json: e.target.value }))}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.7rem' } }} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
                Expected Output (JSON array)
              </Typography>
              <TextField multiline minRows={4} fullWidth size="small"
                value={form.expected_output_json}
                onChange={(e) => setForm(f => ({ ...f, expected_output_json: e.target.value }))}
                inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.7rem' } }} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button size="small" variant="contained"
            disabled={!form.rule_id || !form.test_name || createMut.isPending}
            onClick={() => createMut.mutate(form)}>
            Create Test Case
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
