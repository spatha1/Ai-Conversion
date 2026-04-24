import { api } from './client'
import { useAppStore } from '@/store/useAppStore'
import type {
  Project, ProjectCreate,
  SourceConnection, ConnectionCreate, TestResult,
  Mapping, GeneratedQuery, GeneratedXml,
  Catalog, QueryResult,
  PsConversation, PsMessage, PsApiEntry, Workflow,
  ValidationRule, ValidationResult,
  ProcessResult, TargetFormulaRule, TemplateFormat, TemplateResponse,
  SavedDashboard, DashboardConfigSchema, DashboardDebugMeta, DashboardWidget,
  ApiDispatchConfig, ApiDispatchLog, XmlDispatchRow, DispatchSendAllResult, DispatchType,
  AITraceEntry, AIReadiness, AIContextSummary,
  DevArtifact, SQLValidationResult, PromptTemplate, PowerBIExport, BRDCriterion, QueryExample,
  AITestCase, AITestCaseCreate, AITestResult, TestSummaryRow, TestRunAllResult,
  CatalogRelationRow, AISuggestedRelation,
  FeedbackSubmit, FeedbackEntry,
  AgentRole, AgentCard, WorkflowExecution, WorkflowExecutionStep, AgentTool,
  SavedAgenticWorkflow,
  TestQuery, TestQueryCreate, ReconciliationResult, RecRunSummary, CollectQueriesResult,
  SourceSummaryGroup,
  UserRole, UserRecord,
  AskAIResult,
  UiValidationTemplate, UiValidationRun, UiValidationStatus,
  MultiSourceSlotConfig, MultiCompareResult,
} from '@/types'

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface LoginResponse {
  access_token:  string
  refresh_token: string
  token_type:    string
  username:      string
  role:          UserRole
  user_id:       number
}

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { username, password }).then((r) => r.data),
  refresh: (refresh_token: string) =>
    api.post<LoginResponse>('/auth/refresh', { refresh_token }).then((r) => r.data),
  logout: () =>
    api.post('/auth/logout').then((r) => r.data),
  me: () =>
    api.get<{ id: number; username: string; email: string | null; role: UserRole; is_active: boolean; last_login: string | null }>('/auth/me').then((r) => r.data),
}

// ─── User management (admin only) ────────────────────────────────────────────
export const usersApi = {
  list: () =>
    api.get<UserRecord[]>('/users').then((r) => r.data),
  create: (data: { username: string; email?: string; password: string; role: string }) =>
    api.post<UserRecord>('/users', data).then((r) => r.data),
  get: (id: number) =>
    api.get<UserRecord>(`/users/${id}`).then((r) => r.data),
  update: (id: number, data: { email?: string; role?: string; is_active?: boolean }) =>
    api.put<UserRecord>(`/users/${id}`, data).then((r) => r.data),
  deactivate: (id: number) =>
    api.delete(`/users/${id}`).then((r) => r.data),
}

export type { UserRecord }

// AI Platform response types (not in types/index.ts as they are API-local)
export interface PlanResponse { artifact_id: number; steps: Array<{ step_number: number; title: string; description: string; sql_type: string; depends_on: number[] }> }
export interface GenerateResponse { artifact_id: number; step_number: number; sql: string }

// re-export so consumers can import from @/api
export type { ApiDispatchConfig, ApiDispatchLog, XmlDispatchRow, DispatchSendAllResult, DispatchType }

// ─── Health ──────────────────────────────────────────────────────────────────
export const checkHealth = () => api.get('/health').then((r) => r.data)

// ─── OpenAI Chat Proxy ───────────────────────────────────────────────────────
export const chatApi = {
  send: (
    messages: Array<{ role: string; content: string }>,
    apiKey = '',
    model = 'gpt-4o-mini',
  ) =>
    api
      .post<{ message: string }>('/chat', { messages, api_key: apiKey, model })
      .then((r) => r.data),
}

// ─── Projects ────────────────────────────────────────────────────────────────
export const projectsApi = {
  list: () => api.get<Project[]>('/projects').then((r) => r.data),
  get: (id: number) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (data: ProjectCreate) => api.post<Project>('/projects', data).then((r) => r.data),
  update: (id: number, data: Partial<ProjectCreate>) =>
    api.put<Project>(`/projects/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/projects/${id}`).then((r) => r.data),
}

// ─── Connections ─────────────────────────────────────────────────────────────
export const connectionsApi = {
  list: (projectId?: number) =>
    api
      .get<SourceConnection[]>('/connections', { params: { project_id: projectId } })
      .then((r) => r.data),
  get: (id: number) => api.get<SourceConnection>(`/connections/${id}`).then((r) => r.data),
  create: (data: ConnectionCreate) =>
    api.post<SourceConnection>('/connections', data).then((r) => r.data),
  update: (id: number, data: Partial<ConnectionCreate>) =>
    api.put<SourceConnection>(`/connections/${id}`, data).then((r) => r.data),
  delete: (id: number) => api.delete(`/connections/${id}`).then((r) => r.data),
  test: (id: number) => api.post<TestResult>(`/connections/${id}/test`).then((r) => r.data),
  testAdhoc: (data: ConnectionCreate) =>
    api.post<TestResult>('/sources/test', data).then((r) => r.data),
  previewAdhoc: (data: ConnectionCreate) =>
    api.post<QueryResult>('/sources/preview', data).then((r) => r.data),
  preview: (id: number, query?: string) =>
    api
      .post<QueryResult>(`/connections/${id}/preview`, query ? { query } : {})
      .then((r) => r.data),
  runQuery: (id: number, sql: string) =>
    api.post<QueryResult>(`/connections/${id}/run`, { query: sql }).then((r) => r.data),
  executeSql: (id: number, sql: string, confirm = false) =>
    api.post<{ type: 'select' | 'dml'; columns?: string[]; rows?: unknown[][]; total?: number; rowcount?: number; message?: string }>(
      `/connections/${id}/execute`, { sql, confirm }, { timeout: 60_000 },
    ).then((r) => r.data),
}

// ─── Target Formulas ─────────────────────────────────────────────────────────
export const targetApi = {
  process: (xmlContent: string, connId?: number, name?: string, formatType: TemplateFormat = 'xml') =>
    api
      .post<ProcessResult>('/target-formulas/process', {
        xml_content: xmlContent,
        conn_id: connId,
        name: name ?? `template.${formatType}`,
        format_type: formatType,
      })
      .then((r) => r.data),
  list: (connId?: number) =>
    api
      .get<TargetFormulaRule[]>('/target-formulas', { params: { conn_id: connId } })
      .then((r) => r.data),
  getTemplate: (connId: number) =>
    api.get<TemplateResponse>(`/target-formulas/${connId}/template`).then((r) => r.data),
  deleteTemplate: (connId: number) =>
    api.delete(`/target-formulas/${connId}/template`).then((r) => r.data),
  clear: (connId: number) =>
    api.delete('/target-formulas', { params: { conn_id: connId } }).then((r) => r.data),
}

// ─── Mapping ─────────────────────────────────────────────────────────────────
export const mappingApi = {
  generateQuery: (connId: number) =>
    api.post<{ query_sql: string; identifier_column?: string; identifier_table?: string }>(
      '/mapping/generate/query', { conn_id: connId }, { timeout: 300_000 },
    ).then((r) => r.data),
  generateRows: (connId: number) =>
    api.post<Mapping>('/mapping/generate/rows', { conn_id: connId }, { timeout: 300_000 }).then((r) => r.data),
  get: (connId: number) => api.get<Mapping>(`/mapping/${connId}`).then((r) => r.data),
  getQuery: (connId: number) =>
    api.get<GeneratedQuery>(`/mapping/${connId}/query`).then((r) => r.data),
  save: (data: Mapping) => api.post('/mapping/save', data).then((r) => r.data),
  previewQuery: (connId: number, querySql?: string) =>
    api.post<QueryResult>(`/mapping/${connId}/preview`, { query_sql: querySql ?? null }, { timeout: 120_000 }).then((r) => r.data),
  identifierValues: (connId: number) =>
    api.get<{ identifier_column?: string; values: string[] }>(
      `/mapping/${connId}/identifier-values`,
    ).then((r) => r.data.values ?? []),
  generateXml: (connId: number, identifier: string) =>
    api
      .post<{ xml: string; identifier_value: string; rows_used: number; saved_id: number }>(
        `/mapping/${connId}/generate-xml`,
        { identifier_value: identifier },
      )
      .then((r) => r.data),
  generateAllXml: (connId: number) =>
    api.post<{ generated: number; total_rows: number; groups: number; errors: string[]; records: Array<{ id: number; identifier_value: string }> }>(`/mapping/${connId}/generate-all-xml`).then((r) => r.data),
  listGeneratedXml: (connId: number) =>
    api.get<GeneratedXml[]>(`/mapping/${connId}/generated-xml`).then((r) => r.data),
  getGeneratedXml: (connId: number, recordId: number) =>
    api.get<GeneratedXml>(`/mapping/${connId}/generated-xml/${recordId}`).then((r) => r.data),
  saveQuery: (connId: number, querySql: string) =>
    api.patch<{ query_sql: string }>(`/mapping/${connId}/query`, { query_sql: querySql }).then((r) => r.data),
  updateIdentifier: (connId: number, identifierColumn: string | null, identifierTable?: string | null) =>
    api.patch<{ identifier_column: string | null; identifier_table: string | null }>(
      `/mapping/${connId}/identifier`,
      { identifier_column: identifierColumn || null, identifier_table: identifierTable || null },
    ).then((r) => r.data),
  delete: (connId: number) => api.delete(`/mapping/${connId}`).then((r) => r.data),
}

