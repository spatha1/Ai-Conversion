import React, { useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse,
  Divider, IconButton, Paper, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import {
  CheckCircleOutlined, ErrorOutlined, PlayArrowOutlined,
  RefreshOutlined, ExpandMoreOutlined, ExpandLessOutlined,
  WarningAmberOutlined, HourglassEmptyOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { runEngineApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import ConnectionSelector from '@/components/common/ConnectionSelector'
import type { RunLog } from '@/types'

// ─── Status chip ─────────────────────────────────────────────
function StatusChip({ status }: { status: RunLog['status'] }) {
  const map: Record<RunLog['status'], { label: string; color: string; icon: React.ReactNode }> = {
    success: { label: 'Success',  color: '#16a34a', icon: <CheckCircleOutlined sx={{ fontSize: 14 }} /> },
    failed:  { label: 'Failed',   color: '#dc2626', icon: <ErrorOutlined sx={{ fontSize: 14 }} /> },
    partial: { label: 'Partial',  color: '#d97706', icon: <WarningAmberOutlined sx={{ fontSize: 14 }} /> },
    running: { label: 'Running',  color: '#2563eb', icon: <HourglassEmptyOutlined sx={{ fontSize: 14 }} /> },
  }
  const { label, color, icon } = map[status] ?? map.failed
  return (
    <Chip
      size="small"
      icon={icon as any}
      label={label}
      sx={{ bgcolor: `${color}18`, color, fontWeight: 600, fontSize: '0.7rem', height: 22 }}
    />
  )
}

// ─── Run detail row (expandable) ──────────────────────────────
function RunRow({ run }: { run: RunLog }) {
  const [open, setOpen] = useState(false)

  const sourceRows = run.source_rows ? (() => { try { return JSON.parse(run.source_rows) } catch { return null } })() : null
  const outputXml  = run.output_xml  ? (() => { try { return JSON.parse(run.output_xml)  } catch { return null } })() : null
  const errors     = run.errors      ? (() => { try { return JSON.parse(run.errors)       } catch { return [] } })()  : []

  const duration = run.finished_at
    ? `${((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s`
    : '—'

  return (
    <>
      <TableRow hover sx={{ '& > *': { borderBottom: 'unset' } }}>
        <TableCell sx={{ width: 40, py: 0.5 }}>
          <IconButton size="small" onClick={() => setOpen(o => !o)}>
            {open ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>#{run.id}</TableCell>
        <TableCell><StatusChip status={run.status} /></TableCell>
        <TableCell sx={{ fontSize: '0.78rem' }}>{run.triggered_by}</TableCell>
        <TableCell sx={{ fontSize: '0.78rem' }}>{sourceRows?.total ?? '—'} rows</TableCell>
        <TableCell sx={{ fontSize: '0.78rem' }}>{outputXml?.generated ?? '—'} XML</TableCell>
        <TableCell sx={{ fontSize: '0.78rem' }}>{duration}</TableCell>
        <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
          {new Date(run.started_at).toLocaleString()}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={8} sx={{ py: 0, px: 2 }}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ py: 1.5 }}>
              {errors.length > 0 && (
                <Alert severity="error" sx={{ mb: 1, fontSize: '0.78rem' }}>
                  <strong>{errors.length} error{errors.length > 1 ? 's' : ''}:</strong>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                    {errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                  </ul>
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: '0.78rem' }}>
                {sourceRows && <Box><strong>Source rows:</strong> {sourceRows.total}</Box>}
                {outputXml  && <Box><strong>Generated:</strong> {outputXml.generated} &nbsp; <strong>Groups:</strong> {outputXml.groups}</Box>}
                {run.target_url && (
                  <Box>
                    <strong>Target:</strong> {run.target_url} &nbsp;
                    {run.target_status && (
                      <Chip size="small" label={`HTTP ${run.target_status}`}
                        sx={{ height: 18, fontSize: '0.7rem',
                          bgcolor: run.target_status < 300 ? '#16a34a18' : '#dc262618',
                          color:   run.target_status < 300 ? '#16a34a'   : '#dc2626' }} />
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────
export default function ExecutePage() {
  const { activeProject } = useAppStore()
  const qc = useQueryClient()

  const [connId, setConnId]       = useState<number | ''>('')
  const [targetUrl, setTargetUrl] = useState('')
  const [lastRunId, setLastRunId] = useState<number | null>(null)

  const { data: runs = [], isFetching, refetch } = useQuery({
    queryKey: ['runs', activeProject?.id],
    queryFn:  () => runEngineApi.list({ project_id: activeProject?.id, limit: 50 }),
    enabled:  !!activeProject,
    refetchInterval: 10_000,
  })

  const triggerMutation = useMutation({
    mutationFn: () => runEngineApi.trigger({
      conn_id:      connId as number,
      triggered_by: 'manual',
      target_url:   targetUrl.trim() || undefined,
    }),
    onSuccess: (run) => {
      setLastRunId(run.id)
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const canRun = !!connId && !triggerMutation.isPending

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Execute Conversion</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Run the conversion pipeline for a connection — fetches source data, fills the XML template, and stores output.
        </Typography>
      </Box>

      {/* Trigger panel */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Trigger Run</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Box sx={{ minWidth: 260 }}>
            <ConnectionSelector
              value={connId}
              onChange={(_, id) => setConnId(id)}
              projectId={activeProject?.id}
            />
          </Box>
          <TextField
            size="small"
            label="Target URL (optional)"
            placeholder="https://api.example.com/ingest"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            sx={{ minWidth: 300 }}
          />
          <Button
            variant="contained"
            startIcon={triggerMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowOutlined />}
            disabled={!canRun}
            onClick={() => triggerMutation.mutate()}
            sx={{ height: 40, minWidth: 120 }}
          >
            {triggerMutation.isPending ? 'Running…' : 'Run Now'}
          </Button>
        </Box>

        {triggerMutation.isError && (
          <Alert severity="error" sx={{ mt: 2, fontSize: '0.8rem' }}>
            {(triggerMutation.error as Error)?.message ?? 'Run failed'}
          </Alert>
        )}

        {triggerMutation.isSuccess && lastRunId && (
          <Alert severity={triggerMutation.data?.status === 'success' ? 'success' : triggerMutation.data?.status === 'failed' ? 'error' : 'warning'}
            sx={{ mt: 2, fontSize: '0.8rem' }}>
            Run #{lastRunId} completed with status: <strong>{triggerMutation.data?.status}</strong>.
            {triggerMutation.data?.output_xml && (() => {
              try { const o = JSON.parse(triggerMutation.data.output_xml!); return ` Generated ${o.generated} XML record(s) from ${o.groups} group(s).` } catch { return '' }
            })()}
          </Alert>
        )}
      </Paper>

      {/* Run history */}
      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>Run History</Typography>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => refetch()} disabled={isFetching}>
              <RefreshOutlined fontSize="small" sx={isFetching ? { animation: 'spin 1s linear infinite', '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } } : {}} />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />

        {runs.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
            <Typography variant="body2">No runs yet. Trigger the first run above.</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.75rem', color: 'text.secondary' } }}>
                <TableCell />
                <TableCell>Run</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Triggered By</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Output</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Started</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r) => <RunRow key={r.id} run={r} />)}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  )
}
