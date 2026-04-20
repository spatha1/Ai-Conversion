import { useState } from 'react'
import {
  Box, Grid, Card, CardContent, Typography, Chip, CircularProgress,
  Paper, Divider, Table, TableHead, TableRow, TableCell, TableBody,
  alpha, Avatar, Tooltip, IconButton, LinearProgress,
} from '@mui/material'
import {
  StorageOutlined, SchemaOutlined, AccountTreeOutlined, MapOutlined,
  CodeOutlined, VerifiedOutlined, SupportAgentOutlined, RefreshOutlined,
  CheckCircleOutlined, ErrorOutlined, ArrowForwardOutlined,
  BoltOutlined, TableChartOutlined, AutoAwesomeOutlined, LinkOutlined,
  PlayArrowOutlined, TrendingUpOutlined, CalendarTodayOutlined,
  TimelineOutlined, AdminPanelSettingsOutlined,
} from '@mui/icons-material'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartTip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/useAppStore'
import { dashboardApi } from '@/api'

// ── Palette ───────────────────────────────────────────────────────────────────
// Primary navy + gray secondary + status colors
const COLORS = ['#01398c', '#555555', '#059669', '#D97706', '#DC2626', '#0284C7']

// ── Pipeline step config ──────────────────────────────────────────────────────
interface PipelineStep {
  key: string
  label: string
  icon: React.ReactNode
  color: string
  getValue: (s: any) => number
  getSub: (s: any) => string
  description: string
}

