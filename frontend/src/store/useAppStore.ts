import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser, Project, SourceConnection } from '@/types'

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

  // App section
  section: 'conversion' | 'ps' | 'reports' | 'admin'
  setSection: (s: AppState['section']) => void

  // Conversion tab
  conversionTab: number
  setConversionTab: (tab: number) => void

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

      section: 'conversion',
      setSection: (section) => set({ section }),

      conversionTab: 0,
      setConversionTab: (tab) => set({ conversionTab: tab }),

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
    }),
    {
      name: 'clarity-studio-store',
      partialize: (state) => ({
        user: state.user,
        activeProject: state.activeProject,
        themeMode: state.themeMode,
        section: state.section,
      }),
    },
  ),
)
