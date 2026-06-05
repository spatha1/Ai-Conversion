import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  Table, TableHead, TableRow, TableCell, TableBody, Chip, TextField,
  Select, MenuItem, FormControl, InputLabel, Divider,
} from '@mui/material'
import {
  TableChartOutlined, SearchOutlined, WarningAmberOutlined, ContentCopyOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TILookupResult } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

interface Props { connId: number | null }

export default function LookupIntelligenceTab({ connId }: Props) {
  const { enqueueSnackbar } = useSnackbar()

  const [tableName, setTableName]   = useState('')
  const [columnName, setColumnName] = useState('')
  const [result, setResult]         = useState<TILookupResult | null>(null)

  const { data: catalogCols } = useQuery({
    queryKey: ['ti-catalog-cols', connId],
    queryFn: async () => {
      const r = await transformationApi.listRules({ conn_id: connId!, limit: 1 })
      return []
    },
    enabled: false,
  })

  const lookupMut = useMutation({
    mutationFn: () => transformationApi.lookupIntelligence(connId!, tableName, columnName),
    onSuccess: (data) => setResult(data),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(
      () => enqueueSnackbar('Copied', { variant: 'success', autoHideDuration: 1200 }),
      () => enqueueSnackbar('Copy failed', { variant: 'error' }),
    )
  }

  return (
    <Box sx={{ p: 2.5 }}>
      {/* Controls */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <TableChartOutlined sx={{ fontSize: 16, color: tokens.amber600 }} />
          <Typography variant="body2" fontWeight={700} sx={{ color: tokens.amber600 }}>
            Lookup / Dropdown Mapping Intelligence
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField label="Table Name" size="small" sx={{ width: 200 }}
            value={tableName} onChange={(e) => setTableName(e.target.value)}
            placeholder="e.g. POLICY_HEADER" />
          <TextField label="Column Name" size="small" sx={{ width: 200 }}
            value={columnName} onChange={(e) => setColumnName(e.target.value)}
            placeholder="e.g. STATUS_CODE" />
          <Button
            variant="contained" size="small"
            startIcon={lookupMut.isPending ? <CircularProgress size={12} color="inherit" /> : <SearchOutlined />}
            disabled={!connId || !tableName || !columnName || lookupMut.isPending}
            onClick={() => lookupMut.mutate()}
            sx={{ bgcolor: tokens.amber600, '&:hover': { bgcolor: '#D97706' } }}
          >
            {lookupMut.isPending ? 'Analyzing…' : 'Analyze Values'}
          </Button>
        </Box>
      </Paper>

      {result && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {/* Left: Suggestions */}
          <Box sx={{ flex: '2 1 300px', minWidth: 0 }}>
            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
              <Chip label={`${result.suggestions.length} mappings`} size="small"
                sx={{ height: 20, fontSize: '0.62rem' }} />
              {result.unmapped_values.length > 0 && (
                <Chip label={`${result.unmapped_values.length} unmapped`} size="small" icon={<WarningAmberOutlined sx={{ fontSize: '12px !important' }} />}
                  sx={{ height: 20, fontSize: '0.62rem', bgcolor: alpha(tokens.amber600, 0.12), color: tokens.amber600 }} />
              )}
              {result.conflicts.length > 0 && (
                <Chip label={`${result.conflicts.length} conflicts`} size="small"
                  sx={{ height: 20, fontSize: '0.62rem', bgcolor: alpha(tokens.red600, 0.12), color: tokens.red600 }} />
              )}
            </Box>

            <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 1.5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Source Value</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Target Value</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Type</TableCell>
                    <TableCell sx={{ fontSize: '0.68rem', fontWeight: 700 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.suggestions.map((m, i) => (
                    <TableRow key={i} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{m.source_value}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', fontFamily: 'monospace', color: TEAL }}>
                        {m.target_value || <Typography sx={{ fontSize: '0.68rem', color: tokens.amber600, fontStyle: 'italic' }}>unmapped</Typography>}
                      </TableCell>
                      <TableCell>
                        <Chip label={m.mapping_type} size="small"
                          sx={{ height: 16, fontSize: '0.6rem' }} />
                      </TableCell>
                      <TableCell>
                        <Chip label={m.status} size="small"
                          sx={{ height: 16, fontSize: '0.6rem',
                            bgcolor: m.status === 'approved' ? alpha(tokens.emerald600, 0.12) : alpha(tokens.amber600, 0.12),
                            color: m.status === 'approved' ? tokens.emerald600 : tokens.amber600 }} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>

            {/* Unmapped values */}
            {result.unmapped_values.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 1.5,
                borderColor: alpha(tokens.amber600, 0.3) }}>
                <Typography variant="caption" fontWeight={700}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75, color: tokens.amber600,
                    fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <WarningAmberOutlined sx={{ fontSize: 14 }} /> Unmapped Values
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {result.unmapped_values.map((v, i) => (
                    <Chip key={i} label={v} size="small"
                      sx={{ height: 20, fontSize: '0.65rem', fontFamily: 'monospace',
                        bgcolor: alpha(tokens.amber600, 0.1), color: tokens.amber600 }} />
                  ))}
                </Box>
              </Paper>
            )}

            {/* Conflicts */}
            {result.conflicts.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2,
                borderColor: alpha(tokens.red600, 0.3) }}>
                <Typography variant="caption" fontWeight={700}
                  sx={{ display: 'block', mb: 0.75, color: tokens.red600,
                    fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Conflicting Mappings
                </Typography>
                <Stack spacing={0.75}>
                  {result.conflicts.map((c, i) => (
                    <Box key={i} sx={{ p: 0.75, borderRadius: 1, bgcolor: alpha(tokens.red600, 0.05) }}>
                      <Typography sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: tokens.red600, mb: 0.25 }}>
                        '{c.source_value}' maps to multiple targets:
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {c.mappings.map((m, j) => (
                          <Chip key={j} label={m.target_value || 'null'} size="small"
                            sx={{ height: 16, fontSize: '0.6rem', fontFamily: 'monospace' }} />
                        ))}
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </Paper>
            )}
          </Box>

          {/* Right: Generated outputs */}
          <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
            {result.case_statement && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                    sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    SQL CASE Statement
                  </Typography>
                  <Button size="small" startIcon={<ContentCopyOutlined sx={{ fontSize: 12 }} />}
                    onClick={() => copyToClipboard(result.case_statement!)}
                    sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75, minWidth: 0 }}>
                    Copy
                  </Button>
                </Box>
                <Box component="pre" sx={{ m: 0, p: 1, bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc',
                  borderRadius: 1, fontSize: '0.68rem', fontFamily: 'monospace', color: TEAL,
                  overflowX: 'auto', border: 1, borderColor: 'divider' }}>
                  {result.case_statement}
                </Box>
              </Paper>
            )}

            {Object.keys(result.python_lookup).length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                    sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Python Lookup Dict
                  </Typography>
                  <Button size="small" startIcon={<ContentCopyOutlined sx={{ fontSize: 12 }} />}
                    onClick={() => copyToClipboard(JSON.stringify(result.python_lookup, null, 2))}
                    sx={{ fontSize: '0.65rem', py: 0.25, px: 0.75, minWidth: 0 }}>
                    Copy
                  </Button>
                </Box>
                <Box component="pre" sx={{ m: 0, p: 1, bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc',
                  borderRadius: 1, fontSize: '0.68rem', fontFamily: 'monospace', color: PURPLE,
                  overflowX: 'auto', border: 1, borderColor: 'divider', maxHeight: 300, overflow: 'auto' }}>
                  {JSON.stringify(result.python_lookup, null, 2)}
                </Box>
              </Paper>
            )}
          </Box>
        </Box>
      )}

      {!result && !lookupMut.isPending && (
        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
          Enter a table name and column name to analyze its value mappings.
          The system will detect unmapped values, conflicts, and generate SQL CASE statements and Python lookup dicts.
        </Alert>
      )}
    </Box>
  )
}
