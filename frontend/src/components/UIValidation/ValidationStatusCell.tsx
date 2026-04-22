import React, { useState } from 'react'
import {
  Box, Chip, CircularProgress, IconButton, Tooltip, Button, Typography,
} from '@mui/material'
import { ScienceOutlined, VisibilityOutlined, SettingsOutlined } from '@mui/icons-material'
import { uiValidationApi } from '@/api'
import type { UiValidationRun } from '@/types'
import ReportDialog from './ReportDialog'

interface Props {
  connId:      number
  entity:      string
  entityId:    string
  /** Pass true/false from parent to skip per-row status fetch.
   *  When false, cell renders nothing (banner handles setup CTA). */
  configured?: boolean
}

export default function ValidationStatusCell({
  connId, entity, entityId, configured,
}: Props) {
  const [running,    setRunning]    = useState(false)
  const [lastRun,    setLastRun]    = useState<UiValidationRun | null>(null)
  const [reportOpen, setReportOpen] = useState(false)

  // Template not configured — banner handles setup CTA, cell shows a hint
  if (configured === false) return (
    <Tooltip title="Configure UI Validation template from the banner above">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, opacity: 0.45 }}>
        <SettingsOutlined sx={{ fontSize: 14 }} />
        <Typography variant="caption">Setup required</Typography>
      </Box>
    </Tooltip>
  )

  // While parent hasn't determined status yet, show a small spinner
  if (configured === undefined) return <CircularProgress size={14} />

  const handleRun = async () => {
    setRunning(true)
    try {
      const run = await uiValidationApi.run({
        connection_id: connId,
        entity,
        entity_id:    entityId,
      })
      setLastRun(run)
      setReportOpen(true)
    } catch (err) {
      console.error('Validation run failed', err)
    } finally {
      setRunning(false)
    }
  }

  if (running) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <CircularProgress size={14} />
        <span style={{ fontSize: '0.72rem', color: '#666' }}>Running…</span>
      </Box>
    )
  }

  if (lastRun) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Chip
          size="small"
          label={lastRun.status === 'PASS' ? 'Pass' : lastRun.status === 'FAIL' ? 'Fail' : 'Error'}
          color={lastRun.status === 'PASS' ? 'success' : 'error'}
          variant="outlined"
          sx={{ fontSize: '0.7rem', height: 20 }}
        />
        <Tooltip title="View report">
          <IconButton size="small" onClick={() => setReportOpen(true)}>
            <VisibilityOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Re-run">
          <IconButton size="small" onClick={handleRun}>
            <ScienceOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        {reportOpen && (
          <ReportDialog
            run={lastRun}
            connId={connId}
            entity={entity}
            entityId={entityId}
            onClose={() => setReportOpen(false)}
            onRerun={handleRun}
          />
        )}
      </Box>
    )
  }

  return (
    <Tooltip title="Validate this record against the target UI">
      <Button
        size="small"
        variant="outlined"
        color="primary"
        startIcon={<ScienceOutlined fontSize="small" />}
        onClick={handleRun}
        sx={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}
      >
        Validate
      </Button>
    </Tooltip>
  )
}
