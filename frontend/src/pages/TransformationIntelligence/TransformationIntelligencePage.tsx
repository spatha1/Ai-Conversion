import { useState } from 'react'
import {
  Box, Typography, Tabs, Tab, Alert, Chip, alpha,
} from '@mui/material'
import {
  DashboardOutlined, LibraryBooksOutlined, BuildOutlined,
  AutoAwesomeOutlined, BiotechOutlined, FactCheckOutlined,
  TableChartOutlined, AccountTreeOutlined, VerifiedOutlined,
  CodeOutlined,
} from '@mui/icons-material'
import { useAppStore } from '@/store/useAppStore'
import { tokens } from '@/theme/theme'

import ExecutiveDashboardTab  from './tabs/ExecutiveDashboardTab'
import RuleRepositoryTab      from './tabs/RuleRepositoryTab'
import RuleBuilderTab         from './tabs/RuleBuilderTab'
import AIDiscoveryTab         from './tabs/AIDiscoveryTab'
import SimulationTab          from './tabs/SimulationTab'
import TestCasesTab           from './tabs/TestCasesTab'
import LookupIntelligenceTab  from './tabs/LookupIntelligenceTab'
import RuleSetsAndPipelinesTab from './tabs/RuleSetsAndPipelinesTab'
import ValidationTab          from './tabs/ValidationTab'
import ExportTab              from './tabs/ExportTab'

const TEAL   = '#0EA5E9'
const PURPLE = '#8B5CF6'

const TABS = [
  { label: 'Executive Dashboard',  icon: <DashboardOutlined />,     color: tokens.navy600   },
  { label: 'Rule Repository',      icon: <LibraryBooksOutlined />,  color: TEAL             },
  { label: 'Rule Builder',         icon: <BuildOutlined />,         color: PURPLE           },
  { label: 'AI Discovery',         icon: <AutoAwesomeOutlined />,   color: TEAL             },
  { label: 'Simulation',           icon: <BiotechOutlined />,       color: tokens.emerald600},
  { label: 'Test Cases',           icon: <FactCheckOutlined />,     color: tokens.emerald600},
  { label: 'Lookup Intelligence',  icon: <TableChartOutlined />,    color: tokens.amber600  },
  { label: 'Rule Sets & Pipelines',icon: <AccountTreeOutlined />,   color: PURPLE           },
  { label: 'Validation',           icon: <VerifiedOutlined />,      color: tokens.red600    },
  { label: 'Export',               icon: <CodeOutlined />,          color: '#64748B'        },
]

export default function TransformationIntelligencePage() {
  const activeConnection = useAppStore((s) => s.activeConnection)
  const connId = activeConnection?.id ?? null

  const [activeTab, setActiveTab]       = useState(0)
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null)

  if (!activeConnection) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info" sx={{ fontSize: '0.85rem' }}>
          No connection selected — pick one from the header bar to use Transformation Intelligence.
        </Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <Box sx={{ px: 3, pt: 2.5, pb: 1.5, borderBottom: 1, borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
        <AutoAwesomeOutlined sx={{ fontSize: 22, color: PURPLE }} />
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
            Transformation Intelligence
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Rule discovery, governance, simulation & export for insurance data conversion
          </Typography>
        </Box>
        <Chip
          label={activeConnection.name}
          size="small"
          sx={{ ml: 'auto', height: 22, fontSize: '0.7rem',
            bgcolor: alpha(TEAL, 0.1), color: TEAL, fontWeight: 600 }}
        />
      </Box>

      {/* Tab bar */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0, bgcolor: 'background.paper' }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 44,
            '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontSize: '0.78rem', py: 0 },
          }}
        >
          {TABS.map((t, i) => (
            <Tab
              key={i}
              icon={
                <Box sx={{ color: activeTab === i ? t.color : 'text.disabled',
                  display: 'flex', alignItems: 'center', fontSize: 16 }}>
                  {t.icon}
                </Box>
              }
              iconPosition="start"
              label={t.label}
              sx={{
                color: activeTab === i ? t.color : 'text.secondary',
                '&.Mui-selected': { color: t.color, fontWeight: 700 },
                gap: 0.5,
                px: 1.5,
              }}
            />
          ))}
        </Tabs>
      </Box>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {activeTab === 0 && (
          <ExecutiveDashboardTab connId={connId} onNavigateTab={setActiveTab} />
        )}
        {activeTab === 1 && (
          <RuleRepositoryTab
            connId={connId}
            selectedRuleId={selectedRuleId}
            onSelectRule={setSelectedRuleId}
            onNavigateTab={setActiveTab}
          />
        )}
        {activeTab === 2 && (
          <RuleBuilderTab connId={connId} />
        )}
        {activeTab === 3 && (
          <AIDiscoveryTab connId={connId} />
        )}
        {activeTab === 4 && (
          <SimulationTab connId={connId} selectedRuleId={selectedRuleId} />
        )}
        {activeTab === 5 && (
          <TestCasesTab connId={connId} selectedRuleId={selectedRuleId} />
        )}
        {activeTab === 6 && (
          <LookupIntelligenceTab connId={connId} />
        )}
        {activeTab === 7 && (
          <RuleSetsAndPipelinesTab connId={connId} />
        )}
        {activeTab === 8 && (
          <ValidationTab connId={connId} selectedRuleId={selectedRuleId} />
        )}
        {activeTab === 9 && (
          <ExportTab connId={connId} />
        )}
      </Box>
    </Box>
  )
}