// ─── Admin ───────────────────────────────────────────────────────────────────
export const adminApi = {
  discover: (connId: number) => `/api/admin/discover/${connId}`,
  getCatalog: (connId: number) =>
    api.get<Catalog>(`/admin/catalog/${connId}`).then((r) => r.data),
  clearCatalog: (connId: number) =>
    api.delete(`/admin/catalog/${connId}`).then((r) => r.data),
  generateEmbeddings: (connId: number, apiKey: string) =>
    api.post(`/admin/embeddings/${connId}`, { api_key: apiKey }).then((r) => r.data),
  embeddingCount: (connId: number) =>
    api.get<{ count: number }>(`/admin/embeddings/${connId}/count`).then((r) => r.data),
  getColumnDefinitions: (connId: number) =>
    api.get(`/admin/embeddings/${connId}/definitions`).then((r) => r.data),
  getDataQualityReport: (connId: number) =>
    api.get(`/admin/reports/${connId}`).then((r) => r.data),
  getMetadata: (connId: number) =>
    api.get(`/admin/metadata/${connId}`).then((r) => r.data),
  updateMetadata: (connId: number, data: unknown) =>
    api.put(`/admin/metadata/${connId}`, data).then((r) => r.data),
  bulkMetadata: (connId: number, data: unknown) =>
    api.post(`/admin/metadata/${connId}/bulk`, data).then((r) => r.data),
  deleteMetadata: (connId: number, metaId: number) =>
    api.delete(`/admin/metadata/${connId}/${metaId}`).then((r) => r.data),
  getOpenAiKeyStatus: () =>
    api.get<{ configured: boolean }>('/admin/openai-key-status').then((r) => r.data),
  getOpenAiKey: () =>
    api.get<{ api_key: string }>('/admin/openai-key').then((r) => r.data),
  exportSchema: (connId: number) =>
    api.get(`/admin/schema/export/${connId}`).then((r) => r.data),
  importSchema: (connId: number, data: unknown) =>
    api.post(`/admin/schema/import/${connId}`, { data }).then((r) => r.data),
  aiEnrich: (
    connId: number,
    message: string,
    history: Array<{ role: string; content: string }>,
    sessionId?: number | null,
  ) =>
    api
      .post<{ response: string; updates: unknown[] | null; gaps_remaining: number; session_id: number | null }>(
        `/admin/schema/ai-enrich/${connId}`,
        { message, history, session_id: sessionId ?? null },
      )
      .then((r) => r.data),

  // ── Enrich sessions ──────────────────────────────────────
  createEnrichSession: (connId: number) =>
    api.post<{ id: number; title: string | null; created_at: string; message_count: number }>(
      `/admin/enrich-sessions/${connId}`,
    ).then((r) => r.data),

  listEnrichSessions: (connId: number) =>
    api.get<Array<{ id: number; title: string; created_at: string; updated_at: string; message_count: number }>>(
      `/admin/enrich-sessions/${connId}`,
    ).then((r) => r.data),

  getEnrichSession: (sessionId: number) =>
    api.get<{
      id: number; title: string; conn_id: number;
      messages: Array<{ role: string; content: string; created_at: string }>
    }>(`/admin/enrich-sessions/session/${sessionId}`).then((r) => r.data),

  deleteEnrichSession: (sessionId: number) =>
    api.delete(`/admin/enrich-sessions/session/${sessionId}`).then((r) => r.data),

  enrichFromDocument: (connId: number, file: File, sessionId?: number | null) => {
    const form = new FormData()
    form.append('file', file)
    if (sessionId) form.append('session_id', String(sessionId))
    return api.post<{
      filename: string; summary: string;
      updates: unknown[]; char_read: number
    }>(`/admin/enrich-doc/${connId}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data)
  },

  // ── AI Platform — Context & Readiness ────────────────────
  getAiContext: (connId: number) =>
    api.get<AIContextSummary>(`/admin/ai-context/${connId}`).then((r) => r.data),

  invalidateCtx: (connId: number) =>
    api.post(`/admin/ai-context/${connId}/invalidate`).then((r) => r.data),

  getReadiness: (connId: number) =>
    api.get<AIReadiness>(`/admin/ai-readiness/${connId}`).then((r) => r.data),

  // ── AI Platform — Trace Log ───────────────────────────────
  getTraces: (params: { conn_id?: number; module?: string; limit?: number }) =>
    api.get<AITraceEntry[]>('/admin/ai-traces', { params }).then((r) => r.data),

  deleteTrace: (id: number) =>
    api.delete(`/admin/ai-traces/${id}`).then((r) => r.data),

  purgeTraces: (days: number) =>
    api.delete('/admin/ai-traces', { params: { older_than_days: days } }).then((r) => r.data),

  // ── Prompt Templates ──────────────────────────────────────
  listPromptTemplates: (category?: string) =>
    api.get<PromptTemplate[]>('/admin/prompt-templates', { params: category ? { category } : {} }).then((r) => r.data),

  createPromptTemplate: (data: { name: string; description?: string; category?: string; content: string; example_output?: string }) =>
    api.post<PromptTemplate>('/admin/prompt-templates', data).then((r) => r.data),

  updatePromptTemplate: (id: number, data: Partial<Pick<PromptTemplate, 'name' | 'description' | 'category' | 'content' | 'example_output' | 'is_active'>>) =>
    api.put<PromptTemplate>(`/admin/prompt-templates/${id}`, data).then((r) => r.data),

  deletePromptTemplate: (id: number) =>
    api.delete(`/admin/prompt-templates/${id}`).then((r) => r.data),

  // ── Query Examples ────────────────────────────────────────
  listQueryExamples: (connId: number) =>
    api.get<QueryExample[]>(`/admin/query-examples`, { params: { conn_id: connId } }).then((r) => r.data),

  createQueryExample: (_connId: number, data: Omit<QueryExample, 'id' | 'created_at' | 'updated_at'>) =>
    api.post(`/admin/query-examples`, data).then((r) => r.data),

  updateQueryExample: (_connId: number, id: number, data: Omit<QueryExample, 'id' | 'created_at' | 'updated_at'>) =>
    api.put(`/admin/query-examples/${id}`, data).then((r) => r.data),

  deleteQueryExample: (_connId: number, id: number) =>
    api.delete(`/admin/query-examples/${id}`).then((r) => r.data),

  aiGenerateExampleSql: (connId: number, intent: string) =>
    api.post<{ example_sql: string; tables_used: string }>(
      `/admin/query-examples/${connId}/ai-generate-sql`,
      { intent }
    ).then((r) => r.data),

  aiGenerateExampleBatch: (connId: number) =>
    api.post<{ suggestions: Array<{ name: string; description: string; tables_used: string; example_sql: string }> }>(
      `/admin/query-examples/${connId}/ai-generate-batch`,
      {}
    ).then((r) => r.data),

  aiExtractExamples: (connId: number, text: string, file?: File) => {
    const form = new FormData()
    form.append('text', text)
    if (file) form.append('file', file)
    return api.post<{ suggestions: Array<{ name: string; description: string; tables_used: string; example_sql: string }>; total_found: number }>(
      `/admin/query-examples/${connId}/ai-extract`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    ).then((r) => r.data)
  },

  // ── Table Relations ───────────────────────────────────────
  listRelations: (connId: number) =>
    api.get<CatalogRelationRow[]>(`/admin/relations/${connId}`).then((r) => r.data),

  addRelation: (connId: number, data: { parent_table: string; parent_column: string; referenced_table: string; referenced_column: string; fk_name?: string }) =>
    api.post<CatalogRelationRow>(`/admin/relations/${connId}`, data).then((r) => r.data),

  deleteRelation: (connId: number, id: number) =>
    api.delete(`/admin/relations/${connId}/${id}`).then((r) => r.data),

  aiSuggestRelations: (connId: number, apiKey?: string) =>
    api.post<{ suggestions: AISuggestedRelation[] }>(`/admin/relations/${connId}/ai-suggest`, { api_key: apiKey || '' }).then((r) => r.data),
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export const reportApi = {
  generateSql: (connId: number, question: string, context?: string) =>
    api
      .post<{ sql: string }>('/report/generate-sql', { conn_id: connId, question, context })
      .then((r) => r.data),
  ask: (connId: number, question: string) =>
    api
      .post<{ sql: string; columns: string[]; rows: Record<string, unknown>[]; total: number; confidence?: number; query_explanation?: string; follow_up_suggestions?: string[]; ambiguities?: string[] }>('/report/ask', { conn_id: connId, question })
      .then((r) => r.data),
  listSaved: (connId?: number) =>
    api.get('/reports/saved', { params: { conn_id: connId } }).then((r) => r.data),
  save: (connId: number, name: string, sql: string) =>
    api.post('/reports/saved', { conn_id: connId, name, query_sql: sql }).then((r) => r.data),
  deleteSaved: (reportId: number) =>
    api.delete(`/reports/saved/${reportId}`).then((r) => r.data),

  // Schema Explorer
  getCatalog: (connId: number) =>
    api.get(`/report/catalog/${connId}`).then((r) => r.data),

  // Session management
  createSession: (connId: number) =>
    api.post<{ session_id: number; created_at: string }>('/report/session', { conn_id: connId }).then((r) => r.data),
  getSession: (sessionId: number) =>
    api.get(`/report/session/${sessionId}`).then((r) => r.data),
  askFollowup: (payload: { session_id: number; question: string; conn_id: number }) =>
    api.post<{ sql: string; columns: string[]; rows: Record<string, unknown>[]; total: number; confidence?: number; query_explanation?: string; follow_up_suggestions?: string[]; ambiguities?: string[] }>('/report/ask-followup', payload).then((r) => r.data),

  // Document upload
  uploadDoc: (sessionId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<{ doc_id: number; filename: string; file_type: string; row_count: number | null; preview: string }>(`/report/session/${sessionId}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)
  },
  deleteDoc: (sessionId: number, docId: number) =>
    api.delete(`/report/session/${sessionId}/docs/${docId}`).then((r) => r.data),

  // Insights
  getInsights: (columns: string[], rows: Record<string, unknown>[], useLlm = false, question = '') =>
    api.post('/report/insights', { columns, rows: rows.slice(0, 1000), use_llm: useLlm, question }).then((r) => r.data),

  // PPT Export (blob)
  exportPpt: (connId: number, question: string, columns: string[], rows: Record<string, unknown>[], chartData?: { name: string; value: number }[]) =>
    api.post('/report/export-ppt', { conn_id: connId, question, columns, rows: rows.slice(0, 500), chart_data: chartData }, { responseType: 'blob' }).then((r) => r.data),

  // Auto-resume after approval
  resumeQuery: (approvalRequestId: number) =>
    api.post<{ sql: string; columns: string[]; rows: Record<string, unknown>[]; total: number }>(`/report/resume/${approvalRequestId}`).then((r) => r.data),

  // Pending approval lookup (for re-discovery after page navigation)
  getPendingApprovals: (connId: number) =>
    api.get<{ id: number; status: string; created_at: string }[]>('/report/pending-approvals', { params: { conn_id: connId } }).then((r) => r.data),
}

