import { useState } from 'react'
import {
  Box, Typography, Paper, Chip, Button, CircularProgress,
  Alert, Stack, alpha, LinearProgress, Grid, Tooltip,
} from '@mui/material'
import {
  CheckCircleOutlined, CancelOutlined, WarningAmberOutlined,
  RefreshOutlined, LibraryBooksOutlined, FactCheckOutlined,
  AccountTreeOutlined, RuleOutlined, AutoAwesomeOutlined,
} from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { transformationApi } from '@/api'
import { tokens } from '@/theme/theme'
import type { TIReadinessDashboard } from '@/types'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

interface Props {
  connId: number | null
  onNavigateTab: (tab: number) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  DirectMapping:    TEAL,
  LookupMapping:    tokens.amber600,
  ConditionalRule:  PURPLE,
  DefaultValue:     '#64748B',
  Formula:          tokens.sky600,
  DataValidation:   tokens.emerald600,
  DataQualityRule:  tokens.red600,
  ReferenceDataRule:'#8B5CF6',
}

function KpiTile({
  label, value, subtitle, color, pct, onClick,
}: {
  label: string; value: string | number; subtitle?: string
  color: string; pct?: number; onClick?: () => void
}) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2, borderRadius: 2, textAlign: 'center', position: 'relative',
        borderColor: alpha(color, 0.3),
        bgcolor: alpha(color, 0.03),
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { boxShadow: `0 4px 16px ${alpha(color, 0.2)}`, transform: 'translateY(-1px)' } : {},
        transition: 'box-shadow 0.15s, transform 0.15s',
      }}
    >
      <Box sx={{ height: 3, bgcolor: color, borderRadius: '2px 2px 0 0',
        position: 'absolute', top: 0, left: 0, right: 0 }} />
      <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', textTransform: 'uppercase',
        letterSpacing: 0.5, mb: 0.75, mt: 0.25 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.8rem', fontWeight: 800, color, lineHeight: 1, mb: 0.25 }}>
        {value}
      </Typography>
      {subtitle && (
        <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>{subtitle}</Typography>
      )}
      {pct != null && (
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant="determinate"
            value={Math.min(pct, 100)}
            sx={{
              height: 5, borderRadius: 3,
              bgcolor: alpha(color, 0.12),
              '& .MuiLinearProgress-bar': { bgcolor: color },
            }}
          />
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', mt: 0.3 }}>
            {pct.toFixed(0)}%
          </Typography>
        </Box>
      )}
    </Paper>
  )
}

function ReadinessGate({ label, ready }: { label: string; ready: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, borderRadius: 1.5,
      border: 1, borderColor: alpha(ready ? tokens.emerald600 : '#94A3B8', 0.3),
      bgcolor: alpha(ready ? tokens.emerald600 : '#94A3B8', 0.04) }}>
      {ready
        ? <CheckCircleOutlined sx={{ fontSize: 18, color: tokens.emerald600 }} />
        : <CancelOutlined sx={{ fontSize: 18, color: '#94A3B8' }} />
      }
      <Box>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700,
          color: ready ? tokens.emerald600 : '#64748B' }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>
          {ready ? 'All criteria met' : 'Criteria not yet met'}
        </Typography>
      </Box>
    </Box>
  )
}

