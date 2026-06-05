import { useState } from 'react'
import {
  Box, Typography, Paper, Button, CircularProgress, Alert, Stack, alpha,
  TextField, Select, MenuItem, FormControl, InputLabel, Chip, Divider,
} from '@mui/material'
import {
  AutoAwesomeOutlined, SaveOutlined, BuildOutlined,
  CheckCircleOutlined,
} from '@mui/icons-material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TINLParseResult, RuleCategory, ExecutionStage } from '@/types'

const PURPLE = '#8B5CF6'
const TEAL   = '#0EA5E9'

const EXAMPLES = [
  'If Premium > 10000 then Tier = Gold else Standard',
  'Map Status code 01 to Active, 02 to Inactive, 99 to Cancelled',
  'If PolicyType = HO then CoverageClass = Homeowner else Renter',
  'Default ClaimStatus to Open when ClaimDate is not null',
  'Validate that PolicyEffectiveDate is not in the future',
]

interface Props { connId: number | null }

export default function RuleBuilderTab({ connId }: Props) {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()

  const [nlText, setNlText]         = useState('')
  const [parsed, setParsed]         = useState<TINLParseResult | null>(null)
  const [editCond, setEditCond]     = useState('')
  const [editTrans, setEditTrans]   = useState('')
  const [ruleName, setRuleName]     = useState('')
  const [category, setCategory]     = useState<RuleCategory>('ConditionalRule')
  const [stage, setStage]           = useState<ExecutionStage>('Transform')

  const parseMut = useMutation({
    mutationFn: () => transformationApi.parseNL(nlText, connId ?? undefined),
    onSuccess: (data) => {
      setParsed(data)
      setRuleName(data.suggested_name)
      setCategory(data.category)
      setStage(data.execution_stage)
      setEditCond(data.condition_json ? JSON.stringify(data.condition_json, null, 2) : '')
      setEditTrans(data.transformation_json ? JSON.stringify(data.transformation_json, null, 2) : '')
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const saveMut = useMutation({
    mutationFn: () => transformationApi.createRule({
      conn_id: connId ?? undefined,
      rule_name: ruleName || nlText.slice(0, 60),
      category, execution_stage: stage,
      condition_json: editCond || undefined,
      transformation_json: editTrans || undefined,
      approval_status: 'pending_review',
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ti-rules', connId] })
      qc.invalidateQueries({ queryKey: ['ti-readiness', connId] })
      enqueueSnackbar('Rule saved — pending review', { variant: 'success' })
      setNlText(''); setParsed(null); setEditCond(''); setEditTrans(''); setRuleName('')
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  return (
    <Box sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
        {/* Left: NL Input */}
        <Box sx={{ flex: '1 1 340px', minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <BuildOutlined sx={{ fontSize: 16, color: PURPLE }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: PURPLE }}>
                Natural Language Rule Input
              </Typography>
            </Box>
            <TextField
              multiline minRows={5} maxRows={10} fullWidth
              placeholder={'Describe your transformation rule in plain English.\n\nExamples:\n• "If Premium > 10000 then Tier = Gold"\n• "Map LOB code 01 to Homeowner"\n• "Default Status to Active when not set"'}
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              sx={{ mb: 1.5, '& textarea': { fontSize: '0.82rem' } }}
            />

            {/* Examples */}
            <Typography variant="caption" color="text.secondary"
              sx={{ display: 'block', mb: 0.75, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Quick Examples
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
              {EXAMPLES.map((ex, i) => (
                <Chip key={i} label={ex.slice(0, 35) + (ex.length > 35 ? '…' : '')}
                  size="small" clickable
                  onClick={() => setNlText(ex)}
                  sx={{ height: 20, fontSize: '0.62rem', cursor: 'pointer',
                    bgcolor: alpha(PURPLE, 0.06), color: PURPLE,
                    '&:hover': { bgcolor: alpha(PURPLE, 0.12) } }} />
              ))}
            </Box>

            <Button
              variant="contained"
              fullWidth
              startIcon={parseMut.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoAwesomeOutlined />}
              disabled={!nlText.trim() || parseMut.isPending}
              onClick={() => parseMut.mutate()}
              sx={{ bgcolor: PURPLE, '&:hover': { bgcolor: '#7C3AED' } }}
            >
              {parseMut.isPending ? 'Parsing…' : 'Parse with AI'}
            </Button>

            {parsed && (
              <Box sx={{ mt: 1.5, p: 1, borderRadius: 1.5, bgcolor: alpha(tokens.emerald600, 0.06),
                border: 1, borderColor: alpha(tokens.emerald600, 0.2) }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <CheckCircleOutlined sx={{ fontSize: 14, color: tokens.emerald600 }} />
                  <Typography sx={{ fontSize: '0.7rem', color: tokens.emerald600, fontWeight: 600 }}>
                    Parsed with {Math.round(parsed.confidence * 100)}% confidence
                  </Typography>
                </Box>
              </Box>
            )}
          </Paper>
        </Box>

        {/* Right: Structured Editor */}
        <Box sx={{ flex: '1 1 340px', minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <AutoAwesomeOutlined sx={{ fontSize: 16, color: TEAL }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: TEAL }}>
                Structured Rule Editor
              </Typography>
            </Box>

            <Stack spacing={1.25}>
              <TextField label="Rule Name" size="small" fullWidth
                value={ruleName} onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g. premium_tier_assignment" />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel sx={{ fontSize: '0.78rem' }}>Category</InputLabel>
                  <Select value={category} onChange={(e) => setCategory(e.target.value as RuleCategory)} label="Category"
                    sx={{ fontSize: '0.78rem' }}>
                    {(['DirectMapping','LookupMapping','ConditionalRule','DefaultValue','Formula','DataValidation','DataQualityRule','ReferenceDataRule'] as RuleCategory[]).map(c =>
                      <MenuItem key={c} value={c} sx={{ fontSize: '0.78rem' }}>{c}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" fullWidth>
                  <InputLabel sx={{ fontSize: '0.78rem' }}>Stage</InputLabel>
                  <Select value={stage} onChange={(e) => setStage(e.target.value as ExecutionStage)} label="Stage"
                    sx={{ fontSize: '0.78rem' }}>
                    {(['PreTransform','Transform','PostTransform','Validation'] as ExecutionStage[]).map(s =>
                      <MenuItem key={s} value={s} sx={{ fontSize: '0.78rem' }}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
              </Box>

              <Box>
                <Typography variant="caption" fontWeight={700} color="text.secondary"
                  sx={{ textTransform: 'uppercase', fontSize: '0.58rem', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                  Condition JSON
                </Typography>
                <TextField
                  multiline minRows={4} fullWidth size="small"
                  value={editCond}
                  onChange={(e) => setEditCond(e.target.value)}
                  placeholder='{"logic":"AND","conditions":[{"field":"Premium","operator":">","value":"10000"}]}'
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.7rem' } }}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc' } }}
                />
              </Box>

              <Box>
                <Typography variant="caption" fontWeight={700} color="text.secondary"
                  sx={{ textTransform: 'uppercase', fontSize: '0.58rem', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                  Transformation JSON
                </Typography>
                <TextField
                  multiline minRows={5} fullWidth size="small"
                  value={editTrans}
                  onChange={(e) => setEditTrans(e.target.value)}
                  placeholder='{"action":"set","target_field":"Tier","cases":[{"when":{...},"then":"Gold"},{"else":"Standard"}]}'
                  inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.7rem' } }}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: (t) => t.palette.mode === 'dark' ? '#0d1117' : '#f8fafc' } }}
                />
              </Box>
            </Stack>

            <Divider sx={{ my: 1.5 }} />

            <Button
              variant="contained" fullWidth
              startIcon={saveMut.isPending ? <CircularProgress size={14} color="inherit" /> : <SaveOutlined />}
              disabled={!ruleName || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? 'Saving…' : 'Save Rule (Pending Review)'}
            </Button>
          </Paper>
        </Box>
      </Box>

      {/* JSON schema reference */}
      <Paper variant="outlined" sx={{ mt: 2, p: 1.75, borderRadius: 2, bgcolor: alpha(TEAL, 0.02) }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary"
          sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 1 }}>
          JSON Schema Reference
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', mb: 0.5 }}>Condition:</Typography>
            <Box component="pre" sx={{ m: 0, p: 1, bgcolor: alpha('#000', 0.04), borderRadius: 1,
              fontSize: '0.62rem', fontFamily: 'monospace', color: PURPLE }}>
{`{"logic": "AND",
  "conditions": [
    {"field": "Premium",
     "operator": ">",
     "value": "10000"}
  ]}`}
            </Box>
          </Box>
          <Box>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', mb: 0.5 }}>Transformation:</Typography>
            <Box component="pre" sx={{ m: 0, p: 1, bgcolor: alpha('#000', 0.04), borderRadius: 1,
              fontSize: '0.62rem', fontFamily: 'monospace', color: TEAL }}>
{`{"action": "set",
  "target_field": "Tier",
  "cases": [
    {"when": {...}, "then": "Gold"},
    {"else": "Standard"}
  ]}`}
            </Box>
          </Box>
        </Box>
      </Paper>
    </Box>
  )
}
