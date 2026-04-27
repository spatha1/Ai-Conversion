import { useState, useRef, useEffect, useId } from 'react'
import {
  Box, Fab, Tooltip, Typography, TextField, IconButton,
  Chip, Divider, CircularProgress, alpha,
} from '@mui/material'
import {
  SmartToyOutlined, CloseOutlined, SendOutlined,
  RestartAltOutlined, OpenInFullOutlined, CloseFullscreenOutlined,
} from '@mui/icons-material'
import { useLocation } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { helpChatApi } from '@/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const TEAL = '#0EA5E9'

interface Msg {
  id:      string
  role:    'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'What is in my current project?',
  'How do I generate output from my data?',
  'How do I dispatch via SFTP or Azure Blob?',
  'How do I use the Pipeline tab?',
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

// ── Markdown styles injected once ─────────────────────────────
const MD_STYLES = `
  .clarity-md { font-size: 0.8rem; line-height: 1.65; color: inherit; }
  .clarity-md p  { margin: 0 0 0.5em; }
  .clarity-md p:last-child { margin-bottom: 0; }
  .clarity-md ul, .clarity-md ol { margin: 0.35em 0 0.5em 1.25em; padding: 0; }
  .clarity-md li { margin-bottom: 0.2em; }
  .clarity-md li > p { margin: 0; }
  .clarity-md h1, .clarity-md h2, .clarity-md h3 {
    font-size: 0.85rem; font-weight: 700; margin: 0.6em 0 0.3em; line-height: 1.3;
  }
  .clarity-md h1 { font-size: 0.9rem; }
  .clarity-md code {
    font-family: 'Consolas', 'Fira Code', monospace;
    background: rgba(0,0,0,0.07); border-radius: 3px;
    padding: 0.1em 0.35em; font-size: 0.75rem;
  }
  .clarity-md pre {
    background: rgba(0,0,0,0.06); border-radius: 6px;
    padding: 0.65em 0.85em; overflow-x: auto; margin: 0.5em 0;
  }
  .clarity-md pre code { background: none; padding: 0; font-size: 0.73rem; }
  .clarity-md blockquote {
    border-left: 3px solid ${TEAL}; margin: 0.4em 0;
    padding: 0.25em 0.75em; opacity: 0.85;
  }
  .clarity-md strong { font-weight: 700; }
  .clarity-md em { font-style: italic; }
  .clarity-md a { color: ${TEAL}; text-decoration: underline; }
  .clarity-md hr { border: none; border-top: 1px solid rgba(0,0,0,0.12); margin: 0.6em 0; }

  /* Tables */
  .clarity-md table {
    border-collapse: collapse; width: 100%; font-size: 0.75rem;
    margin: 0.5em 0; border-radius: 6px; overflow: hidden;
  }
  .clarity-md th {
    background: rgba(14,165,233,0.12); font-weight: 700;
    padding: 0.4em 0.65em; text-align: left;
    border: 1px solid rgba(14,165,233,0.25);
  }
  .clarity-md td {
    padding: 0.35em 0.65em;
    border: 1px solid rgba(0,0,0,0.1);
  }
  .clarity-md tr:nth-child(even) td { background: rgba(0,0,0,0.025); }

  /* Images */
  .clarity-md img {
    max-width: 100%; border-radius: 6px; margin: 0.4em 0;
    display: block;
  }

  /* User bubble overrides (white text) */
  .clarity-md-user code { background: rgba(255,255,255,0.2); }
  .clarity-md-user pre  { background: rgba(255,255,255,0.15); }
  .clarity-md-user blockquote { border-left-color: rgba(255,255,255,0.6); }
  .clarity-md-user th { background: rgba(255,255,255,0.2); border-color: rgba(255,255,255,0.3); }
  .clarity-md-user td { border-color: rgba(255,255,255,0.2); }
  .clarity-md-user tr:nth-child(even) td { background: rgba(255,255,255,0.08); }
  .clarity-md-user a  { color: #bfecff; }
`

function injectStyles() {
  if (document.getElementById('clarity-md-styles')) return
  const el = document.createElement('style')
  el.id = 'clarity-md-styles'
  el.textContent = MD_STYLES
  document.head.appendChild(el)
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user'

  useEffect(() => { injectStyles() }, [])

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        mb: 1.25,
        alignItems: 'flex-start',
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
          maxWidth: '84%',
          bgcolor: isUser ? TEAL : (t) => t.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
          color: isUser ? '#fff' : 'text.primary',
          borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          px: 1.5, py: 1,
          wordBreak: 'break-word',
          // Tables need horizontal scroll
          '& table': { display: 'block', overflowX: 'auto' },
        }}
      >
        <div className={`clarity-md${isUser ? ' clarity-md-user' : ''}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Open links in new tab safely
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
            ),
            // Images: constrain to bubble width
            img: ({ src, alt }) => (
              <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', borderRadius: 6 }} />
            ),
          }}
        >
          {msg.content}
        </ReactMarkdown>
        </div>
      </Box>
    </Box>
  )
}

export default function HelpChat() {
  const location    = useLocation()
  const project     = useAppStore((s) => s.activeProject)
  const connection  = useAppStore((s) => s.activeConnection)
  const askAIOpen   = useAppStore((s) => s.askAIOpen)

  const uid = useId()
  const makeId = () => `${uid}-${Date.now()}-${Math.random()}`

  const [open,      setOpen]     = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [messages,  setMessages] = useState<Msg[]>([])
  const [input,     setInput]    = useState('')
  const [loading,   setLoading]  = useState(false)

  const scrollRef    = useRef<HTMLDivElement>(null)
  const bottomRef    = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
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
      {open && !askAIOpen && (
        <Box
          sx={{
            position: 'fixed',
            ...(maximized
              ? { bottom: 16, left: 16, right: 16, top: 16, width: 'auto', height: 'auto' }
              : { bottom: 88, left: 28, width: 440, height: 580 }
            ),
            zIndex: 1299,
            transition: 'all 0.2s cubic-bezier(.4,0,.2,1)',
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
            <Tooltip title={maximized ? 'Restore' : 'Maximize'}>
              <IconButton size="small" onClick={() => setMaximized((v) => !v)} sx={{ color: '#fff', opacity: 0.8, p: 0.5 }}>
                {maximized
                  ? <CloseFullscreenOutlined sx={{ fontSize: 16 }} />
                  : <OpenInFullOutlined sx={{ fontSize: 16 }} />
                }
              </IconButton>
            </Tooltip>
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
                    I support <strong>tables</strong>, <strong>bullet lists</strong>, <strong>code</strong>, and more.
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
                    bgcolor: (t) => t.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
                    borderRadius: '16px 16px 16px 4px',
                    px: 1.5, py: 1,
                  }}
                >
                  <TypingDots />
                </Box>
              </Box>
            )}
            <div ref={bottomRef} />
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
              multiline maxRows={4}
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
            display: askAIOpen ? 'none' : undefined,
          }}
        >
          {open ? <CloseOutlined /> : <SmartToyOutlined />}
        </Fab>
      </Tooltip>
    </>
  )
}
