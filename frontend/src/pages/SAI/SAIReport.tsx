import {
  Box, Typography, Accordion, AccordionSummary, AccordionDetails,
  Chip, List, ListItem, ListItemText, IconButton, Tooltip,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PrintIcon      from '@mui/icons-material/Print'
import { SaiReport } from '@/types'

interface Props {
  report: SaiReport
}

export default function SAIReport({ report }: Props) {
  if (!report || !report.incident_summary) return null

  const sections = [
    { key: 'incident_summary',           label: '1. Incident Summary',            value: report.incident_summary },
    { key: 'systems_impacted',           label: '2. Systems Impacted',            value: report.systems_impacted },
    { key: 'root_cause_analysis',        label: '3. Root Cause Analysis',         value: report.root_cause_analysis },
    { key: 'evidence_findings',          label: '4. Evidence / Data Findings',    value: report.evidence_findings },
    { key: 'autonomous_actions_taken',   label: '5. Autonomous Actions Taken',    value: report.autonomous_actions_taken },
    { key: 'pending_actions',            label: '6. Pending Actions',             value: report.pending_actions },
    { key: 'recommended_fixes',          label: '7. Recommended Fixes',           value: report.recommended_fixes },
    { key: 'ownership_mapping',          label: '8. Ownership Mapping',           value: report.ownership_mapping },
    { key: 'business_impact',            label: '9. Business Impact',             value: report.business_impact },
    { key: 'prevention_recommendations', label: '10. Prevention Recommendations', value: report.prevention_recommendations },
  ]

  const handlePrint = () => {
    const now = new Date().toLocaleString()

    const renderValue = (value: unknown): string => {
      if (typeof value === 'string') {
        return `<p>${value.replace(/\n/g, '<br/>')}</p>`
      }
      if (Array.isArray(value)) {
        return `<ul>${value.map(item =>
          `<li>${typeof item === 'string' ? item : JSON.stringify(item)}</li>`
        ).join('')}</ul>`
      }
      if (typeof value === 'object' && value !== null) {
        return `<ul>${Object.entries(value).map(([k, v]) =>
          `<li><strong>${k}:</strong> ${v}</li>`
        ).join('')}</ul>`
      }
      return ''
    }

    const sectionsHtml = sections.map(s => `
      <div class="section">
        <h3>${s.label}</h3>
        <div class="section-body">${renderValue(s.value)}</div>
      </div>
    `).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>SAI Operational Report — ${now}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1a1a2e; background: #fff; padding: 24px; }
    .header { border-bottom: 3px solid #1565c0; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 20px; color: #1565c0; letter-spacing: 1px; }
    .header .meta { font-size: 10px; color: #555; margin-top: 4px; }
    .section { margin-bottom: 16px; page-break-inside: avoid; }
    .section h3 { font-size: 13px; font-weight: 700; color: #1565c0; background: #e8f0fe; padding: 6px 10px; border-left: 4px solid #1565c0; margin-bottom: 6px; }
    .section-body { padding: 4px 12px; }
    .section-body p { line-height: 1.6; color: #333; }
    .section-body ul { padding-left: 20px; }
    .section-body li { margin-bottom: 4px; line-height: 1.5; color: #333; }
    .footer { margin-top: 32px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 9px; color: #888; text-align: center; }
    @media print {
      body { padding: 12px; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>SAI — SWIFT AUTONOMOUS INTELLIGENCE</h1>
    <div class="meta">Operational Analysis Report &nbsp;|&nbsp; Generated: ${now}</div>
  </div>
  ${sectionsHtml}
  <div class="footer">SAI Mission Control &nbsp;•&nbsp; Confidential &nbsp;•&nbsp; ${now}</div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`

    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
    }
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: 'primary.main', fontWeight: 700 }}>
          OPERATIONAL REPORT
        </Typography>
        <Tooltip title="Print / Export report">
          <IconButton size="small" onClick={handlePrint} sx={{ color: 'text.secondary' }}>
            <PrintIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {sections.map(s => (
        <Accordion key={s.key} disableGutters sx={{
          bgcolor: 'background.paper',
          border: '1px solid', borderColor: 'divider',
          mb: 0.5, '&:before': { display: 'none' },
        }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: 'text.secondary' }} />} sx={{ minHeight: 36, py: 0 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'primary.main' }}>
              {s.label}
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0, pb: 1 }}>
            <SectionValue value={s.value} />
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  )
}

function SectionValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    return (
      <Typography sx={{ fontSize: '0.8rem', color: 'text.primary', whiteSpace: 'pre-wrap' }}>
        {value}
      </Typography>
    )
  }
  if (Array.isArray(value)) {
    return (
      <List dense disablePadding>
        {value.map((item, i) => (
          <ListItem key={i} disablePadding>
            <ListItemText
              primary={typeof item === 'string' ? `• ${item}` : JSON.stringify(item)}
              primaryTypographyProps={{ sx: { fontSize: '0.78rem', color: 'text.primary' } }}
            />
          </ListItem>
        ))}
      </List>
    )
  }
  if (typeof value === 'object' && value !== null) {
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {Object.entries(value).map(([k, v]) => (
          <Chip
            key={k}
            label={`${k}: ${v}`}
            size="small"
            variant="outlined"
            color="primary"
            sx={{ fontSize: '0.7rem' }}
          />
        ))}
      </Box>
    )
  }
  return null
}
