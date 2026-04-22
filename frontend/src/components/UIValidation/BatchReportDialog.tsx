import React, { useState } from 'react'
import {
  Box, Chip, Collapse, Dialog, DialogActions, DialogContent,
  DialogTitle, Button, IconButton, LinearProgress, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Paper, Tooltip,
} from '@mui/material'
import {
  CheckCircleOutlined, ErrorOutlined, ExpandMoreOutlined, ExpandLessOutlined,
} from '@mui/icons-material'
import type { UiValidationRun, ValidationFieldResult } from '@/types'

interface Props {
  runs:    UiValidationRun[]
  onClose: () => void
}

function statusColor(s: string): 'success' | 'error' | 'warning' | 'default' {
  if (s === 'MATCH')    return 'success'
  if (s === 'MISMATCH') return 'error'
  if (s === 'MISSING')  return 'warning'
  return 'default'
}

function RunRow({ run }: { run: UiValidationRun }) {
  const [open, setOpen] = useState(false)
  const summary = run.summary

  return (
    <>
      <TableRow
        hover
        sx={{
          bgcolor: run.status === 'PASS'
            ? 'rgba(5,150,105,0.04)'
            : run.status === 'FAIL'
            ? 'rgba(220,38,38,0.04)'
            : undefined,
        }}
      >
        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500, fontSize: '0.8rem' }}>
          {run.entity_id}
        </TableCell>
        <TableCell>
          <Chip
            size="small"
            label={run.status}
            color={run.status === 'PASS' ? 'success' : 'error'}
            icon={run.status === 'PASS' ? <CheckCircleOutlined /> : <ErrorOutlined />}
            sx={{ fontSize: '0.7rem' }}
          />
        </TableCell>
        <TableCell>
          {summary ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="caption">
                {summary.matched}/{summary.total} matched
              </Typography>
              {summary.mismatched > 0 && (
                <Chip size="small" label={`${summary.mismatched} mismatch`} color="error" variant="outlined" sx={{ fontSize: '0.68rem', height: 18 }} />
              )}
            </Stack>
          ) : run.error_message ? (
            <Typography variant="caption" color="error">{run.error_message.slice(0, 60)}</Typography>
          ) : '—'}
        </TableCell>
        <TableCell align="center">
          {run.results.length > 0 && (
            <Tooltip title={open ? 'Collapse fields' : 'Expand fields'}>
              <IconButton size="small" onClick={() => setOpen((v) => !v)}>
                {open ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>

      {/* Expandable field breakdown */}
      {open && run.results.length > 0 && (
        <TableRow>
          <TableCell colSpan={4} sx={{ py: 0, px: 3, bgcolor: 'action.hover' }}>
            <Collapse in={open}>
              <Box sx={{ py: 1.5 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Field</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>UI Value</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>XML Value</TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {run.results.map((f: ValidationFieldResult, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontSize: '0.75rem', fontWeight: 500 }}>{f.field}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{f.ui_value ?? '—'}</TableCell>
                        <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{f.xml_value ?? '—'}</TableCell>
                        <TableCell>
                          <Chip size="small" label={f.status} color={statusColor(f.status)} variant="outlined"
                            sx={{ fontSize: '0.65rem', height: 18 }} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export default function BatchReportDialog({ runs, onClose }: Props) {
  const passed   = runs.filter((r) => r.status === 'PASS').length
  const failed   = runs.filter((r) => r.status === 'FAIL').length
  const errored  = runs.filter((r) => r.status === 'ERROR').length
  const total    = runs.length
  const passPct  = total > 0 ? Math.round((passed / total) * 100) : 0

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Batch UI Validation Report</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          {/* Summary bar */}
          <Box>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>
                {passed} / {total} records passed
              </Typography>
              <Typography variant="body2" color={passPct === 100 ? 'success.main' : 'error.main'}>
                {passPct}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={passPct}
              color={passPct === 100 ? 'success' : passPct >= 60 ? 'warning' : 'error'}
              sx={{ height: 8, borderRadius: 4 }}
            />
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Chip size="small" color="success" label={`${passed} passed`} variant="outlined" />
              {failed  > 0 && <Chip size="small" color="error"   label={`${failed} failed`}  variant="outlined" />}
              {errored > 0 && <Chip size="small" color="default" label={`${errored} errors`}  variant="outlined" />}
            </Stack>
          </Box>

          {/* Per-record table */}
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Entity ID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Result</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Summary</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((run) => <RunRow key={run.id} run={run} />)}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="outlined">Close</Button>
      </DialogActions>
    </Dialog>
  )
}
