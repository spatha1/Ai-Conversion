import { useState, useRef } from 'react'
import {
  Box, Grid, TextField, MenuItem, Select, FormControl, InputLabel,
  InputAdornment, IconButton, ToggleButtonGroup, ToggleButton, Typography,
  Alert, Button, alpha,
} from '@mui/material'
import {
  VisibilityOutlined, VisibilityOffOutlined, KeyOutlined, UploadFileOutlined,
  StorageOutlined, AcUnitOutlined,
} from '@mui/icons-material'
import type { ConnectionCreate } from '@/types'
import { tokens } from '@/theme/theme'

const SQL_DIALECTS = ['mssql', 'postgresql', 'mysql', 'sqlite']

export const DEFAULT_SQL: ConnectionCreate = {
  name: '', source_type: 'sql', dialect: 'mssql',
  host: '', port: 1433, database_name: '', schema_name: 'dbo',
  username: '', password: '', query_text: '', sheet_alias: '',
}
export const DEFAULT_SF: ConnectionCreate = {
  name: '', source_type: 'snowflake',
  sf_account: '', sf_warehouse: '', sf_role: '',
  sf_database: '', sf_schema: 'PUBLIC',
  sf_username: '', sf_password: '', sf_private_key: '', sf_private_key_passphrase: '',
  query_text: '', sheet_alias: '',
}

interface Props {
  value: ConnectionCreate
  onChange: (v: ConnectionCreate) => void
  mode?: 'create' | 'edit'
  disabled?: boolean
}

