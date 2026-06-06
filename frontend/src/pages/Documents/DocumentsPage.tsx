import React, { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, InputLabel,
  LinearProgress, MenuItem, Paper, Select, Stack, TextField, Tooltip,
  Typography,
} from '@mui/material'
import {
  AddOutlined, AutoAwesomeOutlined, CloudUploadOutlined, FolderOutlined,
  RefreshOutlined,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import { FolderTree } from './FolderTree'
import { FileList } from './FileList'
import type { AfsFile, AfsFolder, AfsFolderCreate, AfsFileEntry } from '@/types'

export default function DocumentsPage() {
  const queryClient = useQueryClient()
  const user = useAppStore((s) => s.user)
  const canWrite = user?.role !== 'viewer'

  const [selectedFolder, setSelectedFolder] = useState<AfsFolder | null>(null)
  const [extractingIds, setExtractingIds] = useState<Set<number>>(new Set())

  // Folder dialog
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [editingFolder, setEditingFolder] = useState<AfsFolder | null>(null)
  const [parentFolder, setParentFolder] = useState<AfsFolder | null>(null)
  const [folderForm, setFolderForm] = useState<AfsFolderCreate>({ name: '' })

  // Upload dialog
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [uploadDone, setUploadDone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Entries dialog
  const [entriesFile, setEntriesFile] = useState<AfsFile | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'folder' | 'file'; item: AfsFolder | AfsFile } | null>(null)

  // ── Queries ─────────────────────────────────────────────────
  const { data: folders = [], isLoading: foldersLoading, refetch: refetchFolders } = useQuery({
    queryKey: ['afs-folders'],
    queryFn: documentsApi.getFolders,
  })

  const { data: files = [], isLoading: filesLoading, refetch: refetchFiles } = useQuery({
    queryKey: ['afs-files', selectedFolder?.id],
    queryFn: () => selectedFolder ? documentsApi.getFolderFiles(selectedFolder.id) : Promise.resolve([]),
    enabled: !!selectedFolder,
    refetchInterval: (query) => {
      const data = query.state.data as AfsFile[] | undefined
      if (data?.some((f) => f.status === 'Processing' || f.status === 'PendingExtraction')) return 3000
      return false
    },
  })

  const { data: fileEntries = [] } = useQuery({
    queryKey: ['afs-file-entries', entriesFile?.id],
    queryFn: () => entriesFile ? documentsApi.getFileEntries(entriesFile.id) : Promise.resolve([]),
    enabled: !!entriesFile,
  })

  // ── Mutations ────────────────────────────────────────────────
  const createFolderMut = useMutation({
    mutationFn: (data: AfsFolderCreate) => documentsApi.createFolder(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['afs-folders'] }); setFolderDialogOpen(false) },
  })

  const updateFolderMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AfsFolderCreate> }) => documentsApi.updateFolder(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['afs-folders'] }); setFolderDialogOpen(false) },
  })

  const deleteFolderMut = useMutation({
    mutationFn: (id: number) => documentsApi.deleteFolder(id, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['afs-folders'] })
      if (selectedFolder?.id === (deleteTarget?.item as AfsFolder)?.id) setSelectedFolder(null)
      setDeleteTarget(null)
    },
  })

  const deleteFileMut = useMutation({
    mutationFn: (id: number) => documentsApi.deleteFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['afs-files', selectedFolder?.id] })
      setDeleteTarget(null)
    },
  })

  const extractFolderMut = useMutation({
    mutationFn: (folderId: number) => documentsApi.extractFolder(folderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['afs-files', selectedFolder?.id] }),
  })

  // ── Folder dialog ────────────────────────────────────────────
  const openCreateFolder = (parent: AfsFolder | null = null) => {
    setEditingFolder(null)
    setParentFolder(parent)
    setFolderForm({ name: '', parent_id: parent?.id })
    setFolderDialogOpen(true)
  }

  const openEditFolder = (folder: AfsFolder) => {
    setEditingFolder(folder)
    setParentFolder(null)
    setFolderForm({
      name: folder.name,
      parent_id: folder.parent_id ?? undefined,
      process_name: folder.process_name ?? '',
      source_system: folder.source_system ?? '',
      target_system: folder.target_system ?? '',
      lob: folder.lob ?? '',
      owner_team: folder.owner_team ?? '',
      kb_schema_id: folder.kb_schema_id ?? undefined,
    })
    setFolderDialogOpen(true)
  }

  const handleFolderSave = () => {
    if (!folderForm.name.trim()) return
    if (editingFolder) {
      updateFolderMut.mutate({ id: editingFolder.id, data: folderForm })
    } else {
      createFolderMut.mutate(folderForm)
    }
  }

  // ── File upload ──────────────────────────────────────────────
  const handleUploadFiles = async () => {
    if (!selectedFolder || !uploadFiles.length) return
    setUploadProgress({})
    setUploadDone(false)
    for (const file of uploadFiles) {
      try {
        await documentsApi.uploadFile(selectedFolder.id, file, (pct) => {
          setUploadProgress((prev) => ({ ...prev, [file.name]: pct }))
        })
        setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }))
      } catch (e) {
        setUploadProgress((prev) => ({ ...prev, [file.name]: -1 }))
      }
    }
    setUploadDone(true)
    queryClient.invalidateQueries({ queryKey: ['afs-files', selectedFolder.id] })
  }

  // ── Extract single file ──────────────────────────────────────
  const handleExtract = async (file: AfsFile) => {
    setExtractingIds((prev) => new Set([...prev, file.id]))
    try {
      await documentsApi.extractFile(file.id)
      queryClient.invalidateQueries({ queryKey: ['afs-files', selectedFolder?.id] })
    } finally {
      setExtractingIds((prev) => { const s = new Set(prev); s.delete(file.id); return s })
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Typography variant="h5" fontWeight={700}>Documents</Typography>
        <Stack direction="row" spacing={1}>
          {canWrite && (
            <Button
              variant="contained"
              startIcon={<AddOutlined />}
              onClick={() => openCreateFolder(null)}
            >
              New Folder
            </Button>
          )}
          <Tooltip title="Refresh">
            <Button variant="outlined" onClick={() => refetchFolders()}>
              <RefreshOutlined />
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      <Box sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 180px)' }}>
        {/* ── Folder Tree Panel ── */}
        <Paper variant="outlined" sx={{ width: 280, flexShrink: 0, overflow: 'auto', p: 1 }}>
          <Typography variant="overline" sx={{ px: 1 }}>Folders</Typography>
          {foldersLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <FolderTree
              folders={folders}
              selectedId={selectedFolder?.id ?? null}
              onSelect={setSelectedFolder}
              onCreateChild={openCreateFolder}
              onEdit={openEditFolder}
              onDelete={(f) => setDeleteTarget({ type: 'folder', item: f })}
              canWrite={canWrite}
            />
          )}
        </Paper>

        {/* ── File List Panel ── */}
        <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {!selectedFolder ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <FolderOutlined sx={{ fontSize: 64, color: 'text.disabled', mb: 1 }} />
              <Typography color="text.secondary">Select a folder to view files</Typography>
            </Box>
          ) : (
            <>
              <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
                <Box>
                  <Typography variant="h6" fontWeight={600}>{selectedFolder.name}</Typography>
                  {selectedFolder.process_name && (
                    <Typography variant="caption" color="text.secondary">{selectedFolder.process_name}</Typography>
                  )}
                  {selectedFolder.source_system && (
                    <Chip size="small" label={selectedFolder.source_system} sx={{ ml: 1 }} />
                  )}
                  {selectedFolder.target_system && (
                    <Chip size="small" label={`→ ${selectedFolder.target_system}`} color="primary" sx={{ ml: 0.5 }} />
                  )}
                </Box>
                <Stack direction="row" spacing={1}>
                  {canWrite && (
                    <>
                      <Button
                        size="small" variant="outlined"
                        startIcon={<CloudUploadOutlined />}
                        onClick={() => { setUploadFiles([]); setUploadProgress({}); setUploadDone(false); setUploadOpen(true) }}
                      >
                        Upload Files
                      </Button>
                      <Tooltip title="Extract knowledge from all files in this folder">
                        <Button
                          size="small" variant="outlined" color="secondary"
                          startIcon={extractFolderMut.isPending ? <CircularProgress size={14} /> : <AutoAwesomeOutlined />}
                          disabled={extractFolderMut.isPending}
                          onClick={() => extractFolderMut.mutate(selectedFolder.id)}
                        >
                          Extract All
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </Stack>
              </Stack>

              <FileList
                files={files}
                loading={filesLoading}
                canWrite={canWrite}
                onExtract={handleExtract}
                onDelete={(f) => setDeleteTarget({ type: 'file', item: f })}
                onViewEntries={(f) => setEntriesFile(f)}
                extractingIds={extractingIds}
              />
            </>
          )}
        </Paper>
      </Box>

      {/* ── Folder Dialog ── */}
      <Dialog open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingFolder ? 'Edit Folder' : parentFolder ? `New Subfolder in "${parentFolder.name}"` : 'New Root Folder'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Folder Name" required
              value={folderForm.name}
              onChange={(e) => setFolderForm((p) => ({ ...p, name: e.target.value }))}
              fullWidth size="small"
            />
            <TextField
              label="Process Name" placeholder="e.g. Policy Attach"
              value={folderForm.process_name || ''}
              onChange={(e) => setFolderForm((p) => ({ ...p, process_name: e.target.value }))}
              fullWidth size="small"
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label="Source System" placeholder="e.g. PRD_T5_EXTERNAL_AGGNE"
                value={folderForm.source_system || ''}
                onChange={(e) => setFolderForm((p) => ({ ...p, source_system: e.target.value }))}
                fullWidth size="small"
              />
              <TextField
                label="Target System" placeholder="e.g. DCT"
                value={folderForm.target_system || ''}
                onChange={(e) => setFolderForm((p) => ({ ...p, target_system: e.target.value }))}
                fullWidth size="small"
              />
            </Stack>
            <Stack direction="row" spacing={1}>
              <TextField
                label="LOB" placeholder="e.g. BP"
                value={folderForm.lob || ''}
                onChange={(e) => setFolderForm((p) => ({ ...p, lob: e.target.value }))}
                fullWidth size="small"
              />
              <TextField
                label="Owner Team"
                value={folderForm.owner_team || ''}
                onChange={(e) => setFolderForm((p) => ({ ...p, owner_team: e.target.value }))}
                fullWidth size="small"
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFolderDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!folderForm.name.trim() || createFolderMut.isPending || updateFolderMut.isPending}
            onClick={handleFolderSave}
          >
            {editingFolder ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Upload Dialog ── */}
      <Dialog open={uploadOpen} onClose={() => { if (uploadDone || !Object.keys(uploadProgress).length) setUploadOpen(false) }} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Files to "{selectedFolder?.name}"</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              startIcon={<CloudUploadOutlined />}
              onClick={() => fileInputRef.current?.click()}
            >
              Select Files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".docx,.sql,.xlsx,.xls,.xml,.pdf,.txt,.json,.csv"
              style={{ display: 'none' }}
              onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
            />
            {uploadFiles.map((f) => (
              <Box key={f.name}>
                <Stack direction="row" justifyContent="space-between" mb={0.5}>
                  <Typography variant="body2">{f.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {uploadProgress[f.name] === 100 ? 'Done' :
                     uploadProgress[f.name] === -1 ? 'Failed' :
                     uploadProgress[f.name] != null ? `${uploadProgress[f.name]}%` : ''}
                  </Typography>
                </Stack>
                {uploadProgress[f.name] != null && uploadProgress[f.name] !== -1 && (
                  <LinearProgress
                    variant="determinate"
                    value={uploadProgress[f.name]}
                    color={uploadProgress[f.name] === 100 ? 'success' : 'primary'}
                  />
                )}
                {uploadProgress[f.name] === -1 && (
                  <Typography variant="caption" color="error">Upload failed</Typography>
                )}
              </Box>
            ))}
            {uploadDone && (
              <Alert severity="success">
                Upload complete. Files are ready for extraction.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadOpen(false)}>Close</Button>
          {!uploadDone && (
            <Button
              variant="contained"
              disabled={!uploadFiles.length || Object.keys(uploadProgress).length > 0}
              onClick={handleUploadFiles}
              startIcon={<CloudUploadOutlined />}
            >
              Upload {uploadFiles.length > 0 ? `(${uploadFiles.length})` : ''}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* ── File Entries Dialog ── */}
      <Dialog open={!!entriesFile} onClose={() => setEntriesFile(null)} maxWidth="md" fullWidth>
        <DialogTitle>KB Entries — {entriesFile?.filename}</DialogTitle>
        <DialogContent>
          {fileEntries.length === 0 ? (
            <Typography color="text.secondary">No entries extracted yet.</Typography>
          ) : (
            <Stack spacing={1}>
              {fileEntries.map((e: AfsFileEntry) => (
                <Paper key={e.id} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography variant="body2" fontWeight={600}>{e.title}</Typography>
                      {e.summary && (
                        <Typography variant="caption" color="text.secondary">{e.summary.slice(0, 120)}</Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <Chip size="small" label={e.type} />
                      {e.mapping_confidence && (
                        <Chip
                          size="small"
                          label={e.mapping_confidence}
                          color={e.mapping_confidence === 'Explicit' ? 'success' : e.mapping_confidence === 'Derived' ? 'info' : 'default'}
                        />
                      )}
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEntriesFile(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            {deleteTarget?.type === 'folder'
              ? `Delete folder "${(deleteTarget.item as AfsFolder).name}" and all its files and KB entries?`
              : `Delete file "${(deleteTarget?.item as AfsFile)?.filename}" and its KB entries?`}
            {' '}This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="contained" color="error"
            disabled={deleteFolderMut.isPending || deleteFileMut.isPending}
            onClick={() => {
              if (deleteTarget?.type === 'folder') {
                deleteFolderMut.mutate((deleteTarget.item as AfsFolder).id)
              } else if (deleteTarget?.type === 'file') {
                deleteFileMut.mutate((deleteTarget.item as AfsFile).id)
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
