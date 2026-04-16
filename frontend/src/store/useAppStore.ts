import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser, Project, SourceConnection, AIContextSummary } from '@/types'

export interface DaxLibraryMeasure {
  name:        string
  table:       string
  code:        string
  description: string
}

interface AppState {
  // Auth
  user: AuthUser | null
  login: (user: AuthUser) => void
  logout: () => void

  // Active project context
  activeProject: Project | null
  setActiveProject: (project: Project | null) => void

  // Active connection within the project
  activeConnection: SourceConnection | null
  setActiveConnection: (conn: SourceConnection | null) => void

  // Theme mode
  themeMode: 'light' | 'dark'
  toggleTheme: () => void

  // Conversion sub-tab (not URL-derived — all tabs share /conversion)
  conversionTab: number
  setConversionTab: (tab: number) => void

  // Power BI sub-tab (not URL-derived — all tabs share /powerbi)
  powerBiTab: number
  setPowerBiTab: (tab: number) => void

  // AI context summaries (in-memory, refreshed on connect)
  aiContexts: Record<number, AIContextSummary>
  setAiContext: (connId: number, ctx: AIContextSummary) => void
  clearAiContext: (connId: number) => void

  // Source data (from Excel/SQL)
  sourceSheets: Array<{ name: string; columns: string[]; rows: Record<string, unknown>[] }>
  setSourceSheets: (sheets: AppState['sourceSheets']) => void

  // XML template
  xmlContent: string | null
  xmlPaths: string[]
  setXmlTemplate: (content: string, paths: string[]) => void

  // Mapping rows
  mappingRows: Array<{
    id: string
    source_sheet?: string
    source_column?: string
    transform?: string
    target_path?: string
    confidence?: number
  }>
  setMappingRows: (rows: AppState['mappingRows']) => void

  // Generated SQL
  generatedSql: string
  setGeneratedSql: (sql: string) => void

  // Generated XML
  generatedXml: string
  setGeneratedXml: (xml: string) => void
  selectedIdentifier: string
  setSelectedIdentifier: (id: string) => void

  // DAX Measure Library (persisted across sessions)
  daxLibrary: DaxLibraryMeasure[]
  addDaxMeasures:    (measures: DaxLibraryMeasure[]) => void
  removeDaxMeasure:  (index: number) => void
  updateDaxMeasure:  (index: number, measure: DaxLibraryMeasure) => void
  setDaxLibrary:     (measures: DaxLibraryMeasure[]) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      login: (user) => set({ user }),
      logout: () => set({ user: null, activeProject: null, activeConnection: null }),

      activeProject: null,
      setActiveProject: (project) => set({ activeProject: project, activeConnection: null }),

      activeConnection: null,
      setActiveConnection: (conn) => set({ activeConnection: conn }),

      themeMode: 'light',
      toggleTheme: () =>
        set((s) => ({ themeMode: s.themeMode === 'light' ? 'dark' : 'light' })),

      conversionTab: 0,
      setConversionTab: (tab) => set({ conversionTab: tab }),

      powerBiTab: 0,
      setPowerBiTab: (tab) => set({ powerBiTab: tab }),

      aiContexts: {},
      setAiContext: (connId, ctx) =>
        set((s) => ({ aiContexts: { ...s.aiContexts, [connId]: ctx } })),
      clearAiContext: (connId) =>
        set((s) => {
          const next = { ...s.aiContexts }
          delete next[connId]
          return { aiContexts: next }
        }),

      sourceSheets: [],
      setSourceSheets: (sourceSheets) => set({ sourceSheets }),

      xmlContent: null,
      xmlPaths: [],
      setXmlTemplate: (content, paths) => set({ xmlContent: content, xmlPaths: paths }),

      mappingRows: [],
      setMappingRows: (mappingRows) => set({ mappingRows }),

      generatedSql: '',
      setGeneratedSql: (generatedSql) => set({ generatedSql }),

      generatedXml: '',
      setGeneratedXml: (generatedXml) => set({ generatedXml }),

      selectedIdentifier: '',
      setSelectedIdentifier: (selectedIdentifier) => set({ selectedIdentifier }),

      daxLibrary: [
        { name: 'Total Sales', table: 'Sales', code: 'Total Sales = SUM(Sales[Amount])', description: 'Sum of all sales amounts' },
        { name: 'Sales Count', table: 'Sales', code: 'Sales Count = COUNTROWS(Sales)', description: 'Number of sales records' },
      ],
      addDaxMeasures:   (measures) => set((s) => ({
        daxLibrary: [
          ...s.daxLibrary,
          ...measures.filter((m) => !s.daxLibrary.some((e) => e.name === m.name)),
        ],
      })),
      removeDaxMeasure: (index) => set((s) => ({ daxLibrary: s.daxLibrary.filter((_, i) => i !== index) })),
      updateDaxMeasure: (index, measure) => set((s) => ({ daxLibrary: s.daxLibrary.map((m, i) => i === index ? measure : m) })),
      setDaxLibrary:    (measures) => set({ daxLibrary: measures }),
    }),
    {
      name: 'clarity-studio-store',
      partialize: (state) => ({
        user:             state.user,
        activeProject:    state.activeProject,
        activeConnection: state.activeConnection,
        themeMode:        state.themeMode,
        daxLibrary:       state.daxLibrary,
      }),
    },
  ),
)