export default function ConnectionForm({ value, onChange, mode = 'create', disabled }: Props) {
  const [showPass, setShowPass] = useState(false)
  const [sfAuth, setSfAuth] = useState<'password' | 'keypair'>(
    value.sf_private_key ? 'keypair' : 'password',
  )
  const keyFileRef = useRef<HTMLInputElement>(null)
  const isSql = value.source_type === 'sql'
  const isSf  = value.source_type === 'snowflake'

  const set = (patch: Partial<ConnectionCreate>) => onChange({ ...value, ...patch })

  const handleKeyFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => set({ sf_private_key: ev.target?.result as string })
    reader.readAsText(file)
  }

  return (
    <Box>
      {/* Source type toggle */}
      <ToggleButtonGroup
        exclusive
        value={value.source_type}
        onChange={(_, v) => v && set({ source_type: v })}
        disabled={disabled}
        size="small"
        sx={{ mb: 2 }}
      >
        <ToggleButton value="sql" sx={{ px: 2, gap: 0.75, fontSize: '0.813rem' }}>
          <StorageOutlined sx={{ fontSize: 15 }} /> SQL Database
        </ToggleButton>
        <ToggleButton value="snowflake" sx={{ px: 2, gap: 0.75, fontSize: '0.813rem' }}>
          <AcUnitOutlined sx={{ fontSize: 15 }} /> Snowflake
        </ToggleButton>
      </ToggleButtonGroup>

      <Grid container spacing={2}>
        {/* Connection name — always shown */}
        <Grid item xs={12}>
          <TextField
            label="Connection Name"
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
            fullWidth size="small" required disabled={disabled}
          />
        </Grid>

        {/* ── SQL fields ──────────────────────────────────────── */}
        {isSql && <>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small" disabled={disabled}>
              <InputLabel>Dialect</InputLabel>
              <Select label="Dialect" value={value.dialect ?? 'mssql'} onChange={(e) => set({ dialect: e.target.value })}>
                {SQL_DIALECTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={5}>
            <TextField
              label="Host / Server"
              value={value.host ?? ''}
              onChange={(e) => set({ host: e.target.value })}
              fullWidth size="small" disabled={disabled}
              helperText={value.dialect === 'mssql' ? 'Use HOST\\INSTANCE for named instances' : undefined}
            />
          </Grid>
          <Grid item xs={12} sm={3}>
            <TextField
              label="Port"
              type="number"
              value={value.port ?? ''}
              onChange={(e) => set({ port: Number(e.target.value) || undefined })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Database"
              value={value.database_name ?? ''}
              onChange={(e) => set({ database_name: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Schema"
              value={value.schema_name ?? ''}
              onChange={(e) => set({ schema_name: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Username"
              value={value.username ?? ''}
              onChange={(e) => set({ username: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Password"
              type={showPass ? 'text' : 'password'}
              value={value.password ?? ''}
              onChange={(e) => set({ password: e.target.value })}
              fullWidth size="small" disabled={disabled}
              placeholder={mode === 'edit' ? '(encrypted — leave blank to keep)' : undefined}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPass((p) => !p)} edge="end">
                      {showPass ? <VisibilityOffOutlined sx={{ fontSize: 15 }} /> : <VisibilityOutlined sx={{ fontSize: 15 }} />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
        </>}

        {/* ── Snowflake fields ─────────────────────────────────── */}
        {isSf && <>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Account"
              value={value.sf_account ?? ''}
              onChange={(e) => set({ sf_account: e.target.value })}
              fullWidth size="small" disabled={disabled}
              helperText="e.g. xy12345.us-east-1"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Warehouse"
              value={value.sf_warehouse ?? ''}
              onChange={(e) => set({ sf_warehouse: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Role"
              value={value.sf_role ?? ''}
              onChange={(e) => set({ sf_role: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Database"
              value={value.sf_database ?? ''}
              onChange={(e) => set({ sf_database: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Schema"
              value={value.sf_schema ?? ''}
              onChange={(e) => set({ sf_schema: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Username"
              value={value.sf_username ?? ''}
              onChange={(e) => set({ sf_username: e.target.value })}
              fullWidth size="small" disabled={disabled}
            />
          </Grid>

          {/* Auth method toggle */}
          <Grid item xs={12}>
            <ToggleButtonGroup
              exclusive value={sfAuth}
              onChange={(_, v) => v && setSfAuth(v)}
              disabled={disabled} size="small"
            >
              <ToggleButton value="password" sx={{ fontSize: '0.75rem', px: 1.5 }}>Password</ToggleButton>
              <ToggleButton value="keypair" sx={{ fontSize: '0.75rem', px: 1.5, gap: 0.5 }}>
                <KeyOutlined sx={{ fontSize: 14 }} /> Key Pair
              </ToggleButton>
            </ToggleButtonGroup>
          </Grid>

          {sfAuth === 'password' && (
            <Grid item xs={12} sm={6}>
              <TextField
                label="Password"
                type={showPass ? 'text' : 'password'}
                value={value.sf_password ?? ''}
                onChange={(e) => set({ sf_password: e.target.value })}
                fullWidth size="small" disabled={disabled}
                placeholder={mode === 'edit' ? '(encrypted — leave blank to keep)' : undefined}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowPass((p) => !p)} edge="end">
                        {showPass ? <VisibilityOffOutlined sx={{ fontSize: 15 }} /> : <VisibilityOutlined sx={{ fontSize: 15 }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
          )}

          {sfAuth === 'keypair' && <>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  label="Private Key (PEM)"
                  value={value.sf_private_key ?? ''}
                  onChange={(e) => set({ sf_private_key: e.target.value })}
                  fullWidth size="small" multiline minRows={3} disabled={disabled}
                  placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                  sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                />
                <Button
                  variant="outlined" size="small" startIcon={<UploadFileOutlined />}
                  onClick={() => keyFileRef.current?.click()} disabled={disabled}
                  sx={{ whiteSpace: 'nowrap', mt: 0.5 }}
                >
                  Upload .p8
                </Button>
                <input ref={keyFileRef} type="file" accept=".p8,.pem,.key" style={{ display: 'none' }} onChange={handleKeyFile} />
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Key Passphrase (optional)"
                type={showPass ? 'text' : 'password'}
                value={value.sf_private_key_passphrase ?? ''}
                onChange={(e) => set({ sf_private_key_passphrase: e.target.value })}
                fullWidth size="small" disabled={disabled}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowPass((p) => !p)} edge="end">
                        {showPass ? <VisibilityOffOutlined sx={{ fontSize: 15 }} /> : <VisibilityOutlined sx={{ fontSize: 15 }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
          </>}
        </>}

        {/* Optional query — both types */}
        <Grid item xs={12}>
          <TextField
            label="Default Query (optional)"
            value={value.query_text ?? ''}
            onChange={(e) => set({ query_text: e.target.value })}
            fullWidth size="small" multiline minRows={2} disabled={disabled}
            placeholder="SELECT * FROM ..."
            helperText="Used as default data source for this connection"
          />
        </Grid>
      </Grid>

      {mode === 'edit' && (
        <Alert severity="info" sx={{ mt: 2, fontSize: '0.75rem' }}>
          Passwords and keys are stored encrypted. Leave blank to keep existing credentials.
        </Alert>
      )}
    </Box>
  )
}
