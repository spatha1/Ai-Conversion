// ─── Auth ────────────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'developer' | 'viewer'

export interface AuthUser {
  id:       number
  username: string
  role:     UserRole
  token:    string   // access_token — stored in memory only, never persisted
}

export interface UserRecord {
  id:         number
  username:   string
  email:      string | null
  role:       UserRole
  is_active:  boolean
  created_at: string
  last_login: string | null
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
export type TemplateFormat = 'xml' | 'json' | 'text' | 'sql'

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
  format_type?: TemplateFormat
  rules: TargetFormulaRule[]
}

export interface TemplateResponse {
  conn_id: number
  name: string
  content: string
  format_type: TemplateFormat
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
  step_type: 'sql' | 'api' | 'api_loop' | 'email'
  label?: string
  name?: string
  config?: Record<string, unknown>
  config_json?: string
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
export type DispatchType = 'api' | 'sftp' | 'azure_blob'

export interface ApiDispatchConfig {
  id?: number
  dispatch_type: DispatchType
  // API
  endpoint_url?: string
  method: string
  content_type: string
  auth_type: string          // none|bearer|apikey|basic|oauth2
  has_auth_value?: boolean
  auth_value?: string        // plain text — only used when saving
  auth_header_name?: string  // for apikey
  extra_headers?: string     // JSON string
  // SFTP
  sftp_host?: string
  sftp_port?: number
  sftp_username?: string
  sftp_password?: string     // plain text — only used when saving
  has_sftp_password?: boolean
  sftp_remote_path?: string
  // Azure Blob
  azure_conn_str?: string    // plain text — only used when saving
  has_azure_conn_str?: boolean
  azure_container?: string
  azure_blob_prefix?: string
}

export interface ApiDispatchLog {
  id: number
  xml_id?: number
  identifier_value?: string
  status: string             // pending|running|success|fail
  request_body?: string
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

// ─── AI Debug & Observability ──────────────────────────────────────────────────

export type DebugLevel  = 'OFF' | 'BASIC' | 'ADVANCED'
export type DebugModule = 'development' | 'mapping' | 'report' | 'reconciliation' | 'multi_compare'

export interface DebugTemplateRef {
  category: string
  name:     string
  id?:      number
}

export interface DebugStepError {
  type:    string
  message: string
  step:    string
}

export interface DebugStep {
  step:          string
  label:         string
  input:         Record<string, unknown>
  output:        Record<string, unknown>
  duration_ms:   number | null
  template_used: DebugTemplateRef | null
  status:        'success' | 'error'
  error:         DebugStepError | null
}

export interface DebugPayload {
  trace_id:    string
  debug_level: DebugLevel
  steps:       DebugStep[]
}

export interface DebugSetting {
  module:      DebugModule
  debug_level: DebugLevel
  updated_at?: string | null
}

export interface DebugSettingsResponse {
  settings: DebugSetting[]
}

export interface DebugTraceRecord {
  id:          number
  trace_id:    string
  module:      string
  conn_id?:    number | null
  debug_level: string
  steps_json?: string | null
  created_at:  string
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

// ── Dev vs Base Reconciliation Engine ────────────────────────────────────────

export type RecQueryType =
  | 'count' | 'agg' | 'distribution' | 'set_diff'
  | 'duplicate' | 'join_explosion' | 'filter_impact' | 'sample_value' | 'custom'

export interface TestQuery {
  id:               number
  conn_id:          number
  query_type:       RecQueryType
  name:             string
  sql_text:         string
  table_name:       string | null
  column_name:      string | null
  priority:         number
  severity:         string
  is_auto_generated: boolean
  dev_source_tag:   string | null   // null = global; comma-separated source types e.g. "mapper,dashboard"
  created_at:       string
}

export interface TestQueryCreate {
  query_type:       RecQueryType
  name:             string
  sql_text:         string
  table_name?:      string
  column_name?:     string
  priority?:        number
  severity?:        string
  is_auto_generated?: boolean
  dev_source_tag?:  string | null
}

export interface ReconciliationResult {
  id:               number
  conn_id:          number
  run_id:           string
  test_query_id:    number | null
  dev_source_type:  string | null
  dev_source_id:    number | null
  test_name:        string
  query_type:       RecQueryType
  q2_base_sql:      string | null
  q1_dev_sql:       string | null
  q1_sql_snapshot:  string | null
  status:           'PASS' | 'FAIL' | 'WARN' | 'ERROR' | 'SKIP'
  base_result:      string | null
  dev_result:       string | null
  issue:            string | null
  ai_insight:       string | null
  execution_time_ms: number | null
  created_at:       string
}

export interface AiInsight {
  root_cause_category: string
  confidence:          number
  explanation:         string
  suggestion:          string
  ai_suggested_fix?:   string
}

export interface RecRunSummary {
  run_id:           string
  conn_id:          number
  created_at:       string
  total:            number
  passed:           number
  failed:           number
  warns:            number
  errors:           number
  skipped:          number
  confidence_score: number
  coverage_score:   number
  dev_source_type:  string | null
  dev_source_id:    number | null
}

export interface SourceRunStats {
  run_id:           string
  created_at:       string
  total:            number
  passed:           number
  failed:           number
  warns:            number
  errors:           number
  skipped:          number
  confidence_score: number
}

export interface SourceEntry {
  source_id:   number | null
  source_name: string
  latest:      SourceRunStats
  runs:        SourceRunStats[]
}

export interface SourceSummaryGroup {
  source_type: string
  label:       string
  total:       number
  passed:      number
  failed:      number
  skipped:     number
  sources:     SourceEntry[]
}

export interface CollectQueriesResult {
  generated: number
  by_type:   Record<string, number>
  errors:    string[]
  coverage?: {
    tables_covered: number
    tables_total:   number
    fk_coverage:    number
    col_coverage:   number
    overall:        number
  }
}

// ─── Ask AI ───────────────────────────────────────────────────────────────────
export type KpiType = 'currency' | 'count' | 'status' | 'date' | 'percentage' | 'duration' | 'score'
export type KpiStatus = 'good' | 'warning' | 'critical' | 'neutral'

export interface AskAIKpi {
  label:   string
  value:   string | number | null
  type:    KpiType
  status:  KpiStatus
  unit:    string | null
  trend:   null
  _band?:  string
}

export interface AskAIAlert {
  level:   'error' | 'warning' | 'info'
  message: string
}

export interface AskAISectionField {
  label:   string
  column:  string
  value:   string
  type:    KpiType
}

export interface AskAISection {
  table:   string
  title:   string
  fields:  AskAISectionField[]
}

export interface AskAIAction {
  label:                 string
  action_type:           string
  entity:                string | null
  entity_id:             string | null
  requires_confirmation: boolean
  preview_steps:         string[]
  query_sql?:            string
}

export interface AskAIFollowUp {
  label: string
  query: string
}

export interface AskAITraceStep {
  step_number:         number
  step_name:           string
  status:              'success' | 'error'
  duration_ms:         number
  summary:             string
  confidence?:         number
  guardrail_triggered: boolean
  sql?:                string
}

export interface AskAIIntent {
  type:                 string
  entity:               string | null
  entity_id:            string | null
  confidence:           number
  clarification_needed: boolean
}

export interface AskAIDataSources {
  tables:    string[]
  row_count: number
  summary:   string
}

export interface AskAIResult {
  session_id:           string | null
  intent:               AskAIIntent
  clarification_prompt: string | null
  narrative:            string | null
  data_sources:         AskAIDataSources | null
  kpis:                 AskAIKpi[]
  alerts:               AskAIAlert[]
  rules_triggered:      { rule_name: string; outcome: string; alert_level: string }[]
  pii_masked:           string[]
  sections:             AskAISection[]
  raw_data:             { columns: string[]; rows: Record<string, unknown>[] } | null
  key_insights:         { type: 'info' | 'warning' | 'success'; text: string }[]
  actions:              AskAIAction[]
  follow_ups:           AskAIFollowUp[]
  trace_steps:          AskAITraceStep[]
  trace_id:             string | null
}

// ─── UI Validation (Playwright template-based) ────────────────────────────────

export interface UiValidationTemplate {
  id:                number
  connection_id:     number
  app_name:          string
  base_url:          string
  entity_paths:      Record<string, string>        // {"policy": "/policy/{id}"}
  login_config:      Record<string, string> | null
  selectors:         Record<string, string>        // {"premium": "[data-testid='premium']"}
  response_id_field: string | null                 // JSON key in dispatch response for DCT entity ID
  created_at:        string
  updated_at:        string
}

export type ValidationFieldStatus = 'MATCH' | 'MISMATCH' | 'MISSING' | 'NO_XML' | 'ERROR'

export interface ValidationFieldResult {
  field:     string
  ui_value:  string | null
  xml_value: string | null
  status:    ValidationFieldStatus
}

export interface ValidationRunSummary {
  total:      number
  matched:    number
  mismatched: number
  missing:    number
}

export interface UiValidationRun {
  id:            number
  entity:        string
  entity_id:     string
  status:        'PASS' | 'FAIL' | 'ERROR'
  url:           string | null
  screenshot:    string | null
  summary:       ValidationRunSummary | null
  results:       ValidationFieldResult[]
  error_message: string | null
  created_at:    string
}

export interface UiValidationStatus {
  configured:   boolean
  template_id:  number | null
  entity_paths: Record<string, string>   // {"policy": "/policy/{id}"} — empty when not configured
}

// ─── Multi-Source Compare ─────────────────────────────────────────────────────

export type MultiSourceType = 'db' | 'file'

export interface MultiSourceSlotConfig {
  slot_index:      number
  source_type:     MultiSourceType
  conn_id?:        number | null
  sql?:            string | null
  label?:          string | null
  file_name?:      string | null
  file_row_count?: number | null
}

export interface MultiSourceDatasetSummary {
  slot_index:   number
  label:        string
  source_type:  MultiSourceType
  row_count:    number
  column_count: number
  columns:      string[]
  sample_rows:  Record<string, unknown>[]
  file_name?:   string | null
}

export interface MultiCompareCheck {
  check_name:        string
  status:            'PASS' | 'WARN' | 'FAIL' | 'INFO'
  detail:            string
  datasets_involved: number[]
}

export interface MultiCompareResult {
  run_id:            string
  datasets:          MultiSourceDatasetSummary[]
  checks_performed:  string[]
  checks:            MultiCompareCheck[]
  overall_verdict:   'PASS' | 'WARN' | 'FAIL'
  verdict_summary:   string
  ai_narrative:      string
  user_instructions: string | null
  elapsed_ms:        number
  tokens_in:         number
  tokens_out:        number
  prompt_text:       string
}

// ── Story Analyzer ────────────────────────────────────────────────────────────

export interface StoryInput {
  title: string
  description: string
  acceptance_criteria?: string
  ticket_id?: string
}

export interface ParsedStory {
  title: string
  ticket_id?: string
  definition?: string
  entities: string[]
  metrics: string[]
  dimensions: string[]
  filters: string[]
  time_granularity: string
  use_case: string
}

export interface UnifiedIntent {
  entities: string[]
  metrics: string[]
  dimensions: string[]
  use_cases: string[]
  time_granularity: string[]
  filters: string[]
}

export interface StoryConflict {
  type: string
  description: string
}

export interface UseCaseOutputs {
  development_prompt: string
  report_prompt: string
  dashboard_prompt: string
  testing_prompt: string
}

export interface ExtractedUseCase {
  name: string
  description: string
  entities: string[]
  metrics: string[]
  dimensions: string[]
  filters: string[]
  time_granularity: string[]
  type: 'trend' | 'aggregation' | 'reconciliation' | 'detail' | string
  priority: 'high' | 'medium' | 'low'
  expected_outputs: string[]
  outputs: UseCaseOutputs
}

export interface ModelReport {
  name: string
  description: string
  prompt: string
}

export interface DataModel {
  name: string
  type: 'history' | 'aggregation' | 'summary' | 'reconciliation' | string
  grain: string
  entities: string[]
  metrics: string[]
  dimensions: string[]
  derived_metrics: string[]
  use_cases: string[]
  development_prompt: string
  reports: ModelReport[]
  dashboard_prompt: string
  testing_prompt: string
}

export interface StoryAnalysisResult {
  parsed_stories: ParsedStory[]
  unified_intent: UnifiedIntent
  conflicts: StoryConflict[]
  use_cases: ExtractedUseCase[]
  ui_actions: Record<string, unknown>
  models: DataModel[]
  tokens_in: number
  tokens_out: number
  latency_ms: number
}

export interface SavedAnalysisOut {
  id: number
  title: string
  project_id: number | null
  model: string | null
  created_at: string
  use_case_count: number
}

export interface SavedAnalysisFull extends SavedAnalysisOut {
  stories: StoryInput[]
  result: StoryAnalysisResult
}

// ── Form Builder ─────────────────────────────────────────────

export type FormFieldType =
  | 'text' | 'number' | 'date' | 'dropdown' | 'checkbox'
  | 'radio' | 'textarea' | 'signature' | 'file'

export type FormDataSourceType = 'db' | 'api' | 'manual'
export type FormOutputFormat = 'pdf' | 'fillable' | 'ui' | 'api'
export type FormStatus = 'draft' | 'configured' | 'active'

export interface FormVisibilityRule {
  depends_on_field: string
  equals: any
}

export interface FormValidationRule {
  rule: string
  value?: any
  message: string
}

export interface FormFieldDef {
  id: string
  name: string
  label: string
  type: FormFieldType
  required: boolean
  default_value?: string
  placeholder?: string
  options?: string[]
  column?: 1 | 2
  validations: FormValidationRule[]
  visibility_rule?: FormVisibilityRule | null
  pdf_layout?: { x: number; y: number; width: number; height: number }
}

export interface FormSection {
  id: string
  title: string
  order: number
  columns: 1 | 2
  fields: FormFieldDef[]
}

export interface FormSchemaJson {
  form_name: string
  version: number
  status: FormStatus
  sections: FormSection[]
}

export interface FormTemplate {
  id: number
  name: string
  description?: string
  category?: string
  version: number
  status: FormStatus
  form_schema_json?: string | null
  source_type?: string
  source_file_path?: string
  parent_id?: number
  project_id?: number
  created_at: string
  updated_at: string
}

export interface FormMappingPreset {
  id: number
  name: string
  description?: string
  source_hint?: string
  mapping_json?: string | null
  created_at: string
  updated_at: string
}

export interface FormDataBinding {
  id: number
  template_id: number
  template_version: number
  name?: string
  data_source: FormDataSourceType
  config_json?: string | null
  mapping_json?: string | null
  preset_id?: number
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface FormExecution {
  id: number
  template_id: number
  template_version: number
  binding_id?: number
  bulk_run_id?: string
  output_format: FormOutputFormat
  status: string
  output_json?: string | null
  output_file_path?: string
  error_message?: string
  triggered_by: string
  created_at: string
  updated_at: string
}

export interface FormBulkExecuteItem {
  template_id: number
  template_version: number
  output_format: FormOutputFormat
}

export interface FormBulkResult {
  bulk_run_id: string
  executions: FormExecution[]
}

export interface FormNormalizedData {
  data: Record<string, any>
  meta: { source: string; fetched_at: string; row_count: number }
}

export interface FormAutoMapResult {
  mapping: Record<string, string>
  confidence: Record<string, number>
}

export interface FormPreviewResult {
  columns: string[]
  sample_rows: any[]
  normalized: FormNormalizedData
}

export interface FormTemplateDraft {
  schema: FormSchemaJson
  source_type: string
}

