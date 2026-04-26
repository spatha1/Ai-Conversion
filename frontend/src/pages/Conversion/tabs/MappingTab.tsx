import { useState, useId, useEffect, useRef } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, IconButton,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Alert, Paper, Tooltip, LinearProgress, Divider,
  Collapse, alpha, CircularProgress,
} from '@mui/material'
import {
  AutoAwesomeOutlined, AddOutlined, DeleteOutlined,
  SaveOutlined, CodeOutlined, ExpandMoreOutlined,
  ExpandLessOutlined, ArrowForwardOutlined, ContentCopyOutlined,
  PreviewOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { mappingApi } from '@/api'
import type { MappingRow, DebugPayload } from '@/types'
import DebugStepsPanel from '@/components/ai/DebugStepsPanel'

function ConfidenceBadge({ value }: { value?: number }) {
  if (value == null) return <Chip label="Manual" size="small" variant="outlined" />
  const color = value >= 80 ? 'success' : value >= 55 ? 'warning' : 'error'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <LinearProgress
        variant="determinate"
        value={value}
        color={color}
        sx={{ width: 48, height: 6, borderRadius: 3 }}
      />
      <Typography variant="caption" fontWeight={600}>{value}%</Typography>
    </Box>
  )
}

export default function MappingTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const uid = useId()
  const {
    mappingRows, setMappingRows,
    generatedSql, setGeneratedSql,
    sourceSheets, xmlPaths,
    setConversionTab,
  } = useAppStore()

  const { activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''
  const prevConnIdRef = useRef<number | ''>(connId)
  const [identifierCol, setIdentifierCol] = useState('')
  const [sqlExpanded, setSqlExpanded] = useState(true)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [debugPayload, setDebugPayload] = useState<DebugPayload | null>(null)
  const [mappingOpen, setMappingOpen] = useState(true)
  const [previewData, setPreviewData] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)

  const allColumns = sourceSheets.flatMap((s) =>
    s.columns.map((c) => ({ sheet: s.name, column: c })),
  )

  // Load saved mapping + SQL query when connection selected
  const { data: savedMapping } = useQuery({
    queryKey: ['mapping', connId],
    queryFn: () => mappingApi.get(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })
  const { data: savedQuery } = useQuery({
    queryKey: ['mapping-query', connId],
    queryFn: () => mappingApi.getQuery(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })

  // Reset local state whenever the active connection changes
  useEffect(() => {
    if (prevConnIdRef.current !== connId) {
      prevConnIdRef.current = connId
      setMappingRows([])
      setGeneratedSql('')
      setIdentifierCol('')
      setPreviewData(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId])

  useEffect(() => {
    if (!savedMapping) return
    if (savedMapping.rows?.length && mappingRows.length === 0) {
      setMappingRows(
        savedMapping.rows.map((row, i) => ({
          id: `saved-${i}`,
          source_sheet: row.source_sheet,
          source_column: row.source_column,
          transform: row.transform,
          target_path: row.target_path,
          confidence: row.confidence,
        })),
      )
    }
    if (savedMapping.identifier_column && !identifierCol) {
      setIdentifierCol(savedMapping.identifier_column)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMapping])

  useEffect(() => {
    if (savedQuery?.query_sql) {
      setGeneratedSql(savedQuery.query_sql)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedQuery])

  const genQueryMutation = useMutation({
    mutationFn: () => mappingApi.generateQuery(connId as number),
    onSuccess: (r) => {
      setGeneratedSql(r.query_sql)
      setSqlExpanded(true)
      if (r.identifier_column) setIdentifierCol(r.identifier_column)
      setDebugPayload(r.debug ?? null)
      enqueueSnackbar('SQL query generated', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const previewMutation = useMutation({
    mutationFn: () => mappingApi.previewQuery(connId as number, generatedSql || undefined),
    onSuccess: (r) => {
      setPreviewData({ columns: r.columns, rows: r.rows })
      setPreviewExpanded(true)
      enqueueSnackbar(`${r.row_count} rows fetched`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const genMappingMutation = useMutation({
    mutationFn: () => mappingApi.generateRows(connId as number),
    onSuccess: (r) => {
      setMappingRows(
        r.rows.map((row, i) => ({
          id: `ai-${i}`,
          source_sheet: row.source_sheet,
          source_column: row.source_column,
          transform: row.transform,
          target_path: row.target_path,
          confidence: row.confidence,
        })),
      )
      enqueueSnackbar(`${r.rows.length} mappings generated`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveQueryMutation = useMutation({
    mutationFn: () => mappingApi.saveQuery(connId as number, generatedSql),
    onSuccess: () => {
      // Update the React Query cache immediately so stale data never re-overwrites the textarea
      qc.setQueryData(['mapping-query', connId], (old: Record<string, unknown> | undefined) =>
        old ? { ...old, query_sql: generatedSql } : old,
      )
      enqueueSnackbar('Query saved', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      mappingApi.save({
        conn_id: connId as number,
        identifier_column: identifierCol || undefined,
        query_sql: generatedSql || undefined,
        rows: mappingRows,
      }),
    onSuccess: () => {
      if (generatedSql) {
        qc.setQueryData(['mapping-query', connId], (old: Record<string, unknown> | undefined) =>
          old ? { ...old, query_sql: generatedSql } : old,
        )
      }
      enqueueSnackbar('Mapping saved', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const addRow = () => {
    setMappingRows([
      ...mappingRows,
      { id: `${uid}-${Date.now()}`, source_sheet: '', source_column: '', target_path: '' },
    ])
  }

  const updateRow = (id: string, field: keyof MappingRow, value: string) => {
    setMappingRows(
      mappingRows.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
    )
  }

  const deleteRow = (id: string) => {
    setMappingRows(mappingRows.filter((r) => r.id !== id))
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Step bar */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<AutoAwesomeOutlined />}
                onClick={() => genQueryMutation.mutate()}
                disabled={!connId || genQueryMutation.isPending}
              >
                {genQueryMutation.isPending ? 'Generating…' : 'Step 1: Generate Query'}
              </Button>
            </Grid>
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<AutoAwesomeOutlined />}
                onClick={() => genMappingMutation.mutate()}
                disabled={!connId || genMappingMutation.isPending}
              >
                {genMappingMutation.isPending ? 'Mapping…' : 'Step 2: AI Map Fields'}
              </Button>
            </Grid>
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                color="info"
                startIcon={previewMutation.isPending ? <CircularProgress size={16} /> : <PreviewOutlined />}
                onClick={() => previewMutation.mutate()}
                disabled={!connId || !generatedSql || previewMutation.isPending}
              >
                {previewMutation.isPending ? 'Loading…' : 'Preview Data'}
              </Button>
            </Grid>
            <Grid item xs={12} sm="auto">
              <Button
                variant="outlined"
                startIcon={<AddOutlined />}
                onClick={addRow}
              >
                Add Row
              </Button>
            </Grid>
            <Grid item xs={12} sm="auto" sx={{ ml: 'auto' }}>
              <Button
                variant="contained"
                startIcon={<SaveOutlined />}
                onClick={() => saveMutation.mutate()}
                disabled={!connId || mappingRows.length === 0 || saveMutation.isPending}
              >
                Save Mapping
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Identifier column — always shown when a connection is selected */}
      {connId !== '' && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              Identifier Column:
            </Typography>
            {allColumns.length > 0 ? (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Column</InputLabel>
                <Select
                  value={identifierCol}
                  label="Column"
                  onChange={(e) => setIdentifierCol(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {allColumns.map(({ sheet, column }) => (
                    <MenuItem key={`${sheet}.${column}`} value={column}>
                      {sheet} · {column}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <TextField
                size="small"
                label="Column name"
                value={identifierCol}
                onChange={(e) => setIdentifierCol(e.target.value)}
                placeholder="e.g. EMPNO"
                sx={{ minWidth: 180 }}
                helperText="Auto-filled when you Generate Query"
              />
            )}
            <Typography variant="caption" color="text.secondary">
              One XML file will be generated per unique value of this column
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Generated SQL — always visible when a connection is selected */}
      {connId !== '' && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 0 }}>
            <Box
              sx={{
                display: 'flex', alignItems: 'center', px: 2, py: 1.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
              onClick={() => setSqlExpanded(!sqlExpanded)}
            >
              <CodeOutlined sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                SQL Query
                {!generatedSql && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    (paste or type manually, or use Step 1 to generate)
                  </Typography>
                )}
              </Typography>
              {generatedSql && (
                <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                  <Tooltip title="Copy SQL">
                    <IconButton
                      size="small"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedSql)
                        enqueueSnackbar('SQL copied', { variant: 'info' })
                      }}
                    >
                      <ContentCopyOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Save edited SQL">
                    <IconButton
                      size="small"
                      color="primary"
                      disabled={saveQueryMutation.isPending || !connId}
                      onClick={() => saveQueryMutation.mutate()}
                    >
                      <SaveOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
              {sqlExpanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            </Box>
            <Collapse in={sqlExpanded}>
              <Divider />
              <TextField
                value={generatedSql}
                onChange={(e) => setGeneratedSql(e.target.value)}
                multiline
                fullWidth
                minRows={4}
                placeholder="Paste or type your SQL query here…"
                sx={{
                  '& .MuiInputBase-root': {
                    fontFamily: 'monospace',
                    fontSize: '0.813rem',
                    bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
                  },
                  '& fieldset': { border: 'none' },
                }}
              />
            </Collapse>
          </CardContent>
        </Card>
      )}

      {debugPayload && (
        <DebugStepsPanel debug={debugPayload} module="mapping" />
      )}

      {/* Preview Data */}
      {previewData && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ p: 0 }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
              onClick={() => setPreviewExpanded(!previewExpanded)}
            >
              <PreviewOutlined sx={{ mr: 1, color: 'info.main' }} />
              <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                Data Preview
                <Chip label={`${previewData.rows.length} rows`} size="small" sx={{ ml: 1 }} />
              </Typography>
              {previewExpanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}
            </Box>
            <Collapse in={previewExpanded}>
              <Divider />
              <Box sx={{ overflow: 'auto', maxHeight: 300 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      {previewData.columns.map((col) => (
                        <TableCell key={col} sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                          {col}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previewData.rows.slice(0, 20).map((row, i) => (
                      <TableRow key={i} hover>
                        {previewData.columns.map((col) => (
                          <TableCell key={col} sx={{ fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                            {row[col] == null ? <em style={{ color: '#94a3b8' }}>null</em> : String(row[col])}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </CardContent>
        </Card>
      )}

      {/* Mapping table */}
      <Card>
        <CardContent sx={{ p: 0 }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, cursor: 'pointer' }}
            onClick={() => setMappingOpen(v => !v)}
          >
            {mappingOpen ? <ExpandLessOutlined sx={{ mr: 1, color: 'text.secondary' }} /> : <ExpandMoreOutlined sx={{ mr: 1, color: 'text.secondary' }} />}
            <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
              Field Mappings
              {mappingRows.length > 0 && (
                <Chip label={mappingRows.length} size="small" sx={{ ml: 1 }} />
              )}
            </Typography>
          </Box>
          <Collapse in={mappingOpen}>
          <Divider />

          {mappingRows.length === 0 ? (
            <Box sx={{ py: 8, textAlign: 'center' }}>
              <ArrowForwardOutlined sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body1" color="text.secondary" fontWeight={500}>
                No mappings yet
              </Typography>
              <Typography variant="body2" color="text.disabled">
                Select a connection and use AI Generate, or click "Add Row" manually
              </Typography>
            </Box>
          ) : (
            <Box sx={{ overflow: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Source Sheet</TableCell>
                    <TableCell>Source Column</TableCell>
                    <TableCell>Transform</TableCell>
                    <TableCell sx={{ textAlign: 'center' }}>→</TableCell>
                    <TableCell>Target XML Path</TableCell>
                    <TableCell>Confidence</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mappingRows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <TextField
                          value={row.source_sheet ?? ''}
                          onChange={(e) => updateRow(row.id!, 'source_sheet', e.target.value)}
                          size="small"
                          variant="standard"
                          placeholder="Sheet"
                          sx={{ minWidth: 100 }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          value={row.source_column ?? ''}
                          onChange={(e) => updateRow(row.id!, 'source_column', e.target.value)}
                          size="small"
                          variant="standard"
                          placeholder="Column"
                          sx={{ minWidth: 120 }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          value={row.transform ?? ''}
                          onChange={(e) => updateRow(row.id!, 'transform', e.target.value)}
                          size="small"
                          variant="standard"
                          placeholder="UPPER({col})"
                          sx={{ minWidth: 140, fontFamily: 'monospace' }}
                        />
                      </TableCell>
                      <TableCell sx={{ textAlign: 'center' }}>
                        <ArrowForwardOutlined fontSize="small" color="disabled" />
                      </TableCell>
                      <TableCell>
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                          <Select
                            value={row.target_path ?? ''}
                            onChange={(e) => updateRow(row.id!, 'target_path', e.target.value)}
                            variant="standard"
                            displayEmpty
                            renderValue={(v) => v || <em style={{ color: '#94a3b8' }}>Select path…</em>}
                          >
                            {xmlPaths.map((p) => (
                              <MenuItem key={p} value={p}>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{p}</Typography>
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </TableCell>
                      <TableCell>
                        <ConfidenceBadge value={row.confidence} />
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => deleteRow(row.id!)}
                        >
                          <DeleteOutlined fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
          </Collapse>
        </CardContent>
      </Card>

      {mappingRows.length > 0 && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            onClick={() => setConversionTab(3)}
            endIcon={<ArrowForwardOutlined />}
          >
            Next: Generate XML
          </Button>
        </Box>
      )}
    </Box>
  )
}
