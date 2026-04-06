import { useState } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, Select,
  MenuItem, FormControl, InputLabel, TextField, Chip,
  Alert, Divider, List, ListItemButton, ListItemText,
  IconButton, Tooltip, alpha, CircularProgress,
} from '@mui/material'
import {
  PlayArrowOutlined, DownloadOutlined, ContentCopyOutlined,
  SendOutlined, VisibilityOutlined, VisibilityOffOutlined,
  CheckCircleOutlineOutlined, ArticleOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import ConnectionSelector from '@/components/common/ConnectionSelector'
import { mappingApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { SourceConnection } from '@/types'

export default function OutputTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const {
    generatedXml, setGeneratedXml,
    selectedIdentifier, setSelectedIdentifier,
  } = useAppStore()

  const [connId, setConnId] = useState<number | ''>('')
  const [apiUrl, setApiUrl] = useState('')
  const [apiMethod, setApiMethod] = useState('POST')
  const [contentType, setContentType] = useState('application/xml')
  const [bearerToken, setBearerToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [extraHeaders, setExtraHeaders] = useState('')
  const [apiResponse, setApiResponse] = useState<{ status: number; body: string; time: number } | null>(null)
  const [activeXmlId, setActiveXmlId] = useState<number | null>(null)

  const { data: identifiers = [] } = useQuery({
    queryKey: ['identifiers', connId],
    queryFn: () => mappingApi.identifierValues(connId as number),
    enabled: Boolean(connId),
    retry: false,          // don't retry on 404 (no query generated yet)
  })

  const { data: generatedXmls = [], refetch: refetchXmls } = useQuery({
    queryKey: ['generated-xml', connId],
    queryFn: () => mappingApi.listGeneratedXml(connId as number),
    enabled: Boolean(connId),
  })

  const genAllMutation = useMutation({
    mutationFn: () => mappingApi.generateAllXml(connId as number),
    onSuccess: (r) => {
      enqueueSnackbar(`Generated ${r.count} XML files`, { variant: 'success' })
      refetchXmls()
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const genOneMutation = useMutation({
    mutationFn: (id: string) => mappingApi.generateXml(connId as number, id),
    onSuccess: (r) => {
      setGeneratedXml(r.xml)
      refetchXmls()
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const loadXmlMutation = useMutation({
    mutationFn: (recordId: number) => mappingApi.getGeneratedXml(connId as number, recordId),
    onSuccess: (r) => {
      setGeneratedXml(r.xml_content)
      setSelectedIdentifier(r.identifier_value)
      setActiveXmlId(r.id)
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const sendApiMutation = useMutation({
    mutationFn: async () => {
      const headers: Record<string, string> = { 'Content-Type': contentType }
      if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`
      try {
        const extra = extraHeaders ? JSON.parse(extraHeaders) : {}
        Object.assign(headers, extra)
      } catch { /* ignore malformed extra headers */ }

      const start = Date.now()
      const res = await fetch(apiUrl, {
        method: apiMethod,
        headers,
        body: generatedXml,
      })
      const body = await res.text()
      return { status: res.status, body, time: Date.now() - start }
    },
    onSuccess: (r) => {
      setApiResponse(r)
      enqueueSnackbar(
        `API responded with ${r.status} in ${r.time}ms`,
        { variant: r.status < 300 ? 'success' : 'warning' },
      )
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const downloadXml = () => {
    if (!generatedXml) return
    const blob = new Blob([generatedXml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `output_${selectedIdentifier || 'all'}.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <ConnectionSelector
              value={connId}
              onChange={(_, id) => setConnId(id)}
              label="Connection"
            />

            <Button
              variant="contained"
              color="success"
              startIcon={genAllMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
              onClick={() => genAllMutation.mutate()}
              disabled={!connId || genAllMutation.isPending}
              sx={{ bgcolor: 'success.dark' }}
            >
              {genAllMutation.isPending ? 'Generating…' : 'Generate All XML'}
            </Button>

            {generatedXmls.length > 0 && (
              <Chip
                label={`${generatedXmls.length} generated`}
                color="success"
                variant="outlined"
                size="small"
                icon={<CheckCircleOutlineOutlined />}
              />
            )}

            {identifiers.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Preview Single Identifier</InputLabel>
                <Select
                  value={selectedIdentifier}
                  label="Preview Single Identifier"
                  onChange={(e) => {
                    setSelectedIdentifier(e.target.value)
                    genOneMutation.mutate(e.target.value)
                  }}
                >
                  {identifiers.map((id) => (
                    <MenuItem key={id} value={id}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        {/* Generated XML list */}
        {generatedXmls.length > 0 && (
          <Grid item xs={12} lg={2}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" fontWeight={700}>
                    Generated XMLs
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {generatedXmls.length} file{generatedXmls.length !== 1 ? 's' : ''}
                  </Typography>
                </Box>
                <List dense disablePadding sx={{ flex: 1, overflowY: 'auto', maxHeight: 500 }}>
                  {generatedXmls.map((rec) => (
                    <ListItemButton
                      key={rec.id}
                      selected={activeXmlId === rec.id}
                      onClick={() => loadXmlMutation.mutate(rec.id)}
                      sx={{ py: 0.75 }}
                    >
                      <ArticleOutlined sx={{ fontSize: 14, mr: 1, color: 'primary.main', flexShrink: 0 }} />
                      <ListItemText
                        primary={rec.identifier_value ?? `#${rec.id}`}
                        primaryTypographyProps={{ variant: 'caption', fontFamily: 'monospace', noWrap: true }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* XML Preview */}
        <Grid item xs={12} lg={generatedXmls.length > 0 ? 5 : 7}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2, pb: '8px !important', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
                <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
                  XML Preview
                </Typography>
                <Tooltip title="Copy XML">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!generatedXml}
                      onClick={() => {
                        navigator.clipboard.writeText(generatedXml)
                        enqueueSnackbar('XML copied', { variant: 'info' })
                      }}
                    >
                      <ContentCopyOutlined fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Download XML">
                  <span>
                    <IconButton size="small" disabled={!generatedXml} onClick={downloadXml}>
                      <DownloadOutlined fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>

              <Box
                sx={{
                  flex: 1, minHeight: 400,
                  bgcolor: (t) => t.palette.mode === 'dark' ? '#0f172a' : '#f8fafc',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: 2,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '0.813rem',
                  lineHeight: 1.7,
                  color: generatedXml ? 'text.primary' : 'text.disabled',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {generatedXml || '<!-- Select a connection and click Generate All XML -->\n<!-- Or select an identifier above to preview one record -->'}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Right: API Configuration */}
        <Grid item xs={12} lg={5}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                API Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Send the generated XML to an external API endpoint
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  label="Endpoint URL"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  fullWidth
                  placeholder="https://api.example.com/import"
                />

                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <FormControl fullWidth>
                      <InputLabel>Method</InputLabel>
                      <Select value={apiMethod} label="Method" onChange={(e) => setApiMethod(e.target.value)}>
                        {['POST', 'PUT', 'PATCH'].map((m) => (
                          <MenuItem key={m} value={m}>{m}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={6}>
                    <FormControl fullWidth>
                      <InputLabel>Content-Type</InputLabel>
                      <Select value={contentType} label="Content-Type" onChange={(e) => setContentType(e.target.value)}>
                        {['application/xml', 'text/xml', 'application/json'].map((t) => (
                          <MenuItem key={t} value={t}>{t}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>

                <TextField
                  label="Bearer Token"
                  type={showToken ? 'text' : 'password'}
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <IconButton size="small" onClick={() => setShowToken(!showToken)}>
                        {showToken ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                      </IconButton>
                    ),
                  }}
                />

                <TextField
                  label="Extra Headers (JSON)"
                  value={extraHeaders}
                  onChange={(e) => setExtraHeaders(e.target.value)}
                  multiline rows={2} fullWidth
                  placeholder='{"X-Client-Id": "123"}'
                  sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.813rem' } }}
                />

                <Button
                  variant="contained"
                  color="primary"
                  fullWidth
                  startIcon={sendApiMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <SendOutlined />}
                  onClick={() => sendApiMutation.mutate()}
                  disabled={!generatedXml || !apiUrl || sendApiMutation.isPending}
                  sx={{ py: 1.5 }}
                >
                  Send to API
                </Button>
              </Box>

              {/* API Response */}
              {apiResponse && (
                <Box sx={{ mt: 3 }}>
                  <Divider sx={{ mb: 2 }} />
                  <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
                    <Chip
                      label={`HTTP ${apiResponse.status}`}
                      color={apiResponse.status < 300 ? 'success' : 'error'}
                      size="small"
                    />
                    <Chip
                      label={`${apiResponse.time}ms`}
                      variant="outlined"
                      size="small"
                    />
                  </Box>
                  <Box
                    sx={{
                      p: 1.5, borderRadius: 2, maxHeight: 160, overflow: 'auto',
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.03),
                      border: '1px solid', borderColor: 'divider',
                      fontFamily: 'monospace', fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}
                  >
                    {apiResponse.body || '(empty response)'}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
