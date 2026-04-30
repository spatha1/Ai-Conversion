import { useState } from 'react'
import {
  Fab, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Select, MenuItem, FormControl, InputLabel,
  Box, Typography, ToggleButton, ToggleButtonGroup, Tooltip,
  alpha, CircularProgress,
} from '@mui/material'
import {
  FeedbackOutlined, BugReportOutlined, StarOutlined,
  TipsAndUpdatesOutlined, HelpOutlineOutlined, ThumbUpOutlined,
  CloseOutlined,
} from '@mui/icons-material'
import { useMutation } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useLocation } from 'react-router-dom'
import { feedbackApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'

const MODULES = [
  'General', 'Conversion', 'Reporting', 'PS Support',
  'Development', 'Admin', 'Testing', 'Dashboards', 'AI Agents',
]

const TYPES = [
  { value: 'bug',         label: 'Bug',             icon: <BugReportOutlined sx={{ fontSize: 16 }} />,        color: '#EF4444' },
  { value: 'feature',     label: 'Feature',          icon: <StarOutlined sx={{ fontSize: 16 }} />,             color: '#8B5CF6' },
  { value: 'improvement', label: 'Improvement',      icon: <TipsAndUpdatesOutlined sx={{ fontSize: 16 }} />,   color: '#3B82F6' },
  { value: 'question',    label: 'Question',         icon: <HelpOutlineOutlined sx={{ fontSize: 16 }} />,      color: '#F59E0B' },
  { value: 'praise',      label: 'Praise',           icon: <ThumbUpOutlined sx={{ fontSize: 16 }} />,          color: '#10B981' },
]

const BLANK = { module: 'General', area: '', type: 'bug', priority: 'medium', title: '', description: '' }

export default function FeedbackButton({ inline = false }: { inline?: boolean }) {
  const { enqueueSnackbar } = useSnackbar()
  const location = useLocation()
  const user = useAppStore((s) => s.user)

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)

  const submit = useMutation({
    mutationFn: () => feedbackApi.submit({
      submitted_by: user?.username,
      module:       form.module,
      area:         form.area || undefined,
      type:         form.type,
      priority:     form.priority,
      title:        form.title,
      description:  form.description || undefined,
      page_url:     location.pathname,
    }),
    onSuccess: () => {
      enqueueSnackbar('Feedback submitted — thank you!', { variant: 'success' })
      setOpen(false)
      setForm(BLANK)
    },
    onError: () => enqueueSnackbar('Submit failed, please try again', { variant: 'error' }),
  })

  const close = () => { setOpen(false); setForm(BLANK) }
  const typeColor = TYPES.find((t) => t.value === form.type)?.color ?? '#8B5CF6'

  return (
    <>
      {inline ? (
        /* Header icon button */
        <Tooltip title="Share feedback" placement="bottom" arrow>
          <IconButton
            size="small"
            onClick={() => setOpen(true)}
            sx={{
              width: 32, height: 32, borderRadius: 1.5,
              color: alpha('#7C3AED', 0.85),
              '&:hover': { bgcolor: alpha('#7C3AED', 0.1) },
            }}
          >
            <FeedbackOutlined sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      ) : (
        /* Original floating FAB */
        <Tooltip title="Share feedback with the team" placement="left" arrow>
          <Fab
            variant="extended"
            size="small"
            onClick={() => setOpen(true)}
            sx={{
              position: 'fixed', bottom: 24, right: 24, zIndex: 1300,
              bgcolor: alpha('#7C3AED', 0.88), color: '#fff',
              boxShadow: '0 2px 10px rgba(124,58,237,.25)',
              px: 1.75, gap: 0.75, fontSize: '0.75rem', fontWeight: 600,
              '&:hover': { bgcolor: '#7C3AED', boxShadow: '0 4px 16px rgba(124,58,237,.38)' },
            }}
          >
            <FeedbackOutlined sx={{ fontSize: 15 }} />
            Feedback
          </Fab>
        </Tooltip>
      )}

      {/* Dialog */}
      <Dialog open={open} onClose={close} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <FeedbackOutlined sx={{ color: '#7C3AED' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" fontWeight={700}>Share Feedback</Typography>
            <Typography variant="caption" color="text.secondary">
              Help us improve Clarity Studio
            </Typography>
          </Box>
          <Button size="small" onClick={close} sx={{ minWidth: 0, p: 0.5 }}>
            <CloseOutlined fontSize="small" />
          </Button>
        </DialogTitle>

        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>

          {/* Type toggle */}
          <Box>
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              Type *
            </Typography>
            <ToggleButtonGroup
              value={form.type} exclusive size="small" fullWidth
              onChange={(_e, v) => v && setForm((f) => ({ ...f, type: v }))}
            >
              {TYPES.map((t) => (
                <ToggleButton key={t.value} value={t.value}
                  sx={{
                    gap: 0.5, fontSize: '0.72rem', textTransform: 'none', py: 0.75,
                    '&.Mui-selected': {
                      bgcolor: alpha(t.color, 0.12),
                      color: t.color,
                      borderColor: alpha(t.color, 0.4),
                      '&:hover': { bgcolor: alpha(t.color, 0.18) },
                    },
                  }}
                >
                  {t.icon}{t.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {/* Module + Area row */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Module</InputLabel>
              <Select label="Module" value={form.module}
                onChange={(e) => setForm((f) => ({ ...f, module: e.target.value }))}>
                {MODULES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Area (optional)" size="small" fullWidth
              placeholder="e.g. AI Field Mapping"
              value={form.area}
              onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
            />
          </Box>

          {/* Priority */}
          <FormControl size="small" fullWidth>
            <InputLabel>Priority</InputLabel>
            <Select label="Priority" value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              <MenuItem value="low"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#6B7280' }} />Low</Box></MenuItem>
              <MenuItem value="medium"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#F59E0B' }} />Medium</Box></MenuItem>
              <MenuItem value="high"><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#EF4444' }} />High</Box></MenuItem>
            </Select>
          </FormControl>

          {/* Title */}
          <TextField
            label="Title *" size="small" fullWidth required
            placeholder="Brief summary of your feedback"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />

          {/* Description */}
          <TextField
            label="Description" size="small" fullWidth multiline minRows={4}
            placeholder="Describe the issue, idea, or experience in detail…"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />

          {/* Page hint */}
          <Typography variant="caption" color="text.disabled">
            Page captured automatically: <strong>{location.pathname}</strong>
          </Typography>
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Button onClick={close} size="small">Cancel</Button>
          <Button
            variant="contained" size="small"
            disabled={!form.title.trim() || submit.isPending}
            onClick={() => submit.mutate()}
            startIcon={submit.isPending ? <CircularProgress size={13} color="inherit" /> : undefined}
            sx={{
              bgcolor: typeColor, '&:hover': { bgcolor: typeColor, filter: 'brightness(0.9)' },
              '&:disabled': { bgcolor: alpha(typeColor, 0.4) },
            }}
          >
            {submit.isPending ? 'Submitting…' : 'Submit Feedback'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
