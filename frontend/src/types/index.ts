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
  schema_snapshot?: string   // JSON string — knowledge module stores { question }
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
  conn_id?: number     // null = global; set = connection-specific override
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
  // Phase 2 — Role-Based Capability Profiles
  tools_json?:            string  // JSON list of granted tool ids
  restricted_tools_json?: string  // JSON list of blocked tool ids
  knowledge_access_json?: string  // {op_categories, systems, entry_types}
  context_budget_tokens?: number
  is_ootb:                boolean
  parent_role_id?:        number
  model_override?:        string
  max_tokens_per_call?:   number
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
  // Phase 3 — Dynamic Orchestration
  condition_json?:    string
  is_planner:         boolean
  created_at:         string
}

export interface WorkflowExecution {
  id:               number
  conn_id?:         number
  user_query:       string
  model:            string
  status:           string    // running|success|partial|escalated|failed|pending_approval|cost_limit_reached
  total_steps:      number
  completed_steps:  number
  final_summary?:   string
  created_at:       string
  finished_at?:     string
  // Phase 2 governance fields
  avg_confidence?:           number
  max_risk_level?:           string
  total_tokens_in?:          number
  total_tokens_out?:         number
  estimated_cost_usd?:       number
  learnings_extracted_json?: string
  dynamic_plan_json?:        string
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
  // Phase 2 — Confidence & Risk Engine
  confidence_score?: number
  risk_json?:        string   // {risk_type, severity, business_impact}
  auto_hitl?:        boolean
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
  prompt_text?:      string
  _slots?: Array<{
    slot_index:  number
    source_type: 'db' | 'file'
    conn_id?:    number | null
    sql?:        string
    label?:      string
    file_name?:  string | null
  }>
}

export interface CompareRunSummary {
  id:                number
  run_id:            string
  project_id?:       number | null
  user_instructions: string | null
  overall_verdict:   'PASS' | 'WARN' | 'FAIL' | null
  verdict_summary:   string | null
  datasets:          { label: string; row_count: number; source_type: string; column_count: number }[]
  created_at:        string | null
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
  column?: 1 | 2 | 3
  row?: number
  full_width?: boolean
  col_span?: 1 | 2 | 3
  row_span?: number
  height?: 'sm' | 'md' | 'lg'
  validations: FormValidationRule[]
  visibility_rule?: FormVisibilityRule | null
  pdf_layout?: { x: number; y: number; width: number; height: number }
}

export interface FormSection {
  id: string
  title: string
  order: number
  columns: 1 | 2 | 3
  layout_type?: 'grid' | 'label_value'
  fields: FormFieldDef[]
}

export interface FormSchemaJson {
  form_name: string
  version: number
  status: FormStatus
  sections: FormSection[]
  _sample_data?: Record<string, string>
}

export interface FormLayoutFieldPos {
  name: string
  row: number
  column?: number
  col_span?: 1 | 2 | 3
  row_span?: number
  height?: 'sm' | 'md' | 'lg'
}
export interface FormLayoutSection {
  section: string
  fields: FormLayoutFieldPos[]
}
export interface FormLayoutResponse {
  layout_type: 'grid' | 'label_value'
  sections: FormLayoutSection[]
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
  sample_data?: Record<string, string>
  source_type: string
}

// ─── SAI Knowledge Processing Agent ──────────────────────────────────────────

export type KnowledgeEntryType    = 'UseCase' | 'Question' | 'Process' | 'Issue' | 'ViewDefinition' | 'QueryExample' | 'QueryLibrary' | 'SchemaDefinition' | 'OperationalRule' | 'XMLPathDefinition' | 'XMLMapping' | 'DependencyDefinition' | 'FieldMapping' | 'DiagramDefinition' | 'QueryDefinition' | 'ProcessLineage' | 'SQLObject' | 'ColumnMetadata' | 'BusinessRule' | 'DataLineage'
export type KnowledgeSystemType   = 'DCT' | 'ADO' | 'Snowflake' | 'General'
export type KnowledgeSourceType   = 'Text' | 'Document' | 'Link' | 'MeetingNotes'
export type KnowledgeQualityScore = 'HIGH' | 'MEDIUM' | 'LOW'
export type EmbeddingStatus       = 'pending' | 'partial' | 'complete' | 'failed'

export const KNOWLEDGE_ALLOWED_TAGS = [
  'DCT', 'ADO', 'Snowflake', 'General',
  'Conversion', 'Clarity', 'Legacy', 'Architecture', 'DB',
] as const
export type KnowledgeTag = typeof KNOWLEDGE_ALLOWED_TAGS[number]

