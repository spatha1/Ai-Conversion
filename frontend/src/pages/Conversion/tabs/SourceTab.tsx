import { useState, useRef, useEffect } from 'react'
import {
  Box, Grid, Card, CardContent, Typography, TextField, Button,
  Select, MenuItem, FormControl, InputLabel, InputAdornment,
  IconButton, Chip, Table, TableHead, TableRow, TableCell, TableBody,
  Alert, Divider, Paper, alpha, CircularProgress, Avatar,
  Tooltip, Badge, ToggleButtonGroup, ToggleButton,
} from '@mui/material'
import {
  StorageOutlined, AcUnitOutlined, SmartToyOutlined,
  VisibilityOutlined, VisibilityOffOutlined, PlayArrowOutlined,
  SaveOutlined, CheckCircleOutlineOutlined, ErrorOutlineOutlined,
  SendOutlined, PersonOutlined, RefreshOutlined, ContentPasteOutlined,
  ArrowForwardOutlined, KeyOutlined, LockOutlined, UploadFileOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { connectionsApi, chatApi, adminApi } from '@/api'
import type { ConnectionCreate, SourceConnection } from '@/types'

type SourceType = 'sql' | 'snowflake' | 'aichat'

const SQL_DIALECTS = ['mssql', 'postgresql', 'mysql', 'sqlite']
const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']

const DEFAULT_SQL: ConnectionCreate = {
  name: '', source_type: 'sql', dialect: 'mssql',
  host: '', port: 1433, database_name: '', schema_name: 'dbo',
  username: '', password: '', query_text: '', sheet_alias: '',
}
const DEFAULT_SF: ConnectionCreate = {
  name: '', source_type: 'snowflake',
  sf_account: '', sf_warehouse: '', sf_role: '',
  sf_database: '', sf_schema: 'PUBLIC',
  sf_username: '', sf_password: '', sf_private_key: '', sf_private_key_passphrase: '',
  query_text: '', sheet_alias: '',
}

interface ChatMsg { role: 'user' | 'assistant'; content: string }

const SYSTEM_PROMPT = `You are a database connection setup wizard for Clarity Studio.
Help the user configure a SQL Server, PostgreSQL, MySQL, SQLite or Snowflake connection.
Ask for: connection name, database type, host/server, port, database, schema, username, password, and an optional SQL query.
When you have all required info, output a JSON code block like:
\`\`\`json
{"name":"...","source_type":"sql","dialect":"mssql","host":"...","port":1433,"database_name":"...","schema_name":"dbo","username":"...","password":"...","query_text":"SELECT TOP 100 * FROM ...","sheet_alias":"..."}
\`\`\`
For Snowflake connections use source_type "snowflake" and fields: sf_account, sf_warehouse, sf_role, sf_database, sf_schema, sf_username.
Snowflake supports TWO authentication methods — always ask which one:
1. Password auth: include sf_password in the JSON.
2. Key-pair auth: include sf_private_key (PEM content of the .p8 file) and optionally sf_private_key_passphrase. Do NOT include sf_password in this case.
If the user says they are using a private key / RSA key / .p8 file, use key-pair auth and ask them to paste the PEM content or upload the file through the form.`

export default function SourceTab() {
  const { enqueueSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const activeProject = useAppStore((s) => s.activeProject)
  const { setSourceSheets, setConversionTab, setActiveConnection } = useAppStore()

  const [srcType, setSrcType] = useState<SourceType>('sql')
  const [sqlForm, setSqlForm] = useState<ConnectionCreate>({ ...DEFAULT_SQL })
  const [sfForm, setSfForm] = useState<ConnectionCreate>({ ...DEFAULT_SF })
  const [showPass, setShowPass] = useState(false)
  const [sfAuthMethod, setSfAuthMethod] = useState<'password' | 'keypair'>('password')
  const keyFileRef = useRef<HTMLInputElement>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [savedConnId, setSavedConnId] = useState<number | null>(null)

  // AI Chat state
  const [chatApiKey, setChatApiKey] = useState('')
  const [chatModel, setChatModel] = useState('gpt-4o-mini')

  // Auto-load OpenAI key from .env on mount
  useEffect(() => {
    adminApi.getOpenAiKey().then((r) => {
      if (r.api_key) setChatApiKey(r.api_key)
    }).catch(() => {})
  }, [])
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [extractedConfig, setExtractedConfig] = useState<ConnectionCreate | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const form = srcType === 'sql' ? sqlForm : sfForm
  const setForm = srcType === 'sql'
    ? (v: ConnectionCreate) => setSqlForm(v)
    : (v: ConnectionCreate) => setSfForm(v)

  const { data: connections = [] } = useQuery({
    queryKey: ['connections', activeProject?.id],
    queryFn: () => connectionsApi.list(activeProject?.id),
  })

  const testMutation = useMutation({
    mutationFn: () => connectionsApi.testAdhoc({ ...form }),
    onSuccess: (r) => setTestResult(r),
    onError: (e: Error) => setTestResult({ success: false, message: e.message }),
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (savedConnId) return connectionsApi.preview(savedConnId)
      const saved = await connectionsApi.create({ ...form, project_id: activeProject?.id })
      setSavedConnId(saved.id)
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      return connectionsApi.preview(saved.id)
    },
    onSuccess: (r) => {
      setPreviewData({ columns: r.columns ?? [], rows: r.rows ?? [] })
      setSourceSheets([{ name: form.sheet_alias || 'Source', columns: r.columns ?? [], rows: r.rows ?? [] }])
      enqueueSnackbar(`Preview loaded — ${r.rows?.length ?? 0} rows`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      savedConnId
        ? connectionsApi.update(savedConnId, { ...form })   // blank password = keep existing
        : connectionsApi.create({ ...form, project_id: activeProject?.id }),
    onSuccess: (conn) => {
      setSavedConnId(conn.id)
      setActiveConnection(conn)   // make this the global active connection
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      enqueueSnackbar(`Connection "${conn.name}" ${savedConnId ? 'updated' : 'saved'}`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const chatMutation = useMutation({
    mutationFn: async (userMsg: string) => {
      const history: ChatMsg[] = [...chatMessages, { role: 'user', content: userMsg }]
      setChatMessages(history)
      const msgs = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ]
      return chatApi.send(msgs, chatApiKey, chatModel)
    },
    onSuccess: (r) => {
      const reply = r.message
      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }])
      // Try to extract JSON config from response
      const match = reply.match(/```json\s*([\s\S]*?)```/)
      if (match) {
        try {
          const cfg = JSON.parse(match[1]) as ConnectionCreate
          setExtractedConfig(cfg)
        } catch { /* ignore */ }
      }
    },
    onError: (e: Error) => {
      enqueueSnackbar(e.message, { variant: 'error' })
      setChatMessages((prev) => prev.slice(0, -1))
    },
  })

  const handleChatSend = () => {
    if (!chatInput.trim()) return
    const msg = chatInput.trim()
    setChatInput('')
    chatMutation.mutate(msg)
  }

  const applyExtractedConfig = () => {
    if (!extractedConfig) return
    if (extractedConfig.source_type === 'snowflake') {
      setSrcType('snowflake')
      setSfForm(extractedConfig)
      // Auto-select auth method based on what the AI returned
      setSfAuthMethod(extractedConfig.sf_private_key ? 'keypair' : 'password')
    } else {
      setSrcType('sql')
      setSqlForm(extractedConfig)
    }
    setExtractedConfig(null)
    enqueueSnackbar('Connection config applied to form', { variant: 'success' })
  }

  const loadSavedConn = (conn: SourceConnection) => {
    setSavedConnId(conn.id)
    setActiveConnection(conn)   // set as global active connection
    if (conn.source_type === 'snowflake') {
      setSrcType('snowflake')
      const hasKey = conn.sf_has_private_key ?? false
      setSfAuthMethod(hasKey ? 'keypair' : 'password')
      setSfForm({
        name: conn.name, source_type: 'snowflake',
        sf_account: conn.sf_account ?? '', sf_warehouse: conn.sf_warehouse ?? '',
        sf_role: conn.sf_role ?? '', sf_database: conn.sf_database ?? '',
        sf_schema: conn.sf_schema ?? 'PUBLIC', sf_username: conn.sf_username ?? '',
        sf_password: '',        // never returned by API — encrypted at rest
        sf_private_key: '',     // never returned by API — encrypted at rest
        sf_private_key_passphrase: '',
        query_text: conn.query_text ?? '', sheet_alias: conn.sheet_alias ?? '',
      })
    } else {
      setSrcType('sql')
      setSqlForm({
        name: conn.name, source_type: 'sql', dialect: conn.dialect ?? 'mssql',
        host: conn.host ?? '', port: conn.port ?? 1433,
        database_name: conn.database_name ?? '', schema_name: conn.schema_name ?? 'dbo',
        username: conn.username ?? '', password: '',  // never returned — encrypted at rest
        query_text: conn.query_text ?? '', sheet_alias: conn.sheet_alias ?? '',
      })
    }
  }

  // ─── Source type selector ───────────────────────────────
  const SourceTypeBtn = ({ type, icon, label, desc }: { type: SourceType; icon: React.ReactNode; label: string; desc: string }) => (
    <Card
      onClick={() => setSrcType(type)}
      sx={{
        cursor: 'pointer', p: 2, flex: 1, minWidth: 120,
        border: '2px solid',
        borderColor: srcType === type ? 'primary.main' : 'divider',
        bgcolor: srcType === type ? (t) => alpha(t.palette.primary.main, 0.05) : 'background.paper',
        transition: 'all .18s ease',
        '&:hover': {
          borderColor: 'primary.light',
          bgcolor: (t) => alpha(t.palette.primary.main, 0.03),
          transform: 'translateY(-2px)',
          boxShadow: 3,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Avatar
          sx={{
            width: 36, height: 36,
            bgcolor: srcType === type ? 'primary.main' : 'action.selected',
            color: srcType === type ? 'white' : 'text.secondary',
          }}
        >
          {icon}
        </Avatar>
        <Box>
          <Typography variant="subtitle2" fontWeight={700}>{label}</Typography>
          <Typography variant="caption" color="text.secondary">{desc}</Typography>
        </Box>
      </Box>
    </Card>
  )

  return (
    <Box sx={{ p: 3 }}>
      {/* Source type selector */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <SourceTypeBtn type="sql" icon={<StorageOutlined />} label="SQL Database" desc="PostgreSQL, MySQL, MSSQL, SQLite" />
        <SourceTypeBtn type="snowflake" icon={<AcUnitOutlined />} label="Snowflake" desc="Cloud data warehouse" />
        <SourceTypeBtn type="aichat" icon={<SmartToyOutlined />} label="AI Chat Setup" desc="Let AI configure your connection" />
      </Box>

      <Grid container spacing={3}>
        {/* ── AI CHAT ── */}
        {srcType === 'aichat' && (
          <>
            <Grid item xs={12} lg={7}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent sx={{ p: 2.5, pb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Avatar sx={{ background: 'linear-gradient(135deg,#7c3aed,#2563eb)', width: 32, height: 32 }}>
                      <SmartToyOutlined sx={{ fontSize: 18 }} />
                    </Avatar>
                    <Typography variant="h6" fontWeight={700}>AI Connection Setup</Typography>
                    <Chip label="Powered by OpenAI" size="small" color="secondary" variant="outlined" sx={{ ml: 'auto' }} />
                  </Box>

                  {/* API Key + Model row */}
                  <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
                    <TextField
                      label="OpenAI API Key"
                      value={chatApiKey}
                      onChange={(e) => setChatApiKey(e.target.value)}
                      type="password"
                      size="small"
                      sx={{ flex: 1, minWidth: 200 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <KeyOutlined fontSize="small" color={chatApiKey ? 'success' : 'action'} />
                          </InputAdornment>
                        ),
                      }}
                      placeholder="sk-..."
                      helperText={chatApiKey ? '✓ Loaded from .env' : 'Not set — add OPENAI_API_KEY to .env'}
                      FormHelperTextProps={{ sx: { color: chatApiKey ? 'success.main' : 'warning.main', mt: 0.25 } }}
                    />
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel>Model</InputLabel>
                      <Select value={chatModel} label="Model" onChange={(e) => setChatModel(e.target.value)}>
                        {OPENAI_MODELS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<RefreshOutlined />}
                      onClick={() => { setChatMessages([]); setExtractedConfig(null) }}
                    >
                      Reset
                    </Button>
                  </Box>
                </CardContent>

                <Divider />

                {/* Chat messages */}
                <Box
                  sx={{
                    flex: 1, minHeight: 320, maxHeight: 420,
                    overflow: 'auto', p: 2,
                    bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#000', 0.2) : alpha('#f8fafc', 0.8),
                  }}
                >
                  {chatMessages.length === 0 ? (
                    <Box sx={{ textAlign: 'center', pt: 6, color: 'text.disabled' }}>
                      <SmartToyOutlined sx={{ fontSize: 48, opacity: 0.3, mb: 1 }} />
                      <Typography variant="body2" fontWeight={500}>
                        Hi! I'll help you configure your database connection.
                      </Typography>
                      <Typography variant="caption">
                        Start by telling me what type of database you're connecting to.
                      </Typography>
                      <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {['Connect to SQL Server', 'Connect to PostgreSQL', 'Set up Snowflake', 'Snowflake with key pair auth'].map((s) => (
                          <Chip
                            key={s} label={s} size="small" variant="outlined"
                            onClick={() => { setChatInput(s); }}
                            sx={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Box>
                    </Box>
                  ) : (
                    chatMessages.map((msg, i) => (
                      <Box
                        key={i}
                        sx={{
                          display: 'flex',
                          justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                          mb: 1.5, gap: 1, alignItems: 'flex-end',
                        }}
                      >
                        {msg.role === 'assistant' && (
                          <Avatar sx={{ width: 28, height: 28, background: 'linear-gradient(135deg,#7c3aed,#2563eb)', mb: 0.25 }}>
                            <SmartToyOutlined sx={{ fontSize: 14 }} />
                          </Avatar>
                        )}
                        <Box
                          sx={{
                            maxWidth: '80%', p: 1.5, fontSize: '0.875rem',
                            borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                            bgcolor: msg.role === 'user' ? 'primary.main' : 'background.paper',
                            color: msg.role === 'user' ? 'white' : 'text.primary',
                            border: msg.role === 'user' ? 'none' : '1px solid',
                            borderColor: 'divider',
                            boxShadow: 1,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
                          }}
                        >
                          {msg.content}
                        </Box>
                        {msg.role === 'user' && (
                          <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.dark', mb: 0.25 }}>
                            <PersonOutlined sx={{ fontSize: 14 }} />
                          </Avatar>
                        )}
                      </Box>
                    ))
                  )}
                  {chatMutation.isPending && (
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', color: 'text.secondary', mt: 1 }}>
                      <CircularProgress size={14} />
                      <Typography variant="caption">AI is thinking…</Typography>
                    </Box>
                  )}
                  <div ref={messagesEndRef} />
                </Box>

                <Divider />

                {/* Extracted config alert */}
                {extractedConfig && (
                  <Box sx={{ px: 2, py: 1.5, bgcolor: (t) => alpha(t.palette.success.main, 0.05) }}>
                    <Alert
                      severity="success"
                      action={
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<ContentPasteOutlined />}
                          onClick={applyExtractedConfig}
                        >
                          Apply to Form
                        </Button>
                      }
                    >
                      Connection config detected — click to apply to the form and review/save it.
                    </Alert>
                  </Box>
                )}

                {/* Input */}
                <Box sx={{ p: 2, display: 'flex', gap: 1.5 }}>
                  <TextField
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend() }
                    }}
                    fullWidth
                    size="small"
                    placeholder="Describe your database or ask a question…"
                    disabled={!chatApiKey.trim()}
                  />
                  <IconButton
                    color="primary"
                    onClick={handleChatSend}
                    disabled={!chatInput.trim() || !chatApiKey.trim() || chatMutation.isPending}
                    sx={{
                      bgcolor: 'primary.main', color: 'white', borderRadius: 2,
                      '&:hover': { bgcolor: 'primary.dark' },
                      '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
                    }}
                  >
                    {chatMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <SendOutlined />}
                  </IconButton>
                </Box>
              </Card>
            </Grid>

            <Grid item xs={12} lg={5}>
              <Card>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h6" fontWeight={700} gutterBottom>How it works</Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {[
                      { step: '1', text: 'API key is auto-loaded from OPENAI_API_KEY in your .env file', icon: <KeyOutlined />, done: !!chatApiKey },
                      { step: '2', text: 'Tell the AI what database you want to connect to', icon: <SmartToyOutlined />, done: false },
                      { step: '3', text: "Answer the AI's questions about host, credentials, etc.", icon: <PersonOutlined />, done: false },
                      { step: '4', text: 'When the AI shows a config, click "Apply to Form"', icon: <ContentPasteOutlined />, done: false },
                      { step: '5', text: 'Review the form, test the connection, and save', icon: <SaveOutlined />, done: false },
                    ].map(({ step, text, done }) => (
                      <Box key={step} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                        <Avatar
                          sx={{
                            width: 32, height: 32,
                            bgcolor: done ? 'success.main' : 'primary.main',
                            fontSize: '0.875rem', fontWeight: 700, flexShrink: 0,
                            transition: 'background-color 0.3s',
                          }}
                        >
                          {done ? '✓' : step}
                        </Avatar>
                        <Typography
                          variant="body2"
                          color={done ? 'success.main' : 'text.secondary'}
                          sx={{ pt: 0.5, fontWeight: done ? 600 : 400 }}
                        >
                          {text}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </>
        )}

        {/* ── SQL / SNOWFLAKE FORM ── */}
        {srcType !== 'aichat' && (
          <>
            <Grid item xs={12} lg={7}>
              <Card>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2.5, gap: 1 }}>
                    <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main', width: 36, height: 36 }}>
                      {srcType === 'sql' ? <StorageOutlined /> : <AcUnitOutlined />}
                    </Avatar>
                    <Box>
                      <Typography variant="h6" fontWeight={700}>
                        {srcType === 'sql' ? 'SQL Database' : 'Snowflake'} Connection
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {srcType === 'sql' ? 'Connect to PostgreSQL, MySQL, MSSQL or SQLite' : 'Connect to Snowflake cloud data warehouse'}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Load saved connection */}
                  {connections.filter((c) => c.source_type === srcType).length > 0 && (
                    <Box sx={{ mb: 2.5 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Load Saved Connection</InputLabel>
                        <Select
                          value=""
                          label="Load Saved Connection"
                          onChange={(e) => {
                            const conn = connections.find((c) => c.id === Number(e.target.value))
                            if (conn) loadSavedConn(conn)
                          }}
                        >
                          {connections
                            .filter((c) => c.source_type === srcType)
                            .map((c) => (
                              <MenuItem key={c.id} value={c.id}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <StorageOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
                                  {c.name}
                                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                    {c.database_name || c.sf_database}
                                  </Typography>
                                </Box>
                              </MenuItem>
                            ))}
                        </Select>
                      </FormControl>
                      <Divider sx={{ mt: 2.5 }} />
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                      label="Connection Name *"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      fullWidth
                      placeholder="e.g., Production DB"
                    />

                    {srcType === 'sql' ? (
                      <>
                        <FormControl fullWidth>
                          <InputLabel>Database Dialect *</InputLabel>
                          <Select
                            value={sqlForm.dialect ?? 'mssql'}
                            label="Database Dialect *"
                            onChange={(e) => setSqlForm({ ...sqlForm, dialect: e.target.value })}
                          >
                            {SQL_DIALECTS.map((d) => <MenuItem key={d} value={d}>{d.toUpperCase()}</MenuItem>)}
                          </Select>
                        </FormControl>
                        <Grid container spacing={2}>
                          <Grid item xs={8}>
                            <TextField
                              label="Host / Server *"
                              value={sqlForm.host}
                              onChange={(e) => setSqlForm({ ...sqlForm, host: e.target.value })}
                              fullWidth
                              placeholder={sqlForm.dialect === 'mssql' ? 'SERVER\\INSTANCE' : 'localhost'}
                            />
                          </Grid>
                          <Grid item xs={4}>
                            <TextField
                              label="Port"
                              type="number"
                              value={sqlForm.port ?? ''}
                              onChange={(e) => setSqlForm({ ...sqlForm, port: Number(e.target.value) })}
                              fullWidth
                            />
                          </Grid>
                        </Grid>
                        <Grid container spacing={2}>
                          <Grid item xs={8}>
                            <TextField
                              label="Database *"
                              value={sqlForm.database_name}
                              onChange={(e) => setSqlForm({ ...sqlForm, database_name: e.target.value })}
                              fullWidth
                            />
                          </Grid>
                          <Grid item xs={4}>
                            <TextField
                              label="Schema"
                              value={sqlForm.schema_name}
                              onChange={(e) => setSqlForm({ ...sqlForm, schema_name: e.target.value })}
                              fullWidth
                            />
                          </Grid>
                        </Grid>
                        <Grid container spacing={2}>
                          <Grid item xs={6}>
                            <TextField
                              label="Username"
                              value={sqlForm.username}
                              onChange={(e) => setSqlForm({ ...sqlForm, username: e.target.value })}
                              fullWidth
                            />
                          </Grid>
                          <Grid item xs={6}>
                            <TextField
                              label="Password"
                              type={showPass ? 'text' : 'password'}
                              value={sqlForm.password ?? ''}
                              onChange={(e) => setSqlForm({ ...sqlForm, password: e.target.value })}
                              fullWidth
                              placeholder={savedConnId ? '🔒 Saved securely — leave blank to keep' : ''}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton size="small" onClick={() => setShowPass(!showPass)}>
                                      {showPass ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                                    </IconButton>
                                  </InputAdornment>
                                ),
                              }}
                            />
                          </Grid>
                        </Grid>
                      </>
                    ) : (
                      <>
                        <Grid container spacing={2}>
                          <Grid item xs={6}>
                            <TextField label="Account Identifier *" value={sfForm.sf_account} onChange={(e) => setSfForm({ ...sfForm, sf_account: e.target.value })} fullWidth placeholder="org-account" />
                          </Grid>
                          <Grid item xs={6}>
                            <TextField label="Warehouse *" value={sfForm.sf_warehouse} onChange={(e) => setSfForm({ ...sfForm, sf_warehouse: e.target.value })} fullWidth />
                          </Grid>
                        </Grid>
                        <Grid container spacing={2}>
                          <Grid item xs={4}>
                            <TextField label="Role" value={sfForm.sf_role} onChange={(e) => setSfForm({ ...sfForm, sf_role: e.target.value })} fullWidth />
                          </Grid>
                          <Grid item xs={4}>
                            <TextField label="Database *" value={sfForm.sf_database} onChange={(e) => setSfForm({ ...sfForm, sf_database: e.target.value })} fullWidth />
                          </Grid>
                          <Grid item xs={4}>
                            <TextField label="Schema" value={sfForm.sf_schema} onChange={(e) => setSfForm({ ...sfForm, sf_schema: e.target.value })} fullWidth />
                          </Grid>
                        </Grid>

                        {/* Username row */}
                        <TextField label="Username *" value={sfForm.sf_username} onChange={(e) => setSfForm({ ...sfForm, sf_username: e.target.value })} fullWidth />

                        {/* Auth method toggle */}
                        <Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}>
                            Authentication Method
                          </Typography>
                          <ToggleButtonGroup
                            value={sfAuthMethod}
                            exclusive
                            size="small"
                            onChange={(_, v) => { if (v) setSfAuthMethod(v) }}
                          >
                            <ToggleButton value="password" sx={{ px: 2, fontSize: '0.75rem' }}>
                              <LockOutlined sx={{ fontSize: 14, mr: 0.5 }} /> Password
                            </ToggleButton>
                            <ToggleButton value="keypair" sx={{ px: 2, fontSize: '0.75rem' }}>
                              <KeyOutlined sx={{ fontSize: 14, mr: 0.5 }} /> Key Pair (.p8)
                            </ToggleButton>
                          </ToggleButtonGroup>
                        </Box>

                        {/* Password auth */}
                        {sfAuthMethod === 'password' && (
                          <TextField
                            label="Password *"
                            type={showPass ? 'text' : 'password'}
                            value={sfForm.sf_password ?? ''}
                            onChange={(e) => setSfForm({ ...sfForm, sf_password: e.target.value })}
                            fullWidth
                            placeholder={savedConnId ? '🔒 Saved securely — leave blank to keep' : ''}
                            InputProps={{
                              endAdornment: (
                                <InputAdornment position="end">
                                  <IconButton size="small" onClick={() => setShowPass(!showPass)}>
                                    {showPass ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                                  </IconButton>
                                </InputAdornment>
                              ),
                            }}
                          />
                        )}

                        {/* Key-pair auth */}
                        {sfAuthMethod === 'keypair' && (
                          <>
                            {/* Hidden file input */}
                            <input
                              ref={keyFileRef}
                              type="file"
                              accept=".p8,.pem,.key"
                              style={{ display: 'none' }}
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (!file) return
                                const reader = new FileReader()
                                reader.onload = (ev) => {
                                  setSfForm({ ...sfForm, sf_private_key: ev.target?.result as string ?? '' })
                                }
                                reader.readAsText(file)
                                e.target.value = ''   // reset so same file can be re-selected
                              }}
                            />
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                  Private Key (PEM / .p8)
                                </Typography>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<UploadFileOutlined />}
                                  onClick={() => keyFileRef.current?.click()}
                                  sx={{ ml: 'auto', fontSize: '0.75rem', py: 0.25 }}
                                >
                                  Upload .p8 file
                                </Button>
                              </Box>
                              <TextField
                                value={sfForm.sf_private_key ?? ''}
                                onChange={(e) => setSfForm({ ...sfForm, sf_private_key: e.target.value })}
                                multiline
                                rows={5}
                                fullWidth
                                placeholder={
                                  savedConnId
                                    ? '🔒 Key saved securely — paste new key or upload .p8 file to replace'
                                    : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
                                }
                                sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                              />
                            </Box>
                            <TextField
                              label="Key Passphrase (optional)"
                              type={showPass ? 'text' : 'password'}
                              value={sfForm.sf_private_key_passphrase ?? ''}
                              onChange={(e) => setSfForm({ ...sfForm, sf_private_key_passphrase: e.target.value })}
                              fullWidth
                              placeholder={savedConnId ? '🔒 Saved securely — leave blank to keep' : 'Leave blank if key is unencrypted'}
                              InputProps={{
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton size="small" onClick={() => setShowPass(!showPass)}>
                                      {showPass ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                                    </IconButton>
                                  </InputAdornment>
                                ),
                              }}
                            />
                          </>
                        )}
                      </>
                    )}

                    <TextField
                      label="SQL Query (optional)"
                      value={form.query_text ?? ''}
                      onChange={(e) => setForm({ ...form, query_text: e.target.value })}
                      multiline rows={3} fullWidth
                      placeholder="SELECT * FROM dbo.Employees"
                      sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
                    />
                    <TextField
                      label="Sheet / Table Alias"
                      value={form.sheet_alias ?? ''}
                      onChange={(e) => setForm({ ...form, sheet_alias: e.target.value })}
                      fullWidth placeholder="e.g., Employees"
                    />
                  </Box>

                  {/* Actions */}
                  <Box sx={{ display: 'flex', gap: 1.5, mt: 3, flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      startIcon={testMutation.isPending ? <CircularProgress size={14} /> : <PlayArrowOutlined />}
                      onClick={() => testMutation.mutate()}
                      disabled={testMutation.isPending}
                    >
                      Test Connection
                    </Button>
                    <Button
                      variant="outlined"
                      color="info"
                      startIcon={previewMutation.isPending ? <CircularProgress size={14} /> : <StorageOutlined />}
                      onClick={() => previewMutation.mutate()}
                      disabled={previewMutation.isPending}
                    >
                      Preview Data
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={saveMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending || !form.name.trim()}
                    >
                      Save Connection
                    </Button>
                  </Box>

                  {testResult && (
                    <Alert
                      severity={testResult.success ? 'success' : 'error'}
                      sx={{ mt: 2 }}
                      onClose={() => setTestResult(null)}
                    >
                      {testResult.message}
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* Right: Preview / Saved */}
            <Grid item xs={12} lg={5}>
              {previewData ? (
                <Card>
                  <CardContent sx={{ p: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                      <Typography variant="h6" fontWeight={700}>Data Preview</Typography>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Chip label={`${previewData.rows.length} rows`} size="small" color="primary" variant="outlined" />
                        <Chip label={`${previewData.columns.length} cols`} size="small" variant="outlined" />
                      </Box>
                    </Box>
                    <Box sx={{ overflow: 'auto', maxHeight: 360, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            {previewData.columns.slice(0, 8).map((col) => (
                              <TableCell key={col}>{col}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {previewData.rows.slice(0, 10).map((row, i) => (
                            <TableRow key={i} hover>
                              {previewData.columns.slice(0, 8).map((col) => (
                                <TableCell key={col}>
                                  <Typography variant="caption" noWrap sx={{ maxWidth: 100, display: 'block' }}>
                                    {String(row[col] ?? '')}
                                  </Typography>
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                    <Button
                      variant="contained"
                      fullWidth sx={{ mt: 2 }}
                      endIcon={<ArrowForwardOutlined />}
                      onClick={() => setConversionTab(1)}
                    >
                      Next: Upload XML Template
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={700} gutterBottom>Saved Connections</Typography>
                    {connections.length === 0 ? (
                      <Box sx={{ textAlign: 'center', py: 6, borderRadius: 2, border: '1px dashed', borderColor: 'divider' }}>
                        <StorageOutlined sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                        <Typography variant="body2" color="text.secondary">No saved connections yet</Typography>
                      </Box>
                    ) : (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {connections.map((c) => (
                          <Paper
                            key={c.id}
                            variant="outlined"
                            sx={{
                              p: 1.5, cursor: 'pointer', borderRadius: 2,
                              transition: 'all .15s',
                              '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.light' },
                            }}
                            onClick={() => loadSavedConn(c)}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Avatar sx={{ width: 28, height: 28, bgcolor: c.source_type === 'snowflake' ? 'info.light' : 'primary.light' }}>
                                {c.source_type === 'snowflake'
                                  ? <AcUnitOutlined sx={{ fontSize: 14, color: 'info.main' }} />
                                  : <StorageOutlined sx={{ fontSize: 14, color: 'primary.main' }} />}
                              </Avatar>
                              <Box sx={{ flex: 1 }}>
                                <Typography variant="body2" fontWeight={600}>{c.name}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {c.source_type} · {c.database_name || c.sf_database}
                                </Typography>
                              </Box>
                              <Chip label={c.is_active ? 'Active' : 'Inactive'} size="small" color={c.is_active ? 'success' : 'default'} variant="outlined" />
                            </Box>
                          </Paper>
                        ))}
                      </Box>
                    )}
                  </CardContent>
                </Card>
              )}
            </Grid>
          </>
        )}
      </Grid>
    </Box>
  )
}