const PIPELINE: PipelineStep[] = [
  {
    key: 'connections',
    label: 'Connect',
    icon: <StorageOutlined />,
    color: '#01398c',
    getValue: (s) => s?.connections?.total ?? 0,
    getSub: (s) => {
      const types = s?.connections?.by_type ?? []
      return types.length ? types.map((t: any) => `${t.count} ${t.type}`).join(', ') : 'No connections'
    },
    description: 'Data source connections',
  },
  {
    key: 'schema',
    label: 'Discover',
    icon: <SchemaOutlined />,
    color: '#1A5099',
    getValue: (s) => s?.schema?.tables ?? 0,
    getSub: (s) => `${s?.schema?.columns ?? 0} cols · ${s?.schema?.relations ?? 0} rels`,
    description: 'Schema tables discovered',
  },
  {
    key: 'templates',
    label: 'Template',
    icon: <CodeOutlined />,
    color: '#0284C7',
    getValue: (s) => s?.templates?.total ?? 0,
    getSub: (s) => `${s?.templates?.formulas ?? 0} formula rules`,
    description: 'XML templates uploaded',
  },
  {
    key: 'mappings',
    label: 'Map',
    icon: <MapOutlined />,
    color: '#059669',
    getValue: (s) => s?.mappings?.total ?? 0,
    getSub: (s) => `${s?.mappings?.rows ?? 0} field rows`,
    description: 'Source→target mappings',
  },
  {
    key: 'xml',
    label: 'Generate',
    icon: <TableChartOutlined />,
    color: '#D97706',
    getValue: (s) => s?.xml?.generated ?? 0,
    getSub: (s) => {
      const gen = s?.xml?.generated ?? 0
      const pass = s?.xml?.passed ?? 0
      return gen > 0 ? `${pass} passed · ${gen - pass} failed` : 'No XML yet'
    },
    description: 'XML records generated',
  },
  {
    key: 'support',
    label: 'Support',
    icon: <SupportAgentOutlined />,
    color: '#555555',
    getValue: (s) => s?.ps_support?.conversations ?? 0,
    getSub: (s) => `${s?.ps_support?.workflows ?? 0} workflows · ${s?.ps_support?.workflow_runs ?? 0} runs`,
    description: 'AI support conversations',
  },
]

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, icon, color, sub, loading }: {
  label: string; value: number | string; icon: React.ReactNode
  color: string; sub?: string; loading?: boolean
}) {
  return (
    <Card
      sx={{
        borderRadius: 3, height: '100%',
        borderColor: alpha(color, 0.25),
        borderTop: `3px solid ${color}`,
        background: (t) => t.palette.mode === 'dark'
          ? `linear-gradient(160deg, ${alpha(color, 0.08)} 0%, transparent 100%)`
          : `linear-gradient(160deg, ${alpha(color, 0.05)} 0%, #ffffff 100%)`,
        '&:hover': {
          borderColor: alpha(color, 0.4),
          boxShadow: `0 8px 28px ${alpha(color, 0.18)} !important`,
          transform: 'translateY(-2px)',
        },
      }}
    >
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="overline"
              sx={{ color: 'text.disabled', fontSize: '0.625rem', letterSpacing: '0.08em', display: 'block', mb: 0.5 }}
            >
              {label}
            </Typography>
            {loading ? (
              <Box sx={{ mt: 0.75 }}><LinearProgress sx={{ borderRadius: 2, height: 8 }} /></Box>
            ) : (
              <Typography
                variant="h3"
                fontWeight={800}
                sx={{ color, lineHeight: 1, fontSize: '1.75rem', letterSpacing: '-0.02em' }}
              >
                {value}
              </Typography>
            )}
            {sub && (
              <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block', mt: 0.5, fontSize: '0.688rem' }}>
                {sub}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              width: 42, height: 42, borderRadius: 2.5, flexShrink: 0,
              background: `linear-gradient(135deg, ${alpha(color, 0.18)}, ${alpha(color, 0.1)})`,
              border: `1px solid ${alpha(color, 0.2)}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color, '& svg': { fontSize: 20 },
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}

// ── Pipeline Flow ─────────────────────────────────────────────────────────────
function PipelineFlow({ summary, loading }: { summary: any; loading: boolean }) {
  return (
    <Card sx={{ borderRadius: 3, overflow: 'hidden', borderTop: '3px solid #01398c' }}>
      <Box
        sx={{
          px: 2.5, py: 1.75,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
          background: (t) => t.palette.mode === 'dark'
            ? 'rgba(1,57,140,.07)'
            : 'linear-gradient(to right, rgba(1,57,140,.04), rgba(85,85,85,.02))',
        }}
      >
        <TimelineOutlined sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="subtitle1" fontWeight={700}>Conversion Pipeline</Typography>
        <Chip
          label="6 stages"
          size="small"
          color="primary"
          sx={{ ml: 'auto', height: 20, fontSize: '0.688rem' }}
        />
      </Box>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        {/* Horizontal pipeline */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', pb: 1 }}>
          {PIPELINE.map((step, idx) => {
            const count = loading ? null : step.getValue(summary)
            const sub   = loading ? '…' : step.getSub(summary)
            const active = count !== null && count > 0
            return (
              <Box key={step.key} sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 120 }}>
                {/* Step card */}
                <Box
                  sx={{
                    flex: 1, px: 1.5, py: 1.25, borderRadius: 2, textAlign: 'center',
                    border: '1.5px solid',
                    borderColor: active ? alpha(step.color, 0.5) : 'divider',
                    bgcolor: active ? alpha(step.color, 0.06) : 'transparent',
                    transition: 'all .2s',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, mb: 0.5 }}>
                    <Box sx={{ color: active ? step.color : 'text.disabled', display: 'flex', '& svg': { fontSize: 18 } }}>
                      {step.icon}
                    </Box>
                    {active && count! > 0 && (
                      <Chip
                        label={count}
                        size="small"
                        sx={{
                          height: 18, fontSize: '0.625rem', fontWeight: 700,
                          bgcolor: alpha(step.color, 0.15), color: step.color, border: 'none',
                        }}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" fontWeight={700} sx={{ color: active ? step.color : 'text.disabled', display: 'block', fontSize: '0.75rem' }}>
                    {step.label}
                  </Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.625rem', display: 'block' }} noWrap>
                    {sub}
                  </Typography>
                </Box>
                {/* Arrow */}
                {idx < PIPELINE.length - 1 && (
                  <ArrowForwardOutlined sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0, mx: 0.25 }} />
                )}
              </Box>
            )
          })}
        </Box>
        {/* Progress bar */}
        <Box sx={{ mt: 2 }}>
          {(() => {
            const completed = loading ? 0 : PIPELINE.filter((s) => s.getValue(summary) > 0).length
            const pct = Math.round((completed / PIPELINE.length) * 100)
            return (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                    Pipeline Progress
                  </Typography>
                  <Typography variant="caption" fontWeight={700} color="primary">
                    {completed}/{PIPELINE.length} stages active
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{ height: 8, borderRadius: 4, bgcolor: (t) => alpha(t.palette.primary.main, 0.1) }}
                />
              </Box>
            )
          })()}
        </Box>
      </CardContent>
    </Card>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusChip({ status }: { status: string }) {
  const map: Record<string, { color: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
    success: { color: 'success', label: 'Success' },
    completed: { color: 'success', label: 'Done' },
    failed: { color: 'error', label: 'Failed' },
    error: { color: 'error', label: 'Error' },
    running: { color: 'warning', label: 'Running' },
  }
  const s = map[status] ?? { color: 'default', label: status }
  return <Chip label={s.label} color={s.color} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.688rem' }} />
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { activeProject } = useAppStore()
  const [activityDays, setActivityDays] = useState(30)

  const { data: summary, isLoading: sumLoading, refetch: refetchSum } = useQuery({
    queryKey: ['dashboard-summary', activeProject?.id],
    queryFn:  () => dashboardApi.getSummary(activeProject?.id),
    refetchInterval: 60_000,
  })

  const { data: activity, isLoading: actLoading } = useQuery({
    queryKey: ['dashboard-activity', activityDays, activeProject?.id],
    queryFn:  () => dashboardApi.getActivity(activityDays, activeProject?.id),
    refetchInterval: 60_000,
  })

  // Merge activity series for area chart
  const activityData = (() => {
    const xml  = (activity?.xml_generated  ?? []) as { date: string; count: number }[]
    const conv = (activity?.conversations  ?? []) as { date: string; count: number }[]
    const all  = new Set([...xml.map((x) => x.date), ...conv.map((x) => x.date)])
    const xmlMap  = Object.fromEntries(xml.map((x)  => [x.date, x.count]))
    const convMap = Object.fromEntries(conv.map((x) => [x.date, x.count]))
    return [...all].sort().map((date) => ({
      date: date.slice(5),   // MM-DD
      'XML Generated': xmlMap[date]  ?? 0,
      'Conversations':  convMap[date] ?? 0,
    }))
  })()

  // Pie chart — connection types
  const connTypes: { name: string; value: number }[] = summary?.connections?.by_type
    ? summary.connections.by_type.map((t: any) => ({ name: t.type, value: t.count }))
    : []

  // Schema bar data
  const schemaData = summary ? [
    { name: 'Tables',     value: summary.schema?.tables     ?? 0 },
    { name: 'Columns',    value: summary.schema?.columns    ?? 0 },
    { name: 'Relations',  value: summary.schema?.relations  ?? 0 },
    { name: 'Embeddings', value: summary.schema?.embeddings ?? 0 },
  ] : []

  const recentRuns = summary?.run_logs?.recent ?? []

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      {/* ── Header ── */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', mb: 3,
          p: 2.5, borderRadius: 3,
          background: (t) => t.palette.mode === 'dark'
            ? 'linear-gradient(135deg, rgba(1,57,140,.14) 0%, rgba(85,85,85,.08) 100%)'
            : 'linear-gradient(135deg, rgba(1,57,140,.07) 0%, rgba(85,85,85,.03) 100%)',
          border: '1px solid',
          borderColor: (t) => t.palette.mode === 'dark'
            ? 'rgba(1,57,140,.22)'
            : 'rgba(1,57,140,.12)',
        }}
      >
        <Box>
          <Typography
            variant="h5" fontWeight={800}
            sx={{ letterSpacing: '-0.025em', color: 'primary.main' }}
          >
            Project Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {activeProject?.name ?? 'All projects'} · Live pipeline overview
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
          {[7, 30, 90].map((d) => (
            <Chip
              key={d}
              label={`${d}d`}
              size="small"
              onClick={() => setActivityDays(d)}
              color={activityDays === d ? 'primary' : 'default'}
              variant={activityDays === d ? 'filled' : 'outlined'}
              sx={{ cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
            />
          ))}
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => refetchSum()} disabled={sumLoading}>
              <RefreshOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Grid container spacing={2.5}>
        {/* ── Pipeline Flow (full width) ── */}
        <Grid item xs={12}>
          <PipelineFlow summary={summary} loading={sumLoading} />
        </Grid>

        {/* ── KPI Row (7 cards — CSS grid for perfect equal-width columns) ── */}
        <Grid item xs={12}>
          <Box sx={{
            display: 'grid',
            gap: 2.5,
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(4, 1fr)',
              lg: 'repeat(7, 1fr)',
            },
          }}>
            {[
              { label: 'Connections',   value: summary?.connections?.total ?? 0,         icon: <StorageOutlined />,           color: '#01398c', sub: `${connTypes.length} type(s)` },
              { label: 'Tables',        value: summary?.schema?.tables ?? 0,             icon: <SchemaOutlined />,            color: '#1A5099', sub: `${summary?.schema?.columns ?? 0} columns` },
              { label: 'Mappings',      value: summary?.mappings?.total ?? 0,            icon: <MapOutlined />,               color: '#059669', sub: `${summary?.mappings?.rows ?? 0} rows` },
              { label: 'XML Generated', value: summary?.xml?.generated ?? 0,            icon: <CodeOutlined />,              color: '#D97706', sub: `${summary?.xml?.passed ?? 0} valid` },
              { label: 'Workflows',     value: summary?.ps_support?.workflows ?? 0,      icon: <BoltOutlined />,              color: '#DC2626', sub: `${summary?.ps_support?.workflow_runs ?? 0} runs` },
              { label: 'Conversations', value: summary?.ps_support?.conversations ?? 0,  icon: <SupportAgentOutlined />,      color: '#555555', sub: 'AI support chats' },
              { label: 'Admin',         value: summary?.admin?.active_templates ?? 0,    icon: <AdminPanelSettingsOutlined />, color: '#7C3AED', sub: `${summary?.admin?.ai_agents ?? 0} agents · ${summary?.admin?.test_cases ?? 0} tests` },
            ].map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} loading={sumLoading} />
            ))}
          </Box>
        </Grid>

        {/* ── Activity Chart (area) ── */}
        <Grid item xs={12} md={8}>
          <Card sx={{ borderRadius: 3, height: '100%', borderTop: `3px solid #01398c` }}>
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <TrendingUpOutlined sx={{ fontSize: 18, color: 'primary.main' }} />
              <Typography variant="subtitle1" fontWeight={700}>Activity — Last {activityDays} days</Typography>
            </Box>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              {actLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 280 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : activityData.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 280, flexDirection: 'column', gap: 1 }}>
                  <CalendarTodayOutlined sx={{ fontSize: 40, color: 'text.disabled' }} />
                  <Typography color="text.disabled">No activity in this period</Typography>
                </Box>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={activityData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradXml" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha('#94a3b8', 0.2)} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <RechartTip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="XML Generated" stroke="#f59e0b" fill="url(#gradXml)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="Conversations"  stroke="#2563eb" fill="url(#gradConv)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* ── Connection Types Pie ── */}
        <Grid item xs={12} md={4}>
          <Card sx={{ borderRadius: 3, height: '100%', borderTop: `3px solid #1A5099` }}>
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <StorageOutlined sx={{ fontSize: 18, color: '#0284C7' }} />
              <Typography variant="subtitle1" fontWeight={700}>Connection Types</Typography>
            </Box>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              {sumLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 240 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : connTypes.length === 0 ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 240, flexDirection: 'column', gap: 1 }}>
                  <StorageOutlined sx={{ fontSize: 40, color: 'text.disabled' }} />
                  <Typography color="text.disabled">No connections</Typography>
                </Box>
              ) : (
                <Box>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={connTypes} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {connTypes.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartTip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Divider sx={{ my: 1.5 }} />
                  {connTypes.map((t, i) => (
                    <Box key={t.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, textTransform: 'uppercase', fontSize: '0.688rem' }}>{t.name}</Typography>
                      <Chip label={t.value} size="small" sx={{ height: 18, fontSize: '0.625rem' }} />
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* ── Schema Breakdown ── */}
        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 3, borderTop: `3px solid #555555` }}>
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <SchemaOutlined sx={{ fontSize: 18, color: '#7C3AED' }} />
              <Typography variant="subtitle1" fontWeight={700}>Schema Breakdown</Typography>
              {summary?.schema?.embeddings > 0 && (
                <Chip icon={<AutoAwesomeOutlined sx={{ fontSize: 12 }} />} label="AI ready" color="secondary" size="small" variant="outlined" sx={{ ml: 'auto', height: 20, fontSize: '0.688rem' }} />
              )}
            </Box>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              {sumLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', height: 200, alignItems: 'center' }}><CircularProgress size={28} /></Box>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={schemaData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha('#94a3b8', 0.2)} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={72} />
                    <RechartTip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {schemaData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* ── XML Generation Status ── */}
        <Grid item xs={12} md={6}>
          <Card sx={{ borderRadius: 3, borderTop: `3px solid #D97706` }}>  {/* amber — kept */}
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <CodeOutlined sx={{ fontSize: 18, color: '#D97706' }} />
              <Typography variant="subtitle1" fontWeight={700}>Output Generation</Typography>
              <Chip label={`${summary?.xml?.generated ?? 0} total`} size="small" sx={{ ml: 'auto', height: 20, fontSize: '0.688rem' }} />
            </Box>
            <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
              {sumLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', height: 200, alignItems: 'center' }}><CircularProgress size={28} /></Box>
              ) : (
                <Box>
                  {/* Pass/fail donut style */}
                  {(summary?.xml?.generated ?? 0) === 0 ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 3 }}>
                      <CodeOutlined sx={{ fontSize: 40, color: 'text.disabled' }} />
                      <Typography color="text.disabled">No records generated yet</Typography>
                    </Box>
                  ) : (
                    <Box>
                      <ResponsiveContainer width="100%" height={160}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Validated', value: summary?.xml?.passed ?? 0 },
                              { name: 'Failed',    value: summary?.xml?.failed ?? 0 },
                              { name: 'Not Validated', value: summary?.xml?.pending ?? 0 },
                            ].filter(d => d.value > 0)}
                            dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                            label={({ name, value }) => value > 0 ? `${name}: ${value}` : ''}
                          >
                            <Cell fill="#10b981" />
                            <Cell fill="#ef4444" />
                            <Cell fill="#94a3b8" />
                          </Pie>
                          <RechartTip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 1, flexWrap: 'wrap' }}>
                        {[
                          { label: 'Validated',     value: summary?.xml?.passed  ?? 0, color: '#10b981' },
                          { label: 'Val. Failed',   value: summary?.xml?.failed  ?? 0, color: '#ef4444' },
                          { label: 'Not Validated', value: summary?.xml?.pending ?? 0, color: '#94a3b8' },
                        ].map((item) => (
                          <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color }} />
                            <Typography variant="caption" fontWeight={600}>{item.label}: {item.value}</Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* ── Recent Run Logs ── */}
        {recentRuns.length > 0 && (
          <Grid item xs={12}>
            <Card sx={{ borderRadius: 3, borderTop: `3px solid #059669` }}>
              <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <PlayArrowOutlined sx={{ fontSize: 18, color: '#10b981' }} />
                <Typography variant="subtitle1" fontWeight={700}>Recent Run Logs</Typography>
                <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                  <Chip icon={<CheckCircleOutlined sx={{ fontSize: 12 }} />} label={`${summary?.run_logs?.success ?? 0} success`} color="success" size="small" variant="outlined" sx={{ height: 22, fontSize: '0.688rem' }} />
                  {(summary?.run_logs?.failed ?? 0) > 0 && (
                    <Chip icon={<ErrorOutlined sx={{ fontSize: 12 }} />} label={`${summary.run_logs.failed} failed`} color="error" size="small" variant="outlined" sx={{ height: 22, fontSize: '0.688rem' }} />
                  )}
                </Box>
              </Box>
              <Box sx={{ overflow: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Run ID</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Rows</TableCell>
                      <TableCell>Started</TableCell>
                      <TableCell>Duration</TableCell>
                      <TableCell>Errors</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {recentRuns.map((run: any) => {
                      const start = run.started_at ? new Date(run.started_at) : null
                      const end   = run.finished_at ? new Date(run.finished_at) : null
                      const dur   = start && end ? `${Math.round((end.getTime() - start.getTime()) / 1000)}s` : '—'
                      return (
                        <TableRow key={run.id} hover>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.813rem' }}>#{run.id}</TableCell>
                          <TableCell><StatusChip status={run.status ?? 'unknown'} /></TableCell>
                          <TableCell align="right">
                            <Typography variant="caption">{run.source_rows?.toLocaleString() ?? '—'}</Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">
                              {start ? start.toLocaleString() : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell><Typography variant="caption">{dur}</Typography></TableCell>
                          <TableCell>
                            {run.errors ? (
                              <Tooltip title={run.errors}>
                                <Chip label="View" size="small" color="error" variant="outlined" sx={{ height: 18, fontSize: '0.625rem', cursor: 'pointer' }} />
                              </Tooltip>
                            ) : (
                              <Typography variant="caption" color="text.disabled">—</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </Box>
            </Card>
          </Grid>
        )}

      </Grid>
    </Box>
  )
}
