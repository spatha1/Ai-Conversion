"""Unit tests for api/services/dialect_utils.py"""
import pytest
from api.services.dialect_utils import (
    normalize_dialect,
    quote_identifier,
    escape_alias,
    qualified_name,
    column_ref,
    limit_query,
    dialect_label_rules,
)


# ── normalize_dialect ────────────────────────────────────────

class TestNormalizeDialect:
    def test_mssql_aliases(self):
        for alias in ("mssql", "MSSQL", "sqlserver", "sql server", "SQL Server"):
            assert normalize_dialect(alias) == "mssql"

    def test_postgresql_aliases(self):
        for alias in ("postgresql", "postgres", "PostgreSQL"):
            assert normalize_dialect(alias) == "postgresql"

    def test_mysql(self):
        assert normalize_dialect("mysql") == "mysql"
        assert normalize_dialect("MySQL") == "mysql"

    def test_snowflake(self):
        assert normalize_dialect("snowflake") == "snowflake"

    def test_sqlite(self):
        assert normalize_dialect("sqlite") == "sqlite"
        assert normalize_dialect("sqlite3") == "sqlite"

    def test_source_type_wins(self):
        # source_type snowflake overrides dialect field
        assert normalize_dialect("mssql", source_type="snowflake") == "snowflake"
        assert normalize_dialect(None, source_type="snowflake") == "snowflake"

    def test_none_defaults_to_mssql(self):
        assert normalize_dialect(None) == "mssql"
        assert normalize_dialect("") == "mssql"

    def test_unknown_defaults_to_mssql(self):
        assert normalize_dialect("db2") == "mssql"


# ── quote_identifier ────────────────────────────────────────

class TestQuoteIdentifier:
    def test_mssql_brackets(self):
        assert quote_identifier("MyTable", "mssql") == "[MyTable]"

    def test_mysql_backticks(self):
        assert quote_identifier("my_col", "mysql") == "`my_col`"

    def test_postgresql_double_quotes(self):
        assert quote_identifier("My Col", "postgresql") == '"My Col"'

    def test_snowflake_double_quotes(self):
        assert quote_identifier("AMOUNT", "snowflake") == '"AMOUNT"'

    def test_sqlite_double_quotes(self):
        assert quote_identifier("value", "sqlite") == '"value"'

    def test_normalizes_dialect_aliases(self):
        assert quote_identifier("t", "sqlserver") == "[t]"
        assert quote_identifier("t", "postgres") == '"t"'


# ── escape_alias ────────────────────────────────────────────

class TestEscapeAlias:
    def test_mssql_escapes_closing_bracket(self):
        result = escape_alias("/Root/Item]Value", "mssql")
        assert result == "[/Root/Item]]Value]"

    def test_postgresql_escapes_double_quote(self):
        result = escape_alias('/path/"field"', "postgresql")
        assert result == '"/path/""field"""'

    def test_mysql_escapes_backtick(self):
        result = escape_alias("col`name", "mysql")
        assert result == "`col``name`"

    def test_simple_path_mssql(self):
        assert escape_alias("/Root/Field", "mssql") == "[/Root/Field]"

    def test_simple_path_snowflake(self):
        assert escape_alias("/Root/Field", "snowflake") == '"/Root/Field"'


# ── qualified_name ──────────────────────────────────────────

class TestQualifiedName:
    def test_mssql_with_schema(self):
        assert qualified_name("dbo", "Orders", "mssql") == "[dbo].[Orders]"

    def test_mssql_no_schema_defaults_dbo(self):
        assert qualified_name(None, "Orders", "mssql") == "[dbo].[Orders]"

    def test_postgresql_with_schema(self):
        assert qualified_name("public", "orders", "postgresql") == '"public"."orders"'

    def test_postgresql_no_schema(self):
        assert qualified_name(None, "orders", "postgresql") == '"orders"'

    def test_mysql_with_schema(self):
        assert qualified_name("mydb", "orders", "mysql") == "`mydb`.`orders`"

    def test_mysql_no_schema(self):
        assert qualified_name(None, "orders", "mysql") == "`orders`"
        assert qualified_name("", "orders", "mysql") == "`orders`"

    def test_snowflake_with_schema(self):
        assert qualified_name("PUBLIC", "ORDERS", "snowflake") == '"PUBLIC"."ORDERS"'

    def test_snowflake_no_schema(self):
        assert qualified_name(None, "ORDERS", "snowflake") == '"ORDERS"'

    def test_sqlite_no_schema(self):
        assert qualified_name(None, "orders", "sqlite") == '"orders"'


