import { useState, useEffect } from 'react'
import {
  Box, Card, CardContent, Grid, Typography, Button, Chip,
  List, ListItem, ListItemText, Alert, Divider, Paper,
  Accordion, AccordionSummary, AccordionDetails, alpha,
} from '@mui/material'
import {
  AccountTreeOutlined, ExpandMoreOutlined, CheckCircleOutlineOutlined,
  SaveOutlined, RefreshOutlined,
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
    <Box sx={{ p: 3 }}>
      <Grid container spacing={3}>
        {/* Left: Upload + Connection */}
        <Grid item xs={12} lg={5}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                XML Template Upload
              </Typography>

              <Divider sx={{ mb: 3 }} />

              <FileDropZone
                onFile={handleFile}
                accept={{ 'text/xml': ['.xml'], 'application/xml': ['.xml'] }}
                label="Drop XML template here"
                sublabel=".xml files only"
                file={file}
                height={160}
              />

              {xmlContent && (
                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  <Chip
                    label={`${xmlPaths.length} paths found`}
                    color="success"
                    variant="outlined"
                    size="small"
                    icon={<CheckCircleOutlineOutlined />}
                  />
                  <Chip
                    label={`${xmlContent.length} bytes`}
                    variant="outlined"
                    size="small"
                  />
                </Box>
              )}

              {xmlContent && (
                <Box sx={{ mt: 3, display: 'flex', gap: 1.5 }}>
                  <Button
                    variant="contained"
                    startIcon={<SaveOutlined />}
                    onClick={handleSave}
                    disabled={processMutation.isPending || !connId}
                    fullWidth
                  >
                    {processMutation.isPending ? 'Saving…' : 'Save Template'}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshOutlined />}
                    onClick={() => { setFile(null); setXmlTemplate('', []) }}
                  >
                    Clear
                  </Button>
                </Box>
              )}

              {!connId && xmlContent && (
                <Alert severity="warning" sx={{ mt: 2, borderRadius: 2 }}>
                  Select a connection in the top bar to save the template
                </Alert>
              )}

              {rules.length > 0 && (
                <Button
                  variant="contained"
                  fullWidth
                  sx={{ mt: 2 }}
                  onClick={() => setConversionTab(2)}
                >
                  Next: Configure Mapping →
                </Button>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Right: Tree view + Formula rules */}
        <Grid item xs={12} lg={7}>
          {xmlContent ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Tree View */}
              <Card>
                <CardContent sx={{ p: 3 }}>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    XML Structure
                  </Typography>
                  <Box
                    sx={{
                      bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      p: 1.5,
                      maxHeight: 300,
                      overflow: 'auto',
                    }}
                  >
                    {Object.entries(tree).map(([k, v]) => (
                      <TreeNode key={k} label={k} children={v as Record<string, unknown>} />
                    ))}
                  </Box>
                </CardContent>
              </Card>

              {/* Formula Rules */}
              {rules.length > 0 && (
                <Card>
                  <CardContent sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={700} gutterBottom>
                      Extracted Formula Rules
                      <Chip
                        label={rules.length}
                        size="small"
                        color="primary"
                        sx={{ ml: 1 }}
                      />
                    </Typography>
                    <Box sx={{ maxHeight: 280, overflow: 'auto' }}>
                      <List dense disablePadding>
                        {rules.map((r, i) => (
                          <ListItem
                            key={i}
                            divider={i < rules.length - 1}
                            sx={{ py: 0.75 }}
                          >
                            <ListItemText
                              primary={
                                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                  {r.target_path}
                                </Typography>
                              }
                              secondary={
                                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
                                  <Chip
                                    label={r.formula_type || 'DIRECT'}
                                    size="small"
                                    variant="outlined"
                                    color={r.formula_type === 'DEFAULT' ? 'warning' : 'info'}
                                    sx={{ height: 18, fontSize: '0.688rem' }}
                                  />
                                  {r.default_value && (
                                    <Chip
                                      label={`default: ${r.default_value}`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ height: 18, fontSize: '0.688rem' }}
                                    />
                                  )}
                                </Box>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  </CardContent>
                </Card>
              )}
            </Box>
          ) : (
            <Paper
              variant="outlined"
              sx={{
                height: 400, display: 'flex', alignItems: 'center',
                justifyContent: 'center', borderRadius: 3, borderStyle: 'dashed',
              }}
            >
              <Box sx={{ textAlign: 'center', color: 'text.disabled' }}>
                <AccountTreeOutlined sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
                <Typography variant="body1" fontWeight={500} color="text.secondary">
                  Upload an XML template to preview the structure
                </Typography>
                <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
                  The tree view and formula rules will appear here
                </Typography>
              </Box>
            </Paper>
          )}
        </Grid>
      </Grid>
    </Box>
  )
}
