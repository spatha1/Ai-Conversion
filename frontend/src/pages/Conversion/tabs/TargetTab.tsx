import { useState, useEffect } from 'react'
import {
  Box, Typography, Button, Chip,
  List, ListItem, ListItemText, Alert, Paper,
  Accordion, AccordionSummary, AccordionDetails, alpha, Collapse, IconButton,
} from '@mui/material'
import {
  AccountTreeOutlined, ExpandMoreOutlined, ExpandLessOutlined,
  CheckCircleOutlineOutlined, SaveOutlined, RefreshOutlined, UploadFileOutlined,
} from '@mui/icons-material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import FileDropZone from '@/components/common/FileDropZone'
import { targetApi } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { TargetFormulaRule } from '@/types'

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

function buildTree(paths: string[]): Record<string, unknown> {
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

function TreeNode({ label, children }: { label: string; children?: Record<string, unknown> }) {
  const hasChildren = children && Object.keys(children).length > 0
  const isAttr = label.startsWith('@')

  if (!hasChildren) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25, pl: 1 }}>
        <Box
          sx={{
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: isAttr ? 'warning.main' : 'success.main',
          }}
        />
        <Typography variant="caption" sx={{ fontFamily: 'monospace', color: isAttr ? 'warning.dark' : 'success.dark' }}>
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

export default function TargetTab() {
  const { enqueueSnackbar } = useSnackbar()
  const { setXmlTemplate, xmlContent, xmlPaths, setConversionTab, activeConnection } = useAppStore()
  const connId = activeConnection?.id ?? ''

  const [file, setFile] = useState<File | null>(null)
  const [rules, setRules] = useState<TargetFormulaRule[]>([])

  // Section collapse state
  const [uploadOpen,    setUploadOpen]    = useState(true)
  const [structureOpen, setStructureOpen] = useState(true)
  const [rulesOpen,     setRulesOpen]     = useState(true)

  // Reset local state when connection changes
  useEffect(() => {
    setFile(null)
    setRules([])
    setXmlTemplate('', [])
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
    const paths = extractXmlPaths(savedTemplate.content)
    setXmlTemplate(savedTemplate.content, paths)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTemplate])

  useEffect(() => {
    if (savedRules?.length) {
      setRules(savedRules)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedRules])

  const processMutation = useMutation({
    mutationFn: (xml: string) =>
      targetApi.process(xml, connId !== '' ? connId : undefined, file?.name),
    onSuccess: (result) => {
      setRules(result.rules)
      enqueueSnackbar(
        `Template saved — ${result.inserted} formula rules extracted`,
        { variant: 'success' },
      )
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  })

  const handleFile = async (f: File) => {
    setFile(f)
    const text = await f.text()
    const paths = extractXmlPaths(text)
    setXmlTemplate(text, paths)
    setRules([])
  }

  const handleSave = () => {
    if (xmlContent) processMutation.mutate(xmlContent)
  }

  const tree = xmlContent ? buildTree(xmlPaths) : {}

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── 1. XML Template Upload ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: uploadOpen ? '1px solid' : 'none', borderColor: 'divider' }}
          onClick={() => setUploadOpen((v) => !v)}
        >
          {uploadOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
          <UploadFileOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>XML Template Upload</Typography>
          {xmlContent && (
            <Box sx={{ display: 'flex', gap: 0.75 }} onClick={(e) => e.stopPropagation()}>
              <Chip label={`${xmlPaths.length} paths`} color="success" variant="outlined" size="small" icon={<CheckCircleOutlineOutlined />} sx={{ height: 22, fontSize: '0.7rem' }} />
              <Chip label={`${xmlContent.length} bytes`} variant="outlined" size="small" sx={{ height: 22, fontSize: '0.7rem' }} />
            </Box>
          )}
        </Box>
        <Collapse in={uploadOpen}>
          <Box sx={{ p: 2 }}>
            <FileDropZone
              onFile={handleFile}
              accept={{ 'text/xml': ['.xml'], 'application/xml': ['.xml'] }}
              label="Drop XML template here"
              sublabel=".xml files only"
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
                  onClick={() => { setFile(null); setXmlTemplate('', []); setRules([]) }}>
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

      {/* ── 2. XML Structure ── */}
      {xmlContent && (
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, minHeight: 44, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderBottom: structureOpen ? '1px solid' : 'none', borderColor: 'divider' }}
            onClick={() => setStructureOpen((v) => !v)}
          >
            {structureOpen ? <ExpandLessOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} /> : <ExpandMoreOutlined sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />}
            <AccountTreeOutlined sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>XML Structure</Typography>
            <Chip label={`${xmlPaths.length} paths`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} onClick={(e) => e.stopPropagation()} />
          </Box>
          <Collapse in={structureOpen}>
            <Box sx={{ p: 2 }}>
              <Box sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.02), border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5, maxHeight: 300, overflow: 'auto' }}>
                {Object.entries(tree).map(([k, v]) => (
                  <TreeNode key={k} label={k} children={v as Record<string, unknown>} />
                ))}
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
              <Button variant="contained" size="small" onClick={() => setConversionTab(2)}>
                Configure Mapping →
              </Button>
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

      {/* Empty state — no XML uploaded yet */}
      {!xmlContent && (
        <Paper variant="outlined" sx={{ borderRadius: 2, borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center', py: 8 }}>
          <Box sx={{ textAlign: 'center', color: 'text.disabled' }}>
            <AccountTreeOutlined sx={{ fontSize: 56, opacity: 0.25, mb: 1.5 }} />
            <Typography variant="body2" color="text.secondary" fontWeight={500}>XML Structure and Formula Rules will appear here</Typography>
            <Typography variant="caption" color="text.disabled">Upload a template above to get started</Typography>
          </Box>
        </Paper>
      )}
    </Box>
  )
}
