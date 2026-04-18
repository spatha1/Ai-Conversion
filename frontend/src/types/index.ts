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
  sf_has_private_key?: boolean   // true when a private key was saved (never returns the key itself)
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
  query_sql?: string
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

export interface CatalogRelationRow extends CatalogRelation {
  id: number
  fk_name?: string | null
  source: 'fk' | 'manual' | 'ai'
}

export interface AISuggestedRelation extends CatalogRelation {
  confidence: number
  reason: string
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

// ─── AI Platform ──────────────────────────────────────────────────────────────

export interface AITraceEntry {
  id: number
  module: string
  conn_id?: number
  model: string
  prompt_text?: string
  response_text?: string
  tokens_in?: number
  tokens_out?: number
  latency_ms?: number
  created_at: string
}

export interface AIReadiness {
  tables_total: number
  tables_with_description: number
  columns_with_embeddings: number
  fk_relations: number
  query_examples: number
  active_prompt_templates: number
  readiness_score: number   // 0.0 – 1.0
}

export interface AIContextSummary {
  conn_id: number
  table_count: number
  column_count: number
  relation_count: number
  metadata_count: number
  example_count: number
  has_query_context: boolean
  active_template_count: number
}

// ─── Development Module ───────────────────────────────────────────────────────

export interface PlanStep {
  step_number: number
  title: string
  description: string
  sql_type: string   // SELECT|INSERT|UPDATE|DELETE|CREATE_TABLE|STORED_PROCEDURE|DDL|SCRIPT
  depends_on: number[]
}

export interface DevArtifactItem {
  step_number: number
  sql?: string
  result?: { columns: string[]; rows: Record<string, unknown>[]; total: number }
  status: 'pending' | 'generated' | 'validated' | 'executed' | 'error' | 'skipped'
  validation?: SQLValidationResult
  error?: string
}

export interface DevArtifact {
  id: number
  conn_id?: number
  project_id?: number
  task_description: string
  plan_json?: string         // JSON-encoded PlanStep[]
  artifacts_json?: string    // JSON-encoded DevArtifactItem[]
  pipeline_config?: string   // JSON-encoded dependency graph
  status: string
  created_at: string
  updated_at: string
}

export interface SQLValidationResult {
  passed: boolean
  errors: string[]
  warnings: string[]
}

// ─── BRD / Acceptance Criteria ────────────────────────────────────────────────

export interface BRDCriterion {
  id: number
  feature: string
  given: string
  when: string
  then: string
  sql_validation?: string
  priority: 'high' | 'medium' | 'low'
  complexity: 'simple' | 'moderate' | 'complex'
  notes?: string
}

// ─── Prompt Templates ─────────────────────────────────────────────────────────

export interface PromptTemplate {
  id: number
  name: string
  description?: string
  category?: string    // mapping|report|dev|admin|dashboard|ps|testing
  content: string
  example_output?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Query Example ───────────────────────────────────────────────────────────

export interface QueryExample {
  id: number
  conn_id?: number
  name: string
  description?: string
  tables_used?: string    // comma-separated table names
  example_sql: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Power BI Export ──────────────────────────────────────────────────────────

export interface PowerBIRelationship {
  fromTable:              string
  fromColumn:             string
  toTable:                string
  toColumn:               string
  crossFilteringBehavior?: string
}

export interface PowerBIExport {
  dax_measures: Array<{ name: string; table?: string; expression: string; description?: string }>
  dataset_schema: {
    tables:         Array<{ name: string; columns: Array<{ name: string; dataType: string }> }>
    relationships?: PowerBIRelationship[]
  }
  report_json:  Record<string, unknown>
  // Enhanced artifacts
  tmsl_json:    Record<string, unknown>
  dax_script:   string
  build_guide:  string
}

// ── AI Agents ─────────────────────────────────────────────────
export interface AIAgent {
  id:          number
  name:        string
  description: string | null
  goal:        string
  conn_id:     number | null
  schedule:    string | null
  status:      'active' | 'paused' | 'inactive'
  role_id:     number | null
  category:    string | null
  tools_json:  string | null
  created_at:  string
  updated_at:  string
  last_run_at: string | null
}

export interface AIAgentLog {
  id:             number
  agent_id:       number
  status:         'running' | 'success' | 'failed' | 'partial'
  generated_plan: string | null
  steps_executed: number | null
  result_summary: string | null
  error:          string | null
  execution_time: number | null
  created_at:     string
  finished_at:    string | null
}

// ── Testing / Reconciliation ──────────────────────────────────
export type ValidationTypeEnum =
  | 'count' | 'sum' | 'null_check' | 'duplicate' | 'custom'
  | 'row_level' | 'column_level'

export type ReconciliationTypeEnum = 'aggregate' | 'row_level'

export interface AITestCase {
  id:                  number
  group_name:          string | null
  name:                string
  source_conn_id:      number | null
  target_conn_id:      number | null
  source_query:        string
  target_query:        string
  validation_type:     ValidationTypeEnum
  threshold:           string | null
  schedule_cron:       string | null
  identifier_column:   string | null
  reconciliation_type: ReconciliationTypeEnum | null
  columns_to_compare:  string | null   // comma-separated; null = all columns
  created_at:          string
}

export interface AITestCaseCreate {
  group_name?:          string
  name:                 string
  source_conn_id?:      number
  target_conn_id?:      number
  source_query:         string
  target_query:         string
  validation_type:      ValidationTypeEnum
  threshold?:           string
  identifier_column?:   string
  reconciliation_type?: ReconciliationTypeEnum
  columns_to_compare?:  string   // comma-separated columns to diff; blank = all
}

/** One row mismatch entry from sample_mismatches JSON */
export interface MismatchEntry {
  key: string
  differences: Record<string, { source: string; target: string }>
}

export interface AITestResult {
  id:                   number
  test_case_id:         number
  execution_time:       number | null
  result:               'pass' | 'fail' | 'error' | 'pending'
  source_value:         string | null
  target_value:         string | null
  difference:           string | null
  remarks:              string | null
  mismatch_count:        number | null
  missing_source_count:  number | null
  missing_target_count:  number | null
  sample_mismatches:     string | null   // JSON string → MismatchEntry[]
  sample_missing_source: string | null   // JSON string → string[]
  sample_missing_target: string | null   // JSON string → string[]
  ran_at:                string
}

export interface TestSummaryRow {
  test_case:     AITestCase
  latest_result: AITestResult | null
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
export interface FeedbackSubmit {
  submitted_by?: string
  module?:       string
  area?:         string
  type:          string   // bug|feature|improvement|question|praise
  priority?:     string   // low|medium|high
  title:         string
  description?:  string
  page_url?:     string
}

export interface FeedbackEntry {
  id:           number
  submitted_by?: string
  module?:       string
  area?:         string
  type:          string
  priority?:     string
  title:         string
  description?:  string
  page_url?:     string
  status:        string   // open|in_progress|resolved|closed
  admin_notes?:  string
  created_at:    string
  updated_at:    string
}

export interface TestRunAllResult {
  summary: { total: number; passed: number; failed: number; errors: number }
  results: Array<{
    test_case_id:         number
    test_case_name:       string
    result:               string
    source_value:         string | null
    target_value:         string | null
    difference:           string | null
    remarks:              string | null
    execution_time:       number | null
    mismatch_count:       number | null
    missing_source_count: number | null
    missing_target_count: number | null
    sample_mismatches:    string | null
  }>
}

// ─── Agentic AI Platform ──────────────────────────────────────────────────────

export interface AgentRole {
  id:                 number
  role_name:          string
  description?:       string
  responsibilities?:  string
  skills?:            string
  input_expectation?: string
  output_expectation?:string
  decision_logic?:    string
  deliverables?:      string
  tone?:              string
  is_active:          boolean
  created_at:         string
  updated_at:         string
}

export interface AgentCard {
  id:                 number
  name:               string
  description?:       string
  role_id?:           number
  agent_id?:          number   // named employee assigned to this step
  execution_order:    number
  input_mapping?:     string
  output_mapping?:    string
  is_mandatory:       boolean
  is_active:          boolean
  on_reject_card_id?: number   // loop-back target on REJECT
  max_iterations:     number   // default 3
  created_at:         string
}

export interface WorkflowExecution {
  id:               number
  conn_id?:         number
  user_query:       string
  model:            string
  status:           string    // running|success|partial|escalated|failed
  total_steps:      number
  completed_steps:  number
  final_summary?:   string
  created_at:       string
  finished_at?:     string
}

export interface WorkflowExecutionStep {
  id:                number
  execution_id:      number
  step_number:       number
  card_id?:          number
  card_name?:        string
  role_name?:        string
  agent_name?:       string   // named person (Sai, Chand)
  iteration:         number   // loop counter — 1 = first run, 2 = after first reject, etc.
  decision?:         string   // APPROVE | REJECT | REVISE | ESCALATED
  decision_notes?:   string   // manager/TL feedback text
  input_text?:       string
  output_text?:      string
  prompt_used?:      string
  status:            string   // pending|running|success|failed|escalated
  execution_time_ms?:number
  created_at:        string
}

export interface AgentTool {
  key:   string
  label: string
}

export interface SavedAgenticWorkflow {
  id:                 number
  name:               string
  description?:       string
  user_query:         string
  conn_id?:           number
  model:              string
  schedule_label?:    string   // "none" | "daily" | "weekly" | "monthly"
  last_run_at?:       string
  last_execution_id?: number
  is_active:          boolean
  created_at:         string
}

// ── Conversion Agent Pipeline ─────────────────────────────────────────────────

export interface AgentRunLog {
  id:             number
  conn_id:        number
  agent_name:     string
  attempt:        number
  status:         string  // running | success | failed
  input_summary:  string | null
  output_summary: string | null
  duration_ms:    number | null
  created_at:     string
}

export interface QueryVersion {
  id:               number
  conn_id:          number
  version:          number
  sql_text:         string
  mapping_snapshot: string | null
  agent_run_id:     number | null
  created_at:       string
}

export interface ValidationResultEntry {
  id:         number
  conn_id:    number
  xml_id:     number | null
  check_name: string
  passed:     boolean
  detail:     string | null
  created_at: string
}

export interface ColumnProfile {
  id:             number
  conn_id:        number
  table_name:     string
  column_name:    string
  null_pct:       number | null
  distinct_count: number | null
  total_count:    number | null
  min_val:        string | null
  max_val:        string | null
  pattern_hint:   string | null
  profiled_at:    string
}

export interface ValueMapping {
  id:           number
  conn_id:      number
  table_name:   string
  column_name:  string
  source_value: string
  target_value: string | null
  confidence:   number | null
  mapping_type: string  // manual | ai | rule | pending_review
  status:       string  // pending | approved | rejected
  expires_at:   string | null
  created_at:   string
}

export interface ConversionAgentResult {
  status:             string
  attempts:           number
  version:            number
  run_log_id:         number | null
  sql_preview:        string
  xml_count:          number
  xml_records:        Array<{ id: number; identifier_value: string; generated_at: string }>
  validation_summary: {
    passed: boolean
    checks: Array<{ name: string; passed: boolean }>
    xml_count: number
  }
  errors: string[]
}
