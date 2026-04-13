import { api } from './client'
import type {
  Project, ProjectCreate,
  SourceConnection, ConnectionCreate, TestResult,
  Mapping, GeneratedQuery, GeneratedXml,
  Catalog, QueryResult,
  PsConversation, PsMessage, PsApiEntry, Workflow,
  ValidationRule, ValidationResult,
  ProcessResult, TargetFormulaRule,
  SavedDashboard, DashboardConfigSchema, DashboardDebugMeta, DashboardWidget,
  ApiDispatchConfig, ApiDispatchLog, XmlDispatchRow, DispatchSendAllResult,
  AITraceEntry, AIReadiness, AIContextSummary,
  DevArtifact, SQLValidationResult, PromptTemplate, PowerBIExport, BRDCriterion,
} from '@/types'

// AI Platform response types (not in types/index.ts as they are API-local)
export interface PlanResponse { artifact_id: number; steps: Array<{ step_number: number; title: string; description: string; sql_type: string; depends_on: number[] }> }
export interface GenerateResponse { artifact_id: number; step_number: number; sql: string }

// re-export so consumers can import from @/api
export type { ApiDispatchConfig, ApiDispatchLog, XmlDispatchRow, DispatchSendAllResult }

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
}

// ─── Target Formulas ─────────────────────────────────────────────────────────
export const targetApi = {
  process: (xmlContent: string, connId?: number, name?: string) =>
    api
      .post<ProcessResult>('/target-formulas/process', {
        xml_content: xmlContent,
        conn_id: connId,
        name: name ?? 'template.xml',
      })
      .then((r) => r.data),
  list: (connId?: number) =>
    api
      .get<TargetFormulaRule[]>('/target-formulas', { params: { conn_id: connId } })
      .then((r) => r.data),
  getTemplate: (connId: number) =>
    api.get(`/target-formulas/${connId}/template`).then((r) => r.data),
  clear: (connId: number) =>
    api.delete('/target-formulas', { params: { conn_id: connId } }).then((r) => r.data),
}

// ─── Mapping ─────────────────────────────────────────────────────────────────
export const mappingApi = {
  generateQuery: (connId: number) =>
    api.post<{ query_sql: string; identifier_column?: string; identifier_table?: string }>(
      '/mapping/generate/query', { conn_id: connId },
    ).then((r) => r.data),
  generateRows: (connId: number) =>
    api.post<Mapping>('/mapping/generate/rows', { conn_id: connId }).then((r) => r.data),
  get: (connId: number) => api.get<Mapping>(`/mapping/${connId}`).then((r) => r.data),
  getQuery: (connId: number) =>
    api.get<GeneratedQuery>(`/mapping/${connId}/query`).then((r) => r.data),
  save: (data: Mapping) => api.post('/mapping/save', data).then((r) => r.data),
  previewQuery: (connId: number) =>
    api.get<QueryResult>(`/mapping/${connId}/preview`).then((r) => r.data),
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
    api.post<{ count: number }>(`/mapping/${connId}/generate-all-xml`).then((r) => r.data),
  listGeneratedXml: (connId: number) =>
    api.get<GeneratedXml[]>(`/mapping/${connId}/generated-xml`).then((r) => r.data),
  getGeneratedXml: (connId: number, recordId: number) =>
    api.get<GeneratedXml>(`/mapping/${connId}/generated-xml/${recordId}`).then((r) => r.data),
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

  createPromptTemplate: (data: { name: string; description?: string; category?: string; content: string }) =>
    api.post<PromptTemplate>('/admin/prompt-templates', data).then((r) => r.data),

  updatePromptTemplate: (id: number, data: Partial<Pick<PromptTemplate, 'name' | 'description' | 'category' | 'content' | 'is_active'>>) =>
    api.put<PromptTemplate>(`/admin/prompt-templates/${id}`, data).then((r) => r.data),

  deletePromptTemplate: (id: number) =>
    api.delete(`/admin/prompt-templates/${id}`).then((r) => r.data),
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export const reportApi = {
  generateSql: (connId: number, question: string, context?: string) =>
    api
      .post<{ sql: string }>('/report/generate-sql', { conn_id: connId, question, context })
      .then((r) => r.data),
  ask: (connId: number, question: string) =>
    api
      .post<{ sql: string; result: QueryResult }>('/report/ask', { conn_id: connId, question })
      .then((r) => r.data),
  listSaved: (connId?: number) =>
    api.get('/reports/saved', { params: { conn_id: connId } }).then((r) => r.data),
  save: (connId: number, name: string, sql: string) =>
    api.post('/reports/saved', { conn_id: connId, name, query_sql: sql }).then((r) => r.data),
  deleteSaved: (reportId: number) =>
    api.delete(`/reports/saved/${reportId}`).then((r) => r.data),
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
  list: (projectId?: number) =>
    api.get<SavedDashboard[]>('/dashboards', { params: projectId ? { project_id: projectId } : {} }).then((r) => r.data),

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
    }>('/dev/brd-analyze', { conn_id: connId, brd_text: brdText, model }).then((r) => r.data),

  fetchExternal: (params: {
    source_type: 'jira' | 'ado'
    resource_id: string
    url?: string
    token?: string
    extra?: { username?: string }
  }) =>
    api.post<{ source_type: string; resource_id: string; text: string }>('/dev/fetch-external', params).then((r) => r.data),
}

// ─── External Integrations (JIRA / ADO) ──────────────────────────────────────
export interface IntegrationConfig {
  id: number
  type: string
  base_url: string
  username?: string
  is_active: boolean
  has_token: boolean
  updated_at: string
}
export const integrationsApi = {
  list: () => api.get<IntegrationConfig[]>('/admin/integrations').then((r) => r.data),
  save: (data: { type: string; base_url: string; username?: string; token: string }) =>
    api.post('/admin/integrations', data).then((r) => r.data),
  delete: (type: string) => api.delete(`/admin/integrations/${type}`).then((r) => r.data),
}

// ─── API Dispatch ─────────────────────────────────────────────────────────────
export const dispatchApi = {
  getConfig: (connId: number) =>
    api.get<ApiDispatchConfig>(`/dispatch/${connId}/config`).then((r) => r.data),

  saveConfig: (connId: number, cfg: ApiDispatchConfig) =>
    api.put<ApiDispatchConfig>(`/dispatch/${connId}/config`, cfg).then((r) => r.data),

  listXmls: (connId: number) =>
    api.get<XmlDispatchRow[]>(`/dispatch/${connId}/xmls`).then((r) => r.data),

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
