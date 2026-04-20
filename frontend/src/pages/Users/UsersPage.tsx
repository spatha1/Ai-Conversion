import { useState } from 'react'
import {
  Box, Typography, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, Chip, Avatar, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, Alert, CircularProgress,
  alpha,
} from '@mui/material'
import {
  AddOutlined, EditOutlined, PersonOffOutlined, PersonOutlined,
  PeopleOutlined, RefreshOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { usersApi, projectMembersApi } from '@/api'
import type { UserRecord, UserRole } from '@/types'

const ROLE_COLORS: Record<UserRole, { bg: string; text: string; label: string }> = {
  admin:     { bg: '#7C3AED20', text: '#7C3AED', label: 'Admin' },
  developer: { bg: '#1D4ED820', text: '#1D4ED8', label: 'Developer' },
  viewer:    { bg: '#6B728020', text: '#6B7280', label: 'Viewer' },
}

function RoleChip({ role }: { role: UserRole }) {
  const c = ROLE_COLORS[role]
  return (
    <Chip
      label={c.label}
      size="small"
      sx={{ bgcolor: c.bg, color: c.text, fontWeight: 700, fontSize: '0.75rem', border: 'none' }}
    />
  )
}

function StatusChip({ active }: { active: boolean }) {
  return (
    <Chip
      label={active ? 'Active' : 'Inactive'}
      size="small"
      sx={{
        bgcolor: active ? '#16a34a20' : '#6B728018',
        color: active ? '#16a34a' : '#6B7280',
        fontWeight: 600, fontSize: '0.75rem', border: 'none',
      }}
    />
  )
}

// ── Create User Dialog ─────────────────────────────────────────────────────────
function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'developer' as UserRole })
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: () => usersApi.create({ username: form.username, email: form.email || undefined, password: form.password, role: form.role }),
    onSuccess: (data, _vars, _ctx) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setForm({ username: '', email: '', password: '', role: 'developer' })
      setErr('')
      // If the API returned 200 instead of 201, it means the user already existed
      enqueueSnackbar('User saved successfully', { variant: 'success' })
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Create User</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
        {err && <Alert severity="error" sx={{ mb: 1 }}>{err}</Alert>}
        <TextField label="Username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required fullWidth />
        <TextField label="Email (optional)" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} fullWidth />
        <TextField label="Password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required fullWidth />
        <FormControl fullWidth>
          <InputLabel>Role</InputLabel>
          <Select label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
            <MenuItem value="admin">Admin</MenuItem>
            <MenuItem value="developer">Developer</MenuItem>
            <MenuItem value="viewer">Viewer</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={!form.username || !form.password || mutation.isPending}
        >
          {mutation.isPending ? <CircularProgress size={18} /> : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Edit User Dialog ───────────────────────────────────────────────────────────
function EditUserDialog({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ email: user.email ?? '', role: user.role, is_active: user.is_active })
  const [err, setErr] = useState('')

  const mutation = useMutation({
    mutationFn: () => usersApi.update(user.id, {
      email: form.email || undefined,
      role: form.role,
      is_active: form.is_active,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setErr('')
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <Dialog open={true} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Edit User — {user.username}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
        {err && <Alert severity="error" sx={{ mb: 1 }}>{err}</Alert>}
        <TextField label="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} fullWidth />
        <FormControl fullWidth>
          <InputLabel>Role</InputLabel>
          <Select label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
            <MenuItem value="admin">Admin</MenuItem>
            <MenuItem value="developer">Developer</MenuItem>
            <MenuItem value="viewer">Viewer</MenuItem>
          </Select>
        </FormControl>
        <FormControl fullWidth>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={form.is_active ? 'active' : 'inactive'} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.value === 'active' }))}>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <CircularProgress size={18} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
function UserProjectsCell({ userId }: { userId: number }) {
  const { data: projects = [] } = useQuery({
    queryKey: ['user-projects', userId],
    queryFn: () => projectMembersApi.listUserProjects(userId),
    staleTime: 60_000,
  })
  if (projects.length === 0) return <Typography variant="caption" color="text.disabled">—</Typography>
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxWidth: 200 }}>
      {projects.map((p) => (
        <Tooltip key={p.project_id} title={`${p.project_role.replace('_', ' ')} in ${p.project_name}`}>
          <Chip label={p.project_name} size="small" sx={{ fontSize: '0.7rem', height: 18 }} />
        </Tooltip>
      ))}
    </Box>
  )
}

export default function UsersPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserRecord | null>(null)

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  })

  const deactivate = useMutation({
    mutationFn: (id: number) => usersApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const formatDate = (dt: string | null) =>
    dt ? new Date(dt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 36, height: 36, borderRadius: 2, bgcolor: alpha('#7C3AED', 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <PeopleOutlined sx={{ fontSize: 20, color: '#7C3AED' }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>User Management</Typography>
            <Typography variant="caption" color="text.secondary">{users.length} user{users.length !== 1 ? 's' : ''}</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Refresh">
            <IconButton onClick={() => qc.invalidateQueries({ queryKey: ['users'] })} size="small">
              <RefreshOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreateOpen(true)} size="small">
            Add User
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error instanceof Error ? error.message : 'Failed to load users'}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.8rem', color: 'text.secondary', bgcolor: 'action.hover' } }}>
              <TableCell>User</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Projects</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Last Login</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                  No users found
                </TableCell>
              </TableRow>
            ) : users.map((u) => (
              <TableRow
                key={u.id}
                sx={{ opacity: u.is_active ? 1 : 0.55, '&:hover': { bgcolor: 'action.hover' } }}
              >
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar sx={{ width: 28, height: 28, fontSize: '0.75rem', fontWeight: 700, background: `linear-gradient(135deg, #6366F1, #7C3AED)` }}>
                      {u.username[0].toUpperCase()}
                    </Avatar>
                    <Typography variant="body2" fontWeight={600}>{u.username}</Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{u.email ?? '—'}</Typography>
                </TableCell>
                <TableCell><RoleChip role={u.role} /></TableCell>
                <TableCell><UserProjectsCell userId={u.id} /></TableCell>
                <TableCell><StatusChip active={u.is_active} /></TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{formatDate(u.created_at)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{formatDate(u.last_login)}</Typography>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={() => setEditUser(u)}>
                      <EditOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {u.is_active ? (
                    <Tooltip title="Deactivate">
                      <IconButton size="small" onClick={() => deactivate.mutate(u.id)} sx={{ color: 'warning.main' }}>
                        <PersonOffOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <Tooltip title="Activate (use Edit → Status)">
                      <IconButton size="small" onClick={() => setEditUser(u)} sx={{ color: 'success.main' }}>
                        <PersonOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {createOpen && <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />}
      {editUser && <EditUserDialog user={editUser} onClose={() => setEditUser(null)} />}
    </Box>
  )
}
