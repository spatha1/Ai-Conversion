import { Box, Typography, LinearProgress, Tooltip } from '@mui/material'
import CheckCircleIcon          from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import ErrorIcon                from '@mui/icons-material/Error'
import ChevronRightIcon         from '@mui/icons-material/ChevronRight'
import { SaiStepStatus, SaiStep, SaiAiTrace } from '@/types'

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

// Agents that log AI traces — show trace count badge
const TRACED_MODULES: Record<string, string> = {
  schema_agent:          'sai_schema',
  data_collection_agent: 'sai_data_collection',
  rca_agent:             'sai_rca',
  issue_classifier:      'sai_classifier',
  ownership_agent:       'sai_ownership',
  reporting_agent:       'sai_report',
}

interface AgentState {
  agent:      string
  status:     SaiStepStatus
  elapsed_ms?: number
}

interface Props {
  agentStates:    Record<string, AgentState>
  steps?:         SaiStep[]
  traces?:        SaiAiTrace[]
  onAgentClick?:  (agentName: string) => void
}

function StatusIcon({ status }: { status?: SaiStepStatus }) {
  if (status === 'done')    return <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
  if (status === 'running') return <LinearProgress sx={{ width: 16, height: 16, borderRadius: '50%' }} />
  if (status === 'error')   return <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
  return <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
}

export default function PipelinePanel({ agentStates, steps = [], traces = [], onAgentClick }: Props) {
  return (
    <Box sx={{
      width: 220, bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider',
      p: 2, display: 'flex', flexDirection: 'column', gap: 0.5, overflowY: 'auto',
    }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, mb: 1, letterSpacing: 1, fontSize: '0.65rem' }}>
        EXECUTION PIPELINE
      </Typography>
      {AGENTS.map(agent => {
        const state      = agentStates[agent.name]
        const status     = state?.status
        const clickable  = (status === 'done' || status === 'error') && !!onAgentClick
        const step       = steps.find(s => s.agent_name === agent.name)
        const module     = TRACED_MODULES[agent.name]
        const traceCount = module ? traces.filter(t => t.module === module).length : 0

        return (
          <Tooltip
            key={agent.name}
            title={clickable ? `View ${agent.label} details` : ''}
            placement="right"
            disableHoverListener={!clickable}
          >
            <Box
              onClick={clickable ? () => onAgentClick(agent.name) : undefined}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                p: 1, borderRadius: 1,
                bgcolor:     status === 'running' ? 'action.hover' : 'transparent',
                border:      status === 'running' ? '1px solid' : '1px solid transparent',
                borderColor: status === 'running' ? 'primary.main' : 'transparent',
                cursor:      clickable ? 'pointer' : 'default',
                transition:  'background-color 0.15s',
                '&:hover':   clickable ? { bgcolor: 'action.hover' } : {},
              }}
            >
              <StatusIcon status={status} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {state?.elapsed_ms != null && (
                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.6rem' }}>
                      {state.elapsed_ms}ms
                    </Typography>
                  )}
                  {traceCount > 0 && (
                    <Typography variant="caption" sx={{ color: 'primary.main', fontSize: '0.6rem', fontWeight: 600 }}>
                      {traceCount} AI call{traceCount !== 1 ? 's' : ''}
                    </Typography>
                  )}
                </Box>
              </Box>
              {clickable && <ChevronRightIcon sx={{ fontSize: 14, color: 'text.disabled', flexShrink: 0 }} />}
            </Box>
          </Tooltip>
        )
      })}
    </Box>
  )
}
