import { Box, Typography, Divider, Chip } from '@mui/material'
import { useEffect, useRef } from 'react'
import { SaiKnowledgeSource } from '@/types'

interface ReasoningLine {
  agent: string
  text:  string
  ts:    number
}

interface Props {
  lines:            ReasoningLine[]
  knowledgeSources: SaiKnowledgeSource[]
}

const AGENT_COLORS: Record<string, string> = {
  schema_agent:          '#90caf9',
  data_collection_agent: '#80cbc4',
  rca_agent:             '#ffcc02',
  issue_classifier:      '#ff8a65',
  ownership_agent:       '#ce93d8',
  action_agent:          '#f48fb1',
  validation_agent:      '#a5d6a7',
  reporting_agent:       '#80deea',
  learning_agent:        '#bcaaa4',
}

export default function ReasoningStream({ lines, knowledgeSources }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines.length])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default' }}>
      {/* Reasoning stream */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, fontFamily: 'monospace' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1, fontSize: '0.65rem' }}>
          LIVE REASONING STREAM
        </Typography>
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {lines.length === 0 && (
            <Typography sx={{ color: 'text.disabled', fontSize: '0.75rem', fontStyle: 'italic' }}>
              Waiting for SAI to begin reasoning...
            </Typography>
          )}
          {lines.map((line, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Typography sx={{
                fontSize: '0.65rem', fontWeight: 700, minWidth: 120,
                color: AGENT_COLORS[line.agent] || 'text.secondary',
                whiteSpace: 'nowrap',
              }}>
                [{line.agent.replace('_agent', '').replace('_', ' ')}]
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: 'text.primary', flex: 1 }}>
                {line.text}
              </Typography>
            </Box>
          ))}
          <div ref={bottomRef} />
        </Box>
      </Box>

      {/* Knowledge sources used */}
      {knowledgeSources.length > 0 && (
        <>
          <Divider />
          <Box sx={{ p: 2, maxHeight: 150, overflowY: 'auto' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 1, fontSize: '0.65rem' }}>
              KNOWLEDGE SOURCES USED
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {knowledgeSources.slice(0, 8).map((src, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ color: 'success.main', fontSize: '0.7rem' }}>✓</Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.7rem', flex: 1 }}>
                    {src.title}
                  </Typography>
                  {src.confidence != null && (
                    <Chip
                      label={`${Math.round(src.confidence * 100)}%`}
                      size="small"
                      sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'action.hover', color: 'text.secondary' }}
                    />
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        </>
      )}
    </Box>
  )
}

export type { ReasoningLine }
