import React, { useState } from 'react'
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, IconButton, Stack, TextField, Tooltip, Typography,
  Accordion, AccordionSummary, AccordionDetails, Divider,
} from '@mui/material'
import {
  AddOutlined, DeleteOutlined, ExpandMoreOutlined,
} from '@mui/icons-material'
import { uiValidationApi } from '@/api'

interface KVRow { key: string; value: string }

interface Props {
  connId:  number
  onClose: () => void
  onSaved: () => void
}

const emptyRow = (): KVRow => ({ key: '', value: '' })

export default function SetupDialog({ connId, onClose, onSaved }: Props) {
  const [appName,         setAppName]         = useState('')
  const [baseUrl,         setBaseUrl]         = useState('')
  const [responseIdField, setResponseIdField] = useState('')
  const [entities,        setEntities]        = useState<KVRow[]>([emptyRow()])
  const [selectors,       setSelectors]       = useState<KVRow[]>([emptyRow()])

  // Login config (optional)
  const [loginExpanded, setLoginExpanded] = useState(false)
  const [loginUrl,       setLoginUrl]      = useState('')
  const [usernameSel,    setUsernameSel]   = useState('')
  const [passwordSel,    setPasswordSel]   = useState('')
  const [submitSel,      setSubmitSel]     = useState('')
  const [username,       setUsername]      = useState('')
  const [password,       setPassword]      = useState('')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const updateKV = (
    list: KVRow[],
    setList: (v: KVRow[]) => void,
    idx: number,
    field: 'key' | 'value',
    val: string,
  ) => {
    const next = [...list]
    next[idx] = { ...next[idx], [field]: val }
    setList(next)
  }

  const addRow    = (list: KVRow[], setList: (v: KVRow[]) => void) => setList([...list, emptyRow()])
  const removeRow = (list: KVRow[], setList: (v: KVRow[]) => void, idx: number) =>
    setList(list.filter((_, i) => i !== idx))

  const handleSave = async () => {
    setError(null)
    if (!appName.trim() || !baseUrl.trim()) {
      setError('App Name and Base URL are required.')
      return
    }

    const entity_paths: Record<string, string> = {}
    for (const row of entities) {
      if (row.key.trim()) entity_paths[row.key.trim()] = row.value.trim()
    }

    const selMap: Record<string, string> = {}
    for (const row of selectors) {
      if (row.key.trim()) selMap[row.key.trim()] = row.value.trim()
    }

    let login_config: Record<string, string> | null = null
    if (loginExpanded && (usernameSel || passwordSel || submitSel)) {
      login_config = {
        login_url:          loginUrl,
        username_selector:  usernameSel,
        password_selector:  passwordSel,
        submit_selector:    submitSel,
        username:           username,
        password:           password,
      }
    }

    setSaving(true)
    try {
      await uiValidationApi.setup({
        connection_id:     connId,
        app_name:          appName.trim(),
        base_url:          baseUrl.trim(),
        entity_paths,
        login_config,
        selectors:         selMap,
        response_id_field: responseIdField.trim() || null,
      })
      onSaved()
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Failed to save template.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Configure UI Validation Template</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={3}>
          {/* Basic info */}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="App Name"
                fullWidth size="small"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="e.g. DCT"
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <TextField
                label="Base URL"
                fullWidth size="small"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://dct-app.com"
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                label="Response ID Field"
                fullWidth size="small"
                value={responseIdField}
                onChange={(e) => setResponseIdField(e.target.value)}
                placeholder="policyId or data.id"
                helperText="JSON key in dispatch response that holds the target app entity ID"
              />
            </Grid>
          </Grid>

          <Divider />

          {/* Entity paths */}
          <div>
            <Typography variant="subtitle2" gutterBottom>
              Entity Paths
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                Use the literal text {'{id}'} as the ID placeholder
              </Typography>
            </Typography>
            <Stack spacing={1}>
              {entities.map((row, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small" label="Entity" placeholder="policy"
                    value={row.key}
                    onChange={(e) => updateKV(entities, setEntities, i, 'key', e.target.value)}
                    sx={{ width: 140 }}
                  />
                  <TextField
                    size="small" label="Path pattern" placeholder="/policy/{id}"
                    value={row.value}
                    onChange={(e) => updateKV(entities, setEntities, i, 'value', e.target.value)}
                    fullWidth
                  />
                  <Tooltip title="Remove">
                    <IconButton size="small" onClick={() => removeRow(entities, setEntities, i)}>
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}
              <Button
                size="small" startIcon={<AddOutlined />}
                onClick={() => addRow(entities, setEntities)}
                sx={{ alignSelf: 'flex-start' }}
              >
                Add Entity
              </Button>
            </Stack>
          </div>

          <Divider />

          {/* Selectors */}
          <div>
            <Typography variant="subtitle2" gutterBottom>
              UI Field Selectors
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                CSS or test-id selectors for each field to compare
              </Typography>
            </Typography>
            <Stack spacing={1}>
              {selectors.map((row, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small" label="Field name" placeholder="premium"
                    value={row.key}
                    onChange={(e) => updateKV(selectors, setSelectors, i, 'key', e.target.value)}
                    sx={{ width: 160 }}
                  />
                  <TextField
                    size="small" label="CSS selector" placeholder="[data-testid='premium']"
                    value={row.value}
                    onChange={(e) => updateKV(selectors, setSelectors, i, 'value', e.target.value)}
                    fullWidth
                  />
                  <Tooltip title="Remove">
                    <IconButton size="small" onClick={() => removeRow(selectors, setSelectors, i)}>
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ))}
              <Button
                size="small" startIcon={<AddOutlined />}
                onClick={() => addRow(selectors, setSelectors)}
                sx={{ alignSelf: 'flex-start' }}
              >
                Add Selector
              </Button>
            </Stack>
          </div>

          <Divider />

          {/* Login config (optional) */}
          <Accordion
            expanded={loginExpanded}
            onChange={(_, v) => setLoginExpanded(v)}
            disableGutters elevation={0}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
          >
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Typography variant="subtitle2">Login Configuration (optional)</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <TextField
                  size="small" label="Login page URL" fullWidth
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                  placeholder="https://dct-app.com/login (leave blank to auto-detect)"
                />
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <TextField size="small" fullWidth label="Username selector"
                      value={usernameSel} onChange={(e) => setUsernameSel(e.target.value)}
                      placeholder="#username" />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField size="small" fullWidth label="Password selector"
                      value={passwordSel} onChange={(e) => setPasswordSel(e.target.value)}
                      placeholder="#password" />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField size="small" fullWidth label="Submit button selector"
                      value={submitSel} onChange={(e) => setSubmitSel(e.target.value)}
                      placeholder="#loginBtn" />
                  </Grid>
                </Grid>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField size="small" fullWidth label="Username"
                      value={username} onChange={(e) => setUsername(e.target.value)} />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField size="small" fullWidth label="Password"
                      type="password"
                      value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Grid>
                </Grid>
              </Stack>
            </AccordionDetails>
          </Accordion>

          {error && (
            <Typography color="error" variant="caption">{error}</Typography>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} variant="outlined" disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving}>
          {saving ? 'Saving…' : 'Save Template'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
