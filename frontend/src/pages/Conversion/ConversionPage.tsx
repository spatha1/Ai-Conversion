import { Box, Tabs, Tab, Paper } from '@mui/material'
import {
  CloudUploadOutlined, AccountTreeOutlined, AccountBalanceOutlined,
  OutputOutlined, VerifiedOutlined,
} from '@mui/icons-material'
import { useAppStore } from '@/store/useAppStore'
import SourceTab from './tabs/SourceTab'
import TargetTab from './tabs/TargetTab'
import MappingTab from './tabs/MappingTab'
import OutputTab from './tabs/OutputTab'
import ValidationTab from './tabs/ValidationTab'

const TABS = [
  { label: 'Source', icon: <CloudUploadOutlined />, desc: 'Connect data source' },
  { label: 'Target', icon: <AccountTreeOutlined />, desc: 'Upload XML template' },
  { label: 'Mapping', icon: <AccountBalanceOutlined />, desc: 'Map fields' },
  { label: 'Output', icon: <OutputOutlined />, desc: 'Generate & export XML' },
  { label: 'Validation', icon: <VerifiedOutlined />, desc: 'XSD validation rules' },
]

export default function ConversionPage() {
  const { conversionTab: tab, setConversionTab: setTab } = useAppStore()

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: 1, borderColor: 'divider',
          bgcolor: 'background.paper',
          px: 3,
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTab-root': {
              minHeight: 56,
              gap: 0.75,
            },
          }}
        >
          {TABS.map((t, i) => (
            <Tab
              key={i}
              icon={t.icon}
              iconPosition="start"
              label={t.label}
              sx={{ textTransform: 'none', fontWeight: tab === i ? 700 : 400 }}
            />
          ))}
        </Tabs>
      </Paper>

      {/* Tab content */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tab === 0 && <SourceTab />}
        {tab === 1 && <TargetTab />}
        {tab === 2 && <MappingTab />}
        {tab === 3 && <OutputTab />}
        {tab === 4 && <ValidationTab />}
      </Box>
    </Box>
  )
}
