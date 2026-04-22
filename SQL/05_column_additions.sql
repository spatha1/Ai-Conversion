-- ============================================================
-- 05_column_additions.sql
-- ConversionAgent — ALTER TABLE: add columns to existing tables
-- Safe to re-run: every ALTER is guarded with IF NOT EXISTS.
-- ============================================================

USE [ConversionAgent];
GO

-- ── conversion_xml_templates ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_xml_templates' AND COLUMN_NAME = 'conn_id')
BEGIN ALTER TABLE conversion_xml_templates ADD conn_id INT NULL; PRINT '  Added conversion_xml_templates.conn_id'; END
ELSE PRINT '  conversion_xml_templates.conn_id already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_xml_templates' AND COLUMN_NAME = 'format_type')
BEGIN ALTER TABLE conversion_xml_templates ADD format_type NVARCHAR(20) NULL DEFAULT 'xml'; PRINT '  Added conversion_xml_templates.format_type'; END
ELSE PRINT '  conversion_xml_templates.format_type already exists';
GO

-- ── conversion_mappings ───────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_mappings' AND COLUMN_NAME = 'conn_id')
BEGIN ALTER TABLE conversion_mappings ADD conn_id INT NULL; PRINT '  Added conversion_mappings.conn_id'; END
ELSE PRINT '  conversion_mappings.conn_id already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_mappings' AND COLUMN_NAME = 'identifier_column')
BEGIN ALTER TABLE conversion_mappings ADD identifier_column NVARCHAR(255) NULL; PRINT '  Added conversion_mappings.identifier_column'; END
ELSE PRINT '  conversion_mappings.identifier_column already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_mappings' AND COLUMN_NAME = 'identifier_table')
BEGIN ALTER TABLE conversion_mappings ADD identifier_table NVARCHAR(255) NULL; PRINT '  Added conversion_mappings.identifier_table'; END
ELSE PRINT '  conversion_mappings.identifier_table already exists';
GO

-- ── conversion_mapping_rows ───────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_mapping_rows' AND COLUMN_NAME = 'confidence')
BEGIN ALTER TABLE conversion_mapping_rows ADD confidence INT NULL; PRINT '  Added conversion_mapping_rows.confidence'; END
ELSE PRINT '  conversion_mapping_rows.confidence already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_mapping_rows' AND COLUMN_NAME = 'transform_expression')
BEGIN ALTER TABLE conversion_mapping_rows ADD transform_expression NVARCHAR(MAX) NULL; PRINT '  Added conversion_mapping_rows.transform_expression'; END
ELSE PRINT '  conversion_mapping_rows.transform_expression already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_mapping_rows' AND COLUMN_NAME = 'transform_sql')
BEGIN ALTER TABLE conversion_mapping_rows ADD transform_sql NVARCHAR(MAX) NULL; PRINT '  Added conversion_mapping_rows.transform_sql'; END
ELSE PRINT '  conversion_mapping_rows.transform_sql already exists';
GO

-- ── conversion_external_integrations ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_external_integrations' AND COLUMN_NAME = 'project_id')
BEGIN ALTER TABLE conversion_external_integrations ADD project_id INT NULL; PRINT '  Added conversion_external_integrations.project_id'; END
ELSE PRINT '  conversion_external_integrations.project_id already exists';
GO

-- ── conversion_generated_xml ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_generated_xml' AND COLUMN_NAME = 'validation_status')
BEGIN ALTER TABLE conversion_generated_xml ADD validation_status NVARCHAR(20) NULL; PRINT '  Added conversion_generated_xml.validation_status'; END
ELSE PRINT '  conversion_generated_xml.validation_status already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_generated_xml' AND COLUMN_NAME = 'validation_comment')
BEGIN ALTER TABLE conversion_generated_xml ADD validation_comment NVARCHAR(MAX) NULL; PRINT '  Added conversion_generated_xml.validation_comment'; END
ELSE PRINT '  conversion_generated_xml.validation_comment already exists';
GO

-- ── conversion_schema_metadata ────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_schema_metadata' AND COLUMN_NAME = 'business_context')
BEGIN ALTER TABLE conversion_schema_metadata ADD business_context NVARCHAR(MAX) NULL; PRINT '  Added conversion_schema_metadata.business_context'; END
ELSE PRINT '  conversion_schema_metadata.business_context already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_schema_metadata' AND COLUMN_NAME = 'synonyms')
BEGIN ALTER TABLE conversion_schema_metadata ADD synonyms NVARCHAR(MAX) NULL; PRINT '  Added conversion_schema_metadata.synonyms'; END
ELSE PRINT '  conversion_schema_metadata.synonyms already exists';
GO

