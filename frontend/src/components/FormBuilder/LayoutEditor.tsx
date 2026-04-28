import {
  Box, Paper, Typography, Chip, IconButton, Tooltip,
  ToggleButtonGroup, ToggleButton, Divider,
} from '@mui/material'
import {
  ArrowUpward, ArrowDownward, ArrowBack, ArrowForward,
  OpenWith as SpanIcon, ViewColumn, ViewStream,
  ViewWeek,
} from '@mui/icons-material'
import type { FormSchemaJson, FormFieldDef, FormSection } from '@/types'

interface Props {
  schema: FormSchemaJson
  onChange: (updated: FormSchemaJson) => void
}

// ── Pure helpers ─────────────────────────────────────────────

function getRows(section: FormSection): FormFieldDef[][] {
  const fields = section.fields
  const hasExplicit = fields.some((f) => f.row !== undefined)
  if (!hasExplicit || section.columns === 1) {
    const size = section.columns
    const rows: FormFieldDef[][] = []
    for (let i = 0; i < fields.length; i += size) rows.push(fields.slice(i, i + size))
    return rows
  }
  const sorted = [...fields].sort((a, b) => {
    const ra = a.row ?? 999, rb = b.row ?? 999
    if (ra !== rb) return ra - rb
    return (a.column ?? 1) - (b.column ?? 1)
  })
  const map = new Map<number, FormFieldDef[]>()
  for (const f of sorted) {
    const r = f.row ?? 999
    if (!map.has(r)) map.set(r, [])
    map.get(r)!.push(f)
  }
  return Array.from(map.values())
}

function rowsToFields(rows: FormFieldDef[][], columns: number): FormFieldDef[] {
  const out: FormFieldDef[] = []
  rows.forEach((row, ri) => {
    row.forEach((f, ci) => {
      const span = (f.col_span ?? 1) as 1 | 2 | 3
      out.push({
        ...f,
        row: ri + 1,
        column: (ci + 1) as 1 | 2 | 3,
        full_width: span >= columns && columns > 1,
        col_span: span,
      })
    })
  })
  return out
}

function updateSection(schema: FormSchemaJson, sectionId: string, updater: (sec: FormSection) => FormSection): FormSchemaJson {
  return { ...schema, sections: schema.sections.map((s) => s.id === sectionId ? updater(s) : s) }
}

function moveFieldUp(schema: FormSchemaJson, sectionId: string, fieldName: string): FormSchemaJson {
  return updateSection(schema, sectionId, (sec) => {
    const rows = getRows(sec)
    const rowIdx = rows.findIndex((r) => r.some((f) => f.name === fieldName))
    if (rowIdx <= 0) return sec
    const newRows = [...rows]
    ;[newRows[rowIdx - 1], newRows[rowIdx]] = [newRows[rowIdx], newRows[rowIdx - 1]]
    return { ...sec, fields: rowsToFields(newRows, sec.columns) }
  })
}

function moveFieldDown(schema: FormSchemaJson, sectionId: string, fieldName: string): FormSchemaJson {
  return updateSection(schema, sectionId, (sec) => {
    const rows = getRows(sec)
    const rowIdx = rows.findIndex((r) => r.some((f) => f.name === fieldName))
    if (rowIdx < 0 || rowIdx >= rows.length - 1) return sec
    const newRows = [...rows]
    ;[newRows[rowIdx], newRows[rowIdx + 1]] = [newRows[rowIdx + 1], newRows[rowIdx]]
    return { ...sec, fields: rowsToFields(newRows, sec.columns) }
  })
}

function moveFieldLeft(schema: FormSchemaJson, sectionId: string, fieldName: string): FormSchemaJson {
  return updateSection(schema, sectionId, (sec) => {
    const rows = getRows(sec)
    const rowIdx = rows.findIndex((r) => r.some((f) => f.name === fieldName))
    if (rowIdx < 0) return sec
    const row = [...rows[rowIdx]]
    const colIdx = row.findIndex((f) => f.name === fieldName)
    if (colIdx <= 0) return sec
    ;[row[colIdx - 1], row[colIdx]] = [row[colIdx], row[colIdx - 1]]
    const newRows = [...rows]
    newRows[rowIdx] = row
    return { ...sec, fields: rowsToFields(newRows, sec.columns) }
  })
}

