import React, { useState, useEffect, useRef } from 'react'
import {
  Badge, IconButton, Popover, Box, Typography, Divider, Button,
  List, ListItem, ListItemText, Chip, CircularProgress,
} from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import CheckIcon from '@mui/icons-material/Check'
import { notificationsApi, type AppNotification } from '@/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

const TYPE_COLOR: Record<string, 'info' | 'success' | 'warning'> = {
  project_assigned: 'info',
  approval_needed:  'warning',
  approval_decided: 'success',
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function NotificationBell() {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const qc = useQueryClient()

  const { data: countData } = useQuery({
    queryKey: ['notif-count'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 30000,
  })

  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(),
    staleTime: 30000,
  })

  useEffect(() => {
    if (anchor) refetch()
  }, [anchor, refetch])

  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notif-count'] })
    },
  })

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notif-count'] })
    },
  })

  const unread = countData?.count ?? 0

  return (
    <>
      <IconButton
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
        sx={{ color: 'text.secondary' }}
      >
        <Badge badgeContent={unread} color="error" max={99}>
          <NotificationsIcon fontSize="small" />
        </Badge>
      </IconButton>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 360, maxHeight: 480, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle2" fontWeight={600}>Notifications</Typography>
          {unread > 0 && (
            <Button size="small" startIcon={<CheckIcon />} onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          )}
        </Box>
        <Divider />

        <Box sx={{ overflowY: 'auto', flex: 1 }}>
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {!isLoading && notifications.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              No notifications
            </Typography>
          )}
          <List disablePadding>
            {notifications.map((n: AppNotification) => (
              <React.Fragment key={n.id}>
                <ListItem
                  alignItems="flex-start"
                  sx={{
                    py: 1.5, px: 2,
                    bgcolor: n.is_read ? 'transparent' : 'action.hover',
                    cursor: n.is_read ? 'default' : 'pointer',
                    '&:hover': { bgcolor: 'action.selected' },
                  }}
                  onClick={() => { if (!n.is_read) markRead.mutate(n.id) }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                        <Chip
                          label={n.type.replace(/_/g, ' ')}
                          size="small"
                          color={TYPE_COLOR[n.type] ?? 'default'}
                          sx={{ fontSize: 10, height: 18 }}
                        />
                        {!n.is_read && (
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main', ml: 'auto' }} />
                        )}
                      </Box>
                    }
                    secondary={
                      <>
                        <Typography variant="body2" fontWeight={n.is_read ? 400 : 600} sx={{ mb: 0.25 }}>
                          {n.title}
                        </Typography>
                        {n.body && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {n.body}
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.disabled">
                          {timeAgo(n.created_at)}
                        </Typography>
                      </>
                    }
                  />
                </ListItem>
                <Divider component="li" />
              </React.Fragment>
            ))}
          </List>
        </Box>
      </Popover>
    </>
  )
}
