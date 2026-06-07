from pydantic import BaseModel, Field
from typing import Optional


# ── Artist ──────────────────────────────────────────────

class ArtistCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class ArtistUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    cover_illustration_id: Optional[int] = None


class ArtistResponse(BaseModel):
    id: int
    name: str
    cover_illustration_id: Optional[int] = None
    cover_thumbnail_url: Optional[str] = None
    illustration_count: int = 0
    created_at: str


# ── Illustration ────────────────────────────────────────

class IllustrationResponse(BaseModel):
    id: int
    artist_id: int
    artist_name: str = ""
    filename: str
    original_filename: str
    file_size: int
    width: Optional[int] = None
    height: Optional[int] = None
    mime_type: str
    tags: str = ""
    extended_data: Optional[dict] = None
    is_ai_generated: bool = False
    thumbnail_url: str
    file_url: str
    created_at: str


class IllustrationUpdate(BaseModel):
    is_ai_generated: Optional[bool] = None
    tags: Optional[str] = None


class IllustrationListItem(BaseModel):
    id: int
    artist_id: int
    original_filename: str
    file_size: int
    width: Optional[int] = None
    height: Optional[int] = None
    mime_type: str
    tags: str = ""
    is_ai_generated: bool = False
    thumbnail_url: str
    file_url: str
    created_at: str


# ── Search ──────────────────────────────────────────────

class SearchResult(BaseModel):
    items: list[IllustrationResponse]
    total: int
    offset: int
    limit: int
