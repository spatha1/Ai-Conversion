import React from 'react'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, LinearProgress, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Typography, Paper,
} from '@mui/material'
import { ScienceOutlined } from '@mui/icons-material'
import type { UiValidationRun, ValidationFieldResult } from '@/types'

interface Props {
  run:      UiValidationRun
  connId:   number
  entity:   string
  entityId: string
  onClose:  () => void
  onRerun:  () => void
}

function statusColor(s: string): 'success' | 'error' | 'warning' | 'default' {
  if (s === 'MATCH')   return 'success'
  if (s === 'MISMATCH') return 'error'
  if (s === 'MISSING')  return 'warning'
  return 'default'
}

function FieldRow({ row }: { row: ValidationFieldResult }) {
  return (
    <TableRow hover>
      <TableCell sx={{ fontWeight: 500, fontSize: '0.8rem' }}>{row.field}</TableCell>
      <TableCell sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
        {row.ui_value ?? <span style={{ color: '#aaa' }}>—</span>}
      </TableCell>
      <TableCell sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
        {row.xml_value ?? <span style={{ color: '#aaa' }}>—</span>}
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          label={row.status}
          color={statusColor(row.status)}
          variant="outlined"
          sx={{ fontSize: '0.7rem', height: 20 }}
        />
      </TableCell>
    </TableRow>
  )
}

export default function ReportDialog({ run, onClose, onRerun }: Props) {
  const { summary, results, status, url, screenshot, error_message } = run

  const matchPct = summary && summary.total > 0
    ? Math.round((summary.matched / summary.total) * 100)
    : 0

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        Validation Report
        <Chip
          size="small"
          label={status}
          color={status === 'PASS' ? 'success' : 'error'}
          sx={{ ml: 'auto' }}
        />
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          {/* URL */}
          {url && (
            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
              {url}
            </Typography>
          )}

          {/* Summary bar */}
          {summary && (
            <Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="body2" fontWeight={600}>
                  {summary.matched} / {summary.total} fields matched
                </Typography>
                <Typography variant="body2" color={summary.mismatched > 0 ? 'error' : 'success.main'}>
                  {matchPct}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={matchPct}
                color={matchPct === 100 ? 'success' : matchPct >= 60 ? 'warning' : 'error'}
                sx={{ height: 8, borderRadius: 4 }}
              />
              <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                <Typography variant="caption" color="success.main">
                  ✓ {summary.matched} matched
                </Typography>
                {summary.mismatched > 0 && (
                  <Typography variant="caption" color="error.main">
                    ✗ {summary.mismatched} mismatched
                  </Typography>
                )}
                {summary.missing > 0 && (
                  <Typography variant="caption" color="warning.main">
                    ? {summary.missing} missing in XML
                  </Typography>
                )}
              </Stack>
            </Box>
          )}

          {/* Error message */}
          {error_message && (
            <Box sx={{ p: 1.5, bgcolor: 'error.50', border: '1px solid', borderColor: 'error.200', borderRadius: 1 }}>
              <Typography variant="caption" color="error">{error_message}</Typography>
            </Box>
          )}

          {/* Screenshot */}
          {screenshot && (
            <Box>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                Screenshot
              </Typography>
              <Box
                component="img"
                src={`/api/screenshots/${screenshot.replace('screenshots/', '')}`}
                alt="Validation screenshot"
                sx={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </Box>
          )}

          {/* Field comparison table */}
          {results.length > 0 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Field</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>UI Value</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>XML Value</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((r, i) => <FieldRow key={i} row={r} />)}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="outlined">Close</Button>
        <Button
          onClick={() => { onRerun(); onClose() }}
          variant="contained"
          startIcon={<ScienceOutlined />}
        >
          Re-run
        </Button>
      </DialogActions>
    </Dialog>
  )
}