export type OpKnowledgeCategory =
  | 'BusinessProcess' | 'ReconRule' | 'Lineage'
  | 'DCTMapping' | 'IncidentHistory' | 'Remediation' | 'Ownership'

export interface KnowledgeEntry {
  id:                   number
  title:                string
  type:                 KnowledgeEntryType
  system:               KnowledgeSystemType
  tags:                 string | null
  summary:              string | null
  detailed_explanation: string | null
  key_points:           string | null
  decision:             string | null
  reason:               string | null
  is_reusable:          boolean
  source_type:          KnowledgeSourceType
  raw_content:          string | null
  quality_score:        KnowledgeQualityScore | null
  suggestions:          string | null
  status:               string
  embedding_status:     EmbeddingStatus
  version:              number
  created_by:           string | null
  created_at:           string
  updated_at:           string
  // Operational Intelligence fields (null for legacy entries)
  op_category:           OpKnowledgeCategory | null
  severity:              string | null
  systems_involved_json: string | null
  remediation_json:      string | null
  sql_template:          string | null
  validation_query:      string | null
  owner_team:            string | null
  // Phase 3 orchestration fields
  decision_type:   string | null
  execution_scope: string | null
  depends_on:      string | null   // JSON-stringified string[] in DB
  // KB v2: schema scoping + session traceability
  kb_schema_id:        number | null
  session_id:          number | null
  meeting_date:        string | null
  attendees_json:      string | null
  approved_at:         string | null
  approved_by:         string | null
  supersedes_entry_id: number | null
}

export interface KnowledgeSchema {
  id:          number
  name:        string
  description: string | null
  color_hex:   string
  created_by:  string | null
  created_at:  string
}

export interface KnowledgeSchemaCreate {
  name:        string
  description?: string
  color_hex?:  string
}

export type SessionType =
  | 'RequirementGathering' | 'ArchitectureReview' | 'MappingWorkshop'
  | 'DefectReview' | 'BusinessDiscussion' | 'ProductionIssue'
  | 'ClientFeedback' | 'MeetingNotes'
  | 'Document' | 'QueryLibrary' | 'KnowledgeUpload' | 'WorkingSession'

export type SessionStatus =
  | 'DRAFT' | 'UPLOADED' | 'TRANSCRIBING' | 'TRANSCRIBED'
  | 'EXTRACTING' | 'EMBEDDING' | 'READY' | 'FAILED' | 'PARTIAL' | 'ARCHIVED'

export interface RequirementSession {
  id:                      number
  kb_schema_id:            number | null
  title:                   string
  session_type:            SessionType
  meeting_datetime:        string | null
  duration_minutes:        number | null
  attendees_json:          string | null
  recording_url:           string | null
  transcript_raw:          string | null
  summary:                 string | null
  status:                  SessionStatus
  decisions_json:          string | null
  action_items_json:       string | null
  open_questions_json:     string | null
  risks_json:              string | null
  retry_count:             number
  last_error:              string | null
  processing_started_at:   string | null
  processing_completed_at: string | null
  created_by:              string | null
  created_at:              string
  db_schema_name:          string | null
  db_connection_name:      string | null
  source_system:           string | null
  environment_name:        string | null
  technical_context_json:  string | null
}

export interface SessionCreate {
  kb_schema_id?:           number
  title:                   string
  session_type:            SessionType
  meeting_datetime?:       string
  duration_minutes?:       number
  attendees?:              string[]
  recording_url?:          string
  transcript_raw?:         string
  created_by?:             string
  db_schema_name?:         string
  db_connection_name?:     string
  source_system?:          string
  environment_name?:       string
  technical_context_json?: string
}

export interface SessionAttachment {
  id:               number
  session_id:       number
  kb_schema_id:     number | null
  file_name:        string
  mime_type:        string
  file_size_bytes:  number | null
  processing_status: string
  embedding_status: string
  last_error:       string | null
  uploaded_by:      string | null
  created_at:       string
}

export type ArtifactType = 'Requirement' | 'Decision' | 'ActionItem' | 'Risk' | 'TechnicalMetadata' | 'OpenQuestion'
export type ArtifactStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'IN_PROGRESS' | 'DONE'

export interface SessionArtifact {
  id:               number
  session_id:       number
  kb_schema_id:     number | null
  artifact_type:    ArtifactType
  artifact_code:    string
  title:            string
  description:      string | null
  owner:            string | null
  due_date:         string | null
  priority:         string | null
  status:           ArtifactStatus | null
  systems_involved: string | null
  confidence_score: number | null
  kb_entry_id:      number | null
  approved_by:      string | null
  approved_at:      string | null
  created_at:       string
}

