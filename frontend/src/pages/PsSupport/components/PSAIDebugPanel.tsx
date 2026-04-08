/**
 * PSAIDebugPanel — right-side Drawer for PS Support AI debugging.
 * Shows:
 *   1. AI Prompt — system prompt, model, connection
 *   2. Tool Calls — all tool call history from the current conversation
 */
import { useState, useEffect } from 'react'
import {
  Drawer, Box, Tabs, Tab, Typography, IconButton, Tooltip,
  Divider, Chip, CircularProgress, Accordion,
  AccordionSummary, AccordionDetails, alpha,
} from '@mui/material'
import {
  CloseOutlined, ContentCopyOutlined, ExpandMoreOutlined,
  CheckOutlined, BugReportOutlined, AutoFixHighOutlined,
  StorageOutlined, ManageSearchOutlined, CodeOutlined,
  LinkOutlined, EmailOutlined, AssessmentOutlined, BoltOutlined,
  RefreshOutlined, ApiOutlined, TableChartOutlined,
} from '@mui/icons-material'
import { psApi } from '@/api'

// ── helpers ───────────────────────────────────────────────────────────────────

interface ToolCall {
  tool: string
  input: Record<string, any>
  output: Record<string, any>
}

interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
  id: string
  toolCalls?: ToolCall[]
}

const TOOL_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  lookup_schema:        { label: 'Schema Lookup',       icon: <ManageSearchOutlined sx={{ fontSize: 14 }} />, color: '#7c3aed' },
  generate_sql:         { label: 'Generate SQL',         icon: <CodeOutlined sx={{ fontSize: 14 }} />,         color: '#2563eb' },
  execute_sql:          { label: 'Execute SQL',          icon: <StorageOutlined sx={{ fontSize: 14 }} />,      color: '#059669' },
  list_api_endpoints:   { label: 'List APIs',            icon: <ApiOutlined sx={{ fontSize: 14 }} />,          color: '#64748b' },
  execute_api:          { label: 'API Call',             icon: <LinkOutlined sx={{ fontSize: 14 }} />,         color: '#7c3aed' },
  execute_api_for_rows: { label: 'Sequential API Calls', icon: <AssessmentOutlined sx={{ fontSize: 14 }} />,   color: '#059669' },
  generate_report:      { label: 'Generate Report',      icon: <AssessmentOutlined sx={{ fontSize: 14 }} />,   color: '#2563eb' },
  preview_email:        { label: 'Email Preview',        icon: <EmailOutlined sx={{ fontSize: 14 }} />,        color: '#d97706' },
  send_email:           { label: 'Send Email',           icon: <EmailOutlined sx={{ fontSize: 14 }} />,        color: '#10b981' },
  call_api:             { label: 'API Call',             icon: <LinkOutlined sx={{ fontSize: 14 }} />,         color: '#7c3aed' },
  query_data:           { label: 'Query Data',           icon: <TableChartOutlined sx={{ fontSize: 14 }} />,   color: '#2563eb' },
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <IconButton size="small" onClick={copy}>
        {copied ? <CheckOutlined fontSize="small" color="success" /> : <ContentCopyOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      fontWeight={700}
      sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: 'text.secondary', mb: 0.5, display: 'block' }}
    >
      {children}
    </Typography>
  )
}

function MonoBox({ text, maxH = 200 }: { text: string; maxH?: number }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0, p: 1.5, borderRadius: 1,
        bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#000', 0.4) : alpha('#000', 0.04),
        border: '1px solid', borderColor: 'divider',
        fontFamily: 'monospace', fontSize: '0.72rem', lineHeight: 1.6,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: maxH, overflowY: 'auto',
      }}
    >
      {text}
    </Box>
  )
}

// ── Tab 1: AI Prompt ──────────────────────────────────────────────────────────