-- ── conversion_dashboard_configs ──────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_dashboard_configs' AND COLUMN_NAME = 'debug_json')
BEGIN ALTER TABLE conversion_dashboard_configs ADD debug_json NVARCHAR(MAX) NULL; PRINT '  Added conversion_dashboard_configs.debug_json'; END
ELSE PRINT '  conversion_dashboard_configs.debug_json already exists';
GO

-- ── conversion_ps_api_collection ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ps_api_collection' AND COLUMN_NAME = 'required_fields')
BEGIN ALTER TABLE conversion_ps_api_collection ADD required_fields NVARCHAR(MAX) NULL; PRINT '  Added conversion_ps_api_collection.required_fields'; END
ELSE PRINT '  conversion_ps_api_collection.required_fields already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ps_api_collection' AND COLUMN_NAME = 'conn_id')
BEGIN ALTER TABLE conversion_ps_api_collection ADD conn_id INT NULL; PRINT '  Added conversion_ps_api_collection.conn_id'; END
ELSE PRINT '  conversion_ps_api_collection.conn_id already exists';
GO

-- ── conversion_api_dispatch_configs ──────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'dispatch_type')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD dispatch_type NVARCHAR(20) NULL DEFAULT 'api'; PRINT '  Added conversion_api_dispatch_configs.dispatch_type'; END
ELSE PRINT '  conversion_api_dispatch_configs.dispatch_type already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'sftp_host')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD sftp_host NVARCHAR(500) NULL; PRINT '  Added conversion_api_dispatch_configs.sftp_host'; END
ELSE PRINT '  conversion_api_dispatch_configs.sftp_host already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'sftp_port')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD sftp_port INT NULL DEFAULT 22; PRINT '  Added conversion_api_dispatch_configs.sftp_port'; END
ELSE PRINT '  conversion_api_dispatch_configs.sftp_port already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'sftp_username')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD sftp_username NVARCHAR(200) NULL; PRINT '  Added conversion_api_dispatch_configs.sftp_username'; END
ELSE PRINT '  conversion_api_dispatch_configs.sftp_username already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'sftp_password_enc')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD sftp_password_enc NVARCHAR(MAX) NULL; PRINT '  Added conversion_api_dispatch_configs.sftp_password_enc'; END
ELSE PRINT '  conversion_api_dispatch_configs.sftp_password_enc already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'sftp_remote_path')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD sftp_remote_path NVARCHAR(2000) NULL; PRINT '  Added conversion_api_dispatch_configs.sftp_remote_path'; END
ELSE PRINT '  conversion_api_dispatch_configs.sftp_remote_path already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'azure_conn_str_enc')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD azure_conn_str_enc NVARCHAR(MAX) NULL; PRINT '  Added conversion_api_dispatch_configs.azure_conn_str_enc'; END
ELSE PRINT '  conversion_api_dispatch_configs.azure_conn_str_enc already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'azure_container')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD azure_container NVARCHAR(500) NULL; PRINT '  Added conversion_api_dispatch_configs.azure_container'; END
ELSE PRINT '  conversion_api_dispatch_configs.azure_container already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_api_dispatch_configs' AND COLUMN_NAME = 'azure_blob_prefix')
BEGIN ALTER TABLE conversion_api_dispatch_configs ADD azure_blob_prefix NVARCHAR(1000) NULL; PRINT '  Added conversion_api_dispatch_configs.azure_blob_prefix'; END
ELSE PRINT '  conversion_api_dispatch_configs.azure_blob_prefix already exists';
GO

-- ── conversion_prompt_templates ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_prompt_templates' AND COLUMN_NAME = 'example_output')
BEGIN ALTER TABLE conversion_prompt_templates ADD example_output NVARCHAR(MAX) NULL; PRINT '  Added conversion_prompt_templates.example_output'; END
ELSE PRINT '  conversion_prompt_templates.example_output already exists';
GO