export interface ArtifactLink {
  id:                 number
  source_artifact_id: number
  target_artifact_id: number
  relationship_type:  string
  created_by:         string | null
  created_at:         string
}

export interface OperationalKnowledgeEntry {
  id:               number
  title:            string
  op_category:      OpKnowledgeCategory
  severity:         string | null
  systems_involved: string[]
  owner_team:       string | null
  sql_template:     string | null
  validation_query: string | null
  remediation:      {
    steps:              string[]
    api_endpoints:      string[]
    ps_module?:         string
    estimated_ttl_min?: number
  }
  summary:          string | null
  detailed_explanation: string | null
  key_points:       string[]
  quality_score:    string | null
  updated_at:       string | null
}

export interface KnowledgeEntryCreate {
  title:       string
  type:        KnowledgeEntryType
  system:      KnowledgeSystemType
  tags:        string[]
  source_type: KnowledgeSourceType
  raw_content: string
  created_by?: string
  // Operational Intelligence fields
  op_category?:      OpKnowledgeCategory
  severity?:         string
  systems_involved?: string[]
  remediation?:      Record<string, unknown>
  sql_template?:     string
  validation_query?: string
  owner_team?:       string
  // Phase 3 orchestration fields
  decision_type?:   string
  execution_scope?: string
  depends_on?:      string[]
  // KB v2: schema scoping + session traceability
  kb_schema_id?:        number
  session_id?:          number
  meeting_date?:        string
  attendees?:           string[]
  supersedes_entry_id?: number
}

export interface OpenQuestion {
  id:                  number
  question:            string
  detected_tags:       string | null
  suggested_tags:      string | null
  reason:              string | null
  frequency:           number
  resolution_text:     string | null
  status:              string
  resolved_by:         string | null
  resolution_entry_id: number | null
  asked_by:            string | null
  feedback_type:       string | null
  ai_answer:           string | null
  days_open:           number | null
  days_to_resolve:     number | null
  created_at:          string
  updated_at:          string
}

export interface OperationalPayload {
  decision_type:   string                 // CONTINUE | STOP | ESCALATE | RETRY | PARTIAL_CONTINUE | WAIT | custom
  severity:        string                 // CRITICAL | HIGH | MEDIUM | LOW
  scope:           string                 // system | batch | monthly_cycle | policy | custom
  actions:         string[]
  owners:          string[]
  recovery_steps:  string[]
  stop_conditions: string[]
  depends_on:      string[]
  rules_matched:   string[]
  rule_count:      number
}

export type ResponseType = 'answer' | 'teach_me' | 'generate' | 'review' | 'troubleshoot' | 'plan' | 'summary'

export interface AskSAIAnswered {
  status:        'ANSWERED'
  answer:        string
  response_type?: ResponseType
  sources: Array<{
    entry_id:     number
    chunk_id:     number
    topic:        string | null
    score:        number
    entry_title:  string
    entry_system: string
  }>
  debug?: {
    tokens_in:  number
    tokens_out: number
    latency_ms: number
    model:      string
  }
  operational?: OperationalPayload
}

export interface AskSAIUnanswered {
  status:         'UNANSWERED'
  message:        string
  question:       string
  detected_tags:  { system: string; category: string; type: string }
  suggested_tags: string[]
  reason:         string
  action:         string
}

export type AskSAIResult = AskSAIAnswered | AskSAIUnanswered

// ─── SAI Knowledge Hub: Content Blocks ───────────────────────────────────────

export type ContentBlockType = 'text' | 'image' | 'sql' | 'document' | 'transcript'

export interface ContentBlock {
  id:          string          // local UUID for React key (not DB id)
  block_type:  ContentBlockType
  name:        string          // user-given name, e.g. "GL Recon Query" — used by Ask SAI for reference
  content:     string          // text / SQL / transcript / extracted doc text
  explanation: string          // user context ("why this SQL was written")
  file_name?:  string
  vision_text?: string         // returned from process-image API
  image_b64?:  string          // base64 for small images
}

// ─── Agent Mapper ─────────────────────────────────────────────────────────────
export interface AgentMapperIntent {
  entity: 'Account' | 'Policy' | 'Risk' | 'Coverage'
  field:  string
  source: string
  type:   'extra' | 'base' | 'dynamic' | 'reference' | 'risk' | 'controller'
  lob:    'Auto' | 'Property' | 'GL'
}

