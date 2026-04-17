import { useState, useRef, useEffect, useId } from 'react'
import {
  Box, Fab, Tooltip, Typography, TextField, IconButton,
  Chip, Divider, CircularProgress, alpha,
} from '@mui/material'
import {
  SmartToyOutlined, CloseOutlined, SendOutlined,
  RestartAltOutlined,
} from '@mui/icons-material'
import { useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { helpChatApi } from '@/api'

const TEAL = '#0EA5E9'

interface Msg {
  id:      string
  role:    'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'What is in my current project?',
  'How do I generate XML from my data?',
  'How do I create an AI dashboard?',
  'How do I improve AI accuracy?',
]

function TypingDots() {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', py: 0.5 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 7, height: 7, borderRadius: '50%',
            bgcolor: TEAL,
            animation: 'helpDot 1.2s ease-in-out infinite',
            animationDelay: `${i * 0.2}s`,
            '@keyframes helpDot': {
              '0%, 80%, 100%': { opacity: 0.3, transform: 'scale(0.85)' },
              '40%':           { opacity: 1,   transform: 'scale(1)' },
            },
          }}
        />
      ))}
    </Box>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user'
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 1,
      }}
    >
      {!isUser && (
        <Box
          sx={{
            width: 26, height: 26, borderRadius: '50%',
            bgcolor: TEAL, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, mr: 0.75, mt: 0.25,
          }}
        >
          <SmartToyOutlined sx={{ fontSize: 14 }} />
        </Box>
      )}
      <Box
        sx={{
          maxWidth: '78%',
          bgcolor: isUser ? TEAL : 'grey.100',
          color: isUser ? '#fff' : 'text.primary',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          px: 1.5, py: 1,
          fontSize: '0.8rem',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
      </Box>
    </Box>
  )
}

export default function HelpChat() {
  const location    = useLocation()
  const project     = useAppStore((s) => s.activeProject)
  const connection  = useAppStore((s) => s.activeConnection)

  const uid = useId()
  const makeId = () => `${uid}-${Date.now()}-${Math.random()}`

  const [open,     setOpen]     = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  async function send(text?: string) {
    const msg = (text ?? input).trim()
    if (!msg || loading) return

    const userMsg: Msg = { id: makeId(), role: 'user', content: msg }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const history = [...messages, userMsg].slice(-10).map((m) => ({
        role: m.role, content: m.content,
      }))

      const res = await helpChatApi.send({
        message:    msg,
        project_id: project?.id,
        conn_id:    connection?.id,
        page:       location.pathname,
        history,
      })

      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: 'assistant', content: res.content },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  function clear() {
    setMessages([])
    setInput('')
  }

  return (
    <>
      {/* Chat panel */}
      {open && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 88, left: 28,
            width: 370, height: 520,
            zIndex: 1299,
            display: 'flex', flexDirection: 'column',
            borderRadius: 3,
            boxShadow: '0 20px 60px rgba(0,0,0,.18)',
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              px: 2, py: 1.25,
              background: `linear-gradient(135deg, ${TEAL} 0%, #0284C7 100%)`,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            <SmartToyOutlined sx={{ fontSize: 20 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={700} lineHeight={1.2}>
                Clarity Assistant
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.8, fontSize: '0.68rem' }}>
                Ask anything about Clarity Studio
              </Typography>
            </Box>
            {messages.length > 0 && (
              <Tooltip title="Clear chat">
                <IconButton size="small" onClick={clear} sx={{ color: '#fff', opacity: 0.8, p: 0.5 }}>
                  <RestartAltOutlined sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: '#fff', p: 0.5 }}>
              <CloseOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>

          <Divider />

          {/* Messages */}
          <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', p: 1.5 }}>
            {messages.length === 0 && !loading && (
              <Box>
                {/* Welcome */}
                <Box sx={{ textAlign: 'center', py: 2, px: 1 }}>
                  <Box
                    sx={{
                      width: 48, height: 48, borderRadius: '50%',
                      bgcolor: alpha(TEAL, 0.1),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      mx: 'auto', mb: 1.5,
                    }}
                  >
                    <SmartToyOutlined sx={{ fontSize: 26, color: TEAL }} />
                  </Box>
                  <Typography variant="body2" fontWeight={600} gutterBottom>
                    Hi! I'm Clarity Assistant
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    I can help you with features, workflows, and your project status.
                  </Typography>
                </Box>

                {/* Suggested questions */}
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, display: 'block', mb: 0.75 }}>
                  Try asking:
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {SUGGESTIONS.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      size="small"
                      onClick={() => send(s)}
                      sx={{
                        fontSize: '0.7rem', cursor: 'pointer',
                        bgcolor: alpha(TEAL, 0.08),
                        color: TEAL,
                        border: `1px solid ${alpha(TEAL, 0.25)}`,
                        '&:hover': { bgcolor: alpha(TEAL, 0.15) },
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {messages.map((m) => <Bubble key={m.id} msg={m} />)}

            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 1 }}>
                <Box
                  sx={{
                    width: 26, height: 26, borderRadius: '50%',
                    bgcolor: TEAL, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, mr: 0.75, mt: 0.25,
                  }}
                >
                  <SmartToyOutlined sx={{ fontSize: 14 }} />
                </Box>
                <Box
                  sx={{
                    bgcolor: 'grey.100',
                    borderRadius: '16px 16px 16px 4px',
                    px: 1.5, py: 1,
                  }}
                >
                  <TypingDots />
                </Box>
              </Box>
            )}
          </Box>

          <Divider />

          {/* Input */}
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, p: 1.25, flexShrink: 0 }}>
            <TextField
              inputRef={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
              }}
              placeholder="Ask anything about Clarity Studio…"
              multiline maxRows={3}
              size="small" fullWidth
              disabled={loading}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2.5,
                  fontSize: '0.8rem',
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: TEAL },
                },
              }}
            />
            <IconButton
              onClick={() => send()}
              disabled={!input.trim() || loading}
              size="small"
              sx={{
                bgcolor: TEAL, color: '#fff', flexShrink: 0,
                width: 34, height: 34,
                '&:hover': { bgcolor: '#0284C7' },
                '&:disabled': { bgcolor: 'action.disabledBackground' },
              }}
            >
              {loading
                ? <CircularProgress size={14} color="inherit" />
                : <SendOutlined sx={{ fontSize: 16 }} />
              }
            </IconButton>
          </Box>
        </Box>
      )}

      {/* Floating bubble */}
      <Tooltip title="Clarity Assistant" placement="right">
        <Fab
          size="medium"
          onClick={() => setOpen((v) => !v)}
          sx={{
            position: 'fixed', bottom: 28, left: 28, zIndex: 1300,
            bgcolor: TEAL, color: '#fff',
            boxShadow: `0 4px 20px ${alpha(TEAL, 0.45)}`,
            '&:hover': { bgcolor: '#0284C7', boxShadow: `0 6px 28px ${alpha(TEAL, 0.6)}` },
          }}
        >
          {open ? <CloseOutlined /> : <SmartToyOutlined />}
        </Fab>
      </Tooltip>
    </>
  )
}
