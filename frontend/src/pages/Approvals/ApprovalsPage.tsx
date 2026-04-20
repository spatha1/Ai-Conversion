import { useState } from 'react'
import {
  Box, Typography, Tabs, Tab, Table, TableHead, TableRow, TableCell,
  TableBody, Chip, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, CircularProgress, alpha, Divider,
} from '@mui/material'
import { CheckCircleOutlined, CancelOutlined } from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { approvalRequestsApi } from '@/api'
import type { ApprovalRequest } from '@/api'

const STATUS_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default'> = {
  in_progress: 'warning',
  approved:    'success',
  rejected:    'error',
  cancelled:   'default',
  pending:     'warning',
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function ApprovalsPage() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const [tab, setTab] = useState(0)

  const [decideTarget, setDecideTarget] = useState<ApprovalRequest | null>(null)
  const [decideAction, setDecideAction] = useState<'approve' | 'reject'>('approve')
  const [decideNotes, setDecideNotes] = useState('')

  const { data: pending = [], isLoading: pendingLoading } = useQuery({
    queryKey: ['approval-requests-pending'],
    queryFn: () => approvalRequestsApi.listForMe(),
    refetchInterval: 30000,
  })

  const { data: mine = [], isLoading: mineLoading } = useQuery({
    queryKey: ['approval-requests-mine'],
    queryFn: () => approvalRequestsApi.listMyRequests(),
    enabled: tab === 1,
  })

  const decideMut = useMutation({
    mutationFn: () =>
      approvalRequestsApi.decide(decideTarget!.id, decideAction, decideNotes || undefined),
    onSuccess: () => {
      enqueueSnackbar(
        `Request ${decideAction === 'approve' ? 'approved' : 'rejected'}`,
        { variant: decideAction === 'approve' ? 'success' : 'warning' },
      )
      setDecideTarget(null)
      setDecideNotes('')
      qc.invalidateQueries({ queryKey: ['approval-requests-pending'] })
      qc.invalidateQueries({ queryKey: ['approval-requests-mine'] })
      qc.invalidateQueries({ queryKey: ['notif-count'] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const openDecide = (req: ApprovalRequest, action: 'approve' | 'reject') => {
    setDecideTarget(req)
    setDecideAction(action)
    setDecideNotes('')
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1100, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={700} mb={3}>Approvals</Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab label={`Pending My Action (${pending.length})`} />
        <Tab label="My Submitted Requests" />
      </Tabs>

      {/* ── Tab 0: Pending My Action ── */}
      {tab === 0 && (
        pendingLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress />
          </Box>
        ) : pending.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <CheckCircleOutlined sx={{ fontSize: 56, color: 'success.main', mb: 2 }} />
            <Typography variant="h6" color="text.secondary">No pending approvals</Typography>
            <Typography variant="body2" color="text.disabled">
              You're all caught up — nothing requires your decision right now.
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Requested by</TableCell>
                <TableCell>Current Step</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pending.map((req) => {
                const currentDecision = req.decisions.find(
                  (d) => d.step_order === req.current_step_order,
                )
                return (
                  <TableRow key={req.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{req.project_name ?? '—'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={req.context_type.replace(/_/g, ' ')}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{req.triggered_by_username ?? '—'}</TableCell>
                    <TableCell>
                      {currentDecision ? (
                        <Box>
                          <Typography variant="body2">{currentDecision.step_name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Requires: {currentDecision.required_role.replace('_', ' ')}
                          </Typography>
                        </Box>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {timeAgo(req.created_at)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<CheckCircleOutlined />}
                          onClick={() => openDecide(req, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          startIcon={<CancelOutlined />}
                          onClick={() => openDecide(req, 'reject')}
                        >
                          Reject
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )
      )}

      {/* ── Tab 1: My Submitted Requests ── */}
      {tab === 1 && (
        mineLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
            <CircularProgress />
          </Box>
        ) : mine.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            You haven't submitted any approval requests yet.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Steps</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mine.map((req) => (
                <TableRow key={req.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{req.project_name ?? '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={req.context_type.replace(/_/g, ' ')} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={req.status.replace('_', ' ')}
                      size="small"
                      color={STATUS_COLOR[req.status] ?? 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {req.decisions.map((d) => (
                        <Chip
                          key={d.id}
                          label={`${d.step_name}: ${d.decision ?? 'pending'}`}
                          size="small"
                          color={d.decision === 'approve' ? 'success' : d.decision === 'reject' ? 'error' : 'default'}
                          variant="outlined"
                          sx={{ fontSize: 10 }}
                        />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {timeAgo(req.created_at)}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}

      {/* ── Decide Dialog ── */}
      <Dialog open={Boolean(decideTarget)} onClose={() => setDecideTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {decideAction === 'approve' ? 'Approve Request' : 'Reject Request'}
        </DialogTitle>
        <Divider />
        <DialogContent>
          {decideTarget && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                <strong>Project:</strong> {decideTarget.project_name}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                <strong>Type:</strong> {decideTarget.context_type.replace(/_/g, ' ')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                <strong>Requested by:</strong> {decideTarget.triggered_by_username}
              </Typography>
            </Box>
          )}
          <TextField
            label="Notes (optional)"
            fullWidth
            multiline
            rows={3}
            value={decideNotes}
            onChange={(e) => setDecideNotes(e.target.value)}
            placeholder={decideAction === 'reject' ? 'Reason for rejection…' : 'Optional approval notes…'}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDecideTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            color={decideAction === 'approve' ? 'success' : 'error'}
            disabled={decideMut.isPending}
            onClick={() => decideMut.mutate()}
          >
            {decideMut.isPending ? 'Submitting…' : decideAction === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
