import os
import pyodbc
from lxml import etree
from collections import defaultdict
from dotenv import load_dotenv

# -------------------------------------------------
# Load environment variables
# -------------------------------------------------
load_dotenv()

DB_SERVER = os.getenv("DB_SERVER")
DB_NAME = os.getenv("DB_NAME")
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_DRIVER = os.getenv("DB_DRIVER")


# -------------------------------------------------
# SQL Server connection
# -------------------------------------------------
def get_sql_server_connection():
    if DB_PASSWORD:
        conn_str = (
            f"DRIVER={{{DB_DRIVER}}};"
            f"SERVER={DB_SERVER};"
            f"DATABASE={DB_NAME};"
            f"UID={DB_USER};"
            f"PWD={DB_PASSWORD};"
        )
    else:
        conn_str = (
            f"DRIVER={{{DB_DRIVER}}};"
            f"SERVER={DB_SERVER};"
            f"DATABASE={DB_NAME};"
            f"UID={DB_USER};"
        )

    return pyodbc.connect(conn_str)


# -------------------------------------------------
# Load XML
# -------------------------------------------------
def load_xml(xml_file):
    try:
        with open(xml_file, "rb") as f:
            return etree.parse(f)
    except FileNotFoundError:
        print(f"Error: File '{xml_file}' not found.")
        raise
    except etree.XMLSyntaxError as e:
        print(f"Error parsing XML: {e}")
        raise


# -------------------------------------------------
# Extract leaf nodes and values
# -------------------------------------------------
def extract_leaf_nodes(xml_tree):
    root = xml_tree.getroot()
    leaf_values = defaultdict(list)

    def walk(node, current_path):
        tag = etree.QName(node).localname
        path = f"{current_path}/{tag}"
        children = list(node)

        if not children:
            leaf_values[path].append(
                (node.text or "").strip()
            )
        else:
            for c in children:
                walk(c, path)

    walk(root, "")
    return leaf_values


# -------------------------------------------------
# Infer group path
# -------------------------------------------------
def infer_group_path(full_path):
    parts = full_path.strip("/").split("/")
    if len(parts) >= 2:
        return f"/{parts[-2]}"
    return None


# -------------------------------------------------
# Build formula rules from XML
# -------------------------------------------------
def build_formula_rules(xml_tree):
    leaf_nodes = extract_leaf_nodes(xml_tree)

    rules = []
    execution_order = 1

    for full_path, values in leaf_nodes.items():
        group_path = infer_group_path(full_path)
        field_name = full_path.strip("/").split("/")[-1]
        target_path = f"{group_path}/{field_name}"

        unique_values = set(v for v in values if v != "")

        if len(unique_values) == 1:
            formula_type = "DEFAULT"
            default_value = list(unique_values)[0]
            expression = None
        else:
            formula_type = "DIRECT"
            default_value = None
            expression = None

        rules.append({
            "target_path": target_path,
            "group_path": group_path,
            "formula_type": formula_type,
            "expression": expression,
            "default_value": default_value,
            "execution_order": execution_order
        })

        execution_order += 1

    return rules


# -------------------------------------------------
# Insert rules into TARGET_FORMULA_RULES table
# -------------------------------------------------
def insert_formula_rules(conn, rules):
    cursor = conn.cursor()

    insert_sql = """
    INSERT INTO dbo.TARGET_FORMULA_RULES
    (
        target_path,
        group_path,
        formula_type,
        expression,
        default_value,
        execution_order
    )
    VALUES (?, ?, ?, ?, ?, ?)
    """

    for r in rules:
        cursor.execute(
            insert_sql,
            r["target_path"],
            r["group_path"],
            r["formula_type"],
            r["expression"],
            r["default_value"],
            r["execution_order"]
        )

    conn.commit()
    print(f"Inserted {len(rules)} rules into TARGET_FORMULA_RULES")


# -------------------------------------------------
# Main runner
# -------------------------------------------------
def main():
    xml_file = r"C:\POC\Conversion-Agent\SourceData\payload.xml"

    print("Loading XML...")
    xml_tree = load_xml(xml_file)

    print("Building formula rules from target XML...")
    rules = build_formula_rules(xml_tree)

    print(f"Discovered {len(rules)} target formula rules")

    print("Connecting to SQL Server...")
    conn = get_sql_server_connection()

    print("Inserting formula rules...")
    insert_formula_rules(conn, rules)

    conn.close()
    print("SUCCESS: Formula rules inserted.")


# -------------------------------------------------
# Entry point
# -------------------------------------------------
if __name__ == "__main__":
    main()