import { useState, useEffect } from 'react'
import {
  Box, Typography, Button, Chip,
  List, ListItem, ListItemText, Alert, Paper,
  Accordion, AccordionSummary, AccordionDetails, alpha, Collapse,
  ToggleButtonGroup, ToggleButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material'
import {
  AccountTreeOutlined, ExpandMoreOutlined, ExpandLessOutlined,
  CheckCircleOutlineOutlined, SaveOutlined, RefreshOutlined, UploadFileOutlined,
  DataObjectOutlined, TextSnippetOutlined, StorageOutlined, CodeOutlined,
  DeleteOutlined, LockOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import FileDropZone from '@/components/common/FileDropZone'
import { targetApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { TargetFormulaRule, TemplateFormat } from '@/types'

// ── XML path extraction ───────────────────────────────────────

function extractXmlPaths(xmlStr: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  function walk(node: Element, path: string) {
    const tag = node.tagName
    const p = `${path}/${tag}`
    if (!node.children.length) {
      if (!seen.has(p)) { seen.add(p); paths.push(p) }
    }
    for (const attr of Array.from(node.attributes)) {
      if (attr.name === 'each') continue
      const ap = `${p}/@${attr.name}`
      if (!seen.has(ap)) { seen.add(ap); paths.push(ap) }
    }
    for (const child of Array.from(node.children)) walk(child, p)
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlStr, 'application/xml')
    if (doc.documentElement) walk(doc.documentElement, '')
  } catch (_) { /* ignore */ }
  return paths
}

// ── JSON path extraction ──────────────────────────────────────

function extractJsonPaths(jsonStr: string): string[] {
  const results: string[] = []
  const seen = new Set<string>()

  function walk(obj: unknown, prefix: string) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>))
        walk(v, `${prefix}.${k}`)
    } else if (Array.isArray(obj)) {
      walk(obj[0] ?? null, `${prefix}[*]`)
    } else {
      if (!seen.has(prefix)) { seen.add(prefix); results.push(prefix) }
    }
  }

  try { walk(JSON.parse(jsonStr), '$') } catch (_) { /* ignore */ }
  return results
}

// ── Text / SQL placeholder extraction ────────────────────────

function extractTextPaths(text: string): string[] {
  const seen = new Set<string>()
  const results: string[] = []
  for (const m of text.matchAll(/\{([^}]+)\}/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); results.push(m[1]) }
  }
  return results
}

// ── Format dispatcher ─────────────────────────────────────────

function extractPaths(content: string, fmt: TemplateFormat): string[] {
  switch (fmt) {
    case 'json': return extractJsonPaths(content)
    case 'text': return extractTextPaths(content)
    case 'sql':  return extractTextPaths(content)
    default:     return extractXmlPaths(content)
  }
}

// ── Tree builders ─────────────────────────────────────────────

function buildXmlTree(paths: string[]): Record<string, unknown> {
  const tree: Record<string, unknown> = {}
  for (const path of paths) {
    const parts = path.replace(/^\//, '').split('/')
    let node: Record<string, unknown> = tree
    for (const part of parts) {
      if (!node[part]) node[part] = {}
      node = node[part] as Record<string, unknown>
    }
  }
  return tree
}

function buildJsonTree(paths: string[]): Record<string, unknown> {
  const tree: Record<string, unknown> = {}
  for (const path of paths) {
    // $.Foo.Bar[*].Baz  →  ["$", "Foo", "Bar[*]", "Baz"]
    const parts = path.split('.').filter(Boolean)
    let node: Record<string, unknown> = tree
    for (const part of parts) {
      if (!node[part]) node[part] = {}
      node = node[part] as Record<string, unknown>
    }
  }
  return tree
}

// ── Tree node renderer ────────────────────────────────────────

function TreeNode({ label, children }: { label: string; children?: Record<string, unknown> }) {
  const hasChildren = children && Object.keys(children).length > 0
  const isAttr = label.startsWith('@')
  const isArray = label.includes('[*]')

  if (!hasChildren) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25, pl: 1 }}>
        <Box
          sx={{
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: isAttr ? 'warning.main' : isArray ? 'secondary.main' : 'success.main',
          }}
        />
        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: isAttr ? 'warning.dark' : isArray ? 'secondary.dark' : 'success.dark' }}>
          {label}
        </Typography>
      </Box>
    )
  }

  return (
    <Accordion disableGutters elevation={0} sx={{ '&::before': { display: 'none' } }}>
      <AccordionSummary
        expandIcon={<ExpandMoreOutlined sx={{ fontSize: 16 }} />}
        sx={{ minHeight: 32, py: 0, '& .MuiAccordionSummary-content': { my: 0.5 } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <AccountTreeOutlined sx={{ fontSize: 14, color: 'primary.main' }} />
          <Typography variant="caption" fontWeight={600} sx={{ fontFamily: 'monospace', color: 'primary.dark' }}>
            {label}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ pl: 2, pt: 0 }}>
        {Object.entries(children as Record<string, unknown>).map(([k, v]) => (
          <TreeNode key={k} label={k} children={v as Record<string, unknown>} />
        ))}
      </AccordionDetails>
    </Accordion>
  )
}

