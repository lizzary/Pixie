import os
import json
import shutil
from contextlib import asynccontextmanager
from io import BytesIO
from typing import Optional, AsyncGenerator

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from database import get_db, init_db
from models import (
    ArtistCreate, ArtistUpdate, ArtistResponse,
    IllustrationResponse, IllustrationUpdate,
    SearchResult,
)
from utils import extract_extended_data, extract_tags, create_thumbnail, get_image_info

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    init_db()
    yield


app = FastAPI(title="Gallery API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── helpers ─────────────────────────────────────────────

def _artist_upload_dir(artist_id: int) -> str:
    p = os.path.join(UPLOADS_DIR, str(artist_id))
    os.makedirs(os.path.join(p, "originals"), exist_ok=True)
    os.makedirs(os.path.join(p, "thumbnails"), exist_ok=True)
    return p


def _build_cover_url(cover_id: Optional[int]) -> Optional[str]:
    if cover_id is None:
        return None
    return f"/api/illustrations/{cover_id}/thumbnail"


def _row_to_artist(row) -> ArtistResponse:
    return ArtistResponse(
        id=row["id"],
        name=row["name"],
        cover_illustration_id=row["cover_illustration_id"],
        cover_thumbnail_url=_build_cover_url(row["cover_illustration_id"]),
        illustration_count=row["illustration_count"],
        created_at=row["created_at"],
    )


def _row_to_illustration(row) -> IllustrationResponse:
    iid = row["id"]
    aid = row["artist_id"]
    return IllustrationResponse(
        id=iid,
        artist_id=aid,
        artist_name=row["artist_name"],
        filename=row["filename"],
        original_filename=row["original_filename"],
        file_size=row["file_size"],
        width=row["width"],
        height=row["height"],
        mime_type=row["mime_type"],
        tags=row["tags"],
        extended_data=json.loads(row["extended_data"]) if row["extended_data"] else None,
        is_ai_generated=bool(row["is_ai_generated"]),
        thumbnail_url=f"/api/illustrations/{iid}/thumbnail",
        file_url=f"/api/illustrations/{iid}/file",
        created_at=row["created_at"],
    )


# ── Artist routes ───────────────────────────────────────

@app.get("/api/artists", response_model=list[ArtistResponse])
def list_artists():
    conn = get_db()
    rows = conn.execute("""
        SELECT a.*, COUNT(i.id) AS illustration_count
        FROM artists a
        LEFT JOIN illustrations i ON a.id = i.artist_id
        GROUP BY a.id
        ORDER BY a.created_at DESC
    """).fetchall()
    conn.close()
    return [_row_to_artist(r) for r in rows]


@app.post("/api/artists", response_model=ArtistResponse, status_code=201)
def create_artist(body: ArtistCreate):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO artists (name) VALUES (?)",
        (body.name,),
    )
    conn.commit()
    artist_id = cur.lastrowid
    row = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
    conn.close()
    return ArtistResponse(
        id=row["id"],
        name=row["name"],
        cover_illustration_id=None,
        cover_thumbnail_url=None,
        illustration_count=0,
        created_at=row["created_at"],
    )