-- ── conversion_ai_agents ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_agents' AND COLUMN_NAME = 'category')
BEGIN ALTER TABLE conversion_ai_agents ADD category NVARCHAR(100) NULL; PRINT '  Added conversion_ai_agents.category'; END
ELSE PRINT '  conversion_ai_agents.category already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_agents' AND COLUMN_NAME = 'role_id')
BEGIN ALTER TABLE conversion_ai_agents ADD role_id INT NULL; PRINT '  Added conversion_ai_agents.role_id'; END
ELSE PRINT '  conversion_ai_agents.role_id already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_agents' AND COLUMN_NAME = 'input_schema')
BEGIN ALTER TABLE conversion_ai_agents ADD input_schema NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_agents.input_schema'; END
ELSE PRINT '  conversion_ai_agents.input_schema already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_agents' AND COLUMN_NAME = 'output_schema')
BEGIN ALTER TABLE conversion_ai_agents ADD output_schema NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_agents.output_schema'; END
ELSE PRINT '  conversion_ai_agents.output_schema already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_agents' AND COLUMN_NAME = 'tools_json')
BEGIN ALTER TABLE conversion_ai_agents ADD tools_json NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_agents.tools_json'; END
ELSE PRINT '  conversion_ai_agents.tools_json already exists';
GO

-- ── conversion_agent_cards ────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_agent_cards' AND COLUMN_NAME = 'on_reject_card_id')
BEGIN ALTER TABLE conversion_agent_cards ADD on_reject_card_id INT NULL; PRINT '  Added conversion_agent_cards.on_reject_card_id'; END
ELSE PRINT '  conversion_agent_cards.on_reject_card_id already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_agent_cards' AND COLUMN_NAME = 'max_iterations')
BEGIN ALTER TABLE conversion_agent_cards ADD max_iterations INT NOT NULL DEFAULT 3; PRINT '  Added conversion_agent_cards.max_iterations'; END
ELSE PRINT '  conversion_agent_cards.max_iterations already exists';
GO

-- ── conversion_workflow_execution_steps ───────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_execution_steps' AND COLUMN_NAME = 'card_id')
BEGIN ALTER TABLE conversion_workflow_execution_steps ADD card_id INT NULL; PRINT '  Added conversion_workflow_execution_steps.card_id'; END
ELSE PRINT '  conversion_workflow_execution_steps.card_id already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_execution_steps' AND COLUMN_NAME = 'iteration')
BEGIN ALTER TABLE conversion_workflow_execution_steps ADD iteration INT NOT NULL DEFAULT 1; PRINT '  Added conversion_workflow_execution_steps.iteration'; END
ELSE PRINT '  conversion_workflow_execution_steps.iteration already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_execution_steps' AND COLUMN_NAME = 'decision')
BEGIN ALTER TABLE conversion_workflow_execution_steps ADD decision NVARCHAR(20) NULL; PRINT '  Added conversion_workflow_execution_steps.decision'; END
ELSE PRINT '  conversion_workflow_execution_steps.decision already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_execution_steps' AND COLUMN_NAME = 'decision_notes')
BEGIN ALTER TABLE conversion_workflow_execution_steps ADD decision_notes NVARCHAR(MAX) NULL; PRINT '  Added conversion_workflow_execution_steps.decision_notes'; END
ELSE PRINT '  conversion_workflow_execution_steps.decision_notes already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_execution_steps' AND COLUMN_NAME = 'approval_request_id')
BEGIN ALTER TABLE conversion_workflow_execution_steps ADD approval_request_id INT NULL; PRINT '  Added conversion_workflow_execution_steps.approval_request_id'; END
ELSE PRINT '  conversion_workflow_execution_steps.approval_request_id already exists';
GO

