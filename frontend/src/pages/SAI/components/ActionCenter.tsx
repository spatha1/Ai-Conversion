import { useState, useEffect } from 'react'
import { Box, Typography, Button, Chip, Collapse, IconButton, Tooltip, Stack } from '@mui/material'
import EmailIcon        from '@mui/icons-material/Email'
import BugReportIcon    from '@mui/icons-material/BugReport'
import BuildIcon        from '@mui/icons-material/Build'
import CheckIcon        from '@mui/icons-material/Check'
import CloseIcon        from '@mui/icons-material/Close'
import ExpandMoreIcon   from '@mui/icons-material/ExpandMore'
import ExpandLessIcon   from '@mui/icons-material/ExpandLess'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import CancelIcon       from '@mui/icons-material/Cancel'
import { SaiAction, SaiApprovalItem } from '@/types'
import { saiApi } from '@/api'

interface Props {
  actions:        SaiAction[]
  approvalItems:  SaiApprovalItem[]
  runId:          number | null
  onApprovalDone: (dispatched?: SaiAction) => void
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  email_sent:             <EmailIcon sx={{ fontSize: 13 }} />,
  send_email:             <EmailIcon sx={{ fontSize: 13 }} />,
  ticket_created:         <BugReportIcon sx={{ fontSize: 13 }} />,
  create_ticket:          <BugReportIcon sx={{ fontSize: 13 }} />,
  remediation_workflow:   <BuildIcon sx={{ fontSize: 13 }} />,
}

function actionLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function payloadSummary(item: SaiApprovalItem): string {
  const p = (item.payload || {}) as Record<string, string | undefined>
  if (p.issue_type)    return `${p.issue_type} — ${p.system_impacted || ''}`
  if (p.subject)       return p.subject.slice(0, 60)
  if (p.title)         return p.title.slice(0, 60)
  return ''
}

export default function ActionCenter({ actions, approvalItems, runId, onApprovalDone }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deciding, setDeciding]       = useState<number | null>(null)

  const pending  = approvalItems.filter(a => a.status === 'pending')
  const decided  = approvalItems.filter(a => a.status !== 'pending')

  // Auto-open history when first item is decided
  useEffect(() => {
    if (decided.length > 0) setHistoryOpen(true)
  }, [decided.length])

  const handleDecision = async (item: SaiApprovalItem, decision: 'approved' | 'rejected') => {
    if (!runId) return
    setDeciding(item.id)
    try {
      const result = await saiApi.approveAction(runId, item.id, decision, 'operator')
      onApprovalDone(result?.dispatched_action ?? undefined)
    } catch (err) {
      console.error(err)
      onApprovalDone()
    } finally {
      setDeciding(null)
    }
  }

  const hasAnything = actions.length > 0 || approvalItems.length > 0

  return (
    <Box sx={{ bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1, fontSize: '0.65rem', flex: 1 }}>
          ACTION CENTER
        </Typography>
        {pending.length > 0 && (
          <Chip label={`${pending.length} awaiting approval`} size="small" color="warning"
            sx={{ fontSize: '0.65rem', height: 18 }} />
        )}
        {decided.length > 0 && (
          <Tooltip title={historyOpen ? 'Hide history' : 'Show approved/rejected history'}>
            <IconButton size="small" onClick={() => setHistoryOpen(o => !o)} sx={{ p: 0.25 }}>
              {historyOpen ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {!hasAnything && (
        <Typography sx={{ color: 'text.disabled', fontSize: '0.7rem', fontStyle: 'italic' }}>
          No actions taken yet
        </Typography>
      )}

      {/* Completed autonomous actions (green) */}
      {actions.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: pending.length > 0 ? 1.5 : 0 }}>
          {actions.map((a, i) => (
            <Chip
              key={i}
              icon={ACTION_ICON[a.type] as React.ReactElement || <CheckIcon sx={{ fontSize: 13 }} />}
              label={`${actionLabel(a.type)}${a.detail ? `: ${String(a.detail).slice(0, 40)}` : ''}`}
              size="small"
              color="success"
              variant="outlined"
              sx={{ fontSize: '0.7rem', height: 24 }}
            />
          ))}
        </Box>
      )}

      {/* Pending approval items — grouped by finding */}
      {pending.length > 0 && (
        <Stack spacing={0.75}>
          {pending.map((a) => {
            const summary = payloadSummary(a)
            return (
              <Box
                key={a.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
                  px: 1.5, py: 0.75, borderRadius: 1,
                  border: '1px solid', borderColor: 'warning.main',
                  bgcolor: 'warning.light', opacity: 0.95,
                }}
              >
                {ACTION_ICON[a.action_type] || <BuildIcon sx={{ fontSize: 13, color: 'warning.dark' }} />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'warning.dark' }}>
                    {actionLabel(a.action_type)}
                  </Typography>
                  {summary && (
                    <Typography sx={{ fontSize: '0.67rem', color: 'text.secondary' }} noWrap>
                      {summary}
                    </Typography>
                  )}
                </Box>
                <Tooltip title="Approve">
                  <Button
                    size="small" variant="contained" color="success"
                    disabled={deciding === a.id}
                    onClick={() => handleDecision(a, 'approved')}
                    sx={{ minWidth: 0, px: 1, py: 0, fontSize: '0.65rem', height: 22 }}
                  >
                    <CheckIcon sx={{ fontSize: 13 }} />
                  </Button>
                </Tooltip>
                <Tooltip title="Reject">
                  <Button
                    size="small" color="error"
                    disabled={deciding === a.id}
                    onClick={() => handleDecision(a, 'rejected')}
                    sx={{ minWidth: 0, px: 1, py: 0, fontSize: '0.65rem', height: 22 }}
                  >
                    <CloseIcon sx={{ fontSize: 13 }} />
                  </Button>
                </Tooltip>
              </Box>
            )
          })}
        </Stack>
      )}

      {/* Decided history (collapsible) */}
      <Collapse in={historyOpen}>
        <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px dashed', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 700, fontSize: '0.62rem', letterSpacing: 1 }}>
            DECISION HISTORY
          </Typography>
          <Stack spacing={0.5} mt={0.75}>
            {decided.map((a) => {
              const approved = a.status === 'approved' || a.status === 'dispatched'
              const summary  = payloadSummary(a)
              return (
                <Stack key={a.id} direction="row" alignItems="center" spacing={0.75}>
                  {approved
                    ? <CheckCircleIcon sx={{ fontSize: 13, color: 'success.main' }} />
                    : <CancelIcon sx={{ fontSize: 13, color: 'error.main' }} />
                  }
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: approved ? 'success.main' : 'error.main' }}>
                    {actionLabel(a.action_type)}
                  </Typography>
                  {summary && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                      — {summary}
                    </Typography>
                  )}
                  <Chip
                    label={a.status}
                    size="small"
                    sx={{
                      height: 16, fontSize: '0.6rem', fontWeight: 700, flexShrink: 0,
                      bgcolor: approved ? 'success.light' : 'error.light',
                      color:   approved ? 'success.dark'  : 'error.dark',
                    }}
                  />
                </Stack>
              )
            })}
          </Stack>
        </Box>
      </Collapse>
    </Box>
  )
}
