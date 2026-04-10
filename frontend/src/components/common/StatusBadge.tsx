import { Box, Typography, alpha } from '@mui/material'
import {
  CheckCircleOutlined,
  ErrorOutlined,
  HourglassEmptyOutlined,
  InfoOutlined,
  WarningAmberOutlined,
} from '@mui/icons-material'

type Status = 'success' | 'error' | 'loading' | 'info' | 'warning'

interface Props {
  status: Status
  label: string
  size?: 'small' | 'medium'
}

const CONFIG: Record<Status, {
  color: string
  bg: string
  border: string
  icon: React.ReactElement
}> = {
  success: {
    color:  '#047857',
    bg:     'rgba(5,150,105,.1)',
    border: 'rgba(5,150,105,.25)',
    icon:   <CheckCircleOutlined />,
  },
  error: {
    color:  '#B91C1C',
    bg:     'rgba(220,38,38,.1)',
    border: 'rgba(220,38,38,.25)',
    icon:   <ErrorOutlined />,
  },
  loading: {
    color:  '#4338CA',
    bg:     'rgba(79,70,229,.1)',
    border: 'rgba(79,70,229,.25)',
    icon:   <HourglassEmptyOutlined />,
  },
  info: {
    color:  '#0369A1',
    bg:     'rgba(2,132,199,.1)',
    border: 'rgba(2,132,199,.25)',
    icon:   <InfoOutlined />,
  },
  warning: {
    color:  '#B45309',
    bg:     'rgba(217,119,6,.1)',
    border: 'rgba(217,119,6,.25)',
    icon:   <WarningAmberOutlined />,
  },
}

export default function StatusBadge({ status, label, size = 'small' }: Props) {
  const { color, bg, border, icon } = CONFIG[status]
  const isSmall = size === 'small'

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.6,
        px: isSmall ? 1 : 1.25,
        py: isSmall ? 0.3 : 0.5,
        borderRadius: isSmall ? 1.5 : 2,
        bgcolor: bg,
        border: `1px solid ${border}`,
        userSelect: 'none',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          color,
          '& svg': { fontSize: isSmall ? 13 : 15 },
        }}
      >
        {icon}
      </Box>
      <Typography
        sx={{
          fontSize: isSmall ? '0.72rem' : '0.813rem',
          fontWeight: 600,
          color,
          lineHeight: 1,
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </Typography>
    </Box>
  )
}