// ─── PS Support ──────────────────────────────────────────────────────────────
export const psApi = {
  // Chat — backend expects { message, conversation_id?, conn_id?, model }
  chat: (
    message: string,
    conversationId?: number | null,
    connId?: number | '',
    model?: string,
  ) =>
    api
      .post<{ content: string; conversation_id: number }>('/ps/chat', {
        message,
        conversation_id: conversationId ?? undefined,
        conn_id: connId || undefined,
        model: model ?? 'gpt-4o-mini',
      })
      .then((r) => r.data),
  streamUrl: () => '/api/ps/chat/stream',

  // Conversations
  listConversations: (connId?: number) =>
    api.get<PsConversation[]>('/ps/conversations', { params: connId ? { conn_id: connId } : {} }).then((r) => r.data),
  getConversation: (id: number) =>
    api
      .get<{ conversation: PsConversation; messages: PsMessage[] }>(`/ps/conversations/${id}`)
      .then((r) => r.data),
  deleteConversation: (id: number) =>
    api.delete(`/ps/conversations/${id}`).then((r) => r.data),
  renameConversation: (id: number, title: string) =>
    api.patch(`/ps/conversations/${id}/title`, { title }).then((r) => r.data),
  exportConversation: (id: number) =>
    api.get(`/ps/conversations/${id}/export`).then((r) => r.data),

  // API Collection
  listApiCollection: (connId?: number, projectId?: number) =>
    api.get<PsApiEntry[]>('/ps/api-collection', {
      params: connId ? { conn_id: connId } : projectId ? { project_id: projectId } : {},
    }).then((r) => r.data),
  createApiEntry: (data: Omit<PsApiEntry, 'id'>) =>
    api.post<PsApiEntry>('/ps/api-collection', data).then((r) => r.data),
  updateApiEntry: (id: number, data: Partial<Omit<PsApiEntry, 'id'>>) =>
    api.put<PsApiEntry>(`/ps/api-collection/${id}`, data).then((r) => r.data),
  deleteApiEntry: (id: number) =>
    api.delete(`/ps/api-collection/${id}`).then((r) => r.data),

  // AI extract APIs from file/text
  aiExtractApis: (file?: File | null, text?: string) => {
    const form = new FormData()
    if (file) form.append('file', file)
    if (text) form.append('text', text)
    return api.post<{ count: number; filename: string | null; apis: unknown[] }>(
      '/ps/api-collection/ai-extract', form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ).then((r) => r.data)
  },

  importCollection: (collection: unknown, connId?: number | null, overwrite = false) =>
    api.post<{ imported: number; skipped: number; entries: unknown[] }>(
      '/ps/api-collection/import',
      { collection, conn_id: connId ?? null, overwrite },
    ).then((r) => r.data),

  // Workflows
  listWorkflows: (connId?: number) =>
    api.get<Workflow[]>('/ps/workflows', { params: connId ? { conn_id: connId } : {} }).then((r) => r.data),
  getWorkflow: (id: number) => api.get<Workflow>(`/ps/workflows/${id}`).then((r) => r.data),
  createWorkflow: (data: {
    name: string
    description?: string
    conn_id?: number
    steps?: Array<{ step_type: string; label: string; config_json: string }>
  }) => api.post<Workflow>('/ps/workflows', data).then((r) => r.data),
  updateWorkflow: (id: number, data: { name?: string; description?: string }) =>
    api.put<Workflow>(`/ps/workflows/${id}`, data).then((r) => r.data),
  deleteWorkflow: (id: number) =>
    api.delete(`/ps/workflows/${id}`).then((r) => r.data),
  cloneWorkflow: (id: number) =>
    api.post<Workflow>(`/ps/workflows/${id}/clone`).then((r) => r.data),
  updateWorkflowStep: (wfId: number, stepId: number, data: { label?: string; config_json?: string }) =>
    api.put(`/ps/workflows/${wfId}/steps/${stepId}`, data).then((r) => r.data),
  runWorkflow: (id: number) =>
    api.post(`/ps/workflows/${id}/run`).then((r) => r.data),
  getWorkflowRuns: (id: number, limit = 10) =>
    api.get(`/ps/workflows/${id}/runs`, { params: { limit } }).then((r) => r.data),
  setSchedule: (
    id: number,
    data: {
      schedule_type: 'manual' | 'interval' | 'daily' | 'weekly'
      interval_minutes?: number
      run_at_time?: string
      run_on_day?: number
      is_enabled?: boolean
    },
  ) => api.put(`/ps/workflows/${id}/schedule`, data).then((r) => r.data),
  createFromConversation: (conversationId: number, name: string, description?: string) =>
    api
      .post<Workflow>('/ps/workflows/from-conversation', {
        conversation_id: conversationId,
        name,
        description,
      })
      .then((r) => r.data),

  // Email Settings
  getEmailSettings: () => api.get('/ps/email-settings').then((r) => r.data),
  saveEmailSettings: (data: {
    smtp_host: string
    smtp_port: number
    smtp_user?: string
    smtp_pass?: string
    from_address: string
    use_tls: boolean
  }) => api.put('/ps/email-settings', data).then((r) => r.data),
  testEmail: () => api.post('/ps/email-settings/test').then((r) => r.data),

  // Debug — fetch rendered system prompt
  getDebugPrompt: (connId?: number | '') =>
    api
      .get<{ conn_id: number | null; system_prompt: string; length: number }>(
        '/ps/debug/system-prompt',
        { params: connId ? { conn_id: connId } : {} },
      )
      .then((r) => r.data),
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export const dashboardApi = {
  getSummary: (projectId?: number) =>
    api.get('/dashboard/summary', { params: projectId ? { project_id: projectId } : {} }).then((r) => r.data),
  getActivity: (days = 30, projectId?: number) =>
    api.get('/dashboard/activity', { params: { days, ...(projectId ? { project_id: projectId } : {}) } }).then((r) => r.data),
}

// ─── Validation ──────────────────────────────────────────────────────────────
export const validationApi = {
  getRules: (connId: number) =>
    api.get<ValidationRule[]>(`/validation/${connId}`).then((r) => r.data),
  scanPaths: (connId: number) =>
    api
      .get<{ paths: Array<{ path: string; sample: string; inferred_type: string }>; xml_count: number; message?: string }>(
        `/validation/${connId}/scan-paths`,
      )
      .then((r) => r.data),
  saveRules: (connId: number, rules: ValidationRule[]) =>
    api.post(`/validation/${connId}/save`, { rules }).then((r) => r.data),
  generateXsd: (connId: number) =>
    api.post<{ xsd: string }>(`/validation/${connId}/generate-xsd`).then((r) => r.data),
  runValidation: (connId: number) =>
    api.post<ValidationResult>(`/validation/${connId}/run`).then((r) => r.data),
  aiSuggest: (
    connId: number,
    message: string,
    history: Array<{ role: string; content: string }>,
    file?: File | null,
    apiConfig?: { url: string; method?: string; headers?: string; body?: string } | null,
  ) => {
    const fd = new FormData()
    fd.append('message', message)
    fd.append('history', JSON.stringify(history))
    if (file) fd.append('file', file)
    if (apiConfig?.url) {
      fd.append('api_url', apiConfig.url)
      fd.append('api_method', apiConfig.method || 'GET')
      if (apiConfig.headers) fd.append('api_headers', apiConfig.headers)
      if (apiConfig.body) fd.append('api_body', apiConfig.body)
    }
    return api
      .post<{ reply: string; rules: Array<Record<string, unknown>> }>(
        `/validation/${connId}/ai-suggest`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      .then((r) => r.data)
  },
  apiFetch: (
    connId: number,
    url: string,
    method = 'GET',
    headers?: Record<string, string>,
    requestBody?: string,
  ) =>
    api
      .post<{ status: number; body_text: string; content_type: string; error: string | null }>(
        `/validation/${connId}/api-fetch`,
        { url, method, headers, request_body: requestBody },
      )
      .then((r) => r.data),
}

// ─── Query Examples & Context ────────────────────────────────────────────────
export const queryApi = {
  listExamples: (connId?: number) =>
    api
      .get('/admin/query-examples', { params: { conn_id: connId } })
      .then((r) => r.data),
  createExample: (data: { conn_id?: number; question: string; sql: string }) =>
    api.post('/admin/query-examples', data).then((r) => r.data),
  updateExample: (id: number, data: { question?: string; sql?: string }) =>
    api.put(`/admin/query-examples/${id}`, data).then((r) => r.data),
  deleteExample: (id: number) =>
    api.delete(`/admin/query-examples/${id}`).then((r) => r.data),
  getContext: (connId: number) =>
    api.get('/admin/query-context', { params: { conn_id: connId } }).then((r) => r.data),
  saveContext: (connId: number, content: string) =>
    api.put('/admin/query-context', { conn_id: connId, content }).then((r) => r.data),
}

// ─── My Dashboards ────────────────────────────────────────────────────────────
export const myDashboardsApi = {
  list: (projectId?: number, connId?: number) =>
    api.get<SavedDashboard[]>('/dashboards', {
      params: { ...(projectId ? { project_id: projectId } : {}), ...(connId ? { conn_id: connId } : {}) },
    }).then((r) => r.data),
  get: (id: number) =>
    api.get<SavedDashboard>(`/dashboards/${id}`).then((r) => r.data),

  save: (data: {
    name: string
    description?: string
    config_json: string
    debug_json?: string
    conn_id?: number
    project_id?: number
  }) => api.post<SavedDashboard>('/dashboards', data).then((r) => r.data),

  update: (id: number, data: {
    name: string
    description?: string
    config_json: string
    debug_json?: string
    conn_id?: number
    project_id?: number
  }) => api.put<SavedDashboard>(`/dashboards/${id}`, data).then((r) => r.data),

  delete: (id: number) => api.delete(`/dashboards/${id}`).then((r) => r.data),

  generate: (intent: string, connId: number, constraints?: string, model?: string) =>
    api
      .post<{ config: DashboardConfigSchema; debug: DashboardDebugMeta }>('/dashboards/generate', {
        intent,
        conn_id: connId,
        constraints: constraints ?? '',
        model: model ?? 'gpt-4o-mini',
      })
      .then((r) => r.data),

  getDebug: (id: number) =>
    api.get<DashboardDebugMeta>(`/dashboards/${id}/debug`).then((r) => r.data),

  generateFromSql: (
    sql: string,
    columns: string[],
    sampleRows: Record<string, unknown>[],
    connId: number,
    intent?: string,
    model?: string,
  ) =>
    api
      .post<{ config: DashboardConfigSchema; debug: DashboardDebugMeta }>('/dashboards/generate-from-sql', {
        sql,
        columns,
        sample_rows: sampleRows,
        conn_id:     connId,
        intent:      intent ?? '',
        model:       model ?? 'gpt-4o-mini',
      })
      .then((r) => r.data),

  regenerateWidget: (
    widgetId: string,
    currentWidget: DashboardWidget,
    refinement: string,
    connId: number,
    originalIntent: string,
    model = 'gpt-4o-mini',
  ) =>
    api
      .post<{ widget: DashboardWidget }>('/dashboards/widget/regenerate', {
        widget_id:       widgetId,
        current_widget:  currentWidget,
        refinement,
        conn_id:         connId,
        original_intent: originalIntent,
        model,
      })
      .then((r) => r.data),

  powerBiExport: (id: number, model?: string) =>
    api.post<PowerBIExport>(`/dashboards/${id}/powerbi-export`, { model }).then((r) => r.data),

  validateDax: (measures: { name: string; expression: string }[], datasetSchema?: unknown) =>
    api.post<{
      all_valid: boolean
      results: { name: string; passed: boolean; errors: string[]; warnings: string[] }[]
    }>('/dashboards/validate-dax', { measures, dataset_schema: datasetSchema }).then((r) => r.data),
}

// ─── Development Module ───────────────────────────────────────────────────────
export const developmentApi = {
  plan: (connId: number, taskDescription: string, model?: string) =>
    api.post<PlanResponse>('/dev/plan', { conn_id: connId, task_description: taskDescription, model }).then((r) => r.data),

  generate: (artifactId: number, stepNumber: number, model?: string) =>
    api.post<GenerateResponse>('/dev/generate', { artifact_id: artifactId, step_number: stepNumber, model }).then((r) => r.data),

  validate: (connId: number, sql: string) =>
    api.post<SQLValidationResult>('/dev/validate', { conn_id: connId, sql }).then((r) => r.data),

  execute: (connId: number, sql: string, limit?: number, skipValidation?: boolean) =>
    api.post<QueryResult>('/dev/execute', { conn_id: connId, sql, limit, skip_validation: skipValidation }).then((r) => r.data),

  explain: (connId: number, sql: string, model?: string) =>
    api.post<{ explanation: string }>('/dev/explain', { conn_id: connId, sql, model }).then((r) => r.data),

  suggestFix: (connId: number, error: string, sql: string, model?: string) =>
    api.post<{ sql: string }>('/dev/suggest-fix', { conn_id: connId, error, sql, model }).then((r) => r.data),

  runPipeline: (artifactId: number) =>
    api.post(`/dev/pipeline/${artifactId}/run`).then((r) => r.data),

  history: (connId: number) =>
    api.get<DevArtifact[]>(`/dev/history/${connId}`).then((r) => r.data),

  getArtifact: (id: number) =>
    api.get<DevArtifact>(`/dev/artifacts/${id}`).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/dev/artifacts/${id}`).then((r) => r.data),

  analyzeBrd: (connId: number, brdText: string, model?: string) =>
    api.post<{
      criteria: BRDCriterion[]
      summary: string
      conn_id: number
      model: string
    }>('/dev/brd-analyze', { conn_id: connId, brd_text: brdText, model }, { timeout: 120_000 }).then((r) => r.data),

  fetchExternal: (params: {
    source_type: 'jira' | 'ado'
    resource_id: string
    project_id?: number
    url?: string
    token?: string
    extra?: { username?: string }
  }) =>
    api.post<{ source_type: string; resource_id: string; text: string }>('/dev/fetch-external', params).then((r) => r.data),

  generateAll: (artifactId: number, model?: string) =>
    api.post<{ artifact_id: number; steps: unknown[]; generated: number; errors: string[] }>(
      `/dev/pipeline/${artifactId}/generate-all`,
      {},
      { params: model ? { model } : {} },
    ).then((r) => r.data),

  validateAll: (artifactId: number) =>
    api.post<{ artifact_id: number; validations: { step_number: number; passed: boolean; errors: string[]; warnings: string[] }[]; all_passed: boolean }>(
      `/dev/pipeline/${artifactId}/validate-all`,
    ).then((r) => r.data),

  exportAc: (params: {
    criteria: unknown[]
    destination: 'jira' | 'ado'
    project_key?: string
    epic_key?: string
    story_type?: string
  }) =>
    api.post<{ created: number; items: unknown[]; errors: string[]; target: string }>('/dev/export-ac', {
      target: params.destination,
      criteria: params.criteria,
      project_key: params.project_key ?? '',
      epic_key: params.epic_key,
      story_type: params.story_type ?? 'Task',
    }).then((r) => r.data),

  gitCheckin: (params: {
    artifact_id?: number
    repo: string
    branch?: string
    path?: string
    token: string
    message?: string
  }) =>
    api.post<{ committed: number; files: string[]; errors: string[] }>('/dev/git-checkin', params).then((r) => r.data),
}

// ─── External Integrations (JIRA / ADO) ──────────────────────────────────────
export interface IntegrationConfig {
  id: number
  type: string
  project_id?: number | null
  base_url: string
  username?: string
  is_active: boolean
  has_token: boolean
  updated_at: string
}
export const integrationsApi = {
  list: (projectId?: number) =>
    api.get<IntegrationConfig[]>('/admin/integrations', { params: projectId != null ? { project_id: projectId } : {} }).then((r) => r.data),
  save: (data: { type: string; base_url: string; username?: string; token: string; project_id?: number | null }) =>
    api.post('/admin/integrations', data).then((r) => r.data),
  delete: (type: string, projectId?: number | null) =>
    api.delete(`/admin/integrations/${type}`, { params: projectId != null ? { project_id: projectId } : {} }).then((r) => r.data),
}

// ─── API Dispatch ─────────────────────────────────────────────────────────────
export const dispatchApi = {
  getConfig: (connId: number) =>
    api.get<ApiDispatchConfig>(`/dispatch/${connId}/config`).then((r) => r.data),

  saveConfig: (connId: number, cfg: ApiDispatchConfig) =>
    api.put<ApiDispatchConfig>(`/dispatch/${connId}/config`, cfg).then((r) => r.data),

  listXmls: (connId: number, limit = 200, offset = 0) =>
    api.get<XmlDispatchRow[]>(`/dispatch/${connId}/xmls`, { params: { limit, offset } }).then((r) => r.data),

  sendOne: (connId: number, xmlId: number) =>
    api.post<ApiDispatchLog>(`/dispatch/${connId}/send/${xmlId}`).then((r) => r.data),

  sendAll: (connId: number) =>
    api.post<DispatchSendAllResult>(`/dispatch/${connId}/send-all`).then((r) => r.data),

  getLogs: (connId: number, xmlId?: number) =>
    api
      .get<ApiDispatchLog[]>(`/dispatch/${connId}/logs`, { params: xmlId ? { xml_id: xmlId } : {} })
      .then((r) => r.data),

  aiConfigure: (
    connId: number,
    message: string,
    history: Array<{ role: string; content: string }>,
    file?: File | null,
  ) => {
    const fd = new FormData()
    fd.append('message', message)
    fd.append('history', JSON.stringify(history))
    if (file) fd.append('file', file)
    return api
      .post<{ reply: string; config: Partial<ApiDispatchConfig> }>(
        `/dispatch/${connId}/ai-configure`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      .then((r) => r.data)
  },
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface PipelineStepResult {
  step:       string
  label:      string
  status:     string        // skipped|running|success|fail|partial
  message?:   string | null
  count?:     number | null
  elapsed_ms?: number | null
}

export interface PipelineRun {
  id:           number
  conn_id:      number
  triggered_by: string
  status:       string      // running|success|fail|partial
  steps:        PipelineStepResult[]
  started_at:   string
  finished_at?: string | null
}

export interface PipelineSchedule {
  id?:              number
  conn_id:          number
  schedule_type:    string   // manual|interval|daily|weekly
  interval_minutes?: number | null
  run_at_time?:     string | null   // "HH:MM"
  run_on_day?:      number | null   // 0=Mon…6=Sun
  is_enabled:       boolean
  skip_mapping:     boolean
  next_run_at?:     string | null
  last_run_at?:     string | null
  last_run_status?: string | null
}

export interface PipelineStatus {
  has_template:     boolean
  has_query:        boolean
  has_mapping:      boolean
  format_type:      string | null
  generated_count:  number
  validated_pass:   number
  validated_fail:   number
  has_dispatch_cfg: boolean
}

export const pipelineApi = {
  run: (connId: number) =>
    api.post<PipelineRun>(`/pipeline/${connId}/run`).then((r) => r.data),

  lastRun: (connId: number) =>
    api.get<PipelineRun | null>(`/pipeline/${connId}/last-run`).then((r) => r.data),

  history: (connId: number, limit = 10) =>
    api.get<PipelineRun[]>(`/pipeline/${connId}/history`, { params: { limit } }).then((r) => r.data),

  getSchedule: (connId: number) =>
    api.get<PipelineSchedule>(`/pipeline/${connId}/schedule`).then((r) => r.data),

  saveSchedule: (connId: number, schedule: Omit<PipelineSchedule, 'id' | 'conn_id' | 'next_run_at' | 'last_run_at' | 'last_run_status'>) =>
    api.put<PipelineSchedule>(`/pipeline/${connId}/schedule`, schedule).then((r) => r.data),

  getStatus: (connId: number) =>
    api.get<PipelineStatus>(`/pipeline/${connId}/status`).then((r) => r.data),
}

// ─── AI Agents ────────────────────────────────────────────────────────────────
import type { AIAgent, AIAgentLog } from '@/types'

// ─── Testing / Reconciliation ────────────────────────────────────────────────
export const testsApi = {
  list: (connId?: number) =>
    api.get<AITestCase[]>('/tests/list', { params: connId != null ? { conn_id: connId } : {} }).then((r) => r.data),

  create: (data: AITestCaseCreate) =>
    api.post<AITestCase>('/tests/create', data).then((r) => r.data),

  update: (id: number, data: Partial<AITestCaseCreate>) =>
    api.put<AITestCase>(`/tests/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/tests/${id}`).then((r) => r.data),

  get: (id: number) =>
    api.get<{ test_case: AITestCase; history: AITestResult[] }>(`/tests/${id}`).then((r) => r.data),

  run: (id: number) =>
    api.post<AITestResult>(`/tests/run/${id}`).then((r) => r.data),

  runAll: (connId?: number) =>
    api.post<TestRunAllResult>('/tests/run-all', {}, { params: connId != null ? { conn_id: connId } : {} }).then((r) => r.data),

  results: (connId?: number) =>
    api.get<TestSummaryRow[]>('/tests/results', { params: connId != null ? { conn_id: connId } : {} }).then((r) => r.data),

  generate: (params: {
    description:          string
    source_conn_id:       number
    target_conn_id?:      number
    model?:               string
    api_key?:             string
    identifier_column?:   string
    reconciliation_type?: string
  }) =>
    api.post<AITestCase[]>('/tests/generate', params, { timeout: 180_000 }).then((r) => r.data),

  runGroup: (groupName: string, connId?: number) =>
    api.post<TestRunAllResult>('/tests/run-group', {}, { params: { group_name: groupName, ...(connId != null ? { conn_id: connId } : {}) } }).then((r) => r.data),

  setGroupSchedule: (groupName: string, scheduleCron: string, connId?: number) =>
    api.post('/tests/group-schedule', {}, { params: { group_name: groupName, schedule_cron: scheduleCron, ...(connId != null ? { conn_id: connId } : {}) } }).then((r) => r.data),
}

export const agentsApi = {
  list: (connId?: number) =>
    api.get<AIAgent[]>('/agents', { params: connId ? { conn_id: connId } : {} }).then((r) => r.data),

  get: (id: number) =>
    api.get<AIAgent>(`/agents/${id}`).then((r) => r.data),

  create: (data: { name: string; description?: string; goal: string; conn_id?: number; schedule?: string; role_id?: number; category?: string; tools_json?: string }) =>
    api.post<AIAgent>('/agents', data).then((r) => r.data),

  update: (id: number, data: Partial<{ name: string; description: string; goal: string; conn_id: number; schedule: string; status: string; role_id: number; category: string; tools_json: string }>) =>
    api.put<AIAgent>(`/agents/${id}`, data).then((r) => r.data),

  delete: (id: number) =>
    api.delete(`/agents/${id}`).then((r) => r.data),

  run: (id: number, model?: string) =>
    api.post<AIAgentLog>(`/agents/${id}/run`, {}, { params: model ? { model } : {} }).then((r) => r.data),

  pause: (id: number) =>
    api.post<AIAgent>(`/agents/${id}/pause`).then((r) => r.data),

  logs: (id: number, limit?: number) =>
    api.get<AIAgentLog[]>(`/agents/${id}/logs`, { params: limit ? { limit } : {} }).then((r) => r.data),

  fromPsChat: (data: { conversation_id: number; name: string; description?: string; conn_id?: number; schedule?: string }) =>
    api.post<AIAgent>('/agents/from-ps-chat', data).then((r) => r.data),
}

// ─── Feedback ─────────────────────────────────────────────────────────────────
export const feedbackApi = {
  submit: (data: FeedbackSubmit) =>
    api.post<FeedbackEntry>('/feedback', data).then((r) => r.data),

  list: (params?: { status?: string; module?: string; type?: string }) =>
    api.get<FeedbackEntry[]>('/feedback', { params }).then((r) => r.data),

  update: (id: number, data: { status?: string; admin_notes?: string }) =>
    api.patch<FeedbackEntry>(`/feedback/${id}`, data).then((r) => r.data),

  remove: (id: number) =>
    api.delete(`/feedback/${id}`).then((r) => r.data),
}

// ─── Clarity Assistant (in-app help chat) ─────────────────────────────────────
export const helpChatApi = {
  send: (payload: {
    message:    string
    project_id?: number
    conn_id?:    number
    page?:       string
    history?:    Array<{ role: string; content: string }>
  }) =>
    api.post<{ content: string }>('/help/chat', payload).then((r) => r.data),
}

// ─── Conversion Agent Pipeline ───────────────────────────────────────────────
import type {
  AgentRunLog, QueryVersion, ValidationResultEntry, ColumnProfile,
  ValueMapping, ConversionAgentResult,
} from '@/types'

export const conversionAgentApi = {
  run: (connId: number, maxAttempts = 3, userHints: string[] = [], skipMapping = false) =>
    api.post<ConversionAgentResult>('/conversion-agent/run', { conn_id: connId, max_attempts: maxAttempts, user_hints: userHints, skip_mapping: skipMapping }, { timeout: 300_000 }).then((r) => r.data),

  getRunLogs: (connId: number, limit = 50) =>
    api.get<AgentRunLog[]>(`/conversion-agent/${connId}/run-logs`, { params: { limit } }).then((r) => r.data),

  getVersions: (connId: number) =>
    api.get<QueryVersion[]>(`/conversion-agent/${connId}/versions`).then((r) => r.data),

  getVersion: (connId: number, vid: number) =>
    api.get<QueryVersion>(`/conversion-agent/${connId}/versions/${vid}`).then((r) => r.data),

  getValidation: (connId: number, limit = 200) =>
    api.get<ValidationResultEntry[]>(`/conversion-agent/${connId}/validation`, { params: { limit } }).then((r) => r.data),

  getProfiles: (connId: number) =>
    api.get<ColumnProfile[]>(`/conversion-agent/${connId}/profiles`).then((r) => r.data),

  triggerProfile: (connId: number) =>
    api.post<{ profiled_columns: number }>(`/conversion-agent/${connId}/profile`).then((r) => r.data),

  getValueMappings: (connId: number, tableName?: string) =>
    api.get<ValueMapping[]>(`/conversion-agent/${connId}/value-mappings`, { params: tableName ? { table_name: tableName } : {} }).then((r) => r.data),

  suggestValueMappings: (connId: number) =>
    api.post<{ new_mappings: number; categorical_columns_checked: number }>(`/conversion-agent/${connId}/value-mappings/suggest`).then((r) => r.data),

  updateValueMapping: (connId: number, mid: number, data: { target_value?: string; status?: string }) =>
    api.put<ValueMapping>(`/conversion-agent/${connId}/value-mappings/${mid}`, data).then((r) => r.data),

  deleteValueMapping: (connId: number, mid: number) =>
    api.delete(`/conversion-agent/${connId}/value-mappings/${mid}`).then((r) => r.data),

  getMappingRows: (connId: number) =>
    api.get<{ identifier_column: string | null; identifier_table: string | null; rows: MappingRowEntry[] }>(
      `/conversion-agent/${connId}/mapping-rows`,
    ).then((r) => r.data),

  updateMappingRow: (connId: number, rowId: number, data: { source_column?: string; formula?: string }) =>
    api.put<MappingRowEntry>(`/conversion-agent/${connId}/mapping-rows/${rowId}`, data).then((r) => r.data),

  rematchMappingRow: (connId: number, rowId: number) =>
    api.post<MappingRowEntry>(`/conversion-agent/${connId}/mapping-rows/${rowId}/rematch`).then((r) => r.data),

  aiTransformRow: (connId: number, rowId: number, instruction: string, dialect?: string) =>
    api.post<TransformResult>(
      `/conversion-agent/${connId}/mapping-rows/${rowId}/ai-transform`,
      { instruction, dialect: dialect ?? 'mssql' },
    ).then((r) => r.data),

  saveTransformManual: (connId: number, rowId: number, sqlExpression: string, pythonExpression: string) =>
    api.put<TransformResult>(
      `/conversion-agent/${connId}/mapping-rows/${rowId}/transform`,
      { sql_expression: sqlExpression, python_expression: pythonExpression },
    ).then((r) => r.data),

  clearTransform: (connId: number, rowId: number) =>
    api.delete(`/conversion-agent/${connId}/mapping-rows/${rowId}/transform`).then((r) => r.data),

  updateQuery: (connId: number, sqlText: string) =>
    api.put<{ id: number; conn_id: number; query_sql: string; generated_by: string }>(
      `/conversion-agent/${connId}/query`,
      { sql_text: sqlText },
    ).then((r) => r.data),
}

export interface MappingRowEntry {
  id:                   number
  source_table:         string | null
  source_column:        string | null
  target_path:          string | null
  formula:              string | null
  confidence:           number | null  // 0-100, null = manual
  transform_expression: string | null
  transform_sql:        string | null
}

export interface TransformResult {
  id:                  number
  target_path:         string
  source_column:       string
  sql_expression:      string
  python_expression:   string
  explanation:         string
  transform_expression: string
  transform_sql:       string
}

// ─── Agentic AI Platform ──────────────────────────────────────────────────────
export const agenticApi = {
  // Roles
  listRoles: () =>
    api.get<AgentRole[]>('/agentic/roles').then((r) => r.data),
  createRole: (d: Partial<AgentRole>) =>
    api.post<AgentRole>('/agentic/roles', d).then((r) => r.data),
  updateRole: (id: number, d: Partial<AgentRole>) =>
    api.put<AgentRole>(`/agentic/roles/${id}`, d).then((r) => r.data),
  deleteRole: (id: number) =>
    api.delete(`/agentic/roles/${id}`).then((r) => r.data),
  aiGenerateRole: (prompt: string) =>
    api.post<Partial<AgentRole>>('/agentic/roles/ai-generate', { prompt }, { timeout: 30_000 }).then((r) => r.data),

  // Cards
  listCards: () =>
    api.get<AgentCard[]>('/agentic/cards').then((r) => r.data),
  createCard: (d: Partial<AgentCard>) =>
    api.post<AgentCard>('/agentic/cards', d).then((r) => r.data),
  updateCard: (id: number, d: Partial<AgentCard>) =>
    api.put<AgentCard>(`/agentic/cards/${id}`, d).then((r) => r.data),
  deleteCard: (id: number) =>
    api.delete(`/agentic/cards/${id}`).then((r) => r.data),
  reorderCards: (items: Array<{ id: number; execution_order: number }>) =>
    api.post('/agentic/cards/reorder', items).then((r) => r.data),

  // Execution
  execute: (p: { conn_id?: number; user_query: string; model: string }) =>
    api.post<{ execution: WorkflowExecution; steps: WorkflowExecutionStep[] }>(
      '/agentic/execute', p, { timeout: 180_000 },
    ).then((r) => r.data),

  // Streaming execution — yields live events per step
  streamWorkflow: async (
    params: { conn_id?: number; user_query: string; model: string; project_id?: number },
    callbacks: {
      onStart?:            (data: { execution_id: number; total_steps: number }) => void
      onThinking:          (data: { step_number: number; card_name: string; agent_name?: string; role_name?: string; iteration: number }) => void
      onStep:              (step: WorkflowExecutionStep) => void
      onDone:              (result: { execution: WorkflowExecution; steps: WorkflowExecutionStep[] }) => void
      onError:             (message: string) => void
      onApprovalRequired?: (data: { execution_id: number; step_id: number; approval_request_id: number; required_role: string; card_name: string }) => void
    },
    signal?: AbortSignal,
  ): Promise<void> => {
    const token = useAppStore.getState().user?.token
    const response = await fetch('/api/agentic/execute/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
      signal,
    })
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => 'Unknown error')
      callbacks.onError(text)
      return
    }
    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer    = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'start')                callbacks.onStart?.(event)
          else if (event.type === 'thinking')         callbacks.onThinking(event)
          else if (event.type === 'step')             callbacks.onStep(event.step)
          else if (event.type === 'done')             callbacks.onDone({ execution: event.execution, steps: event.steps })
          else if (event.type === 'error')            callbacks.onError(event.message)
          else if (event.type === 'approval_required') callbacks.onApprovalRequired?.(event)
        } catch { /* malformed line, skip */ }
      }
    }
  },

  // Resume a paused (pending_approval) execution
  resumeStream: async (
    executionId: number,
    callbacks: {
      onStart?:            (data: { execution_id: number; total_steps: number; resumed?: boolean }) => void
      onThinking:          (data: { step_number: number; card_name: string; agent_name?: string; role_name?: string; iteration: number }) => void
      onStep:              (step: WorkflowExecutionStep) => void
      onDone:              (result: { execution: WorkflowExecution; steps: WorkflowExecutionStep[] }) => void
      onError:             (message: string) => void
      onApprovalRequired?: (data: { execution_id: number; step_id: number; approval_request_id: number; required_role: string; card_name: string }) => void
    },
    signal?: AbortSignal,
  ): Promise<void> => {
    const token = useAppStore.getState().user?.token
    const response = await fetch(`/api/agentic/executions/${executionId}/stream-resume`, {
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    })
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => 'Unknown error')
      callbacks.onError(text)
      return
    }
    const reader  = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer    = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          if (event.type === 'start')                callbacks.onStart?.(event)
          else if (event.type === 'thinking')         callbacks.onThinking(event)
          else if (event.type === 'step')             callbacks.onStep(event.step)
          else if (event.type === 'done')             callbacks.onDone({ execution: event.execution, steps: event.steps })
          else if (event.type === 'error')            callbacks.onError(event.message)
          else if (event.type === 'approval_required') callbacks.onApprovalRequired?.(event)
        } catch { /* malformed line, skip */ }
      }
    }
  },
  listExecutions: (limit = 50, status?: string) =>
    api.get<WorkflowExecution[]>('/agentic/executions', { params: { limit, ...(status ? { status } : {}) } }).then((r) => r.data),
  getExecution: (id: number) =>
    api.get<{ execution: WorkflowExecution; steps: WorkflowExecutionStep[] }>(
      `/agentic/executions/${id}`,
    ).then((r) => r.data),

  // Resources
  getResources: (conn_id?: number) =>
    api.get<{
      roles:           AgentRole[]
      agents:          Array<{ id: number; name: string; description?: string; status: string; role_id?: number; tools_json?: string; category?: string }>
      available_tools: AgentTool[]
      context_summary: string
    }>('/agentic/resources', { params: conn_id ? { conn_id } : {} }).then((r) => r.data),

  // AI Workflow Designer
  designWorkflow: (requirement: string, conn_id?: number, brd_text?: string) =>
    api.post<{
      cards: Array<Partial<AgentCard> & { suggested_tools?: string[]; rationale?: string }>
      requirement: string
    }>('/agentic/design-workflow', { requirement, conn_id, brd_text }, { timeout: 45_000 }).then((r) => r.data),

  // Apply proposed cards to the DB (replaces existing pipeline)
  applyWorkflow: (cards: Array<Partial<AgentCard> & { suggested_tools?: string[]; rationale?: string }>) =>
    api.post<{ created: number; cards: AgentCard[] }>('/agentic/apply-workflow', { cards }, { timeout: 30_000 }).then((r) => r.data),

  // Saved Workflows
  listSavedWorkflows: () =>
    api.get<SavedAgenticWorkflow[]>('/agentic/saved-workflows').then((r) => r.data),
  createSavedWorkflow: (d: { name: string; description?: string; user_query: string; conn_id?: number; model: string; schedule_label?: string }) =>
    api.post<SavedAgenticWorkflow>('/agentic/saved-workflows', d).then((r) => r.data),
  updateSavedWorkflow: (id: number, d: { name: string; description?: string; user_query: string; conn_id?: number; model: string; schedule_label?: string }) =>
    api.put<SavedAgenticWorkflow>(`/agentic/saved-workflows/${id}`, d).then((r) => r.data),
  deleteSavedWorkflow: (id: number) =>
    api.delete(`/agentic/saved-workflows/${id}`).then((r) => r.data),
  runSavedWorkflow: (id: number) =>
    api.post<{ execution: WorkflowExecution; steps: WorkflowExecutionStep[] }>(
      `/agentic/saved-workflows/${id}/run`, {}, { timeout: 180_000 },
    ).then((r) => r.data),

  cancelExecution: (id: number) =>
    api.post<{ id: number; status: string }>(`/agentic/executions/${id}/cancel`, {}).then((r) => r.data),
}

// ── Dev vs Base Reconciliation Engine ─────────────────────────────────────────

export const reconciliationApi = {
  collectQueries: (connId: number) =>
    api.post<CollectQueriesResult>(
      `/reconciliation/${connId}/collect-queries`, {}, { timeout: 120_000 },
    ).then((r) => r.data),

  listQueries: (connId: number) =>
    api.get<TestQuery[]>(`/reconciliation/${connId}/queries`).then((r) => r.data),

  addQuery: (connId: number, data: TestQueryCreate) =>
    api.post<TestQuery>(`/reconciliation/${connId}/queries`, data).then((r) => r.data),

  updateQuery: (connId: number, qid: number, data: Partial<TestQueryCreate>) =>
    api.put<TestQuery>(`/reconciliation/${connId}/queries/${qid}`, data).then((r) => r.data),

  deleteQuery: (connId: number, qid: number) =>
    api.delete(`/reconciliation/${connId}/queries/${qid}`).then((r) => r.data),

  previewQ1: (
    connId: number,
    payload: {
      source_type: string
      source_id?: number | null
      source_sub_id?: number | null
      adhoc_sql?: string | null
    },
  ) =>
    api.post<{ sql: string; source_type: string; source_id: number | null }>(
      `/reconciliation/${connId}/preview-q1`, payload,
    ).then((r) => r.data),

  run: (
    connId: number,
    payload: {
      source_type: string
      source_id?: number | null
      source_sub_id?: number | null
      adhoc_sql?: string | null
      sampling_mode?: string
      sample_size?: number
      stratify_col?: string | null
      base_query_scope?: string
    },
  ) =>
    api.post<{ run_id: string; summary: RecRunSummary }>(
      `/reconciliation/${connId}/run`, payload, { timeout: 300_000 },
    ).then((r) => r.data),

  listRuns: (connId: number) =>
    api.get<RecRunSummary[]>(`/reconciliation/${connId}/runs`).then((r) => r.data),

  getRun: (connId: number, runId: string) =>
    api.get<ReconciliationResult[]>(`/reconciliation/${connId}/runs/${runId}`).then((r) => r.data),

  sourceSummary: (connId: number) =>
    api.get<SourceSummaryGroup[]>(`/reconciliation/${connId}/source-summary`).then((r) => r.data),

  emailPreview: (connId: number, runId?: string) =>
    api.get<{ html: string }>(`/reconciliation/${connId}/email-preview`, {
      params: runId ? { run_id: runId } : {},
    }).then((r) => r.data),

  sendEmail: (connId: number, to: string, subject?: string, runId?: string) =>
    api.post<{ ok: boolean; to: string; subject: string }>(
      `/reconciliation/${connId}/send-email`,
      { to, subject, run_id: runId },
    ).then((r) => r.data),
}

// ─── Multi-Source Compare ─────────────────────────────────────────────────────
export const multiCompareApi = {
  run: (
    slots: MultiSourceSlotConfig[],
    files: (File | null)[],
    userInstructions: string,
  ): Promise<MultiCompareResult> => {
    const fd = new FormData()
    fd.append('slots', JSON.stringify(slots.map(s => ({
      slot_index:  s.slot_index,
      source_type: s.source_type,
      conn_id:     s.conn_id ?? null,
      sql:         s.sql ?? null,
      label:       s.label ?? null,
    }))))
    fd.append('user_instructions', userInstructions)
    files.forEach((f, i) => { if (f) fd.append(`file_${i}`, f) })
    return api.post<MultiCompareResult>(
      '/reconciliation/multi-compare',
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 },
    ).then(r => r.data)
  },
}

// ─── Project Members ──────────────────────────────────────────────────────────
export interface ProjectMember {
  id: number
  user_id: number
  username: string
  email: string | null
  project_role: 'manager' | 'team_lead' | 'developer'
}

export interface UserProject {
  project_id: number
  project_name: string
  project_role: string
}

export const projectMembersApi = {
  list: (projectId: number) =>
    api.get<ProjectMember[]>(`/projects/${projectId}/members`).then((r) => r.data),
  assign: (projectId: number, userId: number, projectRole: string) =>
    api.post<ProjectMember>(`/projects/${projectId}/members`, { user_id: userId, project_role: projectRole }).then((r) => r.data),
  remove: (projectId: number, userId: number) =>
    api.delete(`/projects/${projectId}/members/${userId}`).then((r) => r.data),
  listUserProjects: (userId: number) =>
    api.get<UserProject[]>(`/users/${userId}/projects`).then((r) => r.data),
}

// ─── Approval Workflows ───────────────────────────────────────────────────────
export interface WorkflowStep {
  id: number
  step_order: number
  step_name: string
  required_role: string
}

export interface ApprovalWorkflow {
  id: number
  project_id: number
  name: string
  description: string | null
  is_active: boolean
  steps: WorkflowStep[]
}

export const approvalWorkflowsApi = {
  list: (projectId: number) =>
    api.get<ApprovalWorkflow[]>(`/projects/${projectId}/workflows`).then((r) => r.data),
  create: (projectId: number, data: { name: string; description?: string; is_active?: boolean; steps: Omit<WorkflowStep, 'id'>[] }) =>
    api.post<ApprovalWorkflow>(`/projects/${projectId}/workflows`, data).then((r) => r.data),
  update: (projectId: number, workflowId: number, data: { name: string; description?: string; is_active?: boolean; steps: Omit<WorkflowStep, 'id'>[] }) =>
    api.put<ApprovalWorkflow>(`/projects/${projectId}/workflows/${workflowId}`, data).then((r) => r.data),
  delete: (projectId: number, workflowId: number) =>
    api.delete(`/projects/${projectId}/workflows/${workflowId}`).then((r) => r.data),
}

// ─── Approval Requests ────────────────────────────────────────────────────────
export interface ApprovalDecision {
  id: number
  step_order: number
  step_name: string
  required_role: string
  decided_by: number | null
  decision: 'approve' | 'reject' | null
  notes: string | null
  decided_at: string | null
}

export interface ApprovalRequest {
  id: number
  project_id: number
  project_name: string | null
  workflow_id: number | null
  triggered_by: number
  triggered_by_username: string | null
  context_type: string
  context_id: string | null
  current_step_order: number
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'cancelled'
  created_at: string | null
  decisions: ApprovalDecision[]
}

export const approvalRequestsApi = {
  listForMe: () =>
    api.get<ApprovalRequest[]>('/approval-requests').then((r) => r.data),
  listAll: () =>
    api.get<ApprovalRequest[]>('/approval-requests/all').then((r) => r.data),
  listMyRequests: () =>
    api.get<ApprovalRequest[]>('/approval-requests/my').then((r) => r.data),
  decide: (requestId: number, decision: 'approve' | 'reject', notes?: string) =>
    api.post<ApprovalRequest>(`/approval-requests/${requestId}/decide`, { decision, notes }).then((r) => r.data),
  cancel: (requestId: number) =>
    api.delete(`/approval-requests/${requestId}`).then((r) => r.data),
  deleteAllPending: () =>
    api.delete<{ deleted: number }>('/approval-requests/pending').then((r) => r.data),
}

// ─── Notifications ────────────────────────────────────────────────────────────
export interface AppNotification {
  id: number
  type: string
  title: string
  body: string | null
  is_read: boolean
  link_type: string | null
  link_id: string | null
  created_at: string | null
}

export const notificationsApi = {
  list: () =>
    api.get<AppNotification[]>('/notifications').then((r) => r.data),
  unreadCount: () =>
    api.get<{ count: number }>('/notifications/unread-count').then((r) => r.data),
  markRead: (id: number) =>
    api.patch<AppNotification>(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () =>
    api.patch('/notifications/read-all').then((r) => r.data),
}

// ─── Ask AI ───────────────────────────────────────────────────────────────────
export const askAiApi = {
  createSession: (conn_id: number) =>
    api.post<{ session_id: string }>('/ask-ai/session', { conn_id }).then((r) => r.data),

  chat: (payload: { message: string; conn_id: number; session_id?: string | null; model?: string }) =>
    api.post<AskAIResult>('/ask-ai/chat', payload).then((r) => r.data),

  actionPreview: (payload: { action_type: string; entity?: string | null; entity_id?: string | null; conn_id: number }) =>
    api.post<{ steps: string[]; estimated_impact: string; requires_confirmation: boolean }>(
      '/ask-ai/action/preview', payload
    ).then((r) => r.data),

  executeAction: (payload: { action_type: string; entity?: string | null; entity_id?: string | null; conn_id: number; session_id?: string | null; confirmed: boolean; query_sql?: string }) =>
    api.post<{ result: string; message: string; trace_id: string | null }>(
      '/ask-ai/action', payload
    ).then((r) => r.data),

  history: (session_id: string) =>
    api.get<{ role: string; content: string; created_at: string | null }[]>(
      `/ask-ai/sessions/${session_id}/history`
    ).then((r) => r.data),
}

// ─── UI Validation ────────────────────────────────────────────────────────────
export const uiValidationApi = {
  getStatus: (connId: number) =>
    api.get<UiValidationStatus>(`/ui-validation/status/${connId}`).then((r) => r.data),

  setup: (payload: Omit<UiValidationTemplate, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<UiValidationTemplate>('/ui-validation/setup', payload).then((r) => r.data),

  run: (payload: { connection_id: number; entity: string; entity_id: string }) =>
    api.post<UiValidationRun>('/ui-validation/run', payload, { timeout: 120_000 }).then((r) => r.data),

  listRuns: (templateId: number, limit = 20) =>
    api.get<UiValidationRun[]>(`/ui-validation/runs/${templateId}`, { params: { limit } }).then((r) => r.data),

  deleteTemplate: (templateId: number) =>
    api.delete(`/ui-validation/template/${templateId}`),
}
