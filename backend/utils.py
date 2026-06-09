import os
import json
import logging
from datetime import datetime
from pathlib import Path
from PIL import Image
from PIL.PngImagePlugin import PngImageFile
from PIL.JpegImagePlugin import JpegImageFile

logger = logging.getLogger(__name__)

# ── Model directories ────────────────────────────────────────────────────────
import sys as _sys

if getattr(_sys, "frozen", False):
    # PyInstaller onedir: store models alongside the exe
    MODELS_DIR = os.path.join(os.path.dirname(_sys.executable), "models")
else:
    MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
DEFAULT_MODEL_DIR = os.path.join(MODELS_DIR, "default")
USER_MODEL_DIR = os.path.join(MODELS_DIR, "user_model")
os.makedirs(DEFAULT_MODEL_DIR, exist_ok=True)
os.makedirs(USER_MODEL_DIR, exist_ok=True)

import csv
import urllib.request

import numpy as np
import onnxruntime as ort

# ImageNet normalization constants (for ViT tagger preprocessing)
_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
_TAGGER_INPUT_SIZE = 448  # ViT-Large input resolution

# ── Tagger constants ──────────────────────────────────────────────────────────
_DEFAULT_MODEL_REPO = "lizzary111/wd-eva02-large-tagger-v3"
_DEFAULT_ONNX = "wd-eva02-large-tagger-v3.onnx"
_DEFAULT_TAGS = "tags.csv"
_DEFAULT_MODEL_FILES = [
    "wd-eva02-large-tagger-v3.onnx",
    "wd-eva02-large-tagger-v3.onnx.data",
    "tags.csv",
]

RATING_CATEGORY = 9
GENERAL_CATEGORY = 0
CHARACTER_CATEGORY = 4

DEFAULT_GENERAL_THRESH = 0.35
DEFAULT_CHARACTER_THRESH = 0.75

# Module-level cache
_tagger_session = None
_tagger_tag_names = None
_tagger_rating_indexes = None
_tagger_general_indexes = None
_tagger_char_indexes = None
_active_model = ""   # "" = default model, filename = user model
_use_gpu = False


# ── Public model API ──────────────────────────────────────────────────────────

def set_active_model(model_name: str):
    """Set the active tagger model. Empty string selects the default model."""
    global _active_model, _tagger_session
    target = model_name.strip() if model_name else ""
    if _active_model != target:
        _active_model = target
        _tagger_session = None
        logger.info("Active model changed to: %s", target or "default")


def get_active_model() -> str:
    """Return the currently active model name (empty = default)."""
    return _active_model


def set_use_gpu(enabled: bool):
    """Set whether the tagger should use GPU acceleration."""
    global _use_gpu, _tagger_session
    _use_gpu = enabled
    if _tagger_session is not None:
        logger.info("GPU setting changed, reloading tagger model on next extraction")
        _tagger_session = None


def is_model_cached() -> bool:
    """Check whether the default ONNX model exists locally."""
    return os.path.isfile(os.path.join(DEFAULT_MODEL_DIR, _DEFAULT_ONNX))


_HF_BASE_URL = "https://huggingface.co/{repo}/resolve/main/{filename}"


def download_model():
    """Download the default model files from HuggingFace (blocking)."""
    logger.info("Downloading default model from %s ...", _DEFAULT_MODEL_REPO)
    for filename in _DEFAULT_MODEL_FILES:
        dest = os.path.join(DEFAULT_MODEL_DIR, filename)
        if os.path.isfile(dest):
            logger.info("  %s — already cached", filename)
            continue
        logger.info("  %s — downloading...", filename)
        url = _HF_BASE_URL.format(repo=_DEFAULT_MODEL_REPO, filename=filename)
        urllib.request.urlretrieve(url, dest)
    logger.info("Default model download complete.")
    # Load into session if not already loaded
    if _tagger_session is None and not _active_model:
        _load_tagger()


def list_available_models() -> list[dict]:
    """List the default model and user-uploaded ONNX models."""
    models = []
    default_onnx = os.path.join(DEFAULT_MODEL_DIR, _DEFAULT_ONNX)
    models.append({
        "name": "wd-eva02-large-tagger-v3 (Default)",
        "type": "default",
        "cached": os.path.isfile(default_onnx),
    })
    if os.path.isdir(USER_MODEL_DIR):
        for entry in sorted(os.listdir(USER_MODEL_DIR)):
            if entry.lower().endswith(".onnx"):
                path = os.path.join(USER_MODEL_DIR, entry)
                models.append({
                    "name": entry,
                    "type": "user",
                    "size": os.path.getsize(path),
                })
    return models