function PromptTab({
  connId,
  model,
}: {
  connId: number | ''
  model: string
}) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{ system_prompt: string; length: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await psApi.getDebugPrompt(connId)
      setData(result)
    } catch {
      setError('Could not load system prompt. Make sure the server is running.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [connId])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Model */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <SectionLabel>Model</SectionLabel>
        <Chip label={model} size="small" color="primary" variant="outlined" />
      </Box>

      {/* Connection */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <SectionLabel>Connection</SectionLabel>
        <Chip
          label={connId ? `ID: ${connId}` : 'No connection selected'}
          size="small"
          color={connId ? 'success' : 'default'}
          variant="outlined"
        />
      </Box>

      <Divider />

      {/* System Prompt */}
      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <AccordionSummary expandIcon={<ExpandMoreOutlined />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.75 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <AutoFixHighOutlined fontSize="small" color="primary" />
            <Typography variant="body2" fontWeight={600}>System Prompt</Typography>
            {data && <Chip label={`${data.length} chars`} size="small" />}
            {loading && <CircularProgress size={12} />}
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Reload">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); load() }}
                disabled={loading}
                sx={{ p: 0.3 }}
              >
                <RefreshOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0, pb: 1, px: 1.5 }}>
          {error && (
            <Typography variant="caption" color="error">{error}</Typography>
          )}
          {data && (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
                <CopyButton text={data.system_prompt} />
              </Box>
              <MonoBox text={data.system_prompt} maxH={400} />
            </>
          )}
          {!data && !error && !loading && (
            <Typography variant="caption" color="text.secondary">
              Click refresh to load the system prompt.
            </Typography>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}

// ── Tab 2: Tool Calls ─────────────────────────────────────────────────────────

function ToolCallsTab({ messages }: { messages: ChatBubble[] }) {
  const allToolCalls = messages
    .filter((m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0)
    .flatMap((m, msgIdx) =>
      (m.toolCalls ?? []).map((tc, tcIdx) => ({ ...tc, msgIdx, tcIdx }))
    )

  if (allToolCalls.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" variant="body2">
          No tool calls in this conversation yet.
        </Typography>
        <Typography color="text.secondary" variant="caption" sx={{ mt: 0.5, display: 'block' }}>
          Tool calls will appear here as the AI agent works through your requests.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        {allToolCalls.length} tool call{allToolCalls.length !== 1 ? 's' : ''} in current conversation
      </Typography>

      {allToolCalls.map((tc, idx) => {
        const meta = TOOL_META[tc.tool] ?? { label: tc.tool, icon: <BoltOutlined sx={{ fontSize: 14 }} />, color: '#64748b' }
        const inputStr = JSON.stringify(tc.input, null, 2)
        const outputStr = JSON.stringify(tc.output, null, 2)

        return (
          <Accordion
            key={idx}
            disableGutters
            elevation={0}
            sx={{
              border: '1px solid',
              borderColor: alpha(meta.color, 0.35),
              borderRadius: 1,
              bgcolor: (t) => alpha(meta.color, t.palette.mode === 'dark' ? 0.07 : 0.03),
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreOutlined sx={{ fontSize: 16 }} />}
              sx={{ minHeight: 38, '& .MuiAccordionSummary-content': { my: 0.5 } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ color: meta.color, display: 'flex' }}>{meta.icon}</Box>
                <Typography variant="caption" fontWeight={700} sx={{ color: meta.color }}>
                  {meta.label}
                </Typography>
                <Chip label={`#${idx + 1}`} size="small" sx={{ height: 16, fontSize: '0.65rem' }} />
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0, pb: 1.5, px: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <SectionLabel>Input</SectionLabel>
                  <CopyButton text={inputStr} />
                </Box>
                <MonoBox text={inputStr} maxH={160} />
              </Box>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <SectionLabel>Output</SectionLabel>
                  <CopyButton text={outputStr} />
                </Box>
                <MonoBox text={outputStr} maxH={200} />
              </Box>
            </AccordionDetails>
          </Accordion>
        )
      })}
    </Box>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface PSAIDebugPanelProps {
  open:     boolean
  onClose:  () => void
  connId:   number | ''
  model:    string
  messages: ChatBubble[]
}

export default function PSAIDebugPanel({ open, onClose, connId, model, messages }: PSAIDebugPanelProps) {
  const [tab, setTab] = useState(0)

  const totalToolCalls = messages
    .filter((m) => m.role === 'assistant')
    .reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0)

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100vw', sm: 500 },
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1,
          borderBottom: 1, borderColor: 'divider', flexShrink: 0,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
        }}
      >
        <BugReportOutlined color="primary" />
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          AI Debug Panel
        </Typography>
        {totalToolCalls > 0 && (
          <Chip label={`${totalToolCalls} tool calls`} size="small" />
        )}
        <Tooltip title="Close">
          <IconButton size="small" onClick={onClose}>
            <CloseOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        <Tab
          label="AI Prompt"
          icon={<AutoFixHighOutlined fontSize="small" />}
          iconPosition="start"
          sx={{ minHeight: 48, fontSize: '0.8rem' }}
        />
        <Tab
          label={`Tool Calls${totalToolCalls > 0 ? ` (${totalToolCalls})` : ''}`}
          icon={<BoltOutlined fontSize="small" />}
          iconPosition="start"
          sx={{ minHeight: 48, fontSize: '0.8rem' }}
        />
      </Tabs>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tab === 0 && <PromptTab connId={connId} model={model} />}
        {tab === 1 && <ToolCallsTab messages={messages} />}
      </Box>
    </Drawer>
  )
}
