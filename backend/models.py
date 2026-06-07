from pydantic import BaseModel, Field
from typing import Optional


# ── Group ──────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    cover_illustration_id: Optional[int] = None


class GroupResponse(BaseModel):
    id: int
    name: str
    cover_illustration_id: Optional[int] = None
    cover_thumbnail_url: Optional[str] = None
    illustration_count: int = 0
    created_at: str


# ── Illustration ────────────────────────────────────────

class IllustrationResponse(BaseModel):
    id: int
    group_id: int
    group_name: str = ""
    filename: str
    original_filename: str
    file_size: int
    width: Optional[int] = None
    height: Optional[int] = None
    mime_type: str
    tags: str = ""
    extended_data: Optional[dict] = None
    thumbnail_url: str
    file_url: str
    created_at: str


class IllustrationUpdate(BaseModel):
    tags: Optional[str] = None


class IllustrationListItem(BaseModel):
    id: int
    group_id: int
    original_filename: str
    file_size: int
    width: Optional[int] = None
    height: Optional[int] = None
    mime_type: str
    tags: str = ""
    thumbnail_url: str
    file_url: str
    created_at: str


# ── Search ──────────────────────────────────────────────

class SearchResult(BaseModel):
    items: list[IllustrationResponse]
    total: int
    offset: int
    limit: int


class IllustrationListResult(BaseModel):
    items: list[IllustrationResponse]
    total: int
    offset: int
    limit: int
