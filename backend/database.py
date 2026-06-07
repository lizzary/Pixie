import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gallery.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            cover_illustration_id INTEGER,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS illustrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_filename TEXT NOT NULL,
            file_size INTEGER NOT NULL DEFAULT 0,
            width INTEGER,
            height INTEGER,
            mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
            tags TEXT NOT NULL DEFAULT '',
            extended_data TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS illustrations_fts USING fts5(
            tags,
            content='illustrations',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS illustrations_ai AFTER INSERT ON illustrations BEGIN
            INSERT INTO illustrations_fts(rowid, tags) VALUES (new.id, new.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS illustrations_ad AFTER DELETE ON illustrations BEGIN
            INSERT INTO illustrations_fts(illustrations_fts, rowid, tags) VALUES('delete', old.id, old.tags);
        END;

        CREATE TRIGGER IF NOT EXISTS illustrations_au AFTER UPDATE ON illustrations BEGIN
            INSERT INTO illustrations_fts(illustrations_fts, rowid, tags) VALUES('delete', old.id, old.tags);
            INSERT INTO illustrations_fts(rowid, tags) VALUES (new.id, new.tags);
        END;

        CREATE INDEX IF NOT EXISTS idx_illustrations_group_id
            ON illustrations(group_id);
    """)
    conn.commit()
    conn.close()
