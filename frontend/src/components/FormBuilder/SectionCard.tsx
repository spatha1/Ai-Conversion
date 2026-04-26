import React, { useState } from 'react'
import {
  Accordion, AccordionSummary, AccordionDetails,
  Box, Button, Chip, Dialog, DialogContent, DialogTitle,
  FormControlLabel, IconButton, MenuItem, Select,
  Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import {
  AddCircleOutline, ArrowDownward, ArrowUpward,
  DeleteOutline, EditOutlined, ExpandMore,
} from '@mui/icons-material'
import type { FormFieldDef, FormFieldType, FormSection, FormValidationRule } from '@/types'

interface Props {
  section: FormSection
  sectionIndex: number
  totalSections: number
  onChange: (updated: FormSection) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

const FIELD_TYPES: FormFieldType[] = [
  'text', 'number', 'date', 'dropdown', 'checkbox',
  'radio', 'textarea', 'signature', 'file',
]

function newField(order: number): FormFieldDef {
  return {
    id: `f${Date.now()}`,
    name: `field_${order}`,
    label: `Field ${order}`,
    type: 'text',
    required: false,
    default_value: '',
    placeholder: '',
    column: 1,
    validations: [],
    visibility_rule: null,
  }
}

export default function SectionCard({ section, sectionIndex, totalSections, onChange, onDelete, onMoveUp, onMoveDown }: Props) {
  const [editingField, setEditingField] = useState<FormFieldDef | null>(null)

  const updateField = (idx: number, updated: FormFieldDef) => {
    const fields = [...section.fields]
    fields[idx] = updated
    onChange({ ...section, fields })
  }

  const deleteField = (idx: number) => {
    onChange({ ...section, fields: section.fields.filter((_, i) => i !== idx) })
  }

  const addField = () => {
    const f = newField(section.fields.length + 1)
    onChange({ ...section, fields: [...section.fields, f] })
  }

  const saveEditingField = (updated: FormFieldDef) => {
    const idx = section.fields.findIndex((f) => f.id === updated.id)
    if (idx >= 0) updateField(idx, updated)
    setEditingField(null)
  }

  return (
    <Accordion defaultExpanded sx={{ mb: 1, border: '1px solid', borderColor: 'divider' }} elevation={0}>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', pr: 1 }}>
          <TextField
            size="small"
            value={section.title}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ ...section, title: e.target.value })}
            placeholder="Section title"
            sx={{ flexGrow: 1, maxWidth: 320 }}
          />
          <Select
            size="small"
            value={section.columns}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ ...section, columns: Number(e.target.value) as 1 | 2 })}
            sx={{ minWidth: 100 }}
          >
            <MenuItem value={1}>1 column</MenuItem>
            <MenuItem value={2}>2 columns</MenuItem>
          </Select>
          <Chip label={`${section.fields.length} field${section.fields.length !== 1 ? 's' : ''}`} size="small" />
          <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
            <Tooltip title="Move up">
              <span>
                <IconButton size="small" disabled={sectionIndex === 0} onClick={(e) => { e.stopPropagation(); onMoveUp() }}>
                  <ArrowUpward fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move down">
              <span>
                <IconButton size="small" disabled={sectionIndex === totalSections - 1} onClick={(e) => { e.stopPropagation(); onMoveDown() }}>
                  <ArrowDownward fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Delete section">
              <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); onDelete() }}>
                <DeleteOutline fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ p: 0 }}>
        {section.fields.map((field, fi) => (
          <Box
            key={field.id}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
              borderTop: '1px solid', borderColor: 'divider',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ flex: '0 0 160px' }}>
              <Typography variant="body2" fontWeight={500}>{field.label || field.name}</Typography>
              <Typography variant="caption" color="text.secondary">{field.name}</Typography>
            </Box>
            <Chip label={field.type} size="small" variant="outlined" sx={{ flex: '0 0 80px' }} />
            {field.required && <Chip label="required" size="small" color="error" variant="outlined" />}
            <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
              <Tooltip title="Edit field">
                <IconButton size="small" onClick={() => setEditingField({ ...field })}>
                  <EditOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete field">
                <IconButton size="small" color="error" onClick={() => deleteField(fi)}>
                  <DeleteOutline fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        ))}

        <Box sx={{ p: 2 }}>
          <Button startIcon={<AddCircleOutline />} onClick={addField} size="small">
            Add Field
          </Button>
        </Box>
      </AccordionDetails>

      {editingField && (
        <FieldEditDialog
          field={editingField}
          onSave={saveEditingField}
          onClose={() => setEditingField(null)}
        />
      )}
    </Accordion>
  )
}

// ── Field Edit Dialog ─────────────────────────────────────────

function FieldEditDialog({ field, onSave, onClose }: {
  field: FormFieldDef
  onSave: (f: FormFieldDef) => void
  onClose: () => void
}) {
  const [f, setF] = useState<FormFieldDef>({ ...field })

  const updateValidation = (idx: number, updated: FormValidationRule) => {
    const v = [...f.validations]
    v[idx] = updated
    setF({ ...f, validations: v })
  }

  const addValidation = () => {
    setF({ ...f, validations: [...f.validations, { rule: 'required', value: '', message: '' }] })
  }

  const removeValidation = (idx: number) => {
    setF({ ...f, validations: f.validations.filter((_, i) => i !== idx) })
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Field — {f.label || f.name}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Name (snake_case)"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            label="Label"
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            size="small"
            sx={{ flex: 1 }}
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Select
            size="small"
            value={f.type}
            onChange={(e) => setF({ ...f, type: e.target.value as FormFieldType })}
            sx={{ minWidth: 140 }}
          >
            {FIELD_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
          <Select
            size="small"
            value={f.column ?? 1}
            onChange={(e) => setF({ ...f, column: Number(e.target.value) as 1 | 2 })}
            sx={{ minWidth: 110 }}
          >
            <MenuItem value={1}>Column 1</MenuItem>
            <MenuItem value={2}>Column 2</MenuItem>
          </Select>
          <FormControlLabel
            control={<Switch checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} />}
            label="Required"
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="Placeholder"
            value={f.placeholder ?? ''}
            onChange={(e) => setF({ ...f, placeholder: e.target.value })}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            label="Default value"
            value={f.default_value ?? ''}
            onChange={(e) => setF({ ...f, default_value: e.target.value })}
            size="small"
            sx={{ flex: 1 }}
          />
        </Box>

        {(f.type === 'dropdown' || f.type === 'radio') && (
          <TextField
            label="Options (comma-separated)"
            value={(f.options ?? []).join(', ')}
            onChange={(e) => setF({ ...f, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            size="small"
            fullWidth
          />
        )}

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Validation Rules
          </Typography>
          {f.validations.map((v, vi) => (
            <Box key={vi} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
              <TextField
                label="Rule"
                value={v.rule}
                onChange={(e) => updateValidation(vi, { ...v, rule: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label="Value"
                value={String(v.value ?? '')}
                onChange={(e) => updateValidation(vi, { ...v, value: e.target.value })}
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label="Message"
                value={v.message}
                onChange={(e) => updateValidation(vi, { ...v, message: e.target.value })}
                size="small"
                sx={{ flex: 2 }}
              />
              <IconButton size="small" color="error" onClick={() => removeValidation(vi)}>
                <DeleteOutline fontSize="small" />
              </IconButton>
            </Box>
          ))}
          <Button size="small" startIcon={<AddCircleOutline />} onClick={addValidation}>
            Add Rule
          </Button>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, pt: 1 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={() => onSave(f)}>Save Field</Button>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
