import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from vision import ean13_with_check

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
IMAGE_DIR = DATA_DIR / "images"
DB_PATH = DATA_DIR / "smartom.db"

_CATALOG_SEED = [
    {
        "barcode_body": "460123400001",
        "name": "Куртка зимняя мужская",
        "category": "Одежда",
        "color": "чёрный",
        "size": "L",
        "material": "полиэстер",
        "price": 3519,
        "description": "Тёплая куртка с капюшоном для зимы",
    },
    {
        "barcode_body": "460123400002",
        "name": "Кроссовки беговые",
        "category": "Обувь",
        "color": "белый",
        "size": "42",
        "material": "текстиль",
        "price": 7290,
        "description": "Лёгкие кроссовки для зала и улицы",
    },
    {
        "barcode_body": "460123400003",
        "name": "Кружка керамическая",
        "category": "Посуда",
        "color": "белый",
        "size": "350 мл",
        "material": "керамика",
        "price": 390,
        "description": "Кружка для чая и кофе",
    },
    {
        "barcode_body": "460123400004",
        "name": "Рюкзак городской",
        "category": "Аксессуары",
        "color": "синий",
        "size": "один размер",
        "material": "нейлон",
        "price": 2190,
        "description": "Рюкзак на каждый день",
    },
    {
        "barcode_body": "460123400005",
        "name": "Футболка хлопковая",
        "category": "Одежда",
        "color": "красный",
        "size": "M",
        "material": "хлопок",
        "price": 990,
        "description": "Базовая футболка",
    },
]


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    IMAGE_DIR.mkdir(exist_ok=True)
    with _connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS catalog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '',
                size TEXT NOT NULL DEFAULT '',
                material TEXT NOT NULL DEFAULT '',
                barcode TEXT UNIQUE,
                price REAL,
                description TEXT NOT NULL DEFAULT ''
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS intakes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                catalog_id INTEGER,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '',
                size TEXT NOT NULL DEFAULT '',
                material TEXT NOT NULL DEFAULT '',
                weight_grams INTEGER NOT NULL DEFAULT 0,
                barcode TEXT NOT NULL DEFAULT '',
                price REAL,
                description TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0,
                match_type TEXT NOT NULL DEFAULT 'none',
                image_file TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        count = connection.execute("SELECT COUNT(*) AS total FROM catalog").fetchone()["total"]
        if count == 0:
            for item in _CATALOG_SEED:
                connection.execute(
                    """
                    INSERT INTO catalog
                        (name, category, color, size, material, barcode, price, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["name"],
                        item["category"],
                        item["color"],
                        item["size"],
                        item["material"],
                        ean13_with_check(item["barcode_body"]),
                        item["price"],
                        item["description"],
                    ),
                )


def _as_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return dict(row)


def list_catalog() -> list[dict]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM catalog ORDER BY name COLLATE NOCASE"
        ).fetchall()
    return [dict(row) for row in rows]


def get_catalog_item(item_id: int) -> dict | None:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM catalog WHERE id = ?", (item_id,)).fetchone()
    return _as_dict(row)


def find_catalog_by_barcode(barcode: str) -> dict | None:
    cleaned = "".join(char for char in barcode if char.isdigit())
    if not cleaned:
        return None
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM catalog WHERE barcode = ?", (cleaned,)
        ).fetchone()
    return _as_dict(row)


def find_catalog_by_color(color: str) -> list[dict]:
    if not color:
        return []
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM catalog WHERE color = ? ORDER BY name COLLATE NOCASE",
            (color,),
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_catalog(card: dict) -> int | None:
    barcode = "".join(char for char in str(card.get("barcode") or "") if char.isdigit())
    existing = find_catalog_by_barcode(barcode) if barcode else None
    with _connect() as connection:
        if existing:
            connection.execute(
                """
                UPDATE catalog
                SET name = ?, category = ?, color = ?, size = ?, material = ?,
                    price = ?, description = ?
                WHERE id = ?
                """,
                (
                    card.get("name") or existing["name"],
                    card.get("category") or "",
                    card.get("color") or "",
                    card.get("size") or "",
                    card.get("material") or "",
                    card.get("price"),
                    card.get("description") or "",
                    existing["id"],
                ),
            )
            return existing["id"]
        if not card.get("name"):
            return None
        cursor = connection.execute(
            """
            INSERT INTO catalog
                (name, category, color, size, material, barcode, price, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card["name"],
                card.get("category") or "",
                card.get("color") or "",
                card.get("size") or "",
                card.get("material") or "",
                barcode or None,
                card.get("price"),
                card.get("description") or "",
            ),
        )
        return int(cursor.lastrowid)


def add_intake(card: dict, image_file: str = "") -> dict:
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _connect() as connection:
        cursor = connection.execute(
            """
            INSERT INTO intakes (
                catalog_id, name, category, color, size, material, weight_grams,
                barcode, price, description, confidence, match_type, image_file, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card.get("catalog_id"),
                card["name"],
                card.get("category") or "",
                card.get("color") or "",
                card.get("size") or "",
                card.get("material") or "",
                int(card.get("weight_grams") or 0),
                card.get("barcode") or "",
                card.get("price"),
                card.get("description") or "",
                float(card.get("confidence") or 0),
                card.get("match_type") or "none",
                image_file,
                created_at,
            ),
        )
        row = connection.execute(
            "SELECT * FROM intakes WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return dict(row)


def update_intake(intake_id: int, card: dict, image_file: str | None = None) -> dict | None:
    with _connect() as connection:
        current = connection.execute(
            "SELECT * FROM intakes WHERE id = ?", (intake_id,)
        ).fetchone()
        if current is None:
            return None
        connection.execute(
            """
            UPDATE intakes
            SET catalog_id = ?, name = ?, category = ?, color = ?, size = ?,
                material = ?, weight_grams = ?, barcode = ?, price = ?,
                description = ?, confidence = ?, match_type = ?, image_file = ?
            WHERE id = ?
            """,
            (
                card.get("catalog_id"),
                card["name"],
                card.get("category") or "",
                card.get("color") or "",
                card.get("size") or "",
                card.get("material") or "",
                int(card.get("weight_grams") or 0),
                card.get("barcode") or "",
                card.get("price"),
                card.get("description") or "",
                float(card.get("confidence") or 0),
                card.get("match_type") or "manual",
                image_file if image_file is not None else current["image_file"],
                intake_id,
            ),
        )
        row = connection.execute("SELECT * FROM intakes WHERE id = ?", (intake_id,)).fetchone()
    return dict(row)


def list_intakes() -> list[dict]:
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM intakes ORDER BY id DESC"
        ).fetchall()
    return [dict(row) for row in rows]
