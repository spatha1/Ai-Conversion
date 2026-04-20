import { useState } from 'react'
import {
  Box, TextField, Button, Typography,
  InputAdornment, IconButton, Alert, alpha, Chip,
} from '@mui/material'
import {
  PersonOutlineOutlined, LockOutlined,
  VisibilityOutlined, VisibilityOffOutlined,
  AutoAwesomeOutlined, SchemaOutlined, MapOutlined,
  CodeOutlined, VerifiedOutlined, ArrowForwardOutlined,
} from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/useAppStore'
import { authApi } from '@/api'
import { REFRESH_STORAGE_KEY } from '@/api/client'
import { tokens } from '@/theme/theme'

const NAV = '#01398c'   // primary navy
const NAV2 = '#1A5099'

const FEATURES = [
  { icon: <SchemaOutlined sx={{ fontSize: 20 }} />, label: 'Schema Discovery', desc: 'Auto-collect tables, columns & relationships' },
  { icon: <MapOutlined sx={{ fontSize: 20 }} />,    label: 'AI Field Mapping',  desc: 'Embedding-driven source → target mapping' },
  { icon: <CodeOutlined sx={{ fontSize: 20 }} />,   label: 'XML Generation',    desc: 'Template-based bulk XML output' },
  { icon: <VerifiedOutlined sx={{ fontSize: 20 }} />,label: 'Validation',       desc: 'Rule-based XML & reconciliation checks' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAppStore((s) => s.login)
  const user  = useAppStore((s) => s.user)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  if (user) { navigate('/projects', { replace: true }); return null }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.login(username, password)
      localStorage.setItem(REFRESH_STORAGE_KEY, data.refresh_token)
      login({
        id:       data.user_id,
        username: data.username,
        role:     data.role,
        token:    data.access_token,
      })
      navigate('/projects')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid username or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: '#f8fafc' }}>

      {/* ══ LEFT PANEL — brand + feature list ══════════════════ */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          width: { md: '52%', lg: '55%' },
          position: 'relative',
          overflow: 'hidden',
          background: `linear-gradient(145deg, ${NAV} 0%, ${NAV2} 55%, #0E2A5A 100%)`,
          px: { md: 6, lg: 8 },
          py: 6,
        }}
      >
        {/* Decorative circles */}
        <Box sx={{
          position: 'absolute', width: 520, height: 520,
          top: '-120px', right: '-140px', borderRadius: '50%',
          background: alpha('#fff', 0.04), border: `1px solid ${alpha('#fff', 0.07)}`,
          pointerEvents: 'none',
        }} />
        <Box sx={{
          position: 'absolute', width: 320, height: 320,
          bottom: '-60px', left: '-80px', borderRadius: '50%',
          background: alpha('#fff', 0.04), border: `1px solid ${alpha('#fff', 0.06)}`,
          pointerEvents: 'none',
        }} />
        {/* Subtle grid */}
        <Box sx={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(${alpha('#fff', 0.035)} 1px, transparent 1px),
            linear-gradient(90deg, ${alpha('#fff', 0.035)} 1px, transparent 1px)
          `,
          backgroundSize: '52px 52px',
        }} />

        {/* Content */}
        <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* Logo */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mb: 'auto' }}>
            <Box sx={{
              width: 44, height: 44, borderRadius: 2.5,
              background: alpha('#fff', 0.12),
              border: `1px solid ${alpha('#fff', 0.2)}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AutoAwesomeOutlined sx={{ color: '#fff', fontSize: 22 }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={700} color="white" sx={{ lineHeight: 1.2 }}>
                Clarity Studio
              </Typography>
              <Typography variant="caption" sx={{ color: alpha('#fff', 0.5), lineHeight: 1 }}>
                Data Conversion Platform
              </Typography>
            </Box>
          </Box>

          {/* Headline */}
          <Box sx={{ mt: 8, mb: 6 }}>
            <Chip
              label="AI-Powered · Enterprise Grade"
              size="small"
              sx={{
                mb: 2.5, bgcolor: alpha('#fff', 0.1), color: alpha('#fff', 0.85),
                border: `1px solid ${alpha('#fff', 0.2)}`, fontSize: '0.72rem', fontWeight: 600,
              }}
            />
            <Typography
              variant="h3" fontWeight={800} color="white"
              sx={{ lineHeight: 1.15, letterSpacing: '-0.03em', mb: 2 }}
            >
              Legacy Data to<br />
              <Box component="span" sx={{
                background: 'linear-gradient(90deg, #93C5FD 0%, #C4B5FD 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                XML in Minutes
              </Box>
            </Typography>
            <Typography variant="body1" sx={{ color: alpha('#fff', 0.6), maxWidth: 380, lineHeight: 1.7 }}>
              Connect any SQL or Snowflake source, map fields with AI assistance, and generate validated XML output at scale.
            </Typography>
          </Box>

          {/* Feature list */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 'auto' }}>
            {FEATURES.map((f) => (
              <Box key={f.label} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{
                  width: 40, height: 40, borderRadius: 2, flexShrink: 0,
                  bgcolor: alpha('#fff', 0.1),
                  border: `1px solid ${alpha('#fff', 0.12)}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: alpha('#fff', 0.85),
                }}>
                  {f.icon}
                </Box>
                <Box>
                  <Typography variant="body2" fontWeight={700} color="white" sx={{ lineHeight: 1.3 }}>
                    {f.label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: alpha('#fff', 0.5) }}>
                    {f.desc}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>

          {/* Footer */}
          <Typography variant="caption" sx={{ color: alpha('#fff', 0.25), mt: 6 }}>
            Clarity Studio v2.0 · © 2025
          </Typography>
        </Box>
      </Box>

      {/* ══ RIGHT PANEL — login form ═══════════════════════════ */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 3, sm: 6, lg: 8 },
          py: 6,
          bgcolor: '#ffffff',
          position: 'relative',
        }}
      >
        {/* Mobile logo — only shown on small screens */}
        <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1.5, mb: 5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            background: `linear-gradient(135deg, ${NAV} 0%, ${NAV2} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AutoAwesomeOutlined sx={{ color: '#fff', fontSize: 20 }} />
          </Box>
          <Typography variant="h6" fontWeight={800} color="primary">Clarity Studio</Typography>
        </Box>

        <Box
          sx={{
            width: '100%', maxWidth: 400,
            animation: 'fadeUp .35s cubic-bezier(.4,0,.2,1)',
            '@keyframes fadeUp': {
              from: { opacity: 0, transform: 'translateY(12px)' },
              to:   { opacity: 1, transform: 'translateY(0)' },
            },
          }}
        >
          {/* Heading */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h4" fontWeight={800} sx={{ color: '#0F172A', letterSpacing: '-0.03em', mb: 0.75 }}>
              Welcome back
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in to your Clarity Studio account
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2, fontSize: '0.85rem' }}>
              {error}
            </Alert>
          )}

          {/* Form */}
          <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Box>
              <Typography variant="caption" fontWeight={600} sx={{ color: '#374151', display: 'block', mb: 0.75 }}>
                Username
              </Typography>
              <TextField
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                fullWidth size="medium" required autoFocus
                placeholder="Enter your username"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    bgcolor: '#F9FAFB',
                    '& fieldset': { borderColor: '#E5E7EB' },
                    '&:hover fieldset': { borderColor: '#9CA3AF' },
                    '&.Mui-focused fieldset': { borderColor: NAV, borderWidth: 2 },
                  },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlineOutlined sx={{ fontSize: 18, color: '#9CA3AF' }} />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            <Box>
              <Typography variant="caption" fontWeight={600} sx={{ color: '#374151', display: 'block', mb: 0.75 }}>
                Password
              </Typography>
              <TextField
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                fullWidth size="medium" required
                placeholder="Enter your password"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    bgcolor: '#F9FAFB',
                    '& fieldset': { borderColor: '#E5E7EB' },
                    '&:hover fieldset': { borderColor: '#9CA3AF' },
                    '&.Mui-focused fieldset': { borderColor: NAV, borderWidth: 2 },
                  },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlined sx={{ fontSize: 18, color: '#9CA3AF' }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setShowPass(!showPass)}
                        sx={{ color: '#9CA3AF', '&:hover': { color: '#374151' } }}
                      >
                        {showPass
                          ? <VisibilityOffOutlined sx={{ fontSize: 18 }} />
                          : <VisibilityOutlined sx={{ fontSize: 18 }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={loading}
              endIcon={!loading && <ArrowForwardOutlined />}
              sx={{
                mt: 0.5, py: 1.5, borderRadius: 2,
                fontSize: '0.938rem', fontWeight: 700,
                background: loading
                  ? alpha(NAV, 0.5)
                  : `linear-gradient(135deg, ${NAV} 0%, ${NAV2} 100%)`,
                boxShadow: loading ? 'none' : `0 4px 16px ${alpha(NAV, 0.35)}`,
                letterSpacing: '0.01em',
                transition: 'all .2s ease',
                '&:hover:not(:disabled)': {
                  boxShadow: `0 6px 24px ${alpha(NAV, 0.45)}`,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              {loading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{
                    width: 14, height: 14, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,.3)',
                    borderTopColor: '#fff',
                    animation: 'spin .7s linear infinite',
                    '@keyframes spin': { to: { transform: 'rotate(360deg)' } },
                  }} />
                  Signing in…
                </Box>
              ) : 'Sign In'}
            </Button>
          </Box>

        </Box>
      </Box>
    </Box>
  )
}
