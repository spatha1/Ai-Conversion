import { Box, Typography, Button, Chip } from '@mui/material'
import EmailIcon    from '@mui/icons-material/Email'
import BugReportIcon from '@mui/icons-material/BugReport'
import PendingIcon  from '@mui/icons-material/Pending'
import CheckIcon    from '@mui/icons-material/Check'
import CloseIcon    from '@mui/icons-material/Close'
import { SaiAction, SaiApprovalItem } from '@/types'
import { saiApi } from '@/api'

interface Props {
  actions:        SaiAction[]
  approvalItems:  SaiApprovalItem[]
  runId:          number | null
  onApprovalDone: () => void
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  email_sent:     <EmailIcon sx={{ fontSize: 14 }} />,
  ticket_created: <BugReportIcon sx={{ fontSize: 14 }} />,
  send_email:     <EmailIcon sx={{ fontSize: 14 }} />,
  create_ticket:  <BugReportIcon sx={{ fontSize: 14 }} />,
}

export default function ActionCenter({ actions, approvalItems, runId, onApprovalDone }: Props) {
  const handleDecision = async (item: SaiApprovalItem, decision: 'approved' | 'rejected') => {
    if (!runId) return
    try {
      await saiApi.approveAction(runId, item.id, decision, 'operator')
      onApprovalDone()
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <Box sx={{ bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', p: 2 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1, fontSize: '0.65rem' }}>
        ACTION CENTER
      </Typography>

      <Box sx={{ mt: 1, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Completed actions */}
        {actions.map((a, i) => (
          <Chip
            key={i}
            icon={ACTION_ICON[a.type] as React.ReactElement || <CheckIcon sx={{ fontSize: 14 }} />}
            label={`${a.type.replace('_', ' ')}: ${a.to || a.title || ''}`}
            size="small"
            color="success"
            variant="outlined"
            sx={{ fontSize: '0.7rem', height: 24 }}
          />
        ))}

        {/* Pending approvals */}
        {approvalItems.filter(a => a.status === 'pending').map((a, i) => (
          <Box key={i} sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            px: 1.5, py: 0.5, borderRadius: 1,
            border: '1px solid', borderColor: 'warning.main',
            bgcolor: 'warning.light', opacity: 0.95,
          }}>
            <PendingIcon sx={{ fontSize: 14, color: 'warning.dark' }} />
            <Typography sx={{ fontSize: '0.7rem', color: 'warning.dark' }}>
              Awaiting approval: {a.action_type.replace('_', ' ')}
            </Typography>
            <Button
              size="small"
              variant="contained"
              color="success"
              onClick={() => handleDecision(a, 'approved')}
              sx={{ minWidth: 0, px: 1, py: 0, fontSize: '0.65rem', height: 20 }}
            >
              <CheckIcon sx={{ fontSize: 12 }} />
            </Button>
            <Button
              size="small"
              color="error"
              onClick={() => handleDecision(a, 'rejected')}
              sx={{ minWidth: 0, px: 1, py: 0, fontSize: '0.65rem', height: 20 }}
            >
              <CloseIcon sx={{ fontSize: 12 }} />
            </Button>
          </Box>
        ))}

        {actions.length === 0 && approvalItems.length === 0 && (
          <Typography sx={{ color: 'text.disabled', fontSize: '0.7rem', fontStyle: 'italic' }}>
            No actions taken yet
          </Typography>
        )}
      </Box>
    </Box>
  )
}
