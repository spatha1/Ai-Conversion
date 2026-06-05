import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  Chip, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip,
} from '@mui/material'
import {
  VerifiedOutlined, CheckCircleOutlined, ErrorOutlined, WarningAmberOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TIValidationIssue } from '@/types'

interface Props { connId: number | null; selectedRuleId: number | null }

const SEV_ICONS: Record<string, React.ReactNode> = {
  error:   <ErrorOutlined sx={{ fontSize: 14, color: tokens.red600 }} />,
  warning: <WarningAmberOutlined sx={{ fontSize: 14, color: tokens.amber600 }} />,
  info:    <CheckCircleOutlined sx={{ fontSize: 14, color: tokens.sky600 }} />,
}
const SEV_COLORS: Record<string, string> = {
  error: tokens.red600, warning: tokens.amber600, info: tokens.sky600,
}

export default function ValidationTab({ connId, selectedRuleId }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [showResolved, setShowResolved] = useState(false)

  const { data: issues = [], isLoading, refetch } = useQuery<TIValidationIssue[]>({
    queryKey: ['ti-issues', connId, showResolved],
    queryFn: () => transformationApi.listIssues({
      conn_id: connId ?? undefined,
      resolved: showResolved ? undefined : false,
    }),
    enabled: connId != null,
  })

  const validateAllMut = useMutation({
    mutationFn: () => transformationApi.validateAll(connId!),
    onSuccess: (res) => {
      refetch()
      qc.invalidateQueries({ queryKey: ['ti-readiness', connId] })
      enqueueSnackbar(
        res.clean ? 'All rules valid' : `${res.total_issues} issue${res.total_issues !== 1 ? 's' : ''} found`,
        { variant: res.clean ? 'success' : 'warning' }
      )
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const resolveMut = useMutation({
    mutationFn: (id: number) => transformationApi.resolveIssue(id),
    onSuccess: () => {
      refetch()
      qc.invalidateQueries({ queryKey: ['ti-readiness', connId] })
      enqueueSnackbar('Issue resolved', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const errors   = issues.filter(i => i.severity === 'error').length
  const warnings = issues.filter(i => i.severity === 'warning').length

  return (
    <Box sx={{ p: 2.5 }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VerifiedOutlined sx={{ fontSize: 18, color: issues.length === 0 ? tokens.emerald600 : tokens.red600 }} />
          <Typography variant="body2" fontWeight={700}>
            {issues.length === 0 ? 'All rules valid' : `${issues.length} issue${issues.length !== 1 ? 's' : ''}`}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {errors > 0 && <Chip label={`${errors} errors`} size="small"
            sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600 }} />}
          {warnings > 0 && <Chip label={`${warnings} warnings`} size="small"
            sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(tokens.amber600, 0.12), color: tokens.amber600 }} />}
        </Box>
        <Button size="small" variant="text"
          onClick={() => setShowResolved(s => !s)}
          sx={{ fontSize: '0.7rem' }}>
          {showResolved ? 'Hide resolved' : 'Show resolved'}
        </Button>
        <Button size="small" variant="contained"
          startIcon={validateAllMut.isPending ? <CircularProgress size={12} color="inherit" /> : <VerifiedOutlined />}
          disabled={!connId || validateAllMut.isPending}
          onClick={() => validateAllMut.mutate()}
          sx={{ ml: 'auto', fontSize: '0.75rem' }}>
          {validateAllMut.isPending ? 'Validating…' : 'Validate All Rules'}
        </Button>
      </Box>

      {isLoading && <Box sx={{ display: 'flex', gap: 1 }}><CircularProgress size={16} /><Typography variant="caption">Loading…</Typography></Box>}

      {issues.length === 0 && !isLoading && (
        <Alert severity="success" sx={{ fontSize: '0.8rem' }}>
          No validation issues found. Click <strong>Validate All Rules</strong> to run static analysis checks.
        </Alert>
      )}

      {issues.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700, width: 32 }}>Sev</TableCell>
                <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Rule</TableCell>
                <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Issue Type</TableCell>
                <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Description</TableCell>
                <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700, width: 80 }}>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {issues.map((iss) => (
                <TableRow key={iss.id}
                  sx={{ '&:hover': { bgcolor: 'action.hover' },
                    bgcolor: iss.resolved ? alpha('#64748B', 0.04) : undefined }}>
                  <TableCell sx={{ px: 1.5 }}>
                    {SEV_ICONS[iss.severity] ?? SEV_ICONS.warning}
                  </TableCell>
                  <TableCell>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600 }}>
                      {iss.rule_name ?? `Rule #${iss.rule_id}`}
                    </Typography>
                    {iss.conflicting_rule_id && (
                      <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>
                        Conflicts with Rule #{iss.conflicting_rule_id}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={iss.issue_type.replace(/_/g, ' ')} size="small"
                      sx={{ height: 18, fontSize: '0.6rem',
                        bgcolor: alpha(SEV_COLORS[iss.severity] ?? '#64748B', 0.12),
                        color: SEV_COLORS[iss.severity] ?? '#64748B' }} />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.72rem', color: 'text.secondary', maxWidth: 280 }}>
                    <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {iss.description}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {iss.resolved
                      ? <Chip label="Resolved" size="small"
                          sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600 }} />
                      : <Chip label="Open" size="small"
                          sx={{ height: 16, fontSize: '0.6rem', bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600 }} />
                    }
                  </TableCell>
                  <TableCell>
                    {!iss.resolved && (
                      <Tooltip title="Mark as resolved">
                        <Button size="small" variant="text" color="success"
                          sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75 }}
                          disabled={resolveMut.isPending}
                          onClick={() => resolveMut.mutate(iss.id)}>
                          Resolve
                        </Button>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  )
}