export interface AgentMapperMappingModel extends AgentMapperIntent {
  target:         string | null
  template_name:  string
  inherit:        string | null
  include:        string[]
  low_confidence: boolean
  key_source:     string | null
  name_source:    string | null
  desc_source:    string | null
}

export interface AgentMapperGridRow {
  entity:       string
  target_table: string
  target_field: string
  source:       string
  type:         string
  rule:         string
  include:      string[]
  inherit:      string | null
  operation?:   'added' | 'updated'   // present only on newly added/updated rows
}

// ─── Guided KT Wizard ─────────────────────────────────────────────────────────

export type KTObjectType = 'View' | 'StoredProcedure' | 'Function' | 'Table' | 'Other'

export interface KTSqlObject {
  id:         string          // local UUID
  name:       string          // e.g. "PolicyHeader_VW"
  objectType: KTObjectType
  sql:        string          // SQL code
  purpose:    string          // what it does / why written
  xmlGroup:   string          // which XML group it feeds (e.g. "PolicyHeader", "BIG_XML")
  feedsInto:  string | null   // name of another KTSqlObject it feeds into
}

export interface EntryLink {
  id:               number
  source_entry_id:  number
  source_title:     string
  target_entry_id:  number
  target_title:     string
  edge_type:        string    // feeds | requires | generates | blocks | triggers | validates
  direction?:       'outbound' | 'inbound'
}

export interface AgentMapperMetadata {
  template_id:     number | null
  template_source: 'custom' | 'engine'
  extract_refs:    string[]
}

export interface AgentMapperSuggestion {
  field:            string
  current_entity:   string
  suggested_entity: string
  message:          string
}

export interface AgentMapperResult {
  session_id:     number
  user_input:     string
  parsed_intents: AgentMapperIntent[]
  mapping_models: AgentMapperMappingModel[]
  generated_xml:  string
  grid:           AgentMapperGridRow[]
  mode:           string
  warnings:       string[]
  suggestions?:   AgentMapperSuggestion[]
  tokens_in:      number
  tokens_out:     number
  latency_ms:     number
  prompt_text:    string
  response_text:  string
  metadata?:      AgentMapperMetadata
}

export interface AgentMapperSession {
  id:            number
  project_id:    number | null
  user_input:    string
  mapping_type:  string | null
  entity:        string | null
  field:         string | null
  lob:           string | null
  inherit:       string | null
  generated_xml: string | null
  created_at:    string
}

export interface AgentMapperSessionDetail {
  id:             number
  project_id:     number | null
  user_input:     string
  parsed_intents: AgentMapperIntent[]
  mapping_models: AgentMapperMappingModel[]
  generated_xml:  string
  grid:           AgentMapperGridRow[]
  mapping_type:   string | null
  entity:         string | null
  field:          string | null
  lob:            string | null
  inherit:        string | null
  include:        string[]
  created_at:     string
}

// ─── Agent Mapper Templates ───────────────────────────────────────────────────
export interface AgentMapperTemplate {
  id:           number
  name:         string
  template_key: string
  mapping_type: string | null
  entity:       string | null
  lob:          string | null
  template_xml: string
  notes:        string | null
  is_ootb:      boolean
  is_active:    boolean
  kb_entry_id:  number | null
  created_at:   string
}

// ─── Mapping Assistant ────────────────────────────────────────────────────────
export interface MappingAssistantMessage {
  role:       'user' | 'assistant'
  content:    string
  sources?:   string[]
  tokens_in?: number
  tokens_out?: number
  latency_ms?: number
  timestamp:  string
}

export interface MappingAssistantResponse {
  answer:     string
  sources:    string[]
  tokens_in:  number
  tokens_out: number
  latency_ms: number
}

// ─── Run Engine ───────────────────────────────────────────────────────────────
export interface RunLog {
  id:            number
  project_id:    number
  mapping_id?:   number
  triggered_by:  string
  status:        'running' | 'success' | 'failed' | 'partial'
  source_rows?:  string   // JSON: { total: number }
  output_xml?:   string   // JSON: { generated: number, groups: number }
  target_url?:   string
  target_status?: number
  errors?:       string   // JSON array of error strings
  started_at:    string
  finished_at?:  string
}

export interface QueryHistoryItem {
  id: number
  conn_id: number
  query_text: string
  row_count: number | null
  duration_ms: number | null
  status: 'success' | 'error'
  error_msg: string | null
  executed_at: string
}

