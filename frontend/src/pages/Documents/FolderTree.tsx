import React, { useState } from 'react'
import {
  Box, IconButton, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  Tooltip, Typography, Collapse, CircularProgress,
} from '@mui/material'
import {
  FolderOutlined, FolderOpenOutlined, ExpandMore, ChevronRight,
  AddOutlined, EditOutlined, DeleteOutlined,
} from '@mui/icons-material'
import type { AfsFolder } from '@/types'

interface FolderTreeProps {
  folders: AfsFolder[]
  selectedId: number | null
  onSelect: (folder: AfsFolder) => void
  onCreateChild: (parent: AfsFolder) => void
  onEdit: (folder: AfsFolder) => void
  onDelete: (folder: AfsFolder) => void
  canWrite: boolean
}

function FolderNode({
  folder, depth, selectedId, onSelect, onCreateChild, onEdit, onDelete, canWrite,
}: {
  folder: AfsFolder
  depth: number
  selectedId: number | null
  onSelect: (f: AfsFolder) => void
  onCreateChild: (f: AfsFolder) => void
  onEdit: (f: AfsFolder) => void
  onDelete: (f: AfsFolder) => void
  canWrite: boolean
}) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = (folder.children?.length ?? 0) > 0
  const isSelected = selectedId === folder.id

  return (
    <>
      <ListItem
        disablePadding
        sx={{ pl: depth * 2 }}
        secondaryAction={
          canWrite ? (
            <Box sx={{ display: 'flex', gap: 0 }}>
              <Tooltip title="New subfolder">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); onCreateChild(folder) }}>
                  <AddOutlined fontSize="inherit" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Edit folder">
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(folder) }}>
                  <EditOutlined fontSize="inherit" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete folder">
                <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); onDelete(folder) }}>
                  <DeleteOutlined fontSize="inherit" />
                </IconButton>
              </Tooltip>
            </Box>
          ) : undefined
        }
      >
        <ListItemButton
          selected={isSelected}
          onClick={() => { onSelect(folder); if (hasChildren) setOpen(!open) }}
          sx={{ borderRadius: 1, pr: canWrite ? 14 : 1 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            {hasChildren ? (
              open
                ? <FolderOpenOutlined fontSize="small" color={isSelected ? 'primary' : 'inherit'} />
                : <FolderOutlined fontSize="small" color={isSelected ? 'primary' : 'inherit'} />
            ) : (
              <FolderOutlined fontSize="small" color={isSelected ? 'primary' : 'action'} />
            )}
          </ListItemIcon>
          {hasChildren && (
            <Box sx={{ mr: 0.5, display: 'flex', alignItems: 'center' }}>
              {open ? <ExpandMore fontSize="inherit" /> : <ChevronRight fontSize="inherit" />}
            </Box>
          )}
          <ListItemText
            primary={folder.name}
            secondary={folder.process_name || undefined}
            primaryTypographyProps={{ variant: 'body2', fontWeight: isSelected ? 700 : 400 }}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </ListItemButton>
      </ListItem>
      {hasChildren && (
        <Collapse in={open} timeout="auto">
          <List disablePadding>
            {folder.children!.map((child) => (
              <FolderNode
                key={child.id}
                folder={child}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                onCreateChild={onCreateChild}
                onEdit={onEdit}
                onDelete={onDelete}
                canWrite={canWrite}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  )
}

export function FolderTree({
  folders, selectedId, onSelect, onCreateChild, onEdit, onDelete, canWrite,
}: FolderTreeProps) {
  if (!folders.length) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          No folders yet. Create a root folder to get started.
        </Typography>
      </Box>
    )
  }

  return (
    <List dense disablePadding>
      {folders.map((f) => (
        <FolderNode
          key={f.id}
          folder={f}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreateChild={onCreateChild}
          onEdit={onEdit}
          onDelete={onDelete}
          canWrite={canWrite}
        />
      ))}
    </List>
  )
}