# ── column_ref ──────────────────────────────────────────────

class TestColumnRef:
    def test_mssql_alias_not_quoted(self):
        # alias/table prefix must NOT be quoted — only the column
        result = column_ref("t0", "Amount", "mssql")
        assert result == "t0.[Amount]"

    def test_postgresql(self):
        result = column_ref("t0", "amount", "postgresql")
        assert result == 't0."amount"'

    def test_mysql(self):
        result = column_ref("t0", "amount", "mysql")
        assert result == "t0.`amount`"

    def test_snowflake(self):
        result = column_ref("_src", "AMOUNT", "snowflake")
        assert result == '_src."AMOUNT"'


# ── limit_query ─────────────────────────────────────────────

class TestLimitQuery:
    def test_mssql_outer_wrap(self):
        sql = "SELECT * FROM Orders"
        result = limit_query(sql, 10, "mssql")
        assert result == "SELECT TOP 10 * FROM (SELECT * FROM Orders) AS _src"

    def test_postgresql_limit(self):
        sql = "SELECT * FROM orders"
        result = limit_query(sql, 10, "postgresql")
        assert result == "SELECT * FROM (SELECT * FROM orders) AS _src LIMIT 10"

    def test_mysql_limit(self):
        sql = "SELECT * FROM orders"
        result = limit_query(sql, 5, "mysql")
        assert result == "SELECT * FROM (SELECT * FROM orders) AS _src LIMIT 5"

    def test_snowflake_limit(self):
        sql = "SELECT * FROM ORDERS"
        result = limit_query(sql, 1, "snowflake")
        assert result == "SELECT * FROM (SELECT * FROM ORDERS) AS _src LIMIT 1"

    def test_strips_trailing_semicolon(self):
        sql = "SELECT * FROM orders;"
        result = limit_query(sql, 5, "postgresql")
        assert ";" not in result
        assert "LIMIT 5" in result

    def test_mssql_strips_order_by(self):
        sql = "SELECT * FROM orders ORDER BY id"
        result = limit_query(sql, 10, "mssql")
        assert "ORDER BY" not in result
        assert "TOP 10" in result

    def test_postgresql_preserves_order_by(self):
        # For non-MSSQL dialects ORDER BY is preserved inside the subquery
        sql = "SELECT * FROM orders ORDER BY id"
        result = limit_query(sql, 10, "postgresql")
        assert "ORDER BY id" in result
        assert "LIMIT 10" in result


# ── dialect_label_rules ─────────────────────────────────────

class TestDialectLabelRules:
    def test_mssql_label(self):
        label, rules = dialect_label_rules("mssql")
        assert "SQL Server" in label or "T-SQL" in label
        assert "TOP" in rules

    def test_postgresql_label(self):
        label, rules = dialect_label_rules("postgresql")
        assert "PostgreSQL" in label
        assert "LIMIT" in rules

    def test_mysql_label(self):
        label, rules = dialect_label_rules("mysql")
        assert "MySQL" in label
        assert "LIMIT" in rules

    def test_snowflake_label(self):
        label, rules = dialect_label_rules("snowflake")
        assert "Snowflake" in label
        assert "LIMIT" in rules

    def test_sqlite_label(self):
        label, rules = dialect_label_rules("sqlite")
        assert "SQLite" in label
        assert "LIMIT" in rules

    def test_translate_note_in_all_dialects(self):
        for d in ("mssql", "postgresql", "mysql", "snowflake", "sqlite"):
            _, rules = dialect_label_rules(d)
            assert "translate" in rules.lower() or "dialect" in rules.lower()