-- ── conversion_workflow_executions ────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_executions' AND COLUMN_NAME = 'hitl_required')
BEGIN ALTER TABLE conversion_workflow_executions ADD hitl_required BIT NOT NULL DEFAULT 1; PRINT '  Added conversion_workflow_executions.hitl_required'; END
ELSE PRINT '  conversion_workflow_executions.hitl_required already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_executions' AND COLUMN_NAME = 'human_approved_at')
BEGIN ALTER TABLE conversion_workflow_executions ADD human_approved_at DATETIME2 NULL; PRINT '  Added conversion_workflow_executions.human_approved_at'; END
ELSE PRINT '  conversion_workflow_executions.human_approved_at already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_executions' AND COLUMN_NAME = 'human_approved_by')
BEGIN ALTER TABLE conversion_workflow_executions ADD human_approved_by NVARCHAR(200) NULL; PRINT '  Added conversion_workflow_executions.human_approved_by'; END
ELSE PRINT '  conversion_workflow_executions.human_approved_by already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_executions' AND COLUMN_NAME = 'human_rejection_reason')
BEGIN ALTER TABLE conversion_workflow_executions ADD human_rejection_reason NVARCHAR(MAX) NULL; PRINT '  Added conversion_workflow_executions.human_rejection_reason'; END
ELSE PRINT '  conversion_workflow_executions.human_rejection_reason already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_executions' AND COLUMN_NAME = 'project_id')
BEGIN ALTER TABLE conversion_workflow_executions ADD project_id INT NULL; PRINT '  Added conversion_workflow_executions.project_id'; END
ELSE PRINT '  conversion_workflow_executions.project_id already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_executions' AND COLUMN_NAME = 'paused_card_id')
BEGIN ALTER TABLE conversion_workflow_executions ADD paused_card_id INT NULL; PRINT '  Added conversion_workflow_executions.paused_card_id'; END
ELSE PRINT '  conversion_workflow_executions.paused_card_id already exists';
GO

-- ── conversion_ai_trace_log ───────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_trace_log' AND COLUMN_NAME = 'sql_executed')
BEGIN ALTER TABLE conversion_ai_trace_log ADD sql_executed NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_trace_log.sql_executed'; END
ELSE PRINT '  conversion_ai_trace_log.sql_executed already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_trace_log' AND COLUMN_NAME = 'row_count_returned')
BEGIN ALTER TABLE conversion_ai_trace_log ADD row_count_returned INT NULL; PRINT '  Added conversion_ai_trace_log.row_count_returned'; END
ELSE PRINT '  conversion_ai_trace_log.row_count_returned already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_trace_log' AND COLUMN_NAME = 'schema_snapshot')
BEGIN ALTER TABLE conversion_ai_trace_log ADD schema_snapshot NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_trace_log.schema_snapshot'; END
ELSE PRINT '  conversion_ai_trace_log.schema_snapshot already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_trace_log' AND COLUMN_NAME = 'export_action')
BEGIN ALTER TABLE conversion_ai_trace_log ADD export_action NVARCHAR(50) NULL; PRINT '  Added conversion_ai_trace_log.export_action'; END
ELSE PRINT '  conversion_ai_trace_log.export_action already exists';
GO

-- ── conversion_approval_requests ──────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_approval_requests' AND COLUMN_NAME = 'context_payload')
BEGIN ALTER TABLE conversion_approval_requests ADD context_payload NVARCHAR(MAX) NULL; PRINT '  Added conversion_approval_requests.context_payload'; END
ELSE PRINT '  conversion_approval_requests.context_payload already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_approval_requests' AND COLUMN_NAME = 'sql_hash')
BEGIN ALTER TABLE conversion_approval_requests ADD sql_hash NVARCHAR(64) NULL; PRINT '  Added conversion_approval_requests.sql_hash'; END
ELSE PRINT '  conversion_approval_requests.sql_hash already exists';
GO

-- ── conversion_approval_workflows ─────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_approval_workflows' AND COLUMN_NAME = 'quorum_type')
BEGIN ALTER TABLE conversion_approval_workflows ADD quorum_type NVARCHAR(20) NULL DEFAULT 'any_one'; PRINT '  Added conversion_approval_workflows.quorum_type'; END
ELSE PRINT '  conversion_approval_workflows.quorum_type already exists';
GO

-- ── conversion_ai_test_cases ──────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_cases' AND COLUMN_NAME = 'group_name')
BEGIN ALTER TABLE conversion_ai_test_cases ADD group_name NVARCHAR(200) NULL; PRINT '  Added conversion_ai_test_cases.group_name'; END
ELSE PRINT '  conversion_ai_test_cases.group_name already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_cases' AND COLUMN_NAME = 'schedule_cron')
BEGIN ALTER TABLE conversion_ai_test_cases ADD schedule_cron NVARCHAR(100) NULL; PRINT '  Added conversion_ai_test_cases.schedule_cron'; END
ELSE PRINT '  conversion_ai_test_cases.schedule_cron already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_cases' AND COLUMN_NAME = 'identifier_column')
BEGIN ALTER TABLE conversion_ai_test_cases ADD identifier_column NVARCHAR(500) NULL; PRINT '  Added conversion_ai_test_cases.identifier_column'; END
ELSE PRINT '  conversion_ai_test_cases.identifier_column already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_cases' AND COLUMN_NAME = 'reconciliation_type')
BEGIN ALTER TABLE conversion_ai_test_cases ADD reconciliation_type NVARCHAR(50) NULL; PRINT '  Added conversion_ai_test_cases.reconciliation_type'; END
ELSE PRINT '  conversion_ai_test_cases.reconciliation_type already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_cases' AND COLUMN_NAME = 'columns_to_compare')
BEGIN ALTER TABLE conversion_ai_test_cases ADD columns_to_compare NVARCHAR(2000) NULL; PRINT '  Added conversion_ai_test_cases.columns_to_compare'; END
ELSE PRINT '  conversion_ai_test_cases.columns_to_compare already exists';
GO

