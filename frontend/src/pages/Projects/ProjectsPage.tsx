import { useState } from 'react'
import {
  Box, Grid, Card, CardContent, CardActionArea, CardActions,
  Typography, Button, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Chip, Avatar, Tooltip, InputAdornment,
  Skeleton, Alert, Menu, MenuItem, ListItemIcon, alpha,
  Divider, FormControl, InputLabel, Select, Table, TableHead,
  TableRow, TableCell, TableBody, CircularProgress,
} from '@mui/material'
import {
  AddOutlined, SearchOutlined, FolderOutlined, MoreVertOutlined,
  EditOutlined, DeleteOutlined, ArrowForwardOutlined,
  TransformOutlined, CalendarTodayOutlined,
  AutoAwesomeOutlined, FiberManualRecord, GroupOutlined, PersonAddOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { projectsApi, projectMembersApi, usersApi } from '@/api'
import type { Project, ProjectCreate } from '@/types'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { tokens } from '@/theme/theme'

const PROJECT_COLORS = [
  tokens.indigo600, tokens.violet600, tokens.emerald600,
  tokens.amber600,  tokens.red600,    tokens.sky600,
]

function ProjectCard({
  project, onSelect, onEdit, onDelete, onManageMembers, isActive,
}: {
  project: Project
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onManageMembers: () => void
  isActive: boolean
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)
  const color = PROJECT_COLORS[project.id % PROJECT_COLORS.length]

  const initials = project.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <Card
      sx={{
        height: '100%', display: 'flex', flexDirection: 'column',
        border: '1px solid',
        borderColor: isActive ? alpha(color, 0.5) : 'rgba(255,255,255,.08)',
        background: isActive
          ? `linear-gradient(160deg, ${alpha(color, 0.08)} 0%, rgba(255,255,255,.03) 100%)`
          : 'rgba(255,255,255,.04)',
        backdropFilter: 'blur(12px)',
        transition: 'all .22s ease',
        '&:hover': {
          borderColor: alpha(color, 0.4),
          background: `linear-gradient(160deg, ${alpha(color, 0.1)} 0%, rgba(255,255,255,.05) 100%)`,
          transform: 'translateY(-3px)',
          boxShadow: `0 16px 40px ${alpha(color, 0.2)}`,
        },
      }}
    >
      <CardActionArea onClick={onSelect} sx={{ flex: 1, alignItems: 'flex-start' }}>
        <CardContent sx={{ p: 2.5 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
            <Avatar
              sx={{
                width: 44, height: 44, borderRadius: 2,
                background: `linear-gradient(135deg, ${color} 0%, ${alpha(color, 0.7)} 100%)`,
                fontSize: 16, fontWeight: 800, color: '#fff',
                boxShadow: `0 4px 12px ${alpha(color, 0.4)}`,
              }}
            >
              {initials}
            </Avatar>
            {isActive && (
              <Chip
                label="Active"
                size="small"
                icon={<FiberManualRecord sx={{ fontSize: '8px !important', color: '#34D399 !important' }} />}
                sx={{
                  height: 22, fontWeight: 700, fontSize: '0.688rem',
                  bgcolor: alpha(tokens.emerald600, 0.15),
                  color: '#34D399',
                  border: `1px solid ${alpha(tokens.emerald600, 0.3)}`,
                }}
              />
            )}
          </Box>

          <Typography
            variant="h6"
            fontWeight={700}
            gutterBottom
            noWrap
            sx={{ color: '#F1F5F9', letterSpacing: '-0.01em' }}
          >
            {project.name}
          </Typography>

          <Typography
            variant="body2"
            sx={{
              mb: 2.5, color: alpha('#fff', 0.45),
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
              minHeight: 38, lineHeight: 1.6,
            }}
          >
            {project.description || 'No description provided'}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <TransformOutlined sx={{ fontSize: 13, color: alpha('#fff', 0.3) }} />
              <Typography variant="caption" sx={{ color: alpha('#fff', 0.45), fontSize: '0.75rem' }}>
                {project.connection_count ?? 0} connections
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <CalendarTodayOutlined sx={{ fontSize: 13, color: alpha('#fff', 0.3) }} />
              <Typography variant="caption" sx={{ color: alpha('#fff', 0.45), fontSize: '0.75rem' }}>
                {new Date(project.updated_at).toLocaleDateString()}
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </CardActionArea>

      <Divider sx={{ borderColor: 'rgba(255,255,255,.07)' }} />

      <CardActions sx={{ px: 2, py: 1, justifyContent: 'space-between' }}>
        <Button
          size="small"
          endIcon={<ArrowForwardOutlined sx={{ fontSize: 14 }} />}
          onClick={onSelect}
          sx={{
            color: alpha(color, 0.9),
            fontWeight: 600,
            fontSize: '0.813rem',
            '&:hover': { bgcolor: alpha(color, 0.1) },
          }}
        >
          Open
        </Button>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget) }}
          sx={{ color: alpha('#fff', 0.3), '&:hover': { color: alpha('#fff', 0.7) } }}
        >
          <MoreVertOutlined fontSize="small" />
        </IconButton>
      </CardActions>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        PaperProps={{
          sx: {
            bgcolor: tokens.darkCard,
            border: `1px solid rgba(255,255,255,.1)`,
          },
        }}
      >
        <MenuItem onClick={() => { setAnchorEl(null); onEdit() }} sx={{ color: '#F1F5F9' }}>
          <ListItemIcon><EditOutlined fontSize="small" sx={{ color: tokens.indigo400 }} /></ListItemIcon>
          Edit
        </MenuItem>
        <MenuItem onClick={() => { setAnchorEl(null); onManageMembers() }} sx={{ color: '#F1F5F9' }}>
          <ListItemIcon><GroupOutlined fontSize="small" sx={{ color: tokens.indigo400 }} /></ListItemIcon>
          Manage Members
        </MenuItem>
        <MenuItem
          onClick={() => { setAnchorEl(null); onDelete() }}
          sx={{ color: '#F87171' }}
        >
          <ListItemIcon><DeleteOutlined fontSize="small" sx={{ color: '#F87171' }} /></ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
    </Card>
  )
}

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { enqueueSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const { activeProject, setActiveProject, user, logout } = useAppStore()

  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [form, setForm] = useState<ProjectCreate>({ name: '', description: '' })
  const [membersProject, setMembersProject] = useState<Project | null>(null)
  const [assignUserId, setAssignUserId] = useState<number | ''>('')
  const [assignRole, setAssignRole] = useState<string>('developer')

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  })

  const createMutation = useMutation({
    mutationFn: projectsApi.create,
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setCreateOpen(false)
      setForm({ name: '', description: '' })
      enqueueSnackbar(`Project "${project.name}" created`, { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ProjectCreate> }) =>
      projectsApi.update(id, data),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (activeProject?.id === project.id) setActiveProject(project)
      setEditProject(null)
      enqueueSnackbar('Project updated', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: projectsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (activeProject?.id === deleteTarget?.id) setActiveProject(null)
      setDeleteTarget(null)
      enqueueSnackbar('Project deleted', { variant: 'success' })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const { data: allUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  })

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['project-members', membersProject?.id],
    queryFn: () => projectMembersApi.list(membersProject!.id),
    enabled: Boolean(membersProject),
  })

  const assignMut = useMutation({
    mutationFn: () => projectMembersApi.assign(membersProject!.id, assignUserId as number, assignRole),
    onSuccess: () => {
      enqueueSnackbar('Member assigned', { variant: 'success' })
      setAssignUserId('')
      queryClient.invalidateQueries({ queryKey: ['project-members', membersProject?.id] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const removeMemberMut = useMutation({
    mutationFn: (userId: number) => projectMembersApi.remove(membersProject!.id, userId),
    onSuccess: () => {
      enqueueSnackbar('Member removed', { variant: 'info' })
      queryClient.invalidateQueries({ queryKey: ['project-members', membersProject?.id] })
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const handleSelect = (project: Project) => {
    setActiveProject(project)
    navigate('/conversion')
  }

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description?.toLowerCase().includes(search.toLowerCase()),
  )

  const openEdit = (p: Project) => {
    setEditProject(p)
    setForm({ name: p.name, description: p.description ?? '' })
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(160deg, ${tokens.darkBg} 0%, #0F172A 50%, #130F40 100%)`,
        p: { xs: 2, sm: 3, md: 4 },
      }}
    >
      {/* Background orbs */}
      <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <Box sx={{
          position: 'absolute', width: 700, height: 700,
          top: '-20%', left: '-15%', borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(tokens.indigo600, 0.15)} 0%, transparent 65%)`,
        }} />
        <Box sx={{
          position: 'absolute', width: 500, height: 500,
          bottom: '-10%', right: '-5%', borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(tokens.violet600, 0.12)} 0%, transparent 65%)`,
        }} />
        <Box sx={{
          position: 'absolute', inset: 0,
          backgroundImage: `linear-gradient(${alpha('#ffffff', 0.02)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#ffffff', 0.02)} 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }} />
      </Box>

      <Box
        sx={{
          maxWidth: 1200, mx: 'auto', position: 'relative', zIndex: 1,
          animation: 'fadeUp .35s cubic-bezier(.4,0,.2,1)',
          '@keyframes fadeUp': {
            from: { opacity: 0, transform: 'translateY(12px)' },
            to:   { opacity: 1, transform: 'translateY(0)' },
          },
        }}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 5, flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                width: 44, height: 44, borderRadius: 2.5, flexShrink: 0,
                background: `linear-gradient(135deg, ${tokens.indigo500}, ${tokens.violet600})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 16px ${alpha(tokens.indigo600, 0.5)}`,
              }}
            >
              <AutoAwesomeOutlined sx={{ color: '#fff', fontSize: 22 }} />
            </Box>
            <Box>
              <Typography variant="h4" fontWeight={800} color="white" sx={{ letterSpacing: '-0.025em', lineHeight: 1.1 }}>
                Clarity Studio
              </Typography>
              <Typography variant="body2" sx={{ color: alpha('#fff', 0.45), mt: 0.25 }}>
                Select or create a project to get started
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                px: 1.5, py: 0.6, borderRadius: 2,
                bgcolor: alpha('#fff', 0.07),
                border: `1px solid ${alpha('#fff', 0.1)}`,
              }}
            >
              <Typography variant="caption" sx={{ color: alpha('#fff', 0.6), fontWeight: 500 }}>
                {user?.username}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              size="small"
              onClick={() => { logout(); navigate('/login') }}
              sx={{
                color: alpha('#fff', 0.6),
                borderColor: alpha('#fff', 0.2),
                fontWeight: 600,
                '&:hover': { bgcolor: alpha('#fff', 0.07), borderColor: alpha('#fff', 0.35) },
              }}
            >
              Sign Out
            </Button>
          </Box>
        </Box>

        {/* ── Action bar ──────────────────────────────────── */}
        <Box sx={{ display: 'flex', gap: 2, mb: 4, flexWrap: 'wrap' }}>
          <TextField
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{
              flex: 1, minWidth: 240,
              '& .MuiOutlinedInput-root': {
                bgcolor: alpha('#fff', 0.06),
                borderRadius: 2.5,
                color: 'white',
                '& fieldset': { borderColor: alpha('#fff', 0.12) },
                '&:hover fieldset': { borderColor: alpha('#fff', 0.25) },
                '&.Mui-focused fieldset': { borderColor: tokens.indigo400 },
                '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(tokens.indigo500, 0.2)}` },
                '& input::placeholder': { color: alpha('#fff', 0.35) },
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined sx={{ color: alpha('#fff', 0.35), fontSize: 18 }} />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => { setCreateOpen(true); setForm({ name: '', description: '' }) }}
            sx={{
              px: 3, borderRadius: 2.5,
              background: `linear-gradient(135deg, ${tokens.indigo500}, ${tokens.violet700})`,
              boxShadow: `0 6px 20px ${alpha(tokens.indigo600, 0.45)}`,
              '&:hover': {
                background: `linear-gradient(135deg, ${tokens.indigo400}, ${tokens.violet600})`,
                boxShadow: `0 10px 28px ${alpha(tokens.indigo600, 0.55)}`,
              },
            }}
          >
            New Project
          </Button>
        </Box>

        {/* Error */}
        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2, bgcolor: alpha(tokens.red600, 0.12), borderColor: alpha(tokens.red600, 0.3), color: '#F87171' }}>
            Failed to load projects. Make sure the API server is running on port 8000.
          </Alert>
        )}

        {/* ── Projects grid ──────────────────────────────── */}
        <Grid container spacing={2.5}>
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Grid item xs={12} sm={6} md={4} key={i}>
                  <Skeleton
                    variant="rounded" height={230}
                    sx={{ borderRadius: 3, bgcolor: alpha('#fff', 0.06) }}
                  />
                </Grid>
              ))
            : filteredProjects.length === 0
            ? (
              <Grid item xs={12}>
                <Box sx={{ textAlign: 'center', py: 12 }}>
                  <FolderOutlined sx={{ fontSize: 56, color: alpha('#fff', 0.15), mb: 2 }} />
                  <Typography variant="h6" sx={{ color: alpha('#fff', 0.5), mb: 1 }}>
                    {search ? 'No projects match your search' : 'No projects yet'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: alpha('#fff', 0.3), mb: 3 }}>
                    {search ? 'Try a different search term' : 'Create your first project to get started'}
                  </Typography>
                  {!search && (
                    <Button
                      variant="contained"
                      startIcon={<AddOutlined />}
                      onClick={() => setCreateOpen(true)}
                      sx={{
                        background: `linear-gradient(135deg, ${tokens.indigo500}, ${tokens.violet700})`,
                        boxShadow: `0 6px 20px ${alpha(tokens.indigo600, 0.4)}`,
                      }}
                    >
                      Create First Project
                    </Button>
                  )}
                </Box>
              </Grid>
            )
            : filteredProjects.map((project) => (
              <Grid item xs={12} sm={6} md={4} key={project.id}>
                <ProjectCard
                  project={project}
                  isActive={activeProject?.id === project.id}
                  onSelect={() => handleSelect(project)}
                  onEdit={() => openEdit(project)}
                  onDelete={() => setDeleteTarget(project)}
                  onManageMembers={() => { setMembersProject(project); setAssignUserId(''); setAssignRole('developer') }}
                />
              </Grid>
            ))}
        </Grid>
      </Box>

      {/* ── Create Dialog ──────────────────────────────────── */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Project Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus fullWidth />
            <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline rows={3} fullWidth placeholder="What is this project for? (optional)" />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!form.name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(form)}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Project'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Edit Dialog ────────────────────────────────────── */}
      <Dialog open={Boolean(editProject)} onClose={() => setEditProject(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Project</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="Project Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus fullWidth />
            <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline rows={3} fullWidth />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setEditProject(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!form.name.trim() || updateMutation.isPending}
            onClick={() => editProject && updateMutation.mutate({ id: editProject.id, data: form })}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirm ──────────────────────────────────── */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Project"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        dangerous
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ── Manage Members Dialog ──────────────────────────────── */}
      <Dialog open={Boolean(membersProject)} onClose={() => setMembersProject(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <GroupOutlined />
            Members — {membersProject?.name}
          </Box>
        </DialogTitle>
        <DialogContent>
          {/* Assign new member */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'flex-end' }}>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>User</InputLabel>
              <Select
                label="User"
                value={assignUserId}
                onChange={(e) => setAssignUserId(Number(e.target.value))}
              >
                {allUsers.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.username} {u.email ? `(${u.email})` : ''}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>Role</InputLabel>
              <Select
                label="Role"
                value={assignRole}
                onChange={(e) => setAssignRole(e.target.value)}
              >
                <MenuItem value="manager">Manager</MenuItem>
                <MenuItem value="team_lead">Team Lead</MenuItem>
                <MenuItem value="developer">Developer</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="contained"
              size="small"
              startIcon={<PersonAddOutlined />}
              disabled={!assignUserId || assignMut.isPending}
              onClick={() => assignMut.mutate()}
            >
              Assign
            </Button>
          </Box>
          <Divider sx={{ mb: 1 }} />
          {membersLoading ? (
            <CircularProgress size={24} sx={{ m: 2 }} />
          ) : members.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No members assigned yet.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Project Role</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.username}</TableCell>
                    <TableCell>{m.email ?? '—'}</TableCell>
                    <TableCell>
                      <Chip label={m.project_role.replace('_', ' ')} size="small" />
                    </TableCell>
                    <TableCell>
                      <Tooltip title="Remove">
                        <IconButton size="small" color="error" onClick={() => removeMemberMut.mutate(m.user_id)}>
                          <DeleteOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMembersProject(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
