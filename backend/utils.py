import os
import logging
from PIL import Image
from typing import Optional

logger = logging.getLogger(__name__)

# Redirect HuggingFace model downloads to backend/models
MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
os.makedirs(MODELS_DIR, exist_ok=True)
os.environ["HF_HUB_CACHE"] = MODELS_DIR

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from huggingface_hub import hf_hub_download
import timm
from timm.data import resolve_data_config
from timm.data.transforms_factory import create_transform
from sd_parsers import ParserManager

# ── Tagger constants ──────────────────────────────────────────────────────────
MODEL_REPO = "SmilingWolf/wd-eva02-large-tagger-v3"
LABELS_FILE = "selected_tags.csv"

RATING_CATEGORY = 9
GENERAL_CATEGORY = 0
CHARACTER_CATEGORY = 4

DEFAULT_GENERAL_THRESH = 0.35
DEFAULT_CHARACTER_THRESH = 0.75

# Module-level cache — model is loaded once and reused
_tagger_model = None
_tagger_tag_names = None
_tagger_rating_indexes = None
_tagger_general_indexes = None
_tagger_char_indexes = None
_tagger_transform = None


def _load_tagger():
    """Lazy-load and cache the WD EVA02-Large Tagger v3 model."""
    global _tagger_model, _tagger_tag_names, _tagger_rating_indexes
    global _tagger_general_indexes, _tagger_char_indexes, _tagger_transform

    if _tagger_model is not None:
        return

    logger.info("Loading WD EVA02-Large Tagger v3 (first call downloads ~800MB weights)...")
    model = timm.create_model(f"hf_hub:{MODEL_REPO}", pretrained=True)
    model.eval()
    _tagger_model = model.to("cpu")

    logger.info("Downloading tag labels...")
    labels_path = hf_hub_download(
        repo_id=MODEL_REPO,
        filename=LABELS_FILE,
        cache_dir=MODELS_DIR,
    )
    df = pd.read_csv(labels_path)

    if "tag_id" not in df.columns:
        df = df.reset_index().rename(columns={"index": "tag_id"})

    _tagger_tag_names = df["name"].tolist()
    _tagger_rating_indexes = df.index[df["category"] == RATING_CATEGORY].tolist()
    _tagger_general_indexes = df.index[df["category"] == GENERAL_CATEGORY].tolist()
    _tagger_char_indexes = df.index[df["category"] == CHARACTER_CATEGORY].tolist()

    config = resolve_data_config(model.pretrained_cfg, model=model)
    _tagger_transform = create_transform(**config)

    logger.info("Tagger model loaded.")


# ── Public API ────────────────────────────────────────────────────────────────

def extract_extended_data(image: Image.Image) -> Optional[dict]:
    """
    Extract metadata from extended encoding blocks embedded in the image.
    Returns a dict of the encoded information, or None if not present.
    """
    try:
        prompt_info = ParserManager().parse(image)
        if prompt_info:
            return prompt_info.metadata
    except Exception:
        pass
    return None


def extract_tags(image: Image.Image) -> str:
    """
    Extract tags using WD EVA02-Large Tagger v3.
    Returns a comma-separated string, e.g. "1girl, solo, ..."
    Falls back to "" on any error.
    """
    try:
        _load_tagger()

        # RGBA compositing on white background
        if image.mode == "RGBA":
            canvas = Image.new("RGBA", image.size, (255, 255, 255, 255))
            canvas.paste(image, mask=image.split()[3])
            image = canvas.convert("RGB")
        elif image.mode != "RGB":
            image = image.convert("RGB")

        tensor = _tagger_transform(image).unsqueeze(0)

        with torch.no_grad():
            logits = _tagger_model(tensor)
            probs = F.sigmoid(logits).squeeze(0).cpu().numpy()

        tags = []
        for i in _tagger_char_indexes:
            if probs[i] >= DEFAULT_CHARACTER_THRESH:
                tags.append(_tagger_tag_names[i])
        for i in _tagger_general_indexes:
            if probs[i] >= DEFAULT_GENERAL_THRESH:
                tags.append(_tagger_tag_names[i])

        return ", ".join(tags)

    except Exception as exc:
        logger.warning("Tag extraction failed: %s", exc)
        return ""


def create_thumbnail(image: Image.Image, max_size: int = 400) -> Image.Image:
    """Create a thumbnail copy, maintaining aspect ratio."""
    thumb = image.copy()
    thumb.thumbnail((max_size, max_size), Image.LANCZOS)
    return thumb


def get_image_info(image: Image.Image) -> tuple[int, int, str]:
    """Return (width, height, mime_type) for an image."""
    fmt = (image.format or "JPEG").upper()
    mime_map = {
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "GIF": "image/gif",
        "WEBP": "image/webp",
        "BMP": "image/bmp",
    }
    return image.width, image.height, mime_map.get(fmt, "image/jpeg")
