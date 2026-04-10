import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button, Typography,
  InputAdornment, IconButton, Alert, alpha,
} from '@mui/material'
import {
  PersonOutlineOutlined, LockOutlined,
  VisibilityOutlined, VisibilityOffOutlined,
  AutoAwesomeOutlined,
} from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'

const DEMO_USER = 'admin'
const DEMO_PASS = 'clarity2024'

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAppStore((s) => s.login)
  const user = useAppStore((s) => s.user)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (user) {
    navigate('/projects', { replace: true })
    return null
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    await new Promise((r) => setTimeout(r, 380))
    if (username === DEMO_USER && password === DEMO_PASS) {
      login({ username })
      navigate('/projects')
    } else {
      setError('Invalid username or password. Please try again.')
    }
    setLoading(false)
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(160deg, #0D1117 0%, #0F172A 40%, #131040 100%)`,
        p: 2,
      }}
    >
      {/* ── Mesh gradient orbs ─────────────────────────────── */}
      <Box sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {/* Large indigo orb — top-left */}
        <Box
          sx={{
            position: 'absolute',
            width: 600, height: 600,
            top: '-15%', left: '-10%',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha(tokens.indigo600, 0.22)} 0%, transparent 70%)`,
            filter: 'blur(1px)',
          }}
        />
        {/* Violet orb — bottom-right */}
        <Box
          sx={{
            position: 'absolute',
            width: 500, height: 500,
            bottom: '-10%', right: '-8%',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha(tokens.violet600, 0.2)} 0%, transparent 70%)`,
            filter: 'blur(1px)',
          }}
        />
        {/* Small cyan orb — center-right */}
        <Box
          sx={{
            position: 'absolute',
            width: 280, height: 280,
            top: '40%', right: '22%',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha(tokens.sky600, 0.12)} 0%, transparent 70%)`,
          }}
        />
        {/* Grid overlay */}
        <Box
          sx={{
            position: 'absolute', inset: 0,
            backgroundImage: `
              linear-gradient(${alpha('#ffffff', 0.025)} 1px, transparent 1px),
              linear-gradient(90deg, ${alpha('#ffffff', 0.025)} 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
          }}
        />
      </Box>

      <Box
        sx={{
          width: '100%', maxWidth: 420,
          position: 'relative', zIndex: 1,
          animation: 'fadeUp .4s cubic-bezier(.4,0,.2,1)',
          '@keyframes fadeUp': {
            from: { opacity: 0, transform: 'translateY(16px)' },
            to:   { opacity: 1, transform: 'translateY(0)' },
          },
        }}
      >
        {/* ── Logo area ──────────────────────────────────────── */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box
            sx={{
              width: 60, height: 60, borderRadius: 3, mx: 'auto', mb: 2.5,
              background: `linear-gradient(135deg, ${tokens.indigo500} 0%, ${tokens.violet600} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 0 1px ${alpha(tokens.indigo400, 0.3)}, 0 20px 50px ${alpha(tokens.indigo600, 0.45)}`,
            }}
          >
            <AutoAwesomeOutlined sx={{ color: '#fff', fontSize: 28 }} />
          </Box>
          <Typography
            variant="h4"
            fontWeight={800}
            color="white"
            sx={{ letterSpacing: '-0.025em', mb: 0.75 }}
          >
            Clarity Studio
          </Typography>
          <Typography variant="body2" sx={{ color: alpha('#fff', 0.5) }}>
            Legacy → XML Data Conversion Platform
          </Typography>
        </Box>

        {/* ── Login card ─────────────────────────────────────── */}
        <Card
          sx={{
            borderRadius: 4,
            background: alpha('#161B22', 0.85),
            backdropFilter: 'blur(24px)',
            border: '1px solid',
            borderColor: alpha('#ffffff', 0.09),
            boxShadow: `0 0 0 1px ${alpha('#ffffff', 0.04)}, 0 40px 80px rgba(0,0,0,.5)`,
          }}
        >
          <CardContent sx={{ p: 3.5 }}>
            <Typography variant="h5" fontWeight={700} sx={{ color: '#F1F5F9', mb: 0.75, letterSpacing: '-0.02em' }}>
              Sign In
            </Typography>
            <Typography variant="body2" sx={{ color: alpha('#fff', 0.45), mb: 3 }}>
              Enter your credentials to access the platform
            </Typography>

            {error && (
              <Alert
                severity="error"
                sx={{
                  mb: 2.5, borderRadius: 2,
                  bgcolor: alpha(tokens.red600, 0.12),
                  border: `1px solid ${alpha(tokens.red600, 0.3)}`,
                  color: '#F87171',
                  '& .MuiAlert-icon': { color: '#F87171' },
                }}
              >
                {error}
              </Alert>
            )}

            <Box
              component="form"
              onSubmit={handleLogin}
              sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                size="medium"
                required
                autoFocus
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: alpha('#ffffff', 0.05),
                    '& fieldset': { borderColor: alpha('#ffffff', 0.1) },
                    '&:hover fieldset': { borderColor: alpha('#ffffff', 0.2) },
                    '&.Mui-focused fieldset': { borderColor: tokens.indigo400 },
                    '& input': { color: '#F1F5F9' },
                  },
                  '& .MuiInputLabel-root': { color: alpha('#fff', 0.5) },
                  '& .MuiInputLabel-root.Mui-focused': { color: tokens.indigo400 },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlineOutlined sx={{ fontSize: 18, color: alpha('#fff', 0.35) }} />
                    </InputAdornment>
                  ),
                }}
              />

              <TextField
                label="Password"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                size="medium"
                required
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: alpha('#ffffff', 0.05),
                    '& fieldset': { borderColor: alpha('#ffffff', 0.1) },
                    '&:hover fieldset': { borderColor: alpha('#ffffff', 0.2) },
                    '&.Mui-focused fieldset': { borderColor: tokens.indigo400 },
                    '& input': { color: '#F1F5F9' },
                  },
                  '& .MuiInputLabel-root': { color: alpha('#fff', 0.5) },
                  '& .MuiInputLabel-root.Mui-focused': { color: tokens.indigo400 },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlined sx={{ fontSize: 18, color: alpha('#fff', 0.35) }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setShowPass(!showPass)}
                        sx={{ color: alpha('#fff', 0.35), '&:hover': { color: alpha('#fff', 0.7) } }}
                      >
                        {showPass
                          ? <VisibilityOffOutlined sx={{ fontSize: 18 }} />
                          : <VisibilityOutlined sx={{ fontSize: 18 }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={loading}
                sx={{
                  mt: 0.5, py: 1.4,
                  fontSize: '0.938rem',
                  borderRadius: 2.5,
                  background: loading
                    ? alpha(tokens.indigo500, 0.5)
                    : `linear-gradient(135deg, ${tokens.indigo500} 0%, ${tokens.violet700} 100%)`,
                  boxShadow: loading ? 'none' : `0 8px 24px ${alpha(tokens.indigo600, 0.5)}`,
                  letterSpacing: '0.01em',
                  transition: 'all .2s ease',
                  '&:hover:not(:disabled)': {
                    background: `linear-gradient(135deg, ${tokens.indigo400} 0%, ${tokens.violet600} 100%)`,
                    boxShadow: `0 12px 32px ${alpha(tokens.indigo600, 0.6)}`,
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                {loading ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 14, height: 14, borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,.3)',
                        borderTopColor: '#fff',
                        animation: 'spin .7s linear infinite',
                        '@keyframes spin': { to: { transform: 'rotate(360deg)' } },
                      }}
                    />
                    Signing in…
                  </Box>
                ) : 'Sign In'}
              </Button>
            </Box>

            {/* Demo creds hint */}
            <Box
              sx={{
                mt: 3, p: 1.75, borderRadius: 2.5,
                bgcolor: alpha('#ffffff', 0.04),
                border: '1px solid',
                borderColor: alpha('#ffffff', 0.07),
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: alpha('#fff', 0.35), fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', mb: 0.75, fontSize: '0.625rem' }}
              >
                Demo Credentials
              </Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Typography variant="caption" sx={{ color: alpha('#fff', 0.45) }}>
                  User: <Box component="span" sx={{ color: tokens.indigo400, fontWeight: 600 }}>admin</Box>
                </Typography>
                <Typography variant="caption" sx={{ color: alpha('#fff', 0.45) }}>
                  Pass: <Box component="span" sx={{ color: tokens.indigo400, fontWeight: 600 }}>clarity2024</Box>
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>

        <Typography
          variant="caption"
          sx={{ display: 'block', textAlign: 'center', mt: 3, color: alpha('#fff', 0.25) }}
        >
          Clarity Studio v2.0 · Data Conversion Platform
        </Typography>
      </Box>
    </Box>
  )
}