# ── Internal model loading ────────────────────────────────────────────────────

def _load_tagger():
    """Lazy-load the active tagger model with onnxruntime.

    If _active_model is empty, loads the default model from default/.
    Otherwise loads the named ONNX file from user_model/, falling back to
    default/tags.csv if no matching CSV is found alongside the user model.
    """
    global _tagger_session, _tagger_tag_names, _tagger_rating_indexes
    global _tagger_general_indexes, _tagger_char_indexes

    if _tagger_session is not None:
        return

    # Determine ONNX path and labels path
    if _active_model:
        onnx_path = os.path.join(USER_MODEL_DIR, _active_model)
        # Labels: matching CSV > user tags.csv > default tags.csv
        stem = os.path.splitext(_active_model)[0]
        user_csv = os.path.join(USER_MODEL_DIR, stem + ".csv")
        user_tags = os.path.join(USER_MODEL_DIR, "tags.csv")
        default_tags = os.path.join(DEFAULT_MODEL_DIR, _DEFAULT_TAGS)
        if os.path.isfile(user_csv):
            labels_path = user_csv
        elif os.path.isfile(user_tags):
            labels_path = user_tags
        else:
            labels_path = default_tags
    else:
        onnx_path = os.path.join(DEFAULT_MODEL_DIR, _DEFAULT_ONNX)
        labels_path = os.path.join(DEFAULT_MODEL_DIR, _DEFAULT_TAGS)

    if not os.path.isfile(onnx_path):
        if not _active_model:
            raise FileNotFoundError(
                f"Default model not found: {onnx_path}\n"
                f"Go to Settings → Download Model to download it."
            )
        else:
            raise FileNotFoundError(
                f"User model not found: {onnx_path}"
            )

    if not os.path.isfile(labels_path):
        raise FileNotFoundError(f"Tags CSV not found: {labels_path}")

    # Configure ONNX Runtime providers
    providers = []
    if _use_gpu:
        providers.append("CUDAExecutionProvider")
    providers.append("CPUExecutionProvider")

    logger.info("Loading tagger: %s (providers: %s)", onnx_path, providers)
    _tagger_session = ort.InferenceSession(onnx_path, providers=providers)

    # Load labels
    logger.info("Loading labels: %s", labels_path)
    with open(labels_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    # Add tag_id column if missing (same behavior as pandas reset_index)
    if "tag_id" not in fieldnames:
        for i, row in enumerate(rows):
            row["tag_id"] = str(i)

    _tagger_tag_names = [row["name"] for row in rows]
    _tagger_rating_indexes = [
        i for i, row in enumerate(rows)
        if int(row.get("category", -1)) == RATING_CATEGORY
    ]
    _tagger_general_indexes = [
        i for i, row in enumerate(rows)
        if int(row.get("category", -1)) == GENERAL_CATEGORY
    ]
    _tagger_char_indexes = [
        i for i, row in enumerate(rows)
        if int(row.get("category", -1)) == CHARACTER_CATEGORY
    ]

    logger.info("Tagger ready (%d tags).", len(_tagger_tag_names))


# ── Public API ────────────────────────────────────────────────────────────────

# ═══════════════════════════════════════════════════════════════════════════════
# ComfyUI metadata extraction (replicates temp.py logic)
# ═══════════════════════════════════════════════════════════════════════════════

POSITIVE_KEYWORDS = [
    "positive", "masterpiece", "best quality", "high quality",
    "detailed", "beautiful", "amazing", "stunning", "perfect",
    "photorealistic", "professional", "artistic", "elegant",
]

NEGATIVE_KEYWORDS = [
    "negative", "bad", "worst quality", "low quality", "poor quality",
    "blurry", "distorted", "ugly", "deformed", "artifact", "noise",
    "overexposed", "underexposed", "cropped", "out of frame",
]

STRONG_NEGATIVE = [
    "worst quality", "low quality", "bad", "ugly", "blurry",
    "distorted", "deformed", "amateur", "poor quality",
]

STRONG_POSITIVE = [
    "masterpiece", "best quality", "high quality", "detailed",
    "professional", "photorealistic", "stunning", "beautiful",
]

SAMPLER_NODE_TYPES = {"KSampler", "SamplerCustom", "FaceDetailerPipe"}
MODEL_LOADER_TYPES = {
    "CheckpointLoaderSimple", "CheckpointLoader|pysssss",
    "ModelLoader", "CheckpointLoader",
}
LORA_LOADER_TYPES = {"LoraLoader", "Power Lora Loader (rgthree)"}


def _get_size(file_path):
    file_size_bytes = os.path.getsize(file_path)
    if file_size_bytes < 1024:
        return f"{file_size_bytes} bytes"
    elif file_size_bytes < 1024 * 1024:
        return f"{file_size_bytes / 1024:.2f} KB"
    else:
        return f"{file_size_bytes / (1024 * 1024):.2f} MB"


def _build_fileinfo(image_path, img):
    return {
        "filename": Path(image_path).as_posix(),
        "resolution": f"{img.width}x{img.height}",
        "date": str(datetime.fromtimestamp(os.path.getmtime(image_path))),
        "size": str(_get_size(image_path)),
    }


def _is_plain_prompt_string(val):
    if not isinstance(val, str):
        return False
    trimmed = val.strip()
    if not trimmed:
        return False
    if (trimmed.startswith("{") and trimmed.endswith("}")) or \
       (trimmed.startswith("[") and trimmed.endswith("]")):
        return False
    if len(trimmed) > 2000 and len(trimmed.split(",")) > 100:
        return False
    return True


def _is_positive_prompt(text):
    if not text:
        return False
    lower = text.lower()
    if any(k in lower for k in STRONG_NEGATIVE):
        return False
    if any(k in lower for k in STRONG_POSITIVE):
        return True
    pos = sum(1 for k in POSITIVE_KEYWORDS if k in lower)
    neg = sum(1 for k in NEGATIVE_KEYWORDS if k in lower)
    return (pos + (1 if len(text) > 50 else 0)) > neg and pos > 0


def _is_negative_prompt(text):
    if not text:
        return False
    lower = text.lower()
    if any(k in lower for k in STRONG_NEGATIVE):
        return True
    neg = sum(1 for k in NEGATIVE_KEYWORDS if k in lower)
    pos = sum(1 for k in POSITIVE_KEYWORDS if k in lower)
    if neg > pos and neg > 0:
        return True
    if len(text) < 100 and neg > 0:
        return True
    return False


def _resolve_prompt_string(prompt_obj, ref, visited=None):
    if visited is None:
        visited = set()
    if ref is None:
        return None
    ref_id = id(ref)
    if ref_id in visited:
        return None
    visited.add(ref_id)

    if isinstance(ref, str) and ref.strip():
        return ref
    if isinstance(ref, dict) and "content" in ref and isinstance(ref["content"], str) and ref["content"].strip():
        return ref["content"]
    if isinstance(ref, list) and len(ref) > 0 and isinstance(ref[0], str):
        ref_node = prompt_obj.get(ref[0])
        if ref_node and isinstance(ref_node, dict):
            ct = ref_node.get("class_type") or ref_node.get("type", "")
            inputs = ref_node.get("inputs", {})
            if ct == "Textbox" and isinstance(inputs.get("text"), str) and inputs["text"].strip():
                return inputs["text"]
            if ct == "ImpactWildcardProcessor":
                for field in ("populated_text", "wildcard_text"):
                    val = inputs.get(field)
                    if isinstance(val, str) and val.strip():
                        return val
            wv = ref_node.get("widgets_values")
            if isinstance(wv, list) and len(wv) > 0 and isinstance(wv[0], str) and wv[0].strip():
                return wv[0]
            for key in ("text", "prompt"):
                val = inputs.get(key)
                result = _resolve_prompt_string(prompt_obj, val, visited)
                if result and result.strip():
                    return result
    return None


def _extract_model_from_prompt(prompt_obj):
    if not isinstance(prompt_obj, dict):
        return None

    def _resolve_model_ref(ref, visited=None):
        if visited is None:
            visited = set()
        if ref is None:
            return None
        if id(ref) in visited:
            return None
        visited.add(id(ref))
        if isinstance(ref, str) and (ref.endswith(".safetensors") or ref.endswith(".ckpt")):
            return ref
        if isinstance(ref, dict) and isinstance(ref.get("content"), str):
            content = ref["content"]
            if content.endswith(".safetensors") or content.endswith(".ckpt"):
                return content
        if isinstance(ref, list) and len(ref) > 0 and isinstance(ref[0], str):
            ref_node = prompt_obj.get(ref[0])
            if isinstance(ref_node, dict):
                ct = ref_node.get("class_type") or ref_node.get("type", "")
                inputs = ref_node.get("inputs", {})
                if ct in LORA_LOADER_TYPES and "model" in inputs:
                    return _resolve_model_ref(inputs["model"], visited)
                if ct in MODEL_LOADER_TYPES and "ckpt_name" in inputs:
                    return _resolve_model_ref(inputs["ckpt_name"], visited)
                for key, val in inputs.items():
                    result = _resolve_model_ref(val, visited)
                    if result:
                        return result
        return None

    for node_id, node in prompt_obj.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or node.get("type", "")
        inputs = node.get("inputs", {})
        if ct in MODEL_LOADER_TYPES and "ckpt_name" in inputs:
            resolved = _resolve_model_ref(inputs["ckpt_name"])
            if resolved:
                return resolved
        if ct in LORA_LOADER_TYPES and "model" in inputs:
            resolved = _resolve_model_ref(inputs["model"])
            if resolved:
                return resolved
        for key, val in inputs.items():
            resolved = _resolve_model_ref(val)
            if resolved:
                return resolved
    return None


def _extract_lora_list_from_prompt(prompt_obj):
    loras = []
    if not isinstance(prompt_obj, dict):
        return loras
    for node_id, node in prompt_obj.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or node.get("type", "")
        inputs = node.get("inputs", {})
        for key in inputs:
            if key.startswith("lora_"):
                v = inputs[key]
                if isinstance(v, dict) and v.get("on") and v.get("lora"):
                    loras.append({
                        "name": v["lora"],
                        "model_strength": v.get("strength"),
                        "clip_strength": v.get("strengthTwo"),
                    })
        if ct == "LoraLoader" and "lora_name" in inputs:
            loras.append({
                "name": inputs["lora_name"],
                "model_strength": inputs.get("strength_model"),
                "clip_strength": inputs.get("strength_clip"),
            })
    return loras


def _extract_seed_from_prompt(prompt_obj, sampler_node_id):
    if not isinstance(prompt_obj, dict):
        return None
    sampler = prompt_obj.get(sampler_node_id)
    if not isinstance(sampler, dict):
        return None
    inputs = sampler.get("inputs", {})
    seed_input = inputs.get("seed")
    if isinstance(seed_input, list) and len(seed_input) > 0 and isinstance(seed_input[0], str):
        ref_node = prompt_obj.get(seed_input[0])
        if isinstance(ref_node, dict):
            ct = ref_node.get("class_type") or ref_node.get("type", "")
            if ct == "FooocusV2Expansion":
                val = ref_node.get("inputs", {}).get("prompt_seed")
                if val is not None:
                    return str(val)
            for key in ("seed", "text", "value"):
                val = ref_node.get("inputs", {}).get(key)
                if val is not None:
                    return str(val)
    if isinstance(seed_input, (int, float)):
        return str(int(seed_input))
    if isinstance(seed_input, str):
        return seed_input
    return None


def _extract_positive_prompt_from_prompt(prompt_obj, sampler_node_id):
    if not isinstance(prompt_obj, dict):
        return None

    def _resolve_positive(ref, visited=None):
        if visited is None:
            visited = set()
        if ref is None:
            return None
        ref_id = id(ref)
        if ref_id in visited:
            return None
        visited.add(ref_id)
        if isinstance(ref, str) and _is_plain_prompt_string(ref):
            return ref
        if isinstance(ref, dict) and isinstance(ref.get("content"), str) and _is_plain_prompt_string(ref["content"]):
            return ref["content"]
        if isinstance(ref, list) and len(ref) > 0 and isinstance(ref[0], str):
            ref_node = prompt_obj.get(ref[0])
            if isinstance(ref_node, dict):
                inputs = ref_node.get("inputs", {})
                for key in ("positive", "text", "prompt"):
                    val = inputs.get(key)
                    result = _resolve_positive(val, visited)
                    if result:
                        return result
        return None

    sampler = prompt_obj.get(sampler_node_id)
    if not isinstance(sampler, dict):
        return None
    pos_input = sampler.get("inputs", {}).get("positive")
    if isinstance(pos_input, list) and len(pos_input) > 0:
        return _resolve_positive(pos_input, set())
    if isinstance(pos_input, str) and _is_plain_prompt_string(pos_input):
        return pos_input
    return None


def _extract_prompts_heuristic(prompt_obj):
    positive = None
    negative = None
    if not isinstance(prompt_obj, dict):
        return positive, negative

    positive_candidates = []
    negative_candidates = []
    cr_positive = None
    cr_negative = None

    for node_id, node in prompt_obj.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or node.get("type", "")
        title = node.get("_meta", {}).get("title", "")
        inputs = node.get("inputs", {})

        for key in ("prompt", "text"):
            val = inputs.get(key)
            resolved = None
            if isinstance(val, str) and _is_plain_prompt_string(val) and _is_positive_prompt(val):
                resolved = val
            elif isinstance(val, (list, dict)) and val is not None:
                rec = _resolve_prompt_string(prompt_obj, val)
                if rec and _is_positive_prompt(rec):
                    resolved = rec
            if resolved:
                priority = 0
                if ct == "CR Prompt Text" and "positive" in title.lower():
                    priority = 10
                    if cr_positive is None and resolved.strip():
                        cr_positive = resolved
                elif ct == "CR Prompt Text":
                    priority = 5
                elif "positive" in title.lower():
                    priority = 3
                elif ct == "CLIPTextEncode":
                    priority = 2
                positive_candidates.append({"value": resolved, "priority": priority})

        for key in ("prompt", "text"):
            val = inputs.get(key)
            resolved = None
            if isinstance(val, str) and _is_plain_prompt_string(val) and _is_negative_prompt(val):
                resolved = val
            elif isinstance(val, (list, dict)) and val is not None:
                rec = _resolve_prompt_string(prompt_obj, val)
                if rec and _is_negative_prompt(rec):
                    resolved = rec
            if resolved:
                priority = 0
                if ct == "CR Prompt Text" and "negative" in title.lower():
                    priority = 10
                    if cr_negative is None and resolved.strip():
                        cr_negative = resolved
                elif ct == "CR Prompt Text":
                    priority = 5
                elif "negative" in title.lower():
                    priority = 3
                elif ct == "CLIPTextEncode":
                    priority = 2
                negative_candidates.append({"value": resolved, "priority": priority})

    if cr_positive and cr_positive.strip():
        positive = cr_positive
    elif positive_candidates:
        positive_candidates.sort(key=lambda x: x["priority"], reverse=True)
        positive = positive_candidates[0]["value"]

    if cr_negative and cr_negative.strip():
        negative = cr_negative
    elif negative_candidates:
        negative_candidates.sort(key=lambda x: x["priority"], reverse=True)
        negative = negative_candidates[0]["value"]

    return positive, negative


def _extract_parameters_from_prompt(prompt_obj):
    params = {}
    if not isinstance(prompt_obj, dict):
        return params
    for node_id, node in prompt_obj.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type") or node.get("type", "")
        inputs = node.get("inputs", {})
        if ct in SAMPLER_NODE_TYPES:
            for key in ("steps", "cfg", "sampler_name", "scheduler", "seed", "noise_seed"):
                val = inputs.get(key)
                if val is not None:
                    params[key] = val
        if ct in MODEL_LOADER_TYPES and "ckpt_name" in inputs:
            ckpt = inputs["ckpt_name"]
            if isinstance(ckpt, str):
                params["model"] = ckpt
            elif isinstance(ckpt, dict) and ckpt.get("content"):
                params["model"] = ckpt["content"]
    return params


WORKFLOW_MODEL_TYPES = [
    "CheckpointLoaderSimple", "CheckpointLoader|pysssss", "ModelLoader",
    "CheckpointLoader", "UnetLoaderGGUF", "DualCLIPLoaderGGUF",
    "UNETLoader", "UnetLoaderGGML", "UnetLoaderGGMLv3",
]


def _extract_model_from_workflow(workflow):
    if not isinstance(workflow, dict):
        return None
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return None
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") in WORKFLOW_MODEL_TYPES:
            wv = node.get("widgets_values")
            if isinstance(wv, list) and len(wv) > 0:
                if isinstance(wv[0], str):
                    return wv[0]
                if isinstance(wv[0], dict) and wv[0].get("content"):
                    return wv[0]["content"]
    return None


def _find_source_node(nodes, link_id, visited=None):
    if visited is None:
        visited = set()
    if not isinstance(link_id, int) and not isinstance(link_id, float):
        return None
    for node in nodes:
        if not isinstance(node, dict):
            continue
        outputs = node.get("outputs")
        if not isinstance(outputs, list):
            continue
        for out in outputs:
            if not isinstance(out, dict):
                continue
            links = out.get("links")
            if isinstance(links, list) and int(link_id) in [int(l) for l in links if isinstance(l, (int, float))]:
                if node.get("type") == "CLIPTextEncode" and _is_plain_prompt_string(
                    (node.get("widgets_values") or [None])[0]
                ):
                    return node
                nid = node.get("id")
                if nid not in visited:
                    visited.add(nid)
                    inputs = node.get("inputs")
                    if isinstance(inputs, list):
                        for inp in inputs:
                            if isinstance(inp, dict) and "link" in inp:
                                found = _find_source_node(nodes, inp["link"], visited)
                                if found:
                                    return found
    return None


def _resolve_prompt_from_graph(nodes, node, visited=None):
    if visited is None:
        visited = set()
    if not isinstance(node, dict):
        return None
    nid = node.get("id")
    if nid in visited:
        return None
    visited.add(nid)

    found = []

    wv = node.get("widgets_values")
    if isinstance(wv, list) and len(wv) > 0 and _is_plain_prompt_string(wv[0]) and wv[0].strip():
        found.append(wv[0])

    inputs = node.get("inputs", {})
    if isinstance(inputs, dict):
        for key in ("text", "prompt"):
            val = inputs.get(key)
            if _is_plain_prompt_string(val) and val.strip():
                found.append(val)

        for key in ("text", "prompt", "positive", "negative"):
            val = inputs.get(key)
            if isinstance(val, list) and len(val) > 0 and isinstance(val[0], str):
                ref_node = next((n for n in nodes if str(n.get("id")) == val[0]), None)
                if ref_node:
                    result = _resolve_prompt_from_graph(nodes, ref_node, visited)
                    if result and result.strip():
                        found.append(result)
            elif isinstance(val, str) and val.strip():
                found.append(val)

    if isinstance(inputs, list):
        for inp in inputs:
            if not isinstance(inp, dict):
                continue
            if inp.get("name") in ("text", "prompt", "positive", "negative") and "link" in inp:
                upstream = _find_source_node(nodes, inp["link"], visited.copy())
                if upstream:
                    result = _resolve_prompt_from_graph(nodes, upstream, visited)
                    if result and result.strip():
                        found.append(result)

    return found[-1] if found else None


def _extract_seed_from_workflow(workflow):
    if not isinstance(workflow, dict):
        return None
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return None

    sampler_types = {"KSampler", "UltimateSDUpscale", "KSamplerAdvanced", "SamplerCustom", "FaceDetailerPipe"}
    sampler = next((n for n in nodes if n.get("type") in sampler_types), None)
    if not sampler:
        return None

    inputs = sampler.get("inputs")
    if isinstance(inputs, list):
        seed_input = next((inp for inp in inputs if isinstance(inp, dict) and inp.get("name") == "seed"), None)
        if seed_input and "link" in seed_input and isinstance(seed_input["link"], (int, float)):
            upstream = _find_source_node(nodes, seed_input["link"])
            if upstream:
                wv = upstream.get("widgets_values")
                if upstream.get("type") == "FooocusV2Expansion" and isinstance(wv, list) and len(wv) > 1 and wv[1] is not None and wv[1] != "":
                    return str(int(wv[1]))
                if isinstance(wv, list) and len(wv) > 0 and wv[0] is not None and wv[0] != "":
                    return str(int(wv[0]) if isinstance(wv[0], (int, float)) else wv[0])
        if seed_input and "value" in seed_input and seed_input["value"] is not None:
            return str(int(seed_input["value"]) if isinstance(seed_input["value"], (int, float)) else seed_input["value"])

    wv = sampler.get("widgets_values")
    if isinstance(wv, list) and len(wv) > 0 and wv[0] is not None:
        return str(int(wv[0]) if isinstance(wv[0], (int, float)) else wv[0])
    return None


def _extract_parameters_from_workflow(workflow):
    params = {}
    if not isinstance(workflow, dict):
        return params
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return params

    for node in nodes:
        if not isinstance(node, dict):
            continue
        nt = node.get("type", "")
        if nt not in ("KSampler", "SamplerCustom", "FaceDetailerPipe"):
            continue

        wv = node.get("widgets_values")
        inputs = node.get("inputs", {}) if isinstance(node.get("inputs"), dict) else {}

        if isinstance(wv, list) and len(wv) > 4 and isinstance(wv[4], str):
            params["sampler"] = wv[4]
        elif inputs.get("sampler_name"):
            params["sampler"] = inputs["sampler_name"]

        if isinstance(wv, list) and len(wv) > 5 and isinstance(wv[5], str):
            params["scheduler"] = wv[5]

        if isinstance(wv, list) and len(wv) > 2 and isinstance(wv[2], (int, float)):
            params["steps"] = int(wv[2])
        elif inputs.get("steps") is not None:
            params["steps"] = inputs["steps"]

        if isinstance(wv, list) and len(wv) > 3 and isinstance(wv[3], (int, float)):
            params["cfg"] = wv[3]
        elif inputs.get("cfg") is not None:
            params["cfg"] = inputs["cfg"]

    return params


def _extract_prompts_from_workflow(workflow):
    if not isinstance(workflow, dict):
        return None, None
    nodes = workflow.get("nodes")
    if not isinstance(nodes, list):
        return None, None

    sampler_types = {"KSampler", "UltimateSDUpscale", "KSamplerAdvanced", "SamplerCustom", "FaceDetailerPipe"}
    sampler = next((n for n in nodes if n.get("type") in sampler_types), None)
    if not sampler:
        return None, None

    inputs = sampler.get("inputs")
    if not isinstance(inputs, list):
        return None, None

    pos_input = next((inp for inp in inputs if isinstance(inp, dict) and inp.get("name") == "positive"), None)
    neg_input = next((inp for inp in inputs if isinstance(inp, dict) and inp.get("name") == "negative"), None)

    positive = None
    negative = None

    if pos_input and "link" in pos_input:
        pos_node = _find_source_node(nodes, pos_input["link"])
        if pos_node:
            positive = _resolve_prompt_from_graph(nodes, pos_node)

    if neg_input and "link" in neg_input:
        neg_node = _find_source_node(nodes, neg_input["link"])
        if neg_node:
            negative = _resolve_prompt_from_graph(nodes, neg_node)

    if positive and negative and positive == negative:
        if _is_negative_prompt(negative) and not _is_positive_prompt(positive):
            positive = None
        elif _is_positive_prompt(positive) and not _is_negative_prompt(negative):
            negative = None
        else:
            negative = None

    return positive, negative


def extract_metadata(image_path: str, image: Image.Image) -> dict:
    """Extract ComfyUI generation metadata from an image."""
    fileinfo = _build_fileinfo(image_path, image)

    prompt_obj = None
    workflow_obj = None

    if isinstance(image, PngImageFile):
        for k, v in image.info.items():
            if k == "workflow":
                if isinstance(v, str):
                    try:
                        workflow_obj = json.loads(v)
                    except json.JSONDecodeError:
                        workflow_obj = v
                else:
                    workflow_obj = v
            elif k == "prompt":
                if isinstance(v, str):
                    try:
                        prompt_obj = json.loads(v)
                    except json.JSONDecodeError:
                        prompt_obj = v
                else:
                    prompt_obj = v

    # Find sampler node ID in prompt object
    sampler_node_id = None
    if isinstance(prompt_obj, dict):
        for k, node in prompt_obj.items():
            if isinstance(node, dict) and node.get("class_type") in SAMPLER_NODE_TYPES:
                sampler_node_id = k
                break

    result = {}

    # Model
    model = None
    if prompt_obj:
        model = _extract_model_from_prompt(prompt_obj)
    if not model and workflow_obj:
        model = _extract_model_from_workflow(workflow_obj)
    result["Model"] = model or ""

    # Seed
    seed = None
    if prompt_obj and sampler_node_id:
        seed = _extract_seed_from_prompt(prompt_obj, sampler_node_id)
    if not seed and workflow_obj:
        seed = _extract_seed_from_workflow(workflow_obj)
    result["Seed"] = seed or ""

    # Positive Prompt
    positive = None
    if prompt_obj and sampler_node_id:
        positive = _extract_positive_prompt_from_prompt(prompt_obj, sampler_node_id)
    if not positive and prompt_obj:
        positive, _ = _extract_prompts_heuristic(prompt_obj)
    if not positive and workflow_obj:
        positive, _ = _extract_prompts_from_workflow(workflow_obj)
    result["Positive Prompt"] = positive or ""

    # Negative Prompt
    negative = None
    if prompt_obj:
        _, negative = _extract_prompts_heuristic(prompt_obj)
    if not negative and workflow_obj:
        _, negative = _extract_prompts_from_workflow(workflow_obj)
    result["Negative Prompt"] = negative or ""

    # Sampler
    sampler = None
    if prompt_obj:
        params = _extract_parameters_from_prompt(prompt_obj)
        sampler = params.get("sampler_name")
    if not sampler and workflow_obj:
        wf_params = _extract_parameters_from_workflow(workflow_obj)
        sampler = wf_params.get("sampler")
    result["Sampler"] = sampler or ""

    # Scheduler
    scheduler = None
    if prompt_obj:
        params = _extract_parameters_from_prompt(prompt_obj)
        scheduler = params.get("scheduler")
    if not scheduler and workflow_obj:
        wf_params = _extract_parameters_from_workflow(workflow_obj)
        scheduler = wf_params.get("scheduler")
    result["Scheduler"] = scheduler or ""

    # Steps
    steps = None
    if prompt_obj:
        params = _extract_parameters_from_prompt(prompt_obj)
        steps = params.get("steps")
    if steps is None and workflow_obj:
        wf_params = _extract_parameters_from_workflow(workflow_obj)
        steps = wf_params.get("steps")
    result["Steps"] = str(int(steps)) if steps is not None else ""

    # CFG Scale
    cfg = None
    if prompt_obj:
        params = _extract_parameters_from_prompt(prompt_obj)
        cfg = params.get("cfg")
    if cfg is None and workflow_obj:
        wf_params = _extract_parameters_from_workflow(workflow_obj)
        cfg = wf_params.get("cfg")
    result["CFG Scale"] = str(cfg) if cfg is not None else ""

    # LoRAs
    loras = []
    if prompt_obj:
        loras = _extract_lora_list_from_prompt(prompt_obj)
    if loras:
        lora_strs = []
        for lora in loras:
            name = lora.get("name", "")
            if name:
                model_s = lora.get("model_strength")
                clip_s = lora.get("clip_strength")
                lora_strs.append(f"{name} (Model: {model_s if model_s is not None else ''}, Clip: {clip_s if clip_s is not None else ''})")
        result["LoRAs"] = ", ".join(lora_strs) if lora_strs else "N/A"
    else:
        result["LoRAs"] = "N/A"

    # Deduplicate identical positive/negative
    if (
        result.get("Positive Prompt")
        and result.get("Negative Prompt")
        and result["Positive Prompt"] == result["Negative Prompt"]
    ):
        negative_candidates = []
        if isinstance(prompt_obj, dict):
            for node_id, node in prompt_obj.items():
                if not isinstance(node, dict):
                    continue
                ct = node.get("class_type") or node.get("type", "")
                title = node.get("_meta", {}).get("title", "")
                inputs = node.get("inputs", {})
                for key in ("prompt", "text"):
                    val = inputs.get(key)
                    if isinstance(val, str) and _is_plain_prompt_string(val) and _is_negative_prompt(val):
                        negative_candidates.append(val)
                if "negative" in title.lower() or "negative" in ct.lower():
                    for key in ("prompt", "text"):
                        val = inputs.get(key)
                        if isinstance(val, str) and _is_plain_prompt_string(val) and _is_negative_prompt(val):
                            negative_candidates.insert(0, val)
        negative_candidates = list(dict.fromkeys(negative_candidates))
        negative_candidates = [x for x in negative_candidates if x != result["Positive Prompt"]]
        if negative_candidates:
            result["Negative Prompt"] = negative_candidates[0]
        else:
            result["Negative Prompt"] = ""

    # Swap if only negative is set but looks positive
    if (
        not result.get("Positive Prompt")
        and result.get("Negative Prompt")
        and _is_positive_prompt(result["Negative Prompt"])
        and not _is_negative_prompt(result["Negative Prompt"])
    ):
        result["Positive Prompt"] = result["Negative Prompt"]
        result["Negative Prompt"] = ""

    return {"fileinfo": fileinfo, **result}


def _preprocess(image: Image.Image) -> np.ndarray:
    """Preprocess image for ViT tagger: resize → normalize → NCHW + batch dim."""
    # Resize to model input size
    image = image.resize((_TAGGER_INPUT_SIZE, _TAGGER_INPUT_SIZE), Image.BICUBIC)
    # Convert to float32 array in [0, 1]
    img = np.array(image, dtype=np.float32) / 255.0
    # ImageNet normalization
    img = (img - _IMAGENET_MEAN) / _IMAGENET_STD
    # HWC → CHW, then add batch dimension → (1, 3, 448, 448)
    img = np.transpose(img, (2, 0, 1))
    return np.expand_dims(img, axis=0)


def extract_tags(image: Image.Image) -> str:
    """
    Extract tags using WD EVA02-Large Tagger v3 (ONNX Runtime).
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

        # Preprocess and run inference via ONNX Runtime
        input_array = _preprocess(image)
        outputs = _tagger_session.run(["output"], {"input": input_array})
        logits = outputs[0]                     # shape: (1, num_tags)
        probs = 1.0 / (1.0 + np.exp(-logits))   # sigmoid
        probs = np.squeeze(probs, axis=0)        # (num_tags,)

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

    # JPEG does not support alpha — composite onto white background
    if thumb.mode == "RGBA":
        canvas = Image.new("RGBA", thumb.size, (255, 255, 255, 255))
        canvas.paste(thumb, mask=thumb.split()[3])
        thumb = canvas.convert("RGB")
    elif thumb.mode != "RGB":
        thumb = thumb.convert("RGB")

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
