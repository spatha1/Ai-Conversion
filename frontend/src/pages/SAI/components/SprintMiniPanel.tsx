import {
  Box, Typography, LinearProgress, Chip, Divider,
  IconButton, Tooltip, Stack,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import BlockIcon                from '@mui/icons-material/Block'
import WarningAmberIcon         from '@mui/icons-material/WarningAmber'
import { DevTaskSummary } from '@/types'

interface Props {
  summary:   DevTaskSummary
  onRefresh?: () => void
}

export default function SprintMiniPanel({ summary, onRefresh }: Props) {
  const {
    sprint_name, total_tasks, done_count, in_progress_count,
    blocked_count, completion_pct, overdue_count,
    by_assignee, last_synced_at,
  } = summary

  const syncedLabel = last_synced_at
    ? `Synced ${new Date(last_synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Not synced'

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, height: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700} noWrap>
            {sprint_name ?? 'Current Sprint'}
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>
            {syncedLabel}
          </Typography>
        </Box>
        {onRefresh && (
          <Tooltip title="Sync tasks">
            <IconButton size="small" onClick={onRefresh}>
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Completion progress */}
      <Box sx={{ mb: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
            Completion
          </Typography>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: 'success.main' }}>
            {completion_pct}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={completion_pct}
          color="success"
          sx={{ height: 6, borderRadius: 3 }}
        />
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled', mt: 0.25 }}>
          {done_count} done · {in_progress_count} in progress · {total_tasks - done_count - in_progress_count} to do
        </Typography>
      </Box>

      {/* Status chips */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Chip
          icon={<CheckCircleOutlineIcon sx={{ fontSize: 13 }} />}
          label={`${done_count} Done`}
          size="small"
          color="success"
          variant="outlined"
          sx={{ fontSize: '0.65rem', height: 20 }}
        />
        {blocked_count > 0 && (
          <Chip
            icon={<BlockIcon sx={{ fontSize: 13 }} />}
            label={`${blocked_count} Blocked`}
            size="small"
            color="error"
            variant="outlined"
            sx={{ fontSize: '0.65rem', height: 20 }}
          />
        )}
        {overdue_count > 0 && (
          <Chip
            icon={<WarningAmberIcon sx={{ fontSize: 13 }} />}
            label={`${overdue_count} Overdue`}
            size="small"
            color="warning"
            variant="outlined"
            sx={{ fontSize: '0.65rem', height: 20 }}
          />
        )}
      </Box>

      <Divider sx={{ mb: 1.5 }} />

      {/* Assignees */}
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: 'text.secondary',
                        letterSpacing: 1, mb: 1, textTransform: 'uppercase' }}>
        By Assignee
      </Typography>
      <Stack spacing={0.5}>
        {by_assignee.slice(0, 5).map((a) => (
          <Box key={a.assignee} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: '0.7rem', flex: 1, color: 'text.primary' }} noWrap>
              {a.assignee}
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'success.main', minWidth: 24, textAlign: 'right' }}>
              {a.done}✓
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', minWidth: 28, textAlign: 'right' }}>
              /{a.count}
            </Typography>
          </Box>
        ))}
        {by_assignee.length === 0 && (
          <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', fontStyle: 'italic' }}>
            No tasks assigned
          </Typography>
        )}
      </Stack>
    </Box>
  )
}
