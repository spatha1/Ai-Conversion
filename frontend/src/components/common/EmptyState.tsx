import { Box, Typography, alpha } from '@mui/material'
import { tokens } from '@/theme/theme'

interface Props {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export default function EmptyState({ icon, title, description, action }: Props) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        px: 3,
        gap: 2,
      }}
    >
      {icon && (
        <Box
          sx={{
            width: 72, height: 72,
            borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${alpha(tokens.indigo600, 0.08)}, ${alpha(tokens.violet600, 0.06)})`,
            border: `1px solid ${alpha(tokens.indigo600, 0.12)}`,
            color: alpha(tokens.indigo600, 0.5),
            '& svg': { fontSize: 32 },
          }}
        >
          {icon}
        </Box>
      )}

      <Box sx={{ textAlign: 'center', maxWidth: 380 }}>
        <Typography
          variant="h6"
          fontWeight={600}
          sx={{ color: 'text.secondary', mb: description ? 0.75 : 0 }}
        >
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.disabled" sx={{ lineHeight: 1.65 }}>
            {description}
          </Typography>
        )}
      </Box>

      {action && <Box sx={{ mt: 0.5 }}>{action}</Box>}
    </Box>
  )
}
