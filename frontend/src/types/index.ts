// ─── Auth ────────────────────────────────────────────────────────────────────
export interface AuthUser {
  username: string
  token?: string
}

// ─── Projects ────────────────────────────────────────────────────────────────
export interface Project {
  id: number
  name: string
  description?: string
  status?: 'active' | 'draft' | 'archived'
  created_at: string
  updated_at: string
  connection_count?: number
  mapping_count?: number
}

export interface ProjectCreate {
  name: string
  description?: string
  status?: string
}

// ─── Connections ─────────────────────────────────────────────────────────────
export interface SourceConnection {
  id: number
  project_id?: number
  name: string
  source_type: 'sql' | 'snowflake' | 'file'
  dialect?: string
  host?: string
  port?: number
  database_name?: string
  schema_name?: string
  username?: string
  sf_account?: string
  sf_warehouse?: string
  sf_role?: string
  sf_database?: string
  sf_schema?: string
  sf_username?: string
  query_text?: string
  sheet_alias?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ConnectionCreate {
  project_id?: number
  name: string
  source_type: string
  dialect?: string
  host?: string
  port?: number
  database_name?: string
  schema_name?: string
  username?: string
  password?: string
  sf_account?: string
  sf_warehouse?: string
  sf_role?: string
  sf_database?: string
  sf_schema?: string
  sf_username?: string
  sf_password?: string
  sf_private_key?: string
  sf_private_key_passphrase?: string
  query_text?: string
  sheet_alias?: string
}

export interface TestResult {
  success: boolean
  message: string
  row_count?: number
  columns?: string[]
  rows?: Record<string, unknown>[]
}

// ─── XML / Template ──────────────────────────────────────────────────────────
export interface TargetFormulaRule {
  id?: number
  target_path?: string
  group_path?: string
  formula_type?: string
  expression?: string
  default_value?: string
  execution_order?: number
}

export interface ProcessResult {
  inserted: number
  template_id?: number
  rules: TargetFormulaRule[]
}

// ─── Mapping ─────────────────────────────────────────────────────────────────
export interface MappingRow {
  id?: string
  source_sheet?: string
  source_column?: string
  transform?: string
  target_path?: string
  confidence?: number
  is_manual?: boolean
}

export interface Mapping {
  id?: number
  conn_id: number
  identifier_column?: string
  identifier_table?: string
  rows: MappingRow[]
}

export interface GeneratedQuery {
  query_sql: string
  conn_id: number
  identifier_column?: string
  identifier_table?: string
}

export interface GeneratedXml {
  id: number
  identifier_value: string
  xml_content: string
  created_at: string
}

// ─── Admin / Catalog ─────────────────────────────────────────────────────────
export interface CatalogColumn {
  table_name: string
  column_name: string
  data_type?: string
  is_nullable?: boolean
  is_primary_key?: boolean
}

export interface CatalogRelation {
  parent_table: string
  parent_column: string
  referenced_table: string
  referenced_column: string
}

export interface CatalogSummary {
  table_count: number
  column_count: number
  relation_count: number
  view_count: number
  sample_count: number
}

export interface Catalog {
  summary: CatalogSummary
  columns: CatalogColumn[]
  relations: CatalogRelation[]
  views: Array<{ name: string; definition: string }>
  samples: Record<string, unknown[]>
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  execution_time_ms?: number
}

export interface SavedReport {
  id: number
  name: string
  sql: string
  conn_id: number
  created_at: string
}

// ─── PS Support ──────────────────────────────────────────────────────────────
export interface PsConversation {
  id: number
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

export interface PsMessage {
  id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
}

export interface PsApiEntry {
  id: number
  name: string
  method: string
  url: string
  description?: string
  headers_json?: string
  body_template?: string
  required_fields?: string   // JSON array string e.g. '["emp_id","deptno"]'
  auth_type?: string
  has_auth?: boolean
  conn_id?: number
}

export interface Workflow {
  id: number
  name: string
  description?: string
  trigger_type: string
  schedule_cron?: string
  is_active: boolean
  steps: WorkflowStep[]
  created_at: string
}

export interface WorkflowStep {
  id?: number
  step_order: number
  step_type: 'sql' | 'api' | 'email'
  name: string
  config: Record<string, unknown>
}

// ─── Validation ──────────────────────────────────────────────────────────────
export interface ValidationRule {
  id?: string
  xml_path: string
  is_required?: boolean
  data_type?: 'string' | 'integer' | 'decimal' | 'date' | 'boolean'
  min_length?: number
  max_length?: number
  pattern?: string
  enumeration?: string   // comma-separated allowed values
  min_value?: number
  max_value?: number
}

export interface ValidationError {
  identifier: string
  path: string
  message: string
  actual: string
  expected: string
}

export interface ValidationResult {
  valid: boolean
  total: number
  failed: number
  errors: ValidationError[]
}

// ─── My Dashboards ───────────────────────────────────────────────────────────
export interface WidgetDataBinding {
  sql: string
  xField?: string
  yField?: string
  labelField?: string
  valueField?: string
}

export interface DashboardWidget {
  id: string
  type: 'kpi' | 'line' | 'bar' | 'pie' | 'doughnut' | 'table'
  title: string
  layout: { x: number; y: number; w: number; h: number }
  props?: Record<string, unknown>
  dataBinding: WidgetDataBinding
}

export interface DashboardConfigSchema {
  tabName: string
  description?: string
  filters?: unknown[]
  layout?: { cols: number }
  widgets: DashboardWidget[]
}

export interface SavedDashboard {
  id: number
  name: string
  description?: string
  conn_id?: number
  project_id?: number
  config_json: string
  debug_json?: string
  created_at: string
}

export interface DashboardDebugMeta {
  user_prompt: string
  constraints: string
  system_prompt: string
  schema_text: string
  relationships_text: string
  query_context?: string
  full_user_prompt: string
  model: string
  source_sql?: string   // set when generated from SQL Query mode
}

// ─── API Dispatch ────────────────────────────────────────────────────────────
export interface ApiDispatchConfig {
  id?: number
  endpoint_url?: string
  method: string
  content_type: string
  auth_type: string          // none|bearer|apikey|basic|oauth2
  has_auth_value?: boolean
  auth_value?: string        // plain text — only used when saving
  auth_header_name?: string  // for apikey
  extra_headers?: string     // JSON string
}

export interface ApiDispatchLog {
  id: number
  xml_id?: number
  identifier_value?: string
  status: string             // pending|running|success|fail
  response_status?: number
  response_body?: string
  response_time_ms?: number
  retry_count: number
  error_message?: string
  sent_at?: string
}

export interface XmlDispatchRow {
  xml_id: number
  identifier_value?: string
  validation_status?: string // pass|fail|null
  dispatch_status?: string   // latest log status or null
  dispatch_log_id?: number
  response_status?: number
  response_time_ms?: number
  retry_count: number
}

export interface DispatchSendAllResult {
  sent: number
  failed: number
  total: number
  results: Array<{
    xml_id: number
    identifier_value?: string
    status: string
    http_code: number
    retries: number
    error?: string
  }>
}

// ─── API Response wrappers ───────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  size: number
}