@app.get("/api/artists/{artist_id}", response_model=ArtistResponse)
def get_artist(artist_id: int):
    conn = get_db()
    row = conn.execute("""
        SELECT a.*, COUNT(i.id) AS illustration_count
        FROM artists a
        LEFT JOIN illustrations i ON a.id = i.artist_id
        WHERE a.id = ?
        GROUP BY a.id
    """, (artist_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Artist not found")
    return _row_to_artist(row)


@app.put("/api/artists/{artist_id}", response_model=ArtistResponse)
def update_artist(artist_id: int, body: ArtistUpdate):
    conn = get_db()
    artist = conn.execute("SELECT * FROM artists WHERE id = ?", (artist_id,)).fetchone()
    if artist is None:
        conn.close()
        raise HTTPException(404, "Artist not found")

    if body.name is not None:
        conn.execute("UPDATE artists SET name = ? WHERE id = ?", (body.name, artist_id))

    if body.cover_illustration_id is not None:
        ill = conn.execute(
            "SELECT id FROM illustrations WHERE id = ? AND artist_id = ?",
            (body.cover_illustration_id, artist_id),
        ).fetchone()
        if ill is None:
            conn.close()
            raise HTTPException(400, "Cover illustration must belong to this artist")
        conn.execute(
            "UPDATE artists SET cover_illustration_id = ? WHERE id = ?",
            (body.cover_illustration_id, artist_id),
        )

    conn.commit()
    row = conn.execute("""
        SELECT a.*, COUNT(i.id) AS illustration_count
        FROM artists a
        LEFT JOIN illustrations i ON a.id = i.artist_id
        WHERE a.id = ?
        GROUP BY a.id
    """, (artist_id,)).fetchone()
    conn.close()
    return _row_to_artist(row)


@app.delete("/api/artists/{artist_id}", status_code=204)
def delete_artist(artist_id: int):
    conn = get_db()
    artist = conn.execute("SELECT id FROM artists WHERE id = ?", (artist_id,)).fetchone()
    if artist is None:
        conn.close()
        raise HTTPException(404, "Artist not found")

    # Unset cover reference to avoid FK issues, then delete illustrations
    conn.execute("UPDATE artists SET cover_illustration_id = NULL WHERE id = ?", (artist_id,))
    conn.execute("DELETE FROM illustrations WHERE artist_id = ?", (artist_id,))
    conn.execute("DELETE FROM artists WHERE id = ?", (artist_id,))
    conn.commit()
    conn.close()

    # Remove uploaded files
    artist_dir = os.path.join(UPLOADS_DIR, str(artist_id))
    if os.path.isdir(artist_dir):
        shutil.rmtree(artist_dir)


# ── Illustration routes ─────────────────────────────────

@app.get("/api/artists/{artist_id}/illustrations", response_model=list[IllustrationResponse])
def list_illustrations(
    artist_id: int,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    conn = get_db()
    artist = conn.execute("SELECT id, name FROM artists WHERE id = ?", (artist_id,)).fetchone()
    if artist is None:
        conn.close()
        raise HTTPException(404, "Artist not found")

    rows = conn.execute("""
        SELECT i.*, ? AS artist_name
        FROM illustrations i
        WHERE i.artist_id = ?
        ORDER BY i.created_at DESC
        LIMIT ? OFFSET ?
    """, (artist["name"], artist_id, limit, offset)).fetchall()
    conn.close()
    return [_row_to_illustration(r) for r in rows]


@app.post("/api/artists/{artist_id}/illustrations/upload", response_model=list[IllustrationResponse], status_code=201)
def upload_illustrations(
    artist_id: int,
    files: list[UploadFile] = File(...),
    is_ai_generated: bool = Query(False),
):
    conn = get_db()
    artist = conn.execute("SELECT id, name FROM artists WHERE id = ?", (artist_id,)).fetchone()
    if artist is None:
        conn.close()
        raise HTTPException(404, "Artist not found")
    conn.close()

    _artist_upload_dir(artist_id)
    results: list[IllustrationResponse] = []

    for upload in files:
        if upload.filename is None:
            continue
        safe_filename = os.path.basename(upload.filename)

        try:
            contents = upload.file.read()
            image = Image.open(BytesIO(contents))
            image.load()  # force decode so we catch corrupt images early
        except UnidentifiedImageError:
            raise HTTPException(400, f"Cannot identify image: {safe_filename}")
        except Exception:
            raise HTTPException(400, f"Failed to read image: {safe_filename}")

        try:
            tags = extract_tags(image)
            extended_data = extract_extended_data(image)
            width, height, mime_type = get_image_info(image)
            thumb = create_thumbnail(image)

            conn = get_db()
            cur = conn.execute(
                """INSERT INTO illustrations
                   (artist_id, filename, original_filename, file_size, width, height,
                    mime_type, tags, extended_data, is_ai_generated)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    artist_id,
                    "",  # placeholder, set after we know the id
                    safe_filename,
                    len(contents),
                    width,
                    height,
                    mime_type,
                    tags,
                    json.dumps(extended_data, ensure_ascii=False) if extended_data else None,
                    1 if is_ai_generated else 0,
                ),
            )
            ill_id = cur.lastrowid
            disk_filename = f"{ill_id}_{safe_filename}"

            conn.execute(
                "UPDATE illustrations SET filename = ? WHERE id = ?",
                (disk_filename, ill_id),
            )
            conn.commit()

            row = conn.execute(
                "SELECT i.*, ? AS artist_name FROM illustrations i WHERE i.id = ?",
                (artist["name"], ill_id),
            ).fetchone()
            conn.close()

            # Write files to disk
            originals_dir = os.path.join(UPLOADS_DIR, str(artist_id), "originals")
            thumbnails_dir = os.path.join(UPLOADS_DIR, str(artist_id), "thumbnails")

            image.save(os.path.join(originals_dir, disk_filename))
            thumb.save(os.path.join(thumbnails_dir, disk_filename), format="JPEG")

            results.append(_row_to_illustration(row))

        except HTTPException:
            raise
        except Exception as exc:
            # Clean up partial state on unexpected error
            raise HTTPException(500, f"Failed to process {safe_filename}: {exc}")

    return results


@app.get("/api/illustrations/{illustration_id}", response_model=IllustrationResponse)
def get_illustration(illustration_id: int):
    conn = get_db()
    row = conn.execute("""
        SELECT i.*, a.name AS artist_name
        FROM illustrations i
        JOIN artists a ON i.artist_id = a.id
        WHERE i.id = ?
    """, (illustration_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Illustration not found")
    return _row_to_illustration(row)


@app.get("/api/illustrations/{illustration_id}/file")
def serve_illustration_file(illustration_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT filename, artist_id, mime_type FROM illustrations WHERE id = ?",
        (illustration_id,),
    ).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Illustration not found")

    filepath = os.path.join(UPLOADS_DIR, str(row["artist_id"]), "originals", row["filename"])
    if not os.path.isfile(filepath):
        raise HTTPException(404, "File not found on disk")
    return FileResponse(filepath, media_type=row["mime_type"])


@app.get("/api/illustrations/{illustration_id}/thumbnail")
def serve_illustration_thumbnail(illustration_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT filename, artist_id FROM illustrations WHERE id = ?",
        (illustration_id,),
    ).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(404, "Illustration not found")

    filepath = os.path.join(UPLOADS_DIR, str(row["artist_id"]), "thumbnails", row["filename"])
    if not os.path.isfile(filepath):
        raise HTTPException(404, "Thumbnail not found on disk")
    return FileResponse(filepath, media_type="image/jpeg")


@app.delete("/api/illustrations/{illustration_id}", status_code=204)
def delete_illustration(illustration_id: int):
    conn = get_db()
    row = conn.execute("SELECT id, filename, artist_id FROM illustrations WHERE id = ?", (illustration_id,)).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Illustration not found")

    # Unset as cover if it is one
    conn.execute(
        "UPDATE artists SET cover_illustration_id = NULL WHERE cover_illustration_id = ?",
        (illustration_id,),
    )
    conn.execute("DELETE FROM illustrations WHERE id = ?", (illustration_id,))
    conn.commit()
    conn.close()

    # Delete files
    artist_dir = os.path.join(UPLOADS_DIR, str(row["artist_id"]))
    for sub in ("originals", "thumbnails"):
        fp = os.path.join(artist_dir, sub, row["filename"])
        if os.path.isfile(fp):
            os.remove(fp)


@app.put("/api/illustrations/{illustration_id}", response_model=IllustrationResponse)
def update_illustration(illustration_id: int, body: IllustrationUpdate):
    conn = get_db()
    row = conn.execute(
        "SELECT i.*, a.name AS artist_name FROM illustrations i JOIN artists a ON i.artist_id = a.id WHERE i.id = ?",
        (illustration_id,),
    ).fetchone()
    if row is None:
        conn.close()
        raise HTTPException(404, "Illustration not found")

    updates: dict = {}
    if body.is_ai_generated is not None:
        updates["is_ai_generated"] = 1 if body.is_ai_generated else 0
    if body.tags is not None:
        updates["tags"] = body.tags

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [illustration_id]
        conn.execute(f"UPDATE illustrations SET {set_clause} WHERE id = ?", values)
        conn.commit()

    row = conn.execute(
        "SELECT i.*, a.name AS artist_name FROM illustrations i JOIN artists a ON i.artist_id = a.id WHERE i.id = ?",
        (illustration_id,),
    ).fetchone()
    conn.close()
    return _row_to_illustration(row)


# ── Search ──────────────────────────────────────────────

@app.get("/api/search", response_model=SearchResult)
def search_illustrations(
    q: str = Query(..., min_length=1, description="Search query for tags"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    # Build FTS5 prefix query: wrap each term for prefix matching
    terms = [t.strip() for t in q.replace(",", " ").split() if t.strip()]
    if not terms:
        return SearchResult(items=[], total=0, offset=offset, limit=limit)

    # Escape double-quotes inside terms and build prefix terms
    safe_terms = []
    for t in terms:
        clean = t.replace('"', '')
        safe_terms.append(f'"{clean}"*')
    fts_query = " AND ".join(safe_terms)

    conn = get_db()
    try:
        count_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM illustrations_fts WHERE illustrations_fts MATCH ?",
            (fts_query,),
        ).fetchone()
        total = count_row["cnt"]

        rows = conn.execute("""
            SELECT i.*, a.name AS artist_name
            FROM illustrations_fts fts
            JOIN illustrations i ON fts.rowid = i.id
            JOIN artists a ON i.artist_id = a.id
            WHERE illustrations_fts MATCH ?
            ORDER BY rank
            LIMIT ? OFFSET ?
        """, (fts_query, limit, offset)).fetchall()
    except Exception:
        conn.close()
        return SearchResult(items=[], total=0, offset=offset, limit=limit)

    conn.close()
    items = [_row_to_illustration(r) for r in rows]
    return SearchResult(items=items, total=total, offset=offset, limit=limit)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
