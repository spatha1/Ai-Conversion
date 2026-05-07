import { Box, Typography, LinearProgress } from '@mui/material'
import CheckCircleIcon          from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import ErrorIcon                from '@mui/icons-material/Error'
import { SaiStepStatus } from '@/types'

const AGENTS = [
  { num: 1, name: 'schema_agent',           label: 'Schema Resolution' },
  { num: 2, name: 'data_collection_agent',  label: 'Data Collection' },
  { num: 3, name: 'rca_agent',              label: 'RCA Analysis' },
  { num: 4, name: 'issue_classifier',       label: 'Issue Classification' },
  { num: 5, name: 'ownership_agent',        label: 'Ownership Mapping' },
  { num: 6, name: 'action_agent',           label: 'Autonomous Actions' },
  { num: 7, name: 'validation_agent',       label: 'Validation' },
  { num: 8, name: 'reporting_agent',        label: 'Report Generation' },
  { num: 9, name: 'learning_agent',         label: 'Learning' },
]

interface AgentState {
  agent:      string
  status:     SaiStepStatus
  elapsed_ms?: number
}

interface Props {
  agentStates: Record<string, AgentState>
}

function StatusIcon({ status }: { status?: SaiStepStatus }) {
  if (status === 'done')    return <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
  if (status === 'running') return <LinearProgress sx={{ width: 16, height: 16, borderRadius: '50%' }} />
  if (status === 'error')   return <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
  return <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
}

export default function PipelinePanel({ agentStates }: Props) {
  return (
    <Box sx={{
      width: 220, bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider',
      p: 2, display: 'flex', flexDirection: 'column', gap: 0.5, overflowY: 'auto',
    }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, mb: 1, letterSpacing: 1, fontSize: '0.65rem' }}>
        EXECUTION PIPELINE
      </Typography>
      {AGENTS.map(agent => {
        const state  = agentStates[agent.name]
        const status = state?.status
        return (
          <Box key={agent.name} sx={{
            display: 'flex', alignItems: 'center', gap: 1,
            p: 1, borderRadius: 1,
            bgcolor: status === 'running' ? 'action.hover' : 'transparent',
            border: status === 'running' ? '1px solid' : '1px solid transparent',
            borderColor: status === 'running' ? 'primary.main' : 'transparent',
          }}>
            <StatusIcon status={status} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{
                fontSize: '0.75rem',
                color: status === 'done'    ? 'success.main'
                     : status === 'running' ? 'primary.light'
                     : status === 'error'   ? 'error.main'
                     : 'text.disabled',
                fontWeight: status === 'running' ? 700 : 400,
              }}>
                {agent.label}
              </Typography>
              {state?.elapsed_ms != null && (
                <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.6rem' }}>
                  {state.elapsed_ms}ms
                </Typography>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