// ── Query Intelligence Agent ──────────────────────────────────────────────────

export interface QueryAntiPattern {
  type:        string
  description: string
  severity:    'low' | 'medium' | 'high'
}

export interface QueryCostIssue {
  issue:    string
  impact:   string
  severity: 'low' | 'medium' | 'high'
}

export interface QueryIndexRec {
  table:   string
  columns: string[]
  reason:  string
}

export interface QueryIntelligenceResult {
  summary:               string
  intent:                { business: string; technical: string }
  complexity:            'Simple' | 'Moderate' | 'Complex'
  anti_patterns:         QueryAntiPattern[]
  cost_issues:           QueryCostIssue[]
  suggested_rewrite:     string
  index_recommendations: QueryIndexRec[]
  tokens_in:             number
  tokens_out:            number
  latency_ms:            number
}

// ── Query Knowledge Extraction ────────────────────────────────────────────────

export interface QueryExtractSummary {
  purpose:            string
  business_objective: string
  kpi:                string
  process:            string
  country:            string
  domain:             string
}

export interface QuerySourceObject {
  name:    string
  type:    'base_table' | 'view' | 'cte' | 'temp_table' | 'stored_procedure'
  schema:  string | null
  purpose: string
}

export interface QueryFieldMapping {
  output_field:         string
  source_table:         string
  source_field:         string
  transformation_logic: string
}

export interface QueryJoinAnalysis {
  join_type:   string
  left_table:  string
  right_table: string
  join_keys:   string[]
  purpose:     string
}

export interface QueryBusinessRule {
  rule_type: string
  field:     string | null
  condition: string
  result:    string
}

export interface QueryKpiDetection {
  kpi_name:   string
  confidence: number
  evidence:   string
}

export interface QueryAccountMapping {
  account_number: string
  account_name:   string
  indicator:      'Debit' | 'Credit' | null
}

export interface QueryDataLineage {
  description:     string
  mermaid_diagram: string
}

export interface QueryValidationCheck {
  check_type:      string
  description:     string
  suggested_query: string | null
}

export interface QueryTroubleshootingItem {
  issue:           string
  likely_cause:    string
  resolution_hint: string
}

export interface QueryKbArtifact {
  kb_type: 'Process' | 'View' | 'Configuration' | 'Lineage' | 'Troubleshooting'
  title:   string
  content: string
}

export interface QueryExtractionResult {
  session_name:             string
  query_summary:            QueryExtractSummary
  source_objects:           QuerySourceObject[]
  field_mappings:           QueryFieldMapping[]
  join_analysis:            QueryJoinAnalysis[]
  business_rules:           QueryBusinessRule[]
  kpi_detection:            QueryKpiDetection[]
  account_mappings:         QueryAccountMapping[]
  data_lineage:             QueryDataLineage
  validation_guidance:      QueryValidationCheck[]
  troubleshooting_guidance: QueryTroubleshootingItem[]
  kb_artifacts:             QueryKbArtifact[]
  tokens_in:                number
  tokens_out:               number
  latency_ms:               number
}

export interface QueryEnhanceResult {
  revised_sql:     string
  changes_summary: string
  warnings:        string[]
  tokens_in:       number
  tokens_out:      number
  latency_ms:      number
}

export interface QueryKbChatSource {
  entry_id: number
  title:    string
  score:    number
}

export interface QueryKbChatResponse {
  explanation: string
  sql_query:   string
  sources:     QueryKbChatSource[]
  tokens_in:   number
  tokens_out:  number
  latency_ms:  number
}

// ─── Performance Tuning Agent ──────────────────────────────────────────────
export interface SlowQueryRecord {
  id:              number
  query_text:      string
  duration_ms:     number
  row_count:       number | null
  rows_per_second: number | null
  slowness_reason: string | null
  executed_at:     string
}

export interface QueryPerformanceSuggestion {
  table:     string
  columns:   string[]
  rationale: string
}

export interface QueryPerformanceStats {
  total_queries: number
  slow_count:    number
  avg_slow_ms:   number
  slow_queries:  SlowQueryRecord[]
}

export interface QueryPerformanceAnalysis {
  index_suggestions:  QueryPerformanceSuggestion[]
  regression_summary: string
  top_offenders:      { query_pattern: string; avg_ms: number; count: number }[]
  narrative:          string
  tokens_in:          number
  tokens_out:         number
  latency_ms:         number
}

// ─── JSON/API Payload Intelligence Agent ───────────────────────────────────
export interface PayloadComponent {
  name:       string
  path:       string
  type:       'object' | 'array' | 'field'
  row_count?: number | null
  description: string
}

