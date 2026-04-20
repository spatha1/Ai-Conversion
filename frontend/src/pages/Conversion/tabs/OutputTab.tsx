import { useState } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, Select,
  MenuItem, FormControl, InputLabel, Chip,
  List, ListItemButton, ListItemText,
  IconButton, Tooltip, CircularProgress,
} from '@mui/material'
import {
  PlayArrowOutlined, DownloadOutlined, ContentCopyOutlined,
  CheckCircleOutlineOutlined, ArticleOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { mappingApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'

const FORMAT_EXT: Record<string, string> = {
  xml:  '.xml',
  json: '.json',
  text: '.txt',
  sql:  '.sql',
}
const FORMAT_MIME: Record<string, string> = {
  xml:  'application/xml',
  json: 'application/json',
  text: 'text/plain',
  sql:  'text/plain',
}
const FORMAT_LABEL: Record<string, string> = {
  xml:  'XML',
  json: 'JSON',
  text: 'Text',
  sql:  'SQL',
}

export default function OutputTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const {
    generatedXml, setGeneratedXml,
    selectedIdentifier, setSelectedIdentifier,
    activeConnection, templateFormat,
  } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const fmt = templateFormat ?? 'xml'
  const fmtLabel = FORMAT_LABEL[fmt] ?? 'XML'
  const fmtExt   = FORMAT_EXT[fmt]   ?? '.xml'
  const fmtMime  = FORMAT_MIME[fmt]  ?? 'application/xml'

  const [activeXmlId, setActiveXmlId] = useState<number | null>(null)

  const { data: identifiers = [] } = useQuery({
    queryKey: ['identifiers', connId],
    queryFn: () => mappingApi.identifierValues(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })

  const { data: generatedXmls = [], refetch: refetchXmls } = useQuery({
    queryKey: ['generated-xml', connId],
    queryFn: () => mappingApi.listGeneratedXml(connId as number),
    enabled: Boolean(connId),
  })

  const genAllMutation = useMutation({
    mutationFn: () => mappingApi.generateAllXml(connId as number),
    onSuccess: (r) => {
      enqueueSnackbar(`Generated ${r.generated} ${fmtLabel} records`, { variant: 'success' })
      refetchXmls()
      qc.invalidateQueries({ queryKey: ['dispatch-xmls', connId] })
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

  const downloadOutput = () => {
    if (!generatedXml) return
    const blob = new Blob([generatedXml], { type: fmtMime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `output_${selectedIdentifier || 'all'}${fmtExt}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant="contained"
              color="success"
              startIcon={genAllMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
              onClick={() => genAllMutation.mutate()}
              disabled={!connId || genAllMutation.isPending}
              sx={{ bgcolor: 'success.dark' }}
            >
              {genAllMutation.isPending ? 'Generating…' : `Generate All ${fmtLabel}`}
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
        {/* Generated records list */}
        {generatedXmls.length > 0 && (
          <Grid item xs={12} lg={2}>
            <Card sx={{ height: '100%' }}>
              <CardContent sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" fontWeight={700}>
                    Generated {fmtLabel}
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

        {/* Output Preview */}
        <Grid item xs={12} lg={generatedXmls.length > 0 ? 10 : 12}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2, pb: '8px !important', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
                <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
                  {fmtLabel} Output Preview
                </Typography>
                <Tooltip title={`Copy ${fmtLabel}`}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={!generatedXml}
                      onClick={() => {
                        navigator.clipboard.writeText(generatedXml)
                        enqueueSnackbar(`${fmtLabel} copied`, { variant: 'info' })
                      }}
                    >
                      <ContentCopyOutlined fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={`Download ${fmtLabel}`}>
                  <span>
                    <IconButton size="small" disabled={!generatedXml} onClick={downloadOutput}>
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
                {generatedXml
                  || `<!-- Select a connection and click "Generate All ${fmtLabel}" -->\n<!-- Or select an identifier above to preview one record -->`}
              </Box>
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </Box>
  )
}