function moveFieldRight(schema: FormSchemaJson, sectionId: string, fieldName: string): FormSchemaJson {
  return updateSection(schema, sectionId, (sec) => {
    const rows = getRows(sec)
    const rowIdx = rows.findIndex((r) => r.some((f) => f.name === fieldName))
    if (rowIdx < 0) return sec
    const row = [...rows[rowIdx]]
    const colIdx = row.findIndex((f) => f.name === fieldName)
    if (colIdx >= row.length - 1) return sec
    ;[row[colIdx], row[colIdx + 1]] = [row[colIdx + 1], row[colIdx]]
    const newRows = [...rows]
    newRows[rowIdx] = row
    return { ...sec, fields: rowsToFields(newRows, sec.columns) }
  })
}

function cycleColSpan(schema: FormSchemaJson, sectionId: string, fieldName: string): FormSchemaJson {
  return updateSection(schema, sectionId, (sec) => {
    if (sec.columns === 1) return sec
    const rows = getRows(sec)
    const rowIdx = rows.findIndex((r) => r.some((f) => f.name === fieldName))
    if (rowIdx < 0) return sec
    const row = rows[rowIdx]
    const field = row.find((f) => f.name === fieldName)!
    const currentSpan = field.col_span ?? 1
    // cycle: 1 → 2 → (3 if 3-col) → back to 1
    const nextSpan = (currentSpan >= sec.columns ? 1 : currentSpan + 1) as 1 | 2 | 3
    let newRows: FormFieldDef[][]
    if (nextSpan === 1) {
      // shrink — update in place, field stays in its row
      newRows = rows.map((r, ri) =>
        ri === rowIdx
          ? r.map((f) => f.name === fieldName ? { ...f, col_span: 1 as const, full_width: false } : f)
          : r
      )
    } else {
      // grow — isolate field in its own row so span can render cleanly
      const others = row.filter((f) => f.name !== fieldName)
      newRows = [
        ...rows.slice(0, rowIdx),
        [{ ...field, col_span: nextSpan, full_width: nextSpan >= sec.columns }],
        ...(others.length ? [others] : []),
        ...rows.slice(rowIdx + 1),
      ]
    }
    return { ...sec, fields: rowsToFields(newRows, sec.columns) }
  })
}

// ── Field cell ───────────────────────────────────────────────

interface FieldCellProps {
  field: FormFieldDef
  sectionId: string
  columns: number
  sectionLayoutType?: 'grid' | 'label_value'
  rowIndex: number
  colIndex: number
  rowLength: number
  totalRows: number
  onMoveUp: () => void
  onMoveDown: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
  onToggleFullWidth: () => void
}

const HEIGHT_COLORS: Record<string, 'default' | 'primary' | 'secondary' | 'info' | 'warning'> = {
  sm: 'default', md: 'info', lg: 'warning',
}

function FieldCell({
  field, columns, sectionLayoutType, rowIndex, colIndex, rowLength, totalRows,
  onMoveUp, onMoveDown, onMoveLeft, onMoveRight, onToggleFullWidth,
}: FieldCellProps) {
  const effectiveSpan = field.col_span ?? 1
  const isFullWidth = effectiveSpan >= columns && columns > 1
  const isLabelValue = sectionLayoutType === 'label_value'

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        bgcolor: 'background.paper',
        gridColumn: isFullWidth ? '1 / -1' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minHeight: 80,
      }}
    >
      {/* Header: label + chips */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 0.5 }}>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {field.label || field.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">{field.name}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.25, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Chip label={field.type} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
          {field.required && <Chip label="req" size="small" color="error" sx={{ fontSize: '0.65rem', height: 18 }} />}
          {isFullWidth && <Chip label="full-width" size="small" color="primary" sx={{ fontSize: '0.65rem', height: 18 }} />}
          {effectiveSpan > 1 && <Chip label={`span ${effectiveSpan}`} size="small" color="primary" sx={{ fontSize: '0.65rem', height: 18 }} />}
          {field.height && <Chip label={field.height} size="small" color={HEIGHT_COLORS[field.height] ?? 'default'} sx={{ fontSize: '0.65rem', height: 18 }} />}
        </Box>
      </Box>

      {/* label_value preview row */}
      {isLabelValue && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 0.5, mt: 0.5, pt: 0.5, borderTop: '1px dotted', borderColor: 'divider' }}>
          <Typography variant="caption" sx={{ fontWeight: 500, color: 'text.secondary' }}>
            {field.label || field.name}
          </Typography>
          <Box sx={{ borderBottom: '1px solid', borderColor: 'text.secondary', minWidth: 40, mb: 0.5 }} />
        </Box>
      )}

      {/* Controls */}
      <Box sx={{ display: 'flex', gap: 0.25, mt: 'auto', flexWrap: 'wrap' }}>
        <Tooltip title="Move row up"><span>
          <IconButton size="small" disabled={rowIndex === 0} onClick={onMoveUp} sx={{ p: 0.25 }}>
            <ArrowUpward sx={{ fontSize: 14 }} />
          </IconButton>
        </span></Tooltip>
        <Tooltip title="Move row down"><span>
          <IconButton size="small" disabled={rowIndex >= totalRows - 1} onClick={onMoveDown} sx={{ p: 0.25 }}>
            <ArrowDownward sx={{ fontSize: 14 }} />
          </IconButton>
        </span></Tooltip>

        {columns >= 2 && !isFullWidth && !isLabelValue && (
          <>
            <Tooltip title="Move left"><span>
              <IconButton size="small" disabled={colIndex === 0} onClick={onMoveLeft} sx={{ p: 0.25 }}>
                <ArrowBack sx={{ fontSize: 14 }} />
              </IconButton>
            </span></Tooltip>
            <Tooltip title="Move right"><span>
              <IconButton size="small" disabled={colIndex >= rowLength - 1} onClick={onMoveRight} sx={{ p: 0.25 }}>
                <ArrowForward sx={{ fontSize: 14 }} />
              </IconButton>
            </span></Tooltip>
          </>
        )}

        {columns >= 2 && !isLabelValue && (
          <Tooltip title={
            effectiveSpan >= columns ? 'Remove span (back to 1 col)' :
            effectiveSpan > 1 ? `Expand to ${columns}-col full width` :
            `Merge: span ${Math.min(2, columns)} cols`
          }>
            <IconButton
              size="small"
              onClick={onToggleFullWidth}
              color={effectiveSpan > 1 ? 'primary' : 'default'}
              sx={{ p: 0.25 }}
            >
              <SpanIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  )
}