export interface PayloadFieldMapping {
  source_path:  string
  target_field: string
  confidence:   number
  note:         string
}

export interface PayloadIssue {
  field_path:  string
  issue_type:  'missing_required' | 'null_value' | 'type_mismatch' | 'unexpected_field' | 'format_error'
  detail:      string
  suggestion:  string
}

export interface PayloadAnalysisResult {
  session_id:    number
  components:    PayloadComponent[]
  field_mappings: PayloadFieldMapping[]
  issues:        PayloadIssue[]
  narrative:     string
  tokens_in:     number
  tokens_out:    number
  latency_ms:    number
}

export interface PayloadSession {
  id:         number
  name:       string | null
  narrative:  string | null
  tokens_in:  number | null
  tokens_out: number | null
  latency_ms: number | null
  created_at: string
}

// ─── SAI Ops — Swift Autonomous Intelligence ──────────────────────────────────

export type SaiMode = 'manual' | 'assisted' | 'autonomous'
export type SaiRunStatus = 'running' | 'complete' | 'error' | 'queued'
export type SaiSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type SaiStepStatus = 'pending' | 'running' | 'done' | 'error'
export type SaiApprovalStatus = 'pending' | 'approved' | 'rejected' | 'dispatched'
export type SaiValidationStatus = 'RESOLVED' | 'PENDING' | 'FAILED'

export interface SaiKnowledgeSource {
  entry_id:   number | null
  title:      string
  confidence: number | null
  answer?:    string
}

export interface SaiFinding {
  id?:             number
  issue_type:      string
  severity:        SaiSeverity
  system_impacted: string | null
  description:     string | null
  owner_team:      string | null
  action_taken?:   string | null
  action_status?:  string | null
  evidence_json?:  string | null
}

export interface SaiStep {
  step_number:       number
  agent_name:        string
  status:            SaiStepStatus
  elapsed_ms:        number | null
  output:            Record<string, unknown>
  knowledge_sources: SaiKnowledgeSource[]
}

export interface SaiReport {
  incident_summary:              string
  systems_impacted:              string[]
  root_cause_analysis:           string
  evidence_findings:             string[]
  autonomous_actions_taken:      string[]
  pending_actions:               string[]
  recommended_fixes:             string[]
  ownership_mapping:             Record<string, string>
  business_impact:               string
  prevention_recommendations:    string[]
}

export interface SaiApprovalItem {
  id:          number
  run_id:      number
  action_type: string
  status:      SaiApprovalStatus
  payload:     Record<string, unknown>
  created_at:  string
}

export interface SaiAction {
  type:    string
  to?:     string
  title?:  string
  detail?: string
  status:  string
  note?:   string
}

export interface SaiRunDetail {
  id:               number
  project_id:       number | null
  request_text:     string
  mode:             SaiMode
  status:           SaiRunStatus
  event_type:       string | null
  started_at:       string | null
  completed_at:     string | null
  report:           SaiReport | null
  findings:         SaiFinding[]
  db_findings:      SaiFinding[]
  actions_taken:    SaiAction[]
  knowledge_sources: SaiKnowledgeSource[]
  steps:            SaiStep[]
  approval_queue:   SaiApprovalItem[]
}

export interface SaiRunSummary {
  id:             number
  project_id:     number | null
  request_text:   string
  mode:           SaiMode
  status:         SaiRunStatus
  event_type:     string | null
  started_at:     string | null
  completed_at:   string | null
  findings_count: number
}

export interface SaiMemoryItem {
  id:                  number
  issue_type:          string | null
  system_impacted:     string | null
  description_summary: string | null
  frequency:           number
  last_seen_at:        string | null
  has_fix:             boolean
}

export interface SaiConfig {
  project_id:      number
  mode:            SaiMode
  allowed_actions: { email: boolean; ticket: boolean; etl_retry: boolean }
  updated_at?:     string
}

export interface SaiAiTrace {
  id:            number
  module:        string
  model:         string
  prompt_text:   string
  response_text: string
  tokens_in:     number
  tokens_out:    number
  latency_ms:    number
  created_at:    string
}

export interface SaiQueryUsed {
  conn_id:   number
  label:     string
  query:     string
  status:    'ok' | 'error'
  row_count?: number
  columns?:  string[]
  error?:    string
}

// SSE event payloads from /api/sai/run
export interface SaiSSEStep {
  type:       'step'
  step:       number
  agent:      string
  status:     SaiStepStatus
  elapsed_ms: number
}

