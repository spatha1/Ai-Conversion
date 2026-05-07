import {
  Box, Typography, Accordion, AccordionSummary, AccordionDetails,
  Chip, List, ListItem, ListItemText,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
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

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ color: 'primary.main', mb: 1, fontWeight: 700 }}>
        OPERATIONAL REPORT
      </Typography>
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