// ── Main component ───────────────────────────────────────────

export default function LayoutEditor({ schema, onChange }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {schema.sections.map((sec) => {
        const rows = getRows(sec)
        return (
          <Paper key={sec.id} variant="outlined" sx={{ p: 2 }}>
            {/* Section header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {sec.title || 'Untitled Section'}
                </Typography>
                {sec.layout_type && (
                  <Chip
                    label={sec.layout_type === 'label_value' ? 'label / value' : 'grid'}
                    size="small"
                    color={sec.layout_type === 'label_value' ? 'secondary' : 'primary'}
                    sx={{ fontSize: '0.65rem', height: 18 }}
                  />
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Columns:</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={sec.columns}
                  onChange={(_, v) => {
                    if (v === null) return
                    onChange(updateSection(schema, sec.id, (s) => ({
                      ...s,
                      columns: v as 1 | 2 | 3,
                      fields: s.fields.map((f) => ({ ...f, row: undefined, column: undefined, full_width: undefined, col_span: undefined })),
                    })))
                  }}
                >
                  <ToggleButton value={1} sx={{ px: 1.5, py: 0.25 }}>
                    <ViewStream sx={{ fontSize: 16, mr: 0.5 }} /> 1
                  </ToggleButton>
                  <ToggleButton value={2} sx={{ px: 1.5, py: 0.25 }}>
                    <ViewColumn sx={{ fontSize: 16, mr: 0.5 }} /> 2
                  </ToggleButton>
                  <ToggleButton value={3} sx={{ px: 1.5, py: 0.25 }}>
                    <ViewWeek sx={{ fontSize: 16, mr: 0.5 }} /> 3
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>
            <Divider sx={{ mb: 1.5 }} />

            {/* Grid rows */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {rows.map((rowFields, ri) => (
                <Box
                  key={ri}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: sec.columns === 3 ? '1fr 1fr 1fr' : sec.columns === 2 ? '1fr 1fr' : '1fr',
                    gap: 1,
                  }}
                >
                  {rowFields.map((field, ci) => (
                    <FieldCell
                      key={field.id}
                      field={field}
                      sectionId={sec.id}
                      columns={sec.columns}
                      sectionLayoutType={sec.layout_type}
                      rowIndex={ri}
                      colIndex={ci}
                      rowLength={rowFields.length}
                      totalRows={rows.length}
                      onMoveUp={() => onChange(moveFieldUp(schema, sec.id, field.name))}
                      onMoveDown={() => onChange(moveFieldDown(schema, sec.id, field.name))}
                      onMoveLeft={() => onChange(moveFieldLeft(schema, sec.id, field.name))}
                      onMoveRight={() => onChange(moveFieldRight(schema, sec.id, field.name))}
                      onToggleFullWidth={() => onChange(cycleColSpan(schema, sec.id, field.name))}
                    />
                  ))}
                </Box>
              ))}
              {rows.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                  No fields in this section
                </Typography>
              )}
            </Box>
          </Paper>
        )
      })}
    </Box>
  )
}
