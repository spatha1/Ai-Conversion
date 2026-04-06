import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Box, Typography, alpha } from '@mui/material'
import { UploadFileOutlined, InsertDriveFileOutlined } from '@mui/icons-material'

interface Props {
  onFile: (file: File) => void
  accept?: Record<string, string[]>
  label?: string
  sublabel?: string
  file?: File | null
  height?: number
}

export default function FileDropZone({
  onFile,
  accept = { '*/*': [] },
  label = 'Drop file here',
  sublabel = 'or click to browse',
  file,
  height = 140,
}: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => { if (accepted[0]) onFile(accepted[0]) },
    [onFile],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
  })

  return (
    <Box
      {...getRootProps()}
      sx={{
        height,
        border: '2px dashed',
        borderColor: isDragActive ? 'primary.main' : 'divider',
        borderRadius: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        cursor: 'pointer',
        transition: 'all .2s',
        bgcolor: isDragActive
          ? (t) => alpha(t.palette.primary.main, 0.04)
          : file
          ? (t) => alpha(t.palette.success.main, 0.04)
          : 'transparent',
        '&:hover': {
          borderColor: 'primary.light',
          bgcolor: (t) => alpha(t.palette.primary.main, 0.03),
        },
      }}
    >
      <input {...getInputProps()} />
      {file ? (
        <>
          <InsertDriveFileOutlined sx={{ fontSize: 36, color: 'success.main' }} />
          <Typography variant="body2" fontWeight={600} color="success.main">
            {file.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {(file.size / 1024).toFixed(1)} KB · Click to replace
          </Typography>
        </>
      ) : (
        <>
          <UploadFileOutlined
            sx={{ fontSize: 36, color: isDragActive ? 'primary.main' : 'text.disabled' }}
          />
          <Typography variant="body2" fontWeight={500} color={isDragActive ? 'primary' : 'text.secondary'}>
            {isDragActive ? 'Drop it here' : label}
          </Typography>
          <Typography variant="caption" color="text.disabled">
            {sublabel}
          </Typography>
        </>
      )}
    </Box>
  )
}
