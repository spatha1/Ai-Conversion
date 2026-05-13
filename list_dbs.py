import pyodbc
conn = pyodbc.connect(
    r"DRIVER={ODBC Driver 17 for SQL Server};SERVER=DESKTOP-G01PH8C\SQLEXPRESS;Trusted_Connection=yes;DATABASE=master;"
)
cur = conn.cursor()
cur.execute("SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb') ORDER BY name")
for r in cur.fetchall():
    print(r[0])
conn.close()
