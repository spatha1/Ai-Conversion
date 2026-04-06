import { useState } from 'react'
import {
  Box, Grid, Card, CardContent, CardActionArea, CardActions,
  Typography, Button, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Chip, Avatar, Tooltip, InputAdornment,
  Skeleton, Alert, Menu, MenuItem, ListItemIcon, alpha,
  Divider,
} from '@mui/material'
import {
  AddOutlined, SearchOutlined, FolderOutlined, MoreVertOutlined,
  EditOutlined, DeleteOutlined, ArrowForwardOutlined, FiberManualRecord,
  TransformOutlined, CalendarTodayOutlined, SwapHorizOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSnackbar } from 'notistack'
import { useAppStore } from '@/store/useAppStore'
import { projectsApi } from '@/api'
import type { Project, ProjectCreate } from '@/types'
import ConfirmDialog from '@/components/common/ConfirmDialog'

function ProjectCard({
  project,
  onSelect,
  onEdit,
  onDelete,
  isActive,
}: {
  project: Project
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  isActive: boolean
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null)

  const colors = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0284c7']
  const color = colors[project.id % colors.length]

  const initials = project.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: isActive ? '2px solid' : '1px solid',
        borderColor: isActive ? 'primary.main' : 'divider',
        transition: 'all .2s',
        '&:hover': {
          boxShadow: (t) => `0 8px 24px ${alpha(color, 0.2)}`,
          transform: 'translateY(-2px)',
        },
      }}
    >
      <CardActionArea onClick={onSelect} sx={{ flex: 1 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
            <Avatar
              sx={{
                width: 48, height: 48, borderRadius: 2,
                bgcolor: alpha(color, 0.1), color,
                fontSize: 18, fontWeight: 700,
              }}
            >
              {initials}
            </Avatar>
            {isActive && (
              <Chip
                label="Active"
                size="small"
                color="primary"
                icon={<FiberManualRecord sx={{ fontSize: '10px !important' }} />}
                sx={{ fontWeight: 600 }}
              />
            )}
          </Box>

          <Typography variant="h6" fontWeight={700} gutterBottom noWrap>
            {project.name}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mb: 2,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: 40,
            }}
          >
            {project.description || 'No description provided'}
          </Typography>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TransformOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
              <Typography variant="caption" color="text.secondary">
                {project.connection_count ?? 0} connections
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CalendarTodayOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
              <Typography variant="caption" color="text.secondary">
                {new Date(project.updated_at).toLocaleDateString()}
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </CardActionArea>

      <Divider />

      <CardActions sx={{ px: 2, py: 1, justifyContent: 'space-between' }}>
        <Button
          size="small"
          endIcon={<ArrowForwardOutlined />}
          onClick={onSelect}
          color="primary"
          sx={{ fontWeight: 600 }}
        >
          Open Project
        </Button>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget) }}
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
      >
        <MenuItem
          onClick={() => { setAnchorEl(null); onEdit() }}
        >
          <ListItemIcon><EditOutlined fontSize="small" /></ListItemIcon>
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => { setAnchorEl(null); onDelete() }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon><DeleteOutlined fontSize="small" color="error" /></ListItemIcon>
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
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
        p: 4,
      }}
    >
      {/* Header */}
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
        <Box
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            mb: 5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box
              sx={{
                width: 44, height: 44, borderRadius: 2,
                background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <SwapHorizOutlined sx={{ color: '#fff', fontSize: 24 }} />
            </Box>
            <Box>
              <Typography variant="h4" fontWeight={800} color="white">
                Clarity Studio
              </Typography>
              <Typography variant="body2" sx={{ color: alpha('#fff', 0.6) }}>
                Select or create a project to get started
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="body2" sx={{ color: alpha('#fff', 0.7) }}>
              Signed in as <strong>{user?.username}</strong>
            </Typography>
            <Button
              variant="outlined"
              size="small"
              onClick={() => { logout(); navigate('/login') }}
              sx={{ color: alpha('#fff', 0.7), borderColor: alpha('#fff', 0.3) }}
            >
              Logout
            </Button>
          </Box>
        </Box>

        {/* Action bar */}
        <Box sx={{ display: 'flex', gap: 2, mb: 4, flexWrap: 'wrap' }}>
          <TextField
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            sx={{
              flex: 1, minWidth: 240,
              '& .MuiOutlinedInput-root': {
                bgcolor: alpha('#fff', 0.08),
                borderRadius: 2,
                color: 'white',
                '& fieldset': { borderColor: alpha('#fff', 0.2) },
                '&:hover fieldset': { borderColor: alpha('#fff', 0.4) },
                '& input::placeholder': { color: alpha('#fff', 0.4) },
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlined sx={{ color: alpha('#fff', 0.5), fontSize: 18 }} />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => { setCreateOpen(true); setForm({ name: '', description: '' }) }}
            sx={{ px: 3 }}
          >
            New Project
          </Button>
        </Box>

        {/* Error */}
        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
            Failed to load projects. Make sure the API server is running on port 8000.
          </Alert>
        )}

        {/* Projects grid */}
        <Grid container spacing={3}>
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Grid item xs={12} sm={6} md={4} key={i}>
                  <Skeleton variant="rounded" height={220} sx={{ borderRadius: 3 }} />
                </Grid>
              ))
            : filteredProjects.length === 0
            ? (
              <Grid item xs={12}>
                <Box
                  sx={{
                    textAlign: 'center', py: 10,
                    color: alpha('#fff', 0.5),
                  }}
                >
                  <FolderOutlined sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
                  <Typography variant="h6" sx={{ color: alpha('#fff', 0.6) }}>
                    {search ? 'No projects match your search' : 'No projects yet'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: alpha('#fff', 0.4), mt: 1 }}>
                    {search ? 'Try a different search term' : 'Create your first project to get started'}
                  </Typography>
                  {!search && (
                    <Button
                      variant="contained"
                      startIcon={<AddOutlined />}
                      sx={{ mt: 3 }}
                      onClick={() => setCreateOpen(true)}
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
                />
              </Grid>
            ))}
        </Grid>
      </Box>

      {/* Create Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Project Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
              fullWidth
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              multiline
              rows={3}
              fullWidth
              placeholder="What is this project for? (optional)"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
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

      {/* Edit Dialog */}
      <Dialog open={Boolean(editProject)} onClose={() => setEditProject(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Project</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Project Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
              fullWidth
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              multiline
              rows={3}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditProject(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!form.name.trim() || updateMutation.isPending}
            onClick={() =>
              editProject && updateMutation.mutate({ id: editProject.id, data: form })
            }
          >
            {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Project"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        dangerous
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  )
}