export default function ExecutiveDashboardTab({ connId, onNavigateTab }: Props) {
  const { data: dash, isLoading, error, refetch } = useQuery<TIReadinessDashboard>({
    queryKey: ['ti-readiness', connId],
    queryFn: () => transformationApi.readiness(connId ?? undefined),
    enabled: connId != null,
  })

  if (isLoading) {
    return (
      <Box sx={{ p: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
        <CircularProgress size={20} />
        <Typography variant="body2" color="text.secondary">Loading readiness metrics…</Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ fontSize: '0.8rem' }}>
          Failed to load dashboard. <Button size="small" onClick={() => refetch()}>Retry</Button>
        </Alert>
      </Box>
    )
  }

  const d = dash!

  return (
    <Box sx={{ p: 2.5 }}>
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
        <Typography variant="h6" fontWeight={700} sx={{ fontSize: '0.95rem' }}>
          Conversion Readiness
        </Typography>
        <Chip label={connId ? `conn #${connId}` : 'All'} size="small"
          sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(TEAL, 0.1), color: TEAL }} />
        <Tooltip title="Refresh metrics">
          <Button size="small" variant="outlined" startIcon={<RefreshOutlined />}
            onClick={() => refetch()} sx={{ ml: 'auto', fontSize: '0.7rem' }}>
            Refresh
          </Button>
        </Tooltip>
      </Box>

      {/* SIT / UAT gates */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <ReadinessGate label="Ready for SIT" ready={d.ready_for_sit} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <ReadinessGate label="Ready for UAT" ready={d.ready_for_uat} />
        </Grid>
        {d.issues_count > 0 && (
          <Grid item xs={12} sm={6} md={3}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, borderRadius: 1.5,
              border: 1, borderColor: alpha(tokens.red600, 0.3), bgcolor: alpha(tokens.red600, 0.04),
              cursor: 'pointer' }} onClick={() => onNavigateTab(8)}>
              <WarningAmberOutlined sx={{ fontSize: 18, color: tokens.red600 }} />
              <Box>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: tokens.red600 }}>
                  {d.issues_count} Validation Issue{d.issues_count !== 1 ? 's' : ''}
                </Typography>
                <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>
                  Click to view → Validation tab
                </Typography>
              </Box>
            </Box>
          </Grid>
        )}
      </Grid>

      {/* KPI tiles */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Grid item xs={6} sm={4} md={2}>
          <KpiTile label="Fields Mapped" value={`${d.mapping_coverage_pct}%`}
            subtitle={`${d.unmapped_fields} unmapped`}
            color={d.mapping_coverage_pct >= 90 ? tokens.emerald600 : tokens.amber600}
            pct={d.mapping_coverage_pct}
            onClick={() => onNavigateTab(1)} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiTile label="Values Mapped" value={`${d.value_mapping_coverage_pct}%`}
            subtitle={`${d.unmapped_values} unmapped`}
            color={d.value_mapping_coverage_pct >= 85 ? tokens.emerald600 : tokens.amber600}
            pct={d.value_mapping_coverage_pct}
            onClick={() => onNavigateTab(6)} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiTile label="Approved Rules" value={`${d.approved_rules}`}
            subtitle={`of ${d.total_rules} total`}
            color={PURPLE}
            pct={d.total_rules > 0 ? d.approved_rules / d.total_rules * 100 : 0}
            onClick={() => onNavigateTab(1)} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiTile label="Test Coverage" value={`${d.test_coverage_pct}%`}
            subtitle={`${d.test_cases_passing}/${d.test_case_count} passing`}
            color={d.test_coverage_pct >= 80 ? tokens.emerald600 : tokens.amber600}
            pct={d.test_coverage_pct}
            onClick={() => onNavigateTab(5)} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiTile label="Ref Data Rules" value={d.reference_data_rules}
            subtitle="approved"
            color={tokens.sky600}
            onClick={() => onNavigateTab(1)} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiTile label="Recon Queries" value={d.recon_query_count}
            subtitle="generated"
            color={TEAL}
            onClick={() => onNavigateTab(9)} />
        </Grid>
      </Grid>

      {/* Confidence + pending review */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={6} md={4}>
          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary"
              sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 1 }}>
              AI Confidence
            </Typography>
            {d.avg_ai_confidence != null ? (
              <>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                  <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: PURPLE }}>
                    {Math.round(d.avg_ai_confidence * 100)}%
                  </Typography>
                  <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
                    avg across AI-generated rules
                  </Typography>
                </Box>
                <LinearProgress variant="determinate" value={d.avg_ai_confidence * 100}
                  sx={{ height: 5, borderRadius: 3, bgcolor: alpha(PURPLE, 0.12),
                    '& .MuiLinearProgress-bar': { bgcolor: PURPLE } }} />
              </>
            ) : (
              <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled', fontStyle: 'italic' }}>
                No AI-generated rules yet
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' } }} onClick={() => onNavigateTab(1)}>
            <Typography variant="caption" fontWeight={700} color="text.secondary"
              sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 1 }}>
              Pending Review
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: '1.4rem', fontWeight: 800,
                color: d.manual_review_count > 0 ? tokens.amber600 : tokens.emerald600 }}>
                {d.manual_review_count}
              </Typography>
              <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
                rule{d.manual_review_count !== 1 ? 's' : ''} awaiting approval
              </Typography>
            </Box>
            {d.manual_review_count > 0 && (
              <Typography sx={{ fontSize: '0.65rem', color: tokens.amber600, mt: 0.5 }}>
                Click to review in Rule Repository →
              </Typography>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} sm={12} md={4}>
          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary"
              sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 1 }}>
              Insurance Coverage Dimensions
            </Typography>
            <Stack spacing={0.4}>
              {[
                { label: 'Mapping Coverage', pct: d.mapping_coverage_pct, color: TEAL },
                { label: 'Value Mapping', pct: d.value_mapping_coverage_pct, color: tokens.amber600 },
                { label: 'Rule Coverage', pct: d.rule_coverage_pct, color: PURPLE },
                { label: 'Test Coverage', pct: d.test_coverage_pct, color: tokens.emerald600 },
              ].map(({ label, pct, color }) => (
                <Box key={label}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.2 }}>
                    <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }}>{label}</Typography>
                    <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color }}>{pct.toFixed(0)}%</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={Math.min(pct, 100)}
                    sx={{ height: 4, borderRadius: 2, bgcolor: alpha(color, 0.1),
                      '& .MuiLinearProgress-bar': { bgcolor: color } }} />
                </Box>
              ))}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Rules by category */}
      {Object.keys(d.rules_by_category).length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary"
            sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5, display: 'block', mb: 1 }}>
            Rules by Category
          </Typography>
          <Stack spacing={0.5}>
            {Object.entries(d.rules_by_category)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, cnt]) => {
                const maxCnt = Math.max(...Object.values(d.rules_by_category))
                const pct = Math.round(cnt / maxCnt * 100)
                const color = CATEGORY_COLORS[cat] ?? '#64748B'
                return (
                  <Box key={cat} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', minWidth: 140 }}>
                      {cat}
                    </Typography>
                    <Box sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: alpha(color, 0.12), overflow: 'hidden' }}>
                      <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: 5, bgcolor: color,
                        transition: 'width 0.6s ease' }} />
                    </Box>
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color, minWidth: 24, textAlign: 'right' }}>
                      {cnt}
                    </Typography>
                  </Box>
                )
              })}
          </Stack>
        </Paper>
      )}

      {/* Quick actions */}
      <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" startIcon={<LibraryBooksOutlined />}
          onClick={() => onNavigateTab(1)} sx={{ fontSize: '0.72rem' }}>
          View Rules
        </Button>
        <Button size="small" variant="outlined" startIcon={<AutoAwesomeOutlined />}
          onClick={() => onNavigateTab(3)} sx={{ fontSize: '0.72rem' }}>
          AI Discovery
        </Button>
        <Button size="small" variant="outlined" startIcon={<FactCheckOutlined />}
          onClick={() => onNavigateTab(5)} sx={{ fontSize: '0.72rem' }}>
          Run Tests
        </Button>
        <Button size="small" variant="outlined" startIcon={<AccountTreeOutlined />}
          onClick={() => onNavigateTab(8)} sx={{ fontSize: '0.72rem' }}>
          Validate Rules
        </Button>
      </Box>
    </Box>
  )
}
