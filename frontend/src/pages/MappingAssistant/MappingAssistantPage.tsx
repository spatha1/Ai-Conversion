import { useState, useRef, useEffect } from 'react'
import {
  Box, Typography, TextField, Button, Paper, Chip, CircularProgress,
  Alert, IconButton, Tooltip, alpha, Switch, FormControlLabel,
} from '@mui/material'
import {
  SmartToyOutlined,
  SendOutlined,
  DeleteOutlineOutlined,
  InfoOutlined,
  ArrowForwardOutlined,
} from '@mui/icons-material'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { mappingAssistantApi } from '@/api'
import { tokens } from '@/theme/theme'
import { useAppStore } from '@/store/useAppStore'
import type { MappingAssistantMessage } from '@/types'

function SourceChip({ label }: { label: string }) {
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        height: 18, fontSize: '0.62rem', fontWeight: 600,
        bgcolor: alpha(tokens.indigo600, 0.08),
        color:   tokens.indigo700,
        border:  'none', mr: 0.5, mb: 0.5,
      }}
    />
  )
}

interface MessageBubbleProps {
  msg: MappingAssistantMessage
  onUseInMapper?: () => void
}

function MessageBubble({ msg, onUseInMapper }: MessageBubbleProps) {
  const isDark = useAppStore((s) => s.themeMode) === 'dark'
  const isUser = msg.role === 'user'

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 1.5,
      }}
    >
      <Box
        sx={{
          maxWidth: '80%',
          bgcolor: isUser
            ? `linear-gradient(135deg, ${tokens.indigo600}, ${tokens.violet600})`
            : isDark ? 'rgba(255,255,255,.06)' : '#f1f5f9',
          background: isUser
            ? `linear-gradient(135deg, ${tokens.indigo600}, ${tokens.violet600})`
            : undefined,
          color: isUser ? '#fff' : 'text.primary',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          px: 2, py: 1.25,
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.875rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: msg.content.includes('```') ? 'monospace' : undefined,
          }}
        >
          {msg.content}
        </Typography>

        {!isUser && msg.sources && msg.sources.length > 0 && (
          <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', fontWeight: 700, mr: 0.5 }}>
              Sources:
            </Typography>
            {msg.sources.map((s, i) => <SourceChip key={i} label={s} />)}
          </Box>
        )}

        {!isUser && msg.latency_ms != null && (
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5, fontSize: '0.65rem' }}>
            {msg.tokens_in}↑ {msg.tokens_out}↓ · {msg.latency_ms}ms
          </Typography>
        )}

        {!isUser && onUseInMapper && (
          <Box sx={{ mt: 0.75, pt: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
            <Button
              size="small"
              variant="text"
              endIcon={<ArrowForwardOutlined sx={{ fontSize: 13 }} />}
              onClick={onUseInMapper}
              sx={{
                fontSize: '0.7rem', py: 0.25, px: 0.75,
                color: tokens.indigo600,
                minHeight: 0,
                '&:hover': { bgcolor: alpha(tokens.indigo600, 0.08) },
              }}
            >
              Use in Mapper
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  )
}

const WELCOME: MappingAssistantMessage = {
  role:      'assistant',
  content:   'Hi! I\'m your DCT Extract Mapper assistant. Ask me anything about manuscript XML, mapping patterns, field types, LOB configuration, or best practices.\n\nExamples:\n• "How do I map CoverageCode using a reference template?"\n• "What inherit value does Risk use for Auto?"\n• "Show me an example extra_party template"',
  timestamp: new Date().toISOString(),
}

const ENTITY_KEYWORDS = ['Risk', 'Policy', 'Coverage', 'Account']
// CamelCase word OR a word directly after map/add/field/column
const FIELD_PATTERN = /\b([A-Z][a-z]+[A-Z]\w*|(?:map|add|field|column)\s+\w+)/i

export default function MappingAssistantPage() {
  const isDark    = useAppStore((s) => s.themeMode) === 'dark'
  const navigate  = useNavigate()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [messages,    setMessages]    = useState<MappingAssistantMessage[]>([WELCOME])
  const [question,    setQuestion]    = useState('')
  const [useContext,  setUseContext]  = useState(false)
  const [contextErr,  setContextErr]  = useState<string | null>(null)
  const [mapperError, setMapperError] = useState<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const getSessionContext = () => {
    try {
      const raw = sessionStorage.getItem('agentmapper_last_result')
      if (!raw) return null
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  const ask = useMutation({
    mutationFn: (q: string) => {
      const history = messages
        .filter((m) => m.role !== 'assistant' || messages.indexOf(m) > 0)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }))

      const session_context = useContext ? getSessionContext() : null
      if (useContext && !session_context) {
        setContextErr('No Agent Mapper session found. Generate a manuscript first, then toggle context.')
      } else {
        setContextErr(null)
      }

      return mappingAssistantApi.ask({ question: q, history, session_context })
    },
    onSuccess: (data) => {
      const reply: MappingAssistantMessage = {
        role:       'assistant',
        content:    data.answer,
        sources:    data.sources,
        tokens_in:  data.tokens_in,
        tokens_out: data.tokens_out,
        latency_ms: data.latency_ms,
        timestamp:  new Date().toISOString(),
      }
      setMessages((prev) => [...prev, reply])
    },
    onError: (err) => {
      const reply: MappingAssistantMessage = {
        role:      'assistant',
        content:   `Error: ${(err as Error)?.message ?? 'Request failed'}`,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, reply])
    },
  })

  const handleSend = () => {
    const q = question.trim()
    if (!q || ask.isPending) return

    const userMsg: MappingAssistantMessage = {
      role:      'user',
      content:   q,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setQuestion('')
    ask.mutate(q)
  }

  const hasSession = (() => {
    try { return !!sessionStorage.getItem('agentmapper_last_result') }
    catch { return false }
  })()

  const handleUseInMapper = (msgIndex: number) => {
    const userMsg = [...messages].slice(0, msgIndex).reverse().find((m) => m.role === 'user')
    const instruction = userMsg?.content ?? ''

    if (!instruction.trim()) {
      setMapperError('No question found to send to Mapper.')
      setTimeout(() => setMapperError(null), 4000)
      return
    }
    const hasEntity = ENTITY_KEYWORDS.some((e) =>
      instruction.toLowerCase().includes(e.toLowerCase())
    )
    const hasField = FIELD_PATTERN.test(instruction)
    if (!hasEntity || !hasField) {
      setMapperError(
        'Instruction must reference a DCT entity (Policy, Risk, Coverage, Account) and a field name.'
      )
      setTimeout(() => setMapperError(null), 4000)
      return
    }
    setMapperError(null)
    try {
      sessionStorage.setItem('agentmapper_intent_prefill', instruction)
    } catch { /* quota exceeded — ignore */ }
    navigate('/agent-mapper')
  }

  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 64px)' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SmartToyOutlined sx={{ color: tokens.indigo600, fontSize: 26 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Mapping Assistant</Typography>
            <Typography variant="caption" color="text.secondary">DCT Extract Mapper Knowledge Base</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip
            title={
              hasSession
                ? 'Toggle to include your last Agent Mapper session as context'
                : 'Generate a manuscript in Agent Mapper first to enable session context'
            }
            arrow
          >
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={useContext}
                  onChange={(e) => setUseContext(e.target.checked)}
                  disabled={!hasSession}
                />
              }
              label={
                <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                  Session context
                  {useContext && hasSession && (
                    <Chip label="active" size="small"
                      sx={{ ml: 0.5, height: 16, fontSize: '0.6rem', bgcolor: alpha('#22c55e', 0.12), color: '#15803d', border: 'none' }} />
                  )}
                </Typography>
              }
            />
          </Tooltip>
          <Tooltip title="Clear conversation" arrow>
            <IconButton size="small" onClick={() => setMessages([WELCOME])}>
              <DeleteOutlineOutlined sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {contextErr && (
        <Alert severity="info" icon={<InfoOutlined />} sx={{ mb: 1.5, flexShrink: 0 }} onClose={() => setContextErr(null)}>
          {contextErr}
        </Alert>
      )}

      {mapperError && (
        <Alert severity="warning" sx={{ mb: 1.5, flexShrink: 0 }} onClose={() => setMapperError(null)}>
          {mapperError}
        </Alert>
      )}

      {/* Messages */}
      <Paper
        variant="outlined"
        sx={{
          flex: 1, overflow: 'auto', p: 2, borderRadius: 2,
          bgcolor: isDark ? 'rgba(255,255,255,.02)' : '#fafafa',
          mb: 2,
        }}
      >
        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            onUseInMapper={msg.role === 'assistant' && i > 0 ? () => handleUseInMapper(i) : undefined}
          />
        ))}

        {ask.isPending && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 1.5 }}>
            <Box
              sx={{
                bgcolor: isDark ? 'rgba(255,255,255,.06)' : '#f1f5f9',
                borderRadius: '16px 16px 16px 4px',
                px: 2, py: 1.25,
                display: 'flex', alignItems: 'center', gap: 1,
              }}
            >
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary">Thinking…</Typography>
            </Box>
          </Box>
        )}

        <div ref={bottomRef} />
      </Paper>

      {/* Input row */}
      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Ask anything about DCT mapping…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
          }}
          sx={{ '& .MuiInputBase-root': { borderRadius: 3 } }}
        />
        <Button
          variant="contained"
          disabled={!question.trim() || ask.isPending}
          onClick={handleSend}
          sx={{
            minWidth: 48, borderRadius: 3, px: 1.5,
            background: `linear-gradient(135deg, ${tokens.indigo600}, ${tokens.violet600})`,
          }}
        >
          {ask.isPending ? <CircularProgress size={16} color="inherit" /> : <SendOutlined sx={{ fontSize: 18 }} />}
        </Button>
      </Box>
      <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, fontSize: '0.65rem' }}>
        Ctrl+Enter to send · powered by gpt-4o-mini · OOTB samples
      </Typography>
    </Box>
  )
}