// ── Accept map per format ─────────────────────────────────────

const ACCEPT_MAP: Record<TemplateFormat, Record<string, string[]>> = {
  xml:  { 'text/xml': ['.xml'], 'application/xml': ['.xml'] },
  json: { 'application/json': ['.json'] },
  text: { 'text/plain': ['.txt'] },
  sql:  { 'text/plain': ['.sql'], 'application/sql': ['.sql'] },
}

const FORMAT_LABEL: Record<TemplateFormat, string> = {
  xml:  'XML',
  json: 'JSON',
  text: 'Text',
  sql:  'SQL',
}

const FORMAT_EXT: Record<TemplateFormat, string> = {
  xml:  '.xml',
  json: '.json',
  text: '.txt',
  sql:  '.sql',
}

// ─────────────────────────────────────────────────────────────

export default function TargetTab() {
  const { enqueueSnackbar } = useSnackbar()
  const qc = useQueryClient()
  const { setXmlTemplate, xmlContent, xmlPaths, activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''

  const [file, setFile]           = useState<File | null>(null)
  const [rules, setRules]         = useState<TargetFormulaRule[]>([])
  const [format, setFormat]       = useState<TemplateFormat>('xml')
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Section collapse state
  const [uploadOpen,    setUploadOpen]    = useState(true)
  const [structureOpen, setStructureOpen] = useState(true)
  const [rulesOpen,     setRulesOpen]     = useState(true)

  // Reset local state when connection changes
  useEffect(() => {
    setFile(null)
    setRules([])
    setXmlTemplate('', [], 'xml')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId])

  // Load saved template from DB when connection selected
  const { data: savedTemplate } = useQuery({
    queryKey: ['template', connId],
    queryFn: () => targetApi.getTemplate(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })
  const { data: savedRules } = useQuery({
    queryKey: ['target-rules', connId],
    queryFn: () => targetApi.list(connId as number),
    enabled: Boolean(connId),
    retry: false,
  })

  // Apply fetched template to store whenever connection or fetched data changes
  useEffect(() => {
    if (!savedTemplate?.content) return
    const fmt = (savedTemplate.format_type ?? 'xml') as TemplateFormat
    setFormat(fmt)
    const paths = extractPaths(savedTemplate.content, fmt)
    setXmlTemplate(savedTemplate.content, paths, fmt)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTemplate])

  useEffect(() => {
    if (savedRules?.length) {
      setRules(savedRules)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRules])

  // The saved format locks the selector — only cleared when template is deleted
  const savedFormat = savedTemplate?.format_type as TemplateFormat | undefined
  const formatLocked = Boolean(savedFormat && connId)

  const processMutation = useMutation({
    mutationFn: ({ content, fmt }: { content: string; fmt: TemplateFormat }) =>
      targetApi.process(content, connId !== '' ? connId : undefined, file?.name, fmt),
    onSuccess: (result) => {
      setRules(result.rules)
      qc.invalidateQueries({ queryKey: ['template', connId] })
      enqueueSnackbar(
        `Template saved — ${result.inserted} formula rules extracted`,
        { variant: 'success' },
      )
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => targetApi.deleteTemplate(connId as number),
    onSuccess: () => {
      setFile(null)
      setRules([])
      setFormat('xml')
      setXmlTemplate('', [], 'xml')
      qc.invalidateQueries({ queryKey: ['template', connId] })
      qc.invalidateQueries({ queryKey: ['target-rules', connId] })
      qc.invalidateQueries({ queryKey: ['pipeline-status', connId] })
      setDeleteOpen(false)
      enqueueSnackbar('Template deleted — you can now configure a new format', { variant: 'success' })
    },
    onError: (e: Error) => {
      setDeleteOpen(false)
      enqueueSnackbar(e.message, { variant: 'error' })
    },
  })

  const handleFile = async (f: File) => {
    setFile(f)
    const text = await f.text()
    const paths = extractPaths(text, format)
    setXmlTemplate(text, paths, format)
    setRules([])
  }

  const handleSave = () => {
    if (xmlContent) processMutation.mutate({ content: xmlContent, fmt: format })
  }

  const handleFormatChange = (_: React.MouseEvent<HTMLElement>, val: TemplateFormat | null) => {
    if (!val) return
    setFormat(val)
    // Clear existing template when switching formats
    setFile(null)
    setRules([])
    setXmlTemplate('', [], val)
  }

  // Build the tree structure for the structure panel
  const tree = xmlContent
    ? format === 'json'
      ? buildJsonTree(xmlPaths)
      : format === 'xml'
        ? buildXmlTree(xmlPaths)
        : {}   // text/sql: use flat list below
    : {}

  const structureLabel = `${FORMAT_LABEL[format]} Structure`

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── Format Selector ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
              Target Format
            </Typography>
            {formatLocked && (
              <Tooltip title="Format is locked to the saved template. Delete the template to choose a different format.">
                <LockOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
              </Tooltip>
            )}
          </Box>
          <ToggleButtonGroup
            value={format}
            exclusive
            onChange={handleFormatChange}
            size="small"
            sx={{ '& .MuiToggleButton-root': { px: 1.5, py: 0.4, fontSize: '0.75rem', textTransform: 'none' } }}
          >
            {(['xml', 'json', 'text', 'sql'] as TemplateFormat[]).map((fmt) => {
              const icons = {
                xml:  <AccountTreeOutlined sx={{ fontSize: 14, mr: 0.5 }} />,
                json: <DataObjectOutlined  sx={{ fontSize: 14, mr: 0.5 }} />,
                text: <TextSnippetOutlined sx={{ fontSize: 14, mr: 0.5 }} />,
                sql:  <StorageOutlined     sx={{ fontSize: 14, mr: 0.5 }} />,
              }
              const labels = { xml: 'XML', json: 'JSON', text: 'Text', sql: 'SQL' }
              const isDisabled = formatLocked && fmt !== savedFormat
              return (
                <Tooltip
                  key={fmt}
                  title={isDisabled ? `This connection already has an ${savedFormat?.toUpperCase()} template. Delete it first to switch formats.` : ''}
                  placement="top"
                >
                  <span>
                    <ToggleButton value={fmt} disabled={isDisabled}>
                      {icons[fmt]}{labels[fmt]}
                    </ToggleButton>
                  </span>
                </Tooltip>
              )
            })}
          </ToggleButtonGroup>

          {/* Delete template button — only shown when a template is saved */}
          {formatLocked && connId && (
            <Box sx={{ ml: 'auto' }}>
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlined />}
                onClick={() => setDeleteOpen(true)}
              >
                Delete Template
              </Button>
            </Box>
          )}
        </Box>

        {formatLocked && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, ml: 0.25 }}>
            This connection is configured for <strong>{savedFormat?.toUpperCase()}</strong> templates.
            Delete the template to switch to a different format.
          </Typography>
        )}
      </Paper>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Delete Template?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete the <strong>{savedFormat?.toUpperCase()}</strong> template and all
            extracted formula rules for this connection. Generated outputs will not be affected.
            <br /><br />
            You can then upload a new template in any format.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── 1. Template Upload ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: uploadOpen ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setUploadOpen((v) => !v)}
        >
          {uploadOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <UploadFileOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
            {FORMAT_LABEL[format]} Template Upload
          </Typography>
          {xmlContent && (
            <Box sx={{ display: 'flex', gap: 0.75 }} onClick={(e) => e.stopPropagation()}>
              <Chip label={FORMAT_LABEL[format]} color="primary" variant="outlined" size="small" sx={{ height: 22, fontSize: '0.7rem' }} />
              <Chip label={`${xmlPaths.length} paths`} color="success" variant="outlined" size="small" icon={<CheckCircleOutlineOutlined />} sx={{ height: 22, fontSize: '0.7rem' }} />
              <Chip label={`${xmlContent.length} bytes`} variant="outlined" size="small" sx={{ height: 22, fontSize: '0.7rem' }} />
            </Box>
          )}
        </Box>
        <Collapse in={uploadOpen}>
          <Box sx={{ p: 2 }}>
            <FileDropZone
              onFile={handleFile}
              accept={ACCEPT_MAP[format]}
              label={`Drop ${FORMAT_LABEL[format]} template here`}
              sublabel={`${FORMAT_EXT[format]} files only`}
              file={file}
              height={140}
            />
            {xmlContent && (
              <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                <Button variant="contained" size="small" startIcon={<SaveOutlined />}
                  onClick={handleSave} disabled={processMutation.isPending || !connId} fullWidth>
                  {processMutation.isPending ? 'Saving…' : 'Save Template'}
                </Button>
                <Button variant="outlined" size="small" startIcon={<RefreshOutlined />}
                  onClick={() => { setFile(null); setXmlTemplate('', [], format); setRules([]) }}>
                  Clear
                </Button>
              </Box>
            )}
            {!connId && xmlContent && (
              <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 2, fontSize: '0.8rem' }}>
                Select a connection in the top bar to save the template
              </Alert>
            )}
          </Box>
        </Collapse>
      </Paper>

      {/* ── 2. Structure / Paths Preview ── */}
      {xmlContent && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: structureOpen ? '1px solid' : 'none', borderColor: 'divider' }}
            onClick={() => setStructureOpen((v) => !v)}
          >
            {structureOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
            <AccountTreeOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>{structureLabel}</Typography>
            <Chip label={`${xmlPaths.length} paths`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} onClick={(e) => e.stopPropagation()} />
          </Box>
          <Collapse in={structureOpen}>
            <Box sx={{ p: 2 }}>
              <Box sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.02), border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5, maxHeight: 300, overflow: 'auto' }}>
                {(format === 'xml' || format === 'json') ? (
                  Object.entries(tree).map(([k, v]) => (
                    <TreeNode key={k} label={k} children={v as Record<string, unknown>} />
                  ))
                ) : (
                  // Text / SQL: flat list of placeholder names
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {xmlPaths.map((p) => (
                      <Chip
                        key={p}
                        label={`{${p}}`}
                        size="small"
                        variant="outlined"
                        icon={<CodeOutlined />}
                        sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          </Collapse>
        </Paper>
      )}

      {/* ── 3. Extracted Formula Rules ── */}
      {rules.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: rulesOpen ? '1px solid' : 'none', borderColor: 'divider' }}
            onClick={() => setRulesOpen((v) => !v)}
          >
            {rulesOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
            <CheckCircleOutlineOutlined sx={{ fontSize: 16, color: 'success.main', flexShrink: 0 }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>Extracted Formula Rules</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
              <Chip label={rules.length} size="small" color="primary" sx={{ height: 20, fontSize: '0.7rem' }} />
            </Box>
          </Box>
          <Collapse in={rulesOpen}>
            <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
              <List dense disablePadding>
                {rules.map((r, i) => (
                  <ListItem key={i} divider={i < rules.length - 1} sx={{ py: 0.75, px: 2 }}>
                    <ListItemText
                      primary={
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {r.target_path}
                        </Typography>
                      }
                      secondary={
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
                          <Chip label={r.formula_type || 'DIRECT'} size="small" variant="outlined"
                            color={r.formula_type === 'DEFAULT' ? 'warning' : 'info'} sx={{ height: 18, fontSize: '0.688rem' }} />
                          {r.default_value && (
                            <Chip label={`default: ${r.default_value}`} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.688rem' }} />
                          )}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          </Collapse>
        </Paper>
      )}

      {/* Empty state — no template uploaded yet */}
      {!xmlContent && (
        <Paper variant="outlined" sx={{ borderRadius: 2, borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', py: 8 }}>
          <Box sx={{ textAlign: 'center', color: 'text.disabled' }}>
            <AccountTreeOutlined sx={{ fontSize: 56, opacity: 0.25, mb: 1.5 }} />
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              {FORMAT_LABEL[format]} Structure and Formula Rules will appear here
            </Typography>
            <Typography variant="caption" color="text.disabled">Upload a template above to get started</Typography>
          </Box>
        </Paper>
      )}
    </Box>
  )
}