export interface SaiSSEReasoning {
  type:  'reasoning'
  agent: string
  text:  string
}

export interface SaiSSEKnowledge {
  type:    'knowledge'
  sources: SaiKnowledgeSource[]
}

export interface SaiSSEFinding {
  type:        'finding'
  issue_type:  string
  severity:    SaiSeverity
  system:      string
  description: string
}

export interface SaiSSEAction {
  type:   'action'
  action: string
  detail: string
  status: string
}

export interface SaiSSEComplete {
  type:               'complete'
  run_id:             number
  report:             SaiReport
  findings_count:     number
  actions_count:      number
  pending_approvals:  number
  validation_status:  SaiValidationStatus
  knowledge_sources:  SaiKnowledgeSource[]
}

export type SaiSSEEvent =
  | SaiSSEStep
  | SaiSSEReasoning
  | SaiSSEKnowledge
  | SaiSSEFinding
  | SaiSSEAction
  | SaiSSEComplete
  | { type: 'approval_queued'; action_type: string }

// ─── Developer Ops ────────────────────────────────────────────────────────────

export interface DevTaskSummary {
  sprint_name:       string | null
  total_tasks:       number
  done_count:        number
  in_progress_count: number
  blocked_count:     number
  completion_pct:    number
  overdue_count:     number
  active_sprints:    Array<{ name: string; start: string | null; end: string | null }>
  by_assignee:       Array<{ assignee: string; count: number; done: number }>
  last_synced_at:    string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformation Intelligence Module
// ─────────────────────────────────────────────────────────────────────────────

export type RuleCategory =
  | 'DirectMapping' | 'LookupMapping' | 'ConditionalRule' | 'DefaultValue'
  | 'Formula' | 'DataValidation' | 'DataQualityRule' | 'ReferenceDataRule'

export type ExecutionStage = 'PreTransform' | 'Transform' | 'PostTransform' | 'Validation'

export type RuleApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'deprecated'

export interface TransformationRule {
  id: number
  conn_id: number | null
  rule_name: string
  description: string | null
  category: RuleCategory
  execution_stage: ExecutionStage
  stage_order: number
  priority: number
  condition_json: string | null
  transformation_json: string | null
  source_object: string | null
  source_column: string | null
  target_object: string | null
  target_path: string | null
  version: number
  parent_rule_id: number | null
  approval_status: RuleApprovalStatus
  approved_by: string | null
  approved_at: string | null
  created_by: string | null
  is_active: boolean
  confidence_score: number | null
  ai_generated: boolean
  tags_json: string | null
  impact_json: string | null
  created_at: string
  updated_at: string
}

export interface TransformationRuleCreate {
  conn_id?: number
  rule_name: string
  description?: string
  category: RuleCategory
  execution_stage?: ExecutionStage
  stage_order?: number
  priority?: number
  condition_json?: string
  transformation_json?: string
  source_object?: string
  source_column?: string
  target_object?: string
  target_path?: string
  tags_json?: string
  created_by?: string
}

export interface TransformationRuleUpdate extends Partial<TransformationRuleCreate> {
  is_active?: boolean
  approval_status?: RuleApprovalStatus
}

export interface TIRuleListResult {
  total: number
  items: TransformationRule[]
}

export interface TIRuleSet {
  id: number
  conn_id: number | null
  name: string
  description: string | null
  set_type: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TIRuleSetCreate {
  conn_id?: number
  name: string
  description?: string
  set_type?: string
  created_by?: string
}

export interface TIPipeline {
  id: number
  conn_id: number | null
  name: string
  description: string | null
  is_active: boolean
  steps: TIPipelineStep[]
  created_at: string
}

export interface TIPipelineStep {
  id: number
  pipeline_id: number
  step_number: number
  step_name: string
  execution_stage: ExecutionStage
  rule_set_id: number | null
  rule_id: number | null
  description: string | null
  is_active: boolean
}

export interface TIPipelineCreate {
  conn_id?: number
  name: string
  description?: string
  created_by?: string
}

export interface TIPipelineStepCreate {
  step_number: number
  step_name: string
  execution_stage?: ExecutionStage
  rule_set_id?: number
  rule_id?: number
  description?: string
}

export interface RuleTestCase {
  id: number
  rule_id: number
  conn_id: number | null
  test_name: string
  description: string | null
  input_json: string | null
  expected_output_json: string | null
  actual_output_json: string | null
  passed: boolean | null
  last_run_at: string | null
  last_run_by: string | null
  created_by: string | null
  created_at: string
}

export interface RuleTestCaseCreate {
  rule_id: number
  conn_id?: number
  test_name: string
  description?: string
  input_json?: string
  expected_output_json?: string
  created_by?: string
}

export interface TIDiscoveryResult {
  rules: TransformationRule[]
  kb_sources: string[]
  tokens_in: number
  tokens_out: number
  latency_ms: number
}

export interface TINLParseResult {
  condition_json: Record<string, unknown> | null
  transformation_json: Record<string, unknown> | null
  category: RuleCategory
  execution_stage: ExecutionStage
  suggested_name: string
  confidence: number
}

export interface TISimulationStep {
  step: number
  record_index: number
  description: string
  input_value: unknown
  output_value: unknown
  matched: boolean
}

export interface TISimulationResult {
  output_records: Record<string, unknown>[]
  trace: TISimulationStep[]
  passed: boolean
  error?: string
}

export interface TISimulationLog {
  id: number
  rule_id: number
  conn_id: number | null
  input_json: string | null
  output_json: string | null
  trace_json: string | null
  passed: boolean
  error_message: string | null
  executed_by: string | null
  created_at: string
}

export interface TIImpactItem {
  id: number
  label: string
  detail: string
  link_type: string
}

export interface TIImpactAnalysis {
  rule_id: number
  mapping_rows: TIImpactItem[]
  xml_groups: TIImpactItem[]
  pipelines: TIImpactItem[]
  apis: TIImpactItem[]
  reports: TIImpactItem[]
  total_affected: number
}

export interface TIValidationIssue {
  id: number
  rule_id: number
  conn_id: number | null
  issue_type: string
  severity: 'error' | 'warning' | 'info'
  description: string | null
  conflicting_rule_id: number | null
  resolved: boolean
  detected_at: string
  rule_name?: string
}

export interface TIValidationResult {
  issues: TIValidationIssue[]
  clean: boolean
  total_issues: number
  rules_with_issues: number
}

export interface TIReadinessDashboard {
  mapping_coverage_pct: number
  unmapped_fields: number
  value_mapping_coverage_pct: number
  unmapped_values: number
  rule_coverage_pct: number
  total_rules: number
  approved_rules: number
  avg_ai_confidence: number | null
  manual_review_count: number
  rules_by_category: Record<string, number>
  test_case_count: number
  test_cases_passing: number
  test_coverage_pct: number
  issues_count: number
  reference_data_rules: number
  recon_query_count: number
  ready_for_sit: boolean
  ready_for_uat: boolean
}

export interface TILookupResult {
  suggestions: ValueMapping[]
  unmapped_values: string[]
  conflicts: Array<{ source_value: string; mappings: ValueMapping[] }>
  case_statement: string | null
  python_lookup: Record<string, string>
}

export interface TIReconQuery {
  name: string
  source_sql: string
  target_sql: string
  validation_type: string
}

export interface TIExportResult {
  content: string
  filename: string
}

// ─── Azure File Store (Documents) ────────────────────────────────────────────

export type FileStatus = 'Uploaded' | 'PendingExtraction' | 'Processing' | 'Extracted' | 'Failed'
export type MappingConfidence = 'Explicit' | 'Derived' | 'Inferred'
export type DocumentsScope = 'kb' | 'files' | 'folders' | 'all'

export interface AfsFolder {
  id: number
  name: string
  parent_id: number | null
  process_name: string | null
  source_system: string | null
  target_system: string | null
  lob: string | null
  owner_team: string | null
  blob_prefix: string | null
  afs_path: string | null
  kb_schema_id: number | null
  created_by: string | null
  created_at: string | null
  children?: AfsFolder[]
}

export interface AfsFile {
  id: number
  folder_id: number
  filename: string
  blob_path: string | null
  afs_path: string | null
  file_size: number | null
  mime_type: string | null
  status: FileStatus
  extraction_error: string | null
  extraction_progress: number        // 0-100
  extraction_step: string | null     // current step label
  entry_count: number
  uploaded_by: string | null
  uploaded_at: string | null
  extracted_at: string | null
  kb_schema_id: number | null
}

export interface AfsFolderCreate {
  name: string
  parent_id?: number
  process_name?: string
  source_system?: string
  target_system?: string
  lob?: string
  owner_team?: string
  kb_schema_id?: number
}

export interface AfsFileEntry {
  id: number
  title: string
  type: KnowledgeEntryType
  system: string
  summary: string | null
  mapping_confidence: MappingConfidence | null
  status: string
  created_at: string | null
}

