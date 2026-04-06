import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button, Typography,
  InputAdornment, IconButton, Alert, Divider, alpha,
} from '@mui/material'
import {
  PersonOutlineOutlined, LockOutlined,
  VisibilityOutlined, VisibilityOffOutlined, SwapHorizOutlined,
} from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'

// Hardcoded demo credentials (replace with real auth when needed)
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

  // Auto-redirect if already logged in
  if (user) {
    navigate('/projects', { replace: true })
    return null
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    await new Promise((r) => setTimeout(r, 400))

    if (username === DEMO_USER && password === DEMO_PASS) {
      login({ username })
      navigate('/projects')
    } else {
      setError('Invalid username or password')
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
        background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)',
        p: 2,
      }}
    >
      {/* Background decoration */}
      <Box
        sx={{
          position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
        }}
      >
        {[...Array(6)].map((_, i) => (
          <Box
            key={i}
            sx={{
              position: 'absolute',
              borderRadius: '50%',
              background: alpha('#2563eb', 0.05),
              width: [300, 400, 200, 500, 250, 350][i],
              height: [300, 400, 200, 500, 250, 350][i],
              top: ['10%', '60%', '30%', '70%', '-5%', '40%'][i],
              left: ['5%', '70%', '40%', '10%', '80%', '55%'][i],
              filter: 'blur(60px)',
            }}
          />
        ))}
      </Box>

      <Box sx={{ width: '100%', maxWidth: 420, position: 'relative' }}>
        {/* Logo area */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box
            sx={{
              width: 64, height: 64, borderRadius: 3, mx: 'auto', mb: 2,
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 20px 40px rgba(37,99,235,.4)',
            }}
          >
            <SwapHorizOutlined sx={{ color: '#fff', fontSize: 32 }} />
          </Box>
          <Typography variant="h4" fontWeight={700} color="white" gutterBottom>
            Clarity Studio
          </Typography>
          <Typography variant="body2" sx={{ color: alpha('#fff', 0.6) }}>
            Legacy → XML Data Conversion Platform
          </Typography>
        </Box>

        <Card sx={{ borderRadius: 4, boxShadow: '0 40px 80px rgba(0,0,0,.4)' }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              Sign In
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Enter your credentials to access the platform
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>
                {error}
              </Alert>
            )}

            <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                size="medium"
                required
                autoFocus
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlineOutlined fontSize="small" color="action" />
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
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlined fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowPass(!showPass)}>
                        {showPass ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
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
                sx={{ mt: 1, py: 1.5, fontSize: '1rem', borderRadius: 2 }}
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </Box>

            <Divider sx={{ my: 3 }}>
              <Typography variant="caption" color="text.secondary">
                DEMO CREDENTIALS
              </Typography>
            </Divider>

            <Box
              sx={{
                p: 2, borderRadius: 2,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
                border: '1px dashed',
                borderColor: (t) => alpha(t.palette.primary.main, 0.2),
              }}
            >
              <Typography variant="caption" color="text.secondary" display="block">
                Username: <strong>admin</strong>
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Password: <strong>clarity2024</strong>
              </Typography>
            </Box>
          </CardContent>
        </Card>

        <Typography
          variant="caption"
          sx={{ display: 'block', textAlign: 'center', mt: 3, color: alpha('#fff', 0.35) }}
        >
          Clarity Studio v2.0 · Data Conversion Platform
        </Typography>
      </Box>
    </Box>
  )
}
