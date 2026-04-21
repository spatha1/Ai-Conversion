import { useState } from 'react'
import {
  Drawer, Box, Typography, IconButton, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails, Chip, Tooltip,
  List, ListItemButton, ListItemText, Divider, TextField, InputAdornment,
  Alert,
} from '@mui/material'
import {
  CloseOutlined, ExpandMoreOutlined, KeyOutlined, LinkOutlined,
  SearchOutlined, StorageOutlined, AccountTreeOutlined,
} from '@mui/icons-material'
import { useQuery } from '@tanstack/react-query'
import { reportApi } from '@/api'
import { alpha } from '@mui/material/styles'

interface SchemaExplorerProps {
  connId: number | ''
  open: boolean
  onClose: () => void
  onInsert: (text: string) => void
}

export default function SchemaExplorer({ connId, open, onClose, onInsert }: SchemaExplorerProps) {
  const [search, setSearch] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['report-catalog', connId],
    queryFn: () => reportApi.getCatalog(connId as number),
    enabled: !!connId && open,
    staleTime: 5 * 60 * 1000,
  })

  const tables: { name: string; column_count: number }[] = data?.tables ?? []
  const columns: Record<string, { name: string; data_type: string; is_primary_key: boolean }[]> = data?.columns ?? {}
  const relations: { parent_table: string; parent_column: string; referenced_table: string; referenced_column: string }[] = data?.relations ?? []
  const samples: Record<string, Record<string, unknown>[]> = data?.samples ?? {}

  const filtered = search.trim()
    ? tables.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        (columns[t.name] ?? []).some((c) => c.name.toLowerCase().includes(search.toLowerCase()))
      )
    : tables

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
      PaperProps={{ sx: { width: 300, borderLeft: '1px solid', borderColor: 'divider', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.primary.main, 0.04) }}>
        <AccountTreeOutlined sx={{ fontSize: 18, color: 'primary.main', mr: 1 }} />
        <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1 }}>Schema Explorer</Typography>
        <IconButton size="small" onClick={onClose}><CloseOutlined fontSize="small" /></IconButton>
      </Box>

      {/* Search */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <TextField
          size="small" fullWidth placeholder="Search tables / columns…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchOutlined sx={{ fontSize: 16 }} /></InputAdornment> }}
          sx={{ '& .MuiInputBase-root': { fontSize: '0.8rem' } }}
        />
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        )}

        {error && (
          <Alert severity="warning" sx={{ m: 1.5, fontSize: '0.75rem' }}>
            No catalog found. Run &quot;Collect Schema&quot; in Admin first.
          </Alert>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <Box sx={{ p: 2, color: 'text.disabled', textAlign: 'center' }}>
            <StorageOutlined sx={{ fontSize: 32, mb: 1 }} />
            <Typography variant="caption">No tables found</Typography>
          </Box>
        )}

        {filtered.map((table) => {
          const cols = columns[table.name] ?? []
          const tableSamples = samples[table.name] ?? []
          return (
            <Accordion key={table.name} disableGutters elevation={0}
              sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreOutlined sx={{ fontSize: 16 }} />}
                sx={{ px: 1.5, py: 0.5, minHeight: 36, '& .MuiAccordionSummary-content': { my: 0, alignItems: 'center', gap: 1 } }}>
                <StorageOutlined sx={{ fontSize: 15, color: 'primary.main' }} />
                <Tooltip title={`Click to insert table name`}>
                  <Typography
                    variant="caption" fontWeight={700} noWrap sx={{ flex: 1, cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                    onClick={(e) => { e.stopPropagation(); onInsert(table.name) }}
                  >
                    {table.name}
                  </Typography>
                </Tooltip>
                <Chip label={cols.length} size="small" sx={{ height: 16, fontSize: '0.65rem' }} />
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <List dense disablePadding>
                  {cols.map((col) => (
                    <ListItemButton key={col.name} dense
                      sx={{ pl: 3, pr: 1, py: 0.3 }}
                      onClick={() => onInsert(`${table.name}.${col.name}`)}>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {col.is_primary_key && (
                              <Tooltip title="Primary Key"><KeyOutlined sx={{ fontSize: 11, color: 'warning.main' }} /></Tooltip>
                            )}
                            <Typography variant="caption" noWrap sx={{ flex: 1 }}>{col.name}</Typography>
                            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>{col.data_type}</Typography>
                          </Box>
                        }
                      />
                    </ListItemButton>
                  ))}
                </List>

                {/* Sample data */}
                {tableSamples.length > 0 && (
                  <>
                    <Divider />
                    <Box sx={{ px: 2, py: 1, bgcolor: (t) => alpha(t.palette.grey[500], 0.04) }}>
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.5, fontWeight: 600, fontSize: '0.65rem' }}>SAMPLE DATA</Typography>
                      {Object.entries(tableSamples[0]).slice(0, 4).map(([k, v]) => (
                        <Box key={k} sx={{ display: 'flex', gap: 0.5, mb: 0.2 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', minWidth: 70, fontWeight: 600 }} noWrap>{k}:</Typography>
                          <Typography variant="caption" sx={{ fontSize: '0.65rem' }} noWrap>{String(v ?? '')}</Typography>
                        </Box>
                      ))}
                    </Box>
                  </>
                )}
              </AccordionDetails>
            </Accordion>
          )
        })}

        {/* FK Relations */}
        {relations.length > 0 && (
          <>
            <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.secondary.main, 0.04) }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <LinkOutlined sx={{ fontSize: 14, color: 'secondary.main' }} />
                <Typography variant="caption" fontWeight={700} color="secondary.main" sx={{ fontSize: '0.7rem' }}>
                  RELATIONSHIPS ({relations.length})
                </Typography>
              </Box>
              {relations.slice(0, 10).map((r, i) => (
                <Typography key={i} variant="caption" sx={{ display: 'block', fontSize: '0.65rem', mb: 0.3, color: 'text.secondary' }}>
                  {r.parent_table}.{r.parent_column} → {r.referenced_table}.{r.referenced_column}
                </Typography>
              ))}
              {relations.length > 10 && (
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                  +{relations.length - 10} more…
                </Typography>
              )}
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  )
}
