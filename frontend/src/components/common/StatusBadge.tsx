import { Chip } from '@mui/material'
import {
  CheckCircleOutlineOutlined,
  ErrorOutlineOutlined,
  HourglassEmptyOutlined,
  InfoOutlined,
} from '@mui/icons-material'

type Status = 'success' | 'error' | 'loading' | 'info' | 'warning'

interface Props {
  status: Status
  label: string
  size?: 'small' | 'medium'
}

const CONFIG: Record<Status, { color: 'success' | 'error' | 'warning' | 'info' | 'default'; icon: React.ReactElement }> = {
  success: { color: 'success', icon: <CheckCircleOutlineOutlined /> },
  error: { color: 'error', icon: <ErrorOutlineOutlined /> },
  loading: { color: 'default', icon: <HourglassEmptyOutlined /> },
  info: { color: 'info', icon: <InfoOutlined /> },
  warning: { color: 'warning', icon: <InfoOutlined /> },
}

export default function StatusBadge({ status, label, size = 'small' }: Props) {
  const { color, icon } = CONFIG[status]
  return (
    <Chip
      icon={icon}
      label={label}
      color={color}
      size={size}
      variant="outlined"
      sx={{ fontWeight: 500 }}
    />
  )
}
