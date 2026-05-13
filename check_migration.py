from api.database import SessionLocal
from sqlalchemy import text
db = SessionLocal()

q1 = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_agent_roles' AND COLUMN_NAME IN ('tools_json','restricted_tools_json','is_ootb','model_override')"
r1 = db.execute(text(q1)).fetchall()
print("AgentRole cols:", [c[0] for c in r1])

q2 = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_executions' AND COLUMN_NAME IN ('shared_memory_json','avg_confidence','estimated_cost_usd','learnings_extracted_json')"
r2 = db.execute(text(q2)).fetchall()
print("WorkflowExecution cols:", [c[0] for c in r2])

q3 = "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'conversion_workflow_execution_steps' AND COLUMN_NAME IN ('confidence_score','risk_json','auto_hitl')"
r3 = db.execute(text(q3)).fetchall()
print("Step cols:", [c[0] for c in r3])

q4 = "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN ('conversion_cost_budgets','conversion_cost_usage','conversion_ops_alerts','conversion_capability_registry')"
r4 = db.execute(text(q4)).fetchall()
print("New tables:", [t[0] for t in r4])

q5 = "SELECT role_name, is_ootb, model_override, tools_json FROM conversion_agent_roles WHERE is_ootb = 1"
r5 = db.execute(text(q5)).fetchall()
print("OOTB roles:", [(r[0], r[1], r[2]) for r in r5])

db.close()
print("ALL OK")
