import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  TextField, Chip, Divider, Switch, FormControlLabel, Accordion,
  AccordionSummary, AccordionDetails, Tooltip, LinearProgress,
} from '@mui/material'
import {
  AutoAwesomeOutlined, AddOutlined, SkipNextOutlined,
  ExpandMoreOutlined, CheckCircleOutlined, StorageOutlined,
} from '@mui/icons-material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TIDiscoveryResult, TransformationRule } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

const CATEGORY_COLORS: Record<string, string> = {
  DirectMapping: TEAL, LookupMapping: tokens.amber600, ConditionalRule: PURPLE,
  DefaultValue: '#64748B', Formula: tokens.sky600, DataValidation: tokens.emerald600,
  DataQualityRule: tokens.red600, ReferenceDataRule: '#8B5CF6',
}

interface Props { connId: number | null }

export default function AIDiscoveryTab({ connId }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [useKb, setUseKb]           = useState(true)
  const [maxRules, setMaxRules]     = useState(15)
  const [kbQuery, setKbQuery]       = useState('')
  const [result, setResult]         = useState<TIDiscoveryResult | null>(null)
  const [accepted, setAccepted]     = useState<Set<number>>(new Set())
  const [skipped, setSkipped]       = useState<Set<number>>(new Set())

  const discoverMut = useMutation({
    mutationFn: () => transformationApi.discoverRules({
      conn_id: connId!,
      use_knowledge: useKb,
      max_rules: maxRules,
    }),
    onSuccess: (data) => {
      setResult(data)
      setAccepted(new Set())
      setSkipped(new Set())
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const kbMut = useMutation({
    mutationFn: () => transformationApi.extractFromKb(kbQuery, connId ?? undefined, 8),
    onSuccess: (data) => {
      setResult(data)
      setAccepted(new Set())
      setSkipped(new Set())
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const approveMut = useMutation({
    mutationFn: ({ id, by }: { id: number; by: string }) => transformationApi.approveRule(id, by),
    onSuccess: (_, vars) => {
      setAccepted(s => new Set([...s, vars.id]))
      qc.invalidateQueries({ queryKey: ['ti-rules', connId] })
      qc.invalidateQueries({ queryKey: ['ti-readiness', connId] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const rules = result?.rules ?? []
  const pending = rules.filter(r => !accepted.has(r.id) && !skipped.has(r.id))

  return (
    <Box sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
        {/* Controls */}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, width: 300, flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <AutoAwesomeOutlined sx={{ fontSize: 16, color: PURPLE }} />
            <Typography variant="body2" fontWeight={700} sx={{ color: PURPLE }}>
              AI Rule Discovery
            </Typography>
          </Box>

          <Stack spacing={1.5}>
            <Box sx={{ p: 1.25, borderRadius: 1.5, bgcolor: alpha(TEAL, 0.04),
              border: 1, borderColor: alpha(TEAL, 0.2) }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <StorageOutlined sx={{ fontSize: 14, color: TEAL }} />
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: TEAL }}>
                  Schema Analysis
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', mt: 0.5 }}>
                Analyzes your source schema, sample data, and existing mappings to suggest rules.
              </Typography>
            </Box>

            <FormControlLabel
              control={<Switch checked={useKb} onChange={(e) => setUseKb(e.target.checked)} size="small" />}
              label={<Typography sx={{ fontSize: '0.75rem' }}>Include Knowledge Hub context</Typography>}
            />

            <TextField
              label="Max rules to generate"
              size="small" type="number"
              value={maxRules}
              onChange={(e) => setMaxRules(Math.min(50, Math.max(1, Number(e.target.value))))}
              inputProps={{ min: 1, max: 50 }}
            />

            <Button
              variant="contained" fullWidth
              startIcon={discoverMut.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeOutlined />}
              disabled={!connId || discoverMut.isPending}
              onClick={() => discoverMut.mutate()}
              sx={{ bgcolor: PURPLE, '&:hover': { bgcolor: '#7C3AED' } }}
            >
              {discoverMut.isPending ? 'Discovering…' : 'Discover from Schema'}
            </Button>

            <Divider><Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>OR</Typography></Divider>

            <TextField
              label="Knowledge Hub Query"
              size="small" fullWidth
              placeholder="e.g. Premium tier classification rules"
              value={kbQuery}
              onChange={(e) => setKbQuery(e.target.value)}
            />
            <Button
              variant="outlined" fullWidth
              startIcon={kbMut.isPending ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
              disabled={!kbQuery.trim() || kbMut.isPending}
              onClick={() => kbMut.mutate()}
            >
              {kbMut.isPending ? 'Extracting…' : 'Extract from Knowledge Hub'}
            </Button>
          </Stack>
        </Paper>

        {/* Results */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {(discoverMut.isPending || kbMut.isPending) && (
            <Box sx={{ p: 2 }}>
              <LinearProgress sx={{ mb: 1 }} />
              <Typography variant="caption" color="text.secondary">
                AI is analyzing your schema and generating transformation rules…
              </Typography>
            </Box>
          )}

          {result && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                <Typography variant="body2" fontWeight={700}>
                  {rules.length} rule{rules.length !== 1 ? 's' : ''} discovered
                </Typography>
                <Chip label={`${accepted.size} accepted`} size="small"
                  sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(tokens.emerald600, 0.12), color: tokens.emerald600 }} />
                <Chip label={`${skipped.size} skipped`} size="small"
                  sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha('#64748B', 0.12), color: '#64748B' }} />
                {result.kb_sources.length > 0 && (
                  <Chip label={`${result.kb_sources.length} KB sources`} size="small"
                    sx={{ height: 18, fontSize: '0.62rem', bgcolor: alpha(PURPLE, 0.12), color: PURPLE }} />
                )}
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', ml: 'auto' }}>
                  {result.tokens_in + result.tokens_out} tokens · {result.latency_ms}ms
                </Typography>
              </Box>

              <Stack spacing={1}>
                {rules.map((rule) => {
                  const isAccepted = accepted.has(rule.id)
                  const isSkipped  = skipped.has(rule.id)
                  const conf = rule.confidence_score ?? 0
                  const confColor = conf >= 0.7 ? tokens.emerald600 : conf >= 0.4 ? tokens.amber600 : tokens.red600
                  const catColor = CATEGORY_COLORS[rule.category] ?? '#64748B'

                  return (
                    <Accordion key={rule.id} variant="outlined" disableGutters
                      sx={{ borderRadius: '8px !important', '&:before': { display: 'none' },
                        opacity: isSkipped ? 0.5 : 1,
                        borderColor: isAccepted ? alpha(tokens.emerald600, 0.4) : undefined }}>
                      <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 16 }} />}
                        sx={{ minHeight: 48, '& .MuiAccordionSummary-content': { my: 0.75 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
                          {isAccepted && <CheckCircleOutlined sx={{ fontSize: 16, color: tokens.emerald600, flexShrink: 0 }} />}
                          <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, flex: 1, minWidth: 0,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {rule.rule_name}
                          </Typography>
                          <Chip label={rule.category} size="small"
                            sx={{ height: 16, fontSize: '0.58rem', bgcolor: alpha(catColor, 0.12), color: catColor }} />
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25,
                            borderRadius: 1, bgcolor: alpha(confColor, 0.1) }}>
                            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: confColor }}>
                              {Math.round(conf * 100)}%
                            </Typography>
                          </Box>
                          {!isAccepted && !isSkipped && (
                            <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                              <Tooltip title="Add to Rule Repository">
                                <Button size="small" variant="contained" color="success"
                                  startIcon={<AddOutlined sx={{ fontSize: 12 }} />}
                                  onClick={() => approveMut.mutate({ id: rule.id, by: 'discovery' })}
                                  sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75, minWidth: 0 }}>
                                  Accept
                                </Button>
                              </Tooltip>
                              <Tooltip title="Skip this rule">
                                <Button size="small" variant="outlined"
                                  startIcon={<SkipNextOutlined sx={{ fontSize: 12 }} />}
                                  onClick={() => setSkipped(s => new Set([...s, rule.id]))}
                                  sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75, minWidth: 0 }}>
                                  Skip
                                </Button>
                              </Tooltip>
                            </Box>
                          )}
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails sx={{ pt: 0, pb: 1.5 }}>
                        {rule.description && (
                          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 1 }}>
                            {rule.description}
                          </Typography>
                        )}
                        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                          {rule.source_column && (
                            <Box>
                              <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4 }}>Source</Typography>
                              <Typography sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: TEAL }}>
                                {rule.source_object ? `${rule.source_object}.` : ''}{rule.source_column}
                              </Typography>
                            </Box>
                          )}
                          {rule.target_path && (
                            <Box>
                              <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4 }}>Target</Typography>
                              <Typography sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: PURPLE }}>
                                {rule.target_path}
                              </Typography>
                            </Box>
                          )}
                          <Box>
                            <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4 }}>Stage</Typography>
                            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{rule.execution_stage}</Typography>
                          </Box>
                        </Box>
                        {rule.condition_json && (
                          <Box sx={{ mt: 1 }}>
                            <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.4 }}>Condition</Typography>
                            <Box component="pre" sx={{ m: 0, p: 0.75, bgcolor: alpha(PURPLE, 0.05), borderRadius: 1,
                              fontSize: '0.65rem', fontFamily: 'monospace', color: PURPLE, overflowX: 'auto' }}>
                              {rule.condition_json}
                            </Box>
                          </Box>
                        )}
                        {rule.transformation_json && (
                          <Box sx={{ mt: 1 }}>
                            <Typography sx={{ fontSize: '0.58rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.4 }}>Transformation</Typography>
                            <Box component="pre" sx={{ m: 0, p: 0.75, bgcolor: alpha(TEAL, 0.05), borderRadius: 1,
                              fontSize: '0.65rem', fontFamily: 'monospace', color: TEAL, overflowX: 'auto' }}>
                              {rule.transformation_json}
                            </Box>
                          </Box>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  )
                })}
              </Stack>
            </>
          )}

          {!result && !discoverMut.isPending && !kbMut.isPending && (
            <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
              Click <strong>Discover from Schema</strong> to let AI analyze your source schema and suggest
              transformation rules. Or enter a query to extract rules from your SAI Knowledge Hub.
            </Alert>
          )}
        </Box>
      </Box>
    </Box>
  )
}
