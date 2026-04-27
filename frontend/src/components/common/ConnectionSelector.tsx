import { FormControl, InputLabel, Select, MenuItem, CircularProgress, Box } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { SourceConnection } from '@/types'

interface Props {
  value: number | ''
  onChange: (conn: SourceConnection | null, id: number | '') => void
  label?: string
  size?: 'small' | 'medium'
  sx?: object
  projectId?: number
  showAll?: boolean        // list ALL connections across all projects (avoid — use includeGlobal instead)
  includeGlobal?: boolean  // list project connections + global (no-project) connections
}

export default function ConnectionSelector({ value, onChange, label = 'Connection', size = 'small', sx, projectId, showAll, includeGlobal }: Props) {
  const activeProject = useAppStore((s) => s.activeProject)
  const pid = showAll ? undefined : (projectId ?? activeProject?.id)

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['connections', showAll ? 'all' : pid, includeGlobal ? 'withGlobal' : ''],
    queryFn: () => showAll
      ? connectionsApi.list(undefined)
      : connectionsApi.list(pid, false, includeGlobal),
  })

  return (
    <FormControl size={size} sx={{ minWidth: 220, ...sx }}>
      <InputLabel>{label}</InputLabel>
      <Select
        value={value}
        label={label}
        onChange={(e) => {
          const id = e.target.value as number | ''
          const conn = connections.find((c) => c.id === id) ?? null
          onChange(conn, id)
        }}
        endAdornment={isLoading ? (
          <Box sx={{ pr: 2, display: 'flex' }}>
            <CircularProgress size={14} />
          </Box>
        ) : undefined}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {connections.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            <Box>
              <Box sx={{ fontWeight: 500 }}>{c.name}</Box>
              <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                {c.source_type} {c.dialect ? `· ${c.dialect}` : ''}
              </Box>
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
