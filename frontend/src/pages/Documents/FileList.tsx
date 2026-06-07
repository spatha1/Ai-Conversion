import React from 'react'
import {
  Box, Button, Chip, CircularProgress, IconButton, LinearProgress,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import {
  AutoAwesomeOutlined, DeleteOutlined, InfoOutlined, RefreshOutlined,
} from '@mui/icons-material'
import type { AfsFile, FileStatus } from '@/types'

const STATUS_COLOR: Record<FileStatus, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  Uploaded: 'default',
  PendingExtraction: 'info',
  Processing: 'warning',
  Extracted: 'success',
  Failed: 'error',
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface FileListProps {
  files: AfsFile[]
  loading: boolean
  canWrite: boolean
  onExtract: (file: AfsFile) => void
  onDelete: (file: AfsFile) => void
  onViewEntries: (file: AfsFile) => void
  extractingIds: Set<number>
}

export function FileList({
  files, loading, canWrite, onExtract, onDelete, onViewEntries, extractingIds,
}: FileListProps) {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (!files.length) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No files in this folder. Upload files to get started.
        </Typography>
      </Box>
    )
  }

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>File</TableCell>
          <TableCell>Size</TableCell>
          <TableCell sx={{ minWidth: 180 }}>Status</TableCell>
          <TableCell align="center">Entries</TableCell>
          <TableCell>Uploaded</TableCell>
          <TableCell />
        </TableRow>
      </TableHead>
      <TableBody>
        {files.map((f) => {
          const isProcessing = f.status === 'Processing' || f.status === 'PendingExtraction' || extractingIds.has(f.id)
          const pct = f.extraction_progress ?? 0
          const step = f.extraction_step ?? ''
          return (
            <TableRow key={f.id} hover>
              <TableCell>
                <Typography variant="body2" fontWeight={500}>{f.filename}</Typography>
                {f.extraction_error && (
                  <Typography variant="caption" color="error" display="block">
                    {f.extraction_error.slice(0, 120)}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                <Typography variant="caption">{formatBytes(f.file_size)}</Typography>
              </TableCell>

              {/* ── Status + progress bar ── */}
              <TableCell>
                <Chip
                  size="small"
                  label={isProcessing ? (f.status === 'PendingExtraction' ? 'Queued' : 'Processing…') : f.status}
                  color={STATUS_COLOR[f.status]}
                  icon={isProcessing ? <CircularProgress size={12} sx={{ color: 'inherit' }} /> : undefined}
                />
                {isProcessing && (
                  <Box sx={{ mt: 0.75 }}>
                    <LinearProgress
                      variant={pct > 0 ? 'determinate' : 'indeterminate'}
                      value={pct}
                      sx={{ height: 4, borderRadius: 2, width: 160 }}
                    />
                    {step && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                        sx={{ mt: 0.25, maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {pct > 0 ? `${pct}% — ` : ''}{step}
                      </Typography>
                    )}
                  </Box>
                )}
              </TableCell>

              <TableCell align="center">
                {f.entry_count > 0 ? (
                  <Tooltip title="View KB entries">
                    <Button
                      size="small" variant="text"
                      onClick={() => onViewEntries(f)}
                      sx={{ minWidth: 0, fontWeight: 600 }}
                    >
                      {f.entry_count}
                    </Button>
                  </Tooltip>
                ) : (
                  <Typography variant="caption" color="text.disabled">—</Typography>
                )}
              </TableCell>
              <TableCell>
                <Typography variant="caption">
                  {f.uploaded_at ? new Date(f.uploaded_at).toLocaleDateString() : '—'}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                  {canWrite && (
                    <Tooltip title={f.status === 'Extracted' ? 'Re-extract knowledge' : 'Extract knowledge'}>
                      <span>
                        <IconButton
                          size="small"
                          color="primary"
                          disabled={isProcessing}
                          onClick={() => onExtract(f)}
                        >
                          {isProcessing
                            ? <CircularProgress size={14} />
                            : f.status === 'Extracted'
                              ? <RefreshOutlined fontSize="small" />
                              : <AutoAwesomeOutlined fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  {f.entry_count > 0 && (
                    <Tooltip title="View extracted KB entries">
                      <IconButton size="small" onClick={() => onViewEntries(f)}>
                        <InfoOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {canWrite && (
                    <Tooltip title="Delete file and KB entries">
                      <IconButton size="small" color="error" onClick={() => onDelete(f)}>
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
