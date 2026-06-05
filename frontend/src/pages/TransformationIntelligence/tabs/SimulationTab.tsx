import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  TextField, Chip, Accordion, AccordionSummary, AccordionDetails, Select,
  MenuItem, FormControl, InputLabel,
} from '@mui/material'
import {
  BiotechOutlined, PlayArrowOutlined, ExpandMoreOutlined,
  CheckCircleOutlined, ErrorOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TISimulationResult } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

interface Props { connId: number | null; selectedRuleId: number | null }

const SAMPLE_INPUT = JSON.stringify([
  { "PolicyNumber": "POL-001", "Premium": 15000, "PolicyType": "HO", "Status": "01" },
  { "PolicyNumber": "POL-002", "Premium": 5000,  "PolicyType": "HO", "Status": "02" },
], null, 2)

export default function SimulationTab({ connId, selectedRuleId }: Props) {
  const { enqueueSnackbar } = useSnackbar()

  const [ruleId, setRuleId]         = useState<number>(selectedRuleId ?? 0)
  const [inputJson, setInputJson]   = useState(SAMPLE_INPUT)
  const [result, setResult]         = useState<TISimulationResult | null>(null)
  const [jsonError, setJsonError]   = useState('')

  const { data: rulesResult } = useQuery({
    queryKey: ['ti-rules', connId, '', '', ''],
    queryFn: () => transformationApi.listRules({ conn_id: connId ?? undefined, is_active: true, limit: 100 }),
    enabled: connId != null,
  })
  const rules = rulesResult?.items ?? []

  const simMut = useMutation({
    mutationFn: () => {
      let records: Record<string, unknown>[]
      try {
        records = JSON.parse(inputJson)
        if (!Array.isArray(records)) records = [records]
        setJsonError('')
      } catch (e) {
        throw new Error('Invalid JSON input')
      }
      return transformationApi.simulate(ruleId, records, connId ?? undefined)
    },
    onSuccess: (data) => setResult(data),
    onError: (e: Error) => {
      if (e.message === 'Invalid JSON input') setJsonError(e.message)
      else enqueueSnackbar(e.message, { variant: 'error' })
    },
  })

  return (
    <Box sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
        {/* Input panel */}
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <BiotechOutlined sx={{ fontSize: 16, color: tokens.emerald600 }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: tokens.emerald600 }}>
                Simulation Input
              </Typography>
            </Box>
            <Stack spacing={1.5}>
              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontSize: '0.78rem' }}>Select Rule</InputLabel>
                <Select value={ruleId || ''} onChange={(e) => setRuleId(Number(e.target.value))} label="Select Rule"
                  sx={{ fontSize: '0.78rem' }}>
                  {rules.map(r => (
                    <MenuItem key={r.id} value={r.id} sx={{ fontSize: '0.78rem' }}>
                      {r.rule_name} (v{r.version})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Box>
                <Typography variant="caption" color="text.secondary"
                  sx={{ fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
                  Sample Records (JSON array)
                </Typography>
                <TextField
                  multiline minRows={10} maxRows={20} fullWidth size="small"
                  value={inputJson}
                  onChange={(e) => { setInputJson(e.target.value); setJsonError('') }}
                  error={!!jsonError}
                  helperText={jsonError || 'Enter a JSON array of record objects'}
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.7rem' } }}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc' } }}
                />
              </Box>
              <Button
                variant="contained" fullWidth
                startIcon={simMut.isPending ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlined />}
                disabled={!ruleId || simMut.isPending}
                onClick={() => simMut.mutate()}
                sx={{ bgcolor: tokens.emerald600, '&:hover': { bgcolor: '#059669' } }}
              >
                {simMut.isPending ? 'Running…' : 'Run Simulation'}
              </Button>
            </Stack>
          </Paper>
        </Box>

        {/* Output panel */}
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          {result && (
            <Stack spacing={1.5}>
              {/* Summary */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                {result.passed
                  ? <CheckCircleOutlined sx={{ fontSize: 18, color: tokens.emerald600 }} />
                  : <ErrorOutlined sx={{ fontSize: 18, color: tokens.red600 }} />
                }
                <Typography variant="body2" fontWeight={700}
                  sx={{ color: result.passed ? tokens.emerald600 : tokens.red600 }}>
                  {result.passed ? 'Simulation passed' : 'Simulation failed'}
                </Typography>
                <Chip label={`${result.output_records.length} records`} size="small"
                  sx={{ height: 18, fontSize: '0.62rem' }} />
              </Box>
              {result.error && (
                <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{result.error}</Alert>
              )}

              {/* Output records */}
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 1.5, py: 1, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                    sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Output Records
                  </Typography>
                </Box>
                <Box component="pre" sx={{ m: 0, p: 1.5, fontSize: '0.7rem', fontFamily: 'monospace',
                  color: TEAL, overflowX: 'auto', maxHeight: 300, overflow: 'auto',
                  bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc' }}>
                  {JSON.stringify(result.output_records, null, 2)}
                </Box>
              </Paper>

              {/* Step trace */}
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 1.5, py: 1, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                    sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Step-by-Step Trace ({result.trace.length} steps)
                  </Typography>
                </Box>
                <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                  {result.trace.map((step, i) => (
                    <Accordion key={i} disableGutters elevation={0}
                      sx={{ '&:before': { display: 'none' }, borderBottom: 1, borderColor: 'divider' }}>
                      <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 14 }} />}
                        sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip label={`Step ${step.step}`} size="small"
                            sx={{ height: 16, fontSize: '0.6rem' }} />
                          {step.matched
                            ? <CheckCircleOutlined sx={{ fontSize: 13, color: tokens.emerald600 }} />
                            : <ErrorOutlined sx={{ fontSize: 13, color: '#94A3B8' }} />}
                          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                            {step.description}
                          </Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails sx={{ pt: 0.5, pb: 1.5, px: 2 }}>
                        <Box sx={{ display: 'flex', gap: 2 }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.3 }}>Input</Typography>
                            <Box component="pre" sx={{ m: 0, p: 0.75, bgcolor: alpha(PURPLE, 0.04), borderRadius: 1,
                              fontSize: '0.62rem', fontFamily: 'monospace', color: PURPLE, overflowX: 'auto' }}>
                              {JSON.stringify(step.input_value, null, 1)}
                            </Box>
                          </Box>
                          <Box sx={{ flex: 1 }}>
                            <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.3 }}>Output</Typography>
                            <Box component="pre" sx={{ m: 0, p: 0.75, bgcolor: alpha(TEAL, 0.04), borderRadius: 1,
                              fontSize: '0.62rem', fontFamily: 'monospace', color: TEAL, overflowX: 'auto' }}>
                              {JSON.stringify(step.output_value, null, 1)}
                            </Box>
                          </Box>
                        </Box>
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Box>
              </Paper>
            </Stack>
          )}

          {!result && !simMut.isPending && (
            <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
              Select a rule, enter sample records as a JSON array, then click <strong>Run Simulation</strong>
              to see the transformation trace.
            </Alert>
          )}
          {simMut.isPending && (
            <Box sx={{ p: 2, display: 'flex', gap: 1.5, alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Running simulation…</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}