-- ── conversion_ai_test_results ────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_results' AND COLUMN_NAME = 'mismatch_count')
BEGIN ALTER TABLE conversion_ai_test_results ADD mismatch_count INT NULL; PRINT '  Added conversion_ai_test_results.mismatch_count'; END
ELSE PRINT '  conversion_ai_test_results.mismatch_count already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_results' AND COLUMN_NAME = 'missing_source_count')
BEGIN ALTER TABLE conversion_ai_test_results ADD missing_source_count INT NULL; PRINT '  Added conversion_ai_test_results.missing_source_count'; END
ELSE PRINT '  conversion_ai_test_results.missing_source_count already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_results' AND COLUMN_NAME = 'missing_target_count')
BEGIN ALTER TABLE conversion_ai_test_results ADD missing_target_count INT NULL; PRINT '  Added conversion_ai_test_results.missing_target_count'; END
ELSE PRINT '  conversion_ai_test_results.missing_target_count already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_results' AND COLUMN_NAME = 'sample_mismatches')
BEGIN ALTER TABLE conversion_ai_test_results ADD sample_mismatches NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_test_results.sample_mismatches'; END
ELSE PRINT '  conversion_ai_test_results.sample_mismatches already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_results' AND COLUMN_NAME = 'sample_missing_source')
BEGIN ALTER TABLE conversion_ai_test_results ADD sample_missing_source NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_test_results.sample_missing_source'; END
ELSE PRINT '  conversion_ai_test_results.sample_missing_source already exists';
GO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ai_test_results' AND COLUMN_NAME = 'sample_missing_target')
BEGIN ALTER TABLE conversion_ai_test_results ADD sample_missing_target NVARCHAR(MAX) NULL; PRINT '  Added conversion_ai_test_results.sample_missing_target'; END
ELSE PRINT '  conversion_ai_test_results.sample_missing_target already exists';
GO

-- ── conversion_pipeline_schedules ────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_pipeline_schedules' AND COLUMN_NAME = 'skip_mapping')
BEGIN ALTER TABLE conversion_pipeline_schedules ADD skip_mapping BIT NOT NULL DEFAULT 0; PRINT '  Added conversion_pipeline_schedules.skip_mapping'; END
ELSE PRINT '  conversion_pipeline_schedules.skip_mapping already exists';
GO

-- ── conversion_saved_agentic_workflows ────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_saved_agentic_workflows' AND COLUMN_NAME = 'schedule_label')
BEGIN ALTER TABLE conversion_saved_agentic_workflows ADD schedule_label NVARCHAR(50) NULL; PRINT '  Added conversion_saved_agentic_workflows.schedule_label'; END
ELSE PRINT '  conversion_saved_agentic_workflows.schedule_label already exists';
GO

-- ── conversion_test_queries ───────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_test_queries' AND COLUMN_NAME = 'dev_source_tag')
BEGIN ALTER TABLE conversion_test_queries ADD dev_source_tag NVARCHAR(30) NULL; PRINT '  Added conversion_test_queries.dev_source_tag'; END
ELSE PRINT '  conversion_test_queries.dev_source_tag already exists';
GO

-- ── conversion_ui_validation_templates ───────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_ui_validation_templates' AND COLUMN_NAME = 'response_id_field')
BEGIN ALTER TABLE conversion_ui_validation_templates ADD response_id_field NVARCHAR(500) NULL; PRINT '  Added conversion_ui_validation_templates.response_id_field'; END
ELSE PRINT '  conversion_ui_validation_templates.response_id_field already exists';
GO
