import { useState } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, IconButton,
  TextField, Select, MenuItem, FormControl, InputLabel, Checkbox,
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Alert, Divider, alpha, CircularProgress,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, SaveOutlined, SchemaOutlined,
  PlayArrowOutlined, DownloadOutlined, CheckCircleOutlineOutlined,
  ErrorOutlineOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useId, useEffect } from 'react'
import ConnectionSelector from '@/components/common/ConnectionSelector'
import { validationApi, targetApi } from '@/api'
import type { ValidationRule } from '@/types'

export default function ValidationTab() {
  const { enqueueSnackbar } = useSnackbar()
  const uid = useId()
  const qc = useQueryClient()
  const [connId, setConnId] = useState<number | ''>('')
  const [rules, setRules] = useState<ValidationRule[]>([])
  const [xsdContent, setXsdContent] = useState('')
  const [validationResult, setValidationResult] = useState<{
    valid: boolean; total: number; failed: number;
    errors: Array<{ identifier: string; path: string; message: string }>
  } | null>(null)

  // Load saved rules when connection selected
  const { data: savedRules } = useQuery({
    queryKey: ['validation-rules', connId],
    queryFn: () => validationApi.getRules(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })
  useEffect(() => {
    if (savedRules?.length && rules.length === 0) {
      setRules(savedRules.map((r, i) => ({ ...r, id: `saved-${i}` })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRules])

  const importPaths = useMutation({
    mutationFn: () => targetApi.list(connId as number),
    onSuccess: (formulas) => {
      setRules(
        formulas.map((f, i) => ({
          id: `${uid}-${i}`,
          xml_path: f.target_path ?? '',
          is_required: false,
          data_type: 'string',
        })),
      )
      enqueueSnackbar(`${formulas.length} paths imported`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveMutation = useMutation({
    mutationFn: () => validationApi.saveRules(connId as number, rules),
    onSuccess: () => {
      enqueueSnackbar('Rules saved', { variant: 'success' })
      qc.invalidateQueries({ queryKey: ['validation-rules', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const genXsdMutation = useMutation({
    mutationFn: () => validationApi.generateXsd(connId as number),
    onSuccess: (r) => {
      setXsdContent(r.xsd)
      enqueueSnackbar('XSD generated', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const runValidation = useMutation({
    mutationFn: () => validationApi.runValidation(connId as number),
    onSuccess: (r) => {
      setValidationResult(r)
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const addRow = () => {
    setRules([...rules, { id: `${uid}-${Date.now()}`, xml_path: '', data_type: 'string' }])
  }

  const updateRule = (id: string, field: keyof ValidationRule, value: unknown) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  }

  const deleteRule = (id: string) => setRules(rules.filter((r) => r.id !== id))

  const downloadXsd = () => {
    if (!xsdContent) return
    const blob = new Blob([xsdContent], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'schema.xsd'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Toolbar */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <ConnectionSelector
              value={connId}
              onChange={(_, id) => { setConnId(id); setRules([]); setXsdContent(''); setValidationResult(null) }}
            />
            <Button
              variant="outlined"
              startIcon={<SchemaOutlined />}
              onClick={() => importPaths.mutate()}
              disabled={!connId || importPaths.isPending}
            >
              Import Paths from Template
            </Button>
            <Button
              variant="outlined"
              startIcon={<AddOutlined />}
              onClick={addRow}
            >
              Add Rule
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveOutlined />}
              onClick={() => saveMutation.mutate()}
              disabled={!connId || saveMutation.isPending}
              sx={{ ml: 'auto' }}
            >
              Save Rules
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        {/* Left: Rule editor */}
        <Grid item xs={12} xl={8}>
          <Card>
            <CardContent sx={{ p: 0 }}>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="h6" fontWeight={700}>
                  Validation Rules
                  {rules.length > 0 && <Chip label={rules.length} size="small" sx={{ ml: 1 }} />}
                </Typography>
              </Box>
              <Divider />
              <Box sx={{ overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>XML Path</TableCell>
                      <TableCell align="center">Required</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>Min Len</TableCell>
                      <TableCell>Max Len</TableCell>
                      <TableCell>Pattern (regex)</TableCell>
                      <TableCell>Min Val</TableCell>
                      <TableCell>Max Val</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rules.map((rule) => (
                      <TableRow key={rule.id} hover>
                        <TableCell>
                          <TextField
                            value={rule.xml_path}
                            onChange={(e) => updateRule(rule.id!, 'xml_path', e.target.value)}
                            size="small" variant="standard"
                            sx={{ minWidth: 160, '& input': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Checkbox
                            size="small"
                            checked={rule.is_required ?? false}
                            onChange={(e) => updateRule(rule.id!, 'is_required', e.target.checked)}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={rule.data_type ?? 'string'}
                            onChange={(e) => updateRule(rule.id!, 'data_type', e.target.value)}
                            size="small" variant="standard" sx={{ minWidth: 90 }}
                          >
                            {['string', 'integer', 'decimal', 'date', 'boolean'].map((t) => (
                              <MenuItem key={t} value={t}>{t}</MenuItem>
                            ))}
                          </Select>
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number" value={rule.min_length ?? ''}
                            onChange={(e) => updateRule(rule.id!, 'min_length', Number(e.target.value))}
                            size="small" variant="standard" sx={{ width: 60 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number" value={rule.max_length ?? ''}
                            onChange={(e) => updateRule(rule.id!, 'max_length', Number(e.target.value))}
                            size="small" variant="standard" sx={{ width: 60 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            value={rule.pattern ?? ''}
                            onChange={(e) => updateRule(rule.id!, 'pattern', e.target.value)}
                            size="small" variant="standard"
                            sx={{ minWidth: 120, '& input': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number" value={rule.min_value ?? ''}
                            onChange={(e) => updateRule(rule.id!, 'min_value', Number(e.target.value))}
                            size="small" variant="standard" sx={{ width: 60 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number" value={rule.max_value ?? ''}
                            onChange={(e) => updateRule(rule.id!, 'max_value', Number(e.target.value))}
                            size="small" variant="standard" sx={{ width: 60 }}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" color="error" onClick={() => deleteRule(rule.id!)}>
                            <DeleteOutlined fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                    {rules.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} align="center" sx={{ py: 6, color: 'text.disabled' }}>
                          No validation rules. Import paths from template or add rows manually.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Right: XSD + Results */}
        <Grid item xs={12} xl={4}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* XSD Card */}
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={700} gutterBottom>
                  XSD Schema
                </Typography>
                <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
                  <Button
                    variant="outlined"
                    startIcon={<SchemaOutlined />}
                    onClick={() => genXsdMutation.mutate()}
                    disabled={!connId || genXsdMutation.isPending}
                    fullWidth
                  >
                    Generate XSD
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<DownloadOutlined />}
                    onClick={downloadXsd}
                    disabled={!xsdContent}
                  >
                    Download
                  </Button>
                </Box>
                {xsdContent && (
                  <Box
                    sx={{
                      p: 1.5, borderRadius: 2, maxHeight: 200, overflow: 'auto',
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
                      border: '1px solid', borderColor: 'divider',
                      fontFamily: 'monospace', fontSize: '0.75rem',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {xsdContent}
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Validation Results */}
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="h6" fontWeight={700}>Validation Results</Typography>
                  {validationResult && (
                    <Chip
                      label={validationResult.valid ? 'All Valid' : `${validationResult.failed} Errors`}
                      color={validationResult.valid ? 'success' : 'error'}
                      size="small"
                      icon={validationResult.valid ? <CheckCircleOutlineOutlined /> : <ErrorOutlineOutlined />}
                    />
                  )}
                </Box>
                <Button
                  variant="contained"
                  fullWidth
                  startIcon={runValidation.isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
                  onClick={() => runValidation.mutate()}
                  disabled={!connId || runValidation.isPending}
                  color={validationResult?.valid ? 'success' : 'primary'}
                >
                  Run Validation
                </Button>
                {validationResult && validationResult.errors.length > 0 && (
                  <Box sx={{ mt: 2, maxHeight: 240, overflow: 'auto' }}>
                    {validationResult.errors.map((err, i) => (
                      <Alert
                        key={i}
                        severity="error"
                        sx={{ mb: 1, py: 0.5, borderRadius: 2 }}
                      >
                        <Typography variant="caption" display="block" fontWeight={600}>
                          {err.identifier}
                        </Typography>
                        <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                          {err.path}: {err.message}
                        </Typography>
                      </Alert>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Box>
        </Grid>
      </Grid>
    </Box>
  )
}
