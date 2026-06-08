import os
import json
import logging
from datetime import datetime
from pathlib import Path
from PIL import Image
from PIL.PngImagePlugin import PngImageFile
from PIL.JpegImagePlugin import JpegImageFile

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

# ── Tagger constants ──────────────────────────────────────────────────────────
DEFAULT_MODEL_REPO = "SmilingWolf/wd-eva02-large-tagger-v3"
LABELS_FILE = "selected_tags.csv"

# Active model repo — can be changed via set_model_repo()
_model_repo = DEFAULT_MODEL_REPO


def set_model_repo(repo: str):
    """Set the active tagger model repo and reset cached model if changed."""
    global _model_repo, _tagger_model
    if repo and repo != _model_repo:
        _model_repo = repo
        _tagger_model = None
        logger.info("Model repo changed to %s, tagger will reload on next extraction", repo)


def get_model_repo() -> str:
    return _model_repo


def _repo_to_dirname(repo: str) -> str:
    """Convert HuggingFace repo ID to cache directory name."""
    return "models--" + repo.replace("/", "--")


def _dirname_to_repo(dirname: str) -> str:
    """Convert cache directory name to HuggingFace repo ID."""
    if dirname.startswith("models--"):
        return dirname[len("models--"):].replace("--", "/", 1)
    return dirname


def list_available_models() -> list[dict]:
    """List tagger model directories and model files in MODELS_DIR."""
    models = []
    if not os.path.isdir(MODELS_DIR):
        return models
    for entry in sorted(os.listdir(MODELS_DIR)):
        if entry == "CACHEDIR.TAG":
            continue
        entry_path = os.path.join(MODELS_DIR, entry)
        if os.path.isdir(entry_path) and entry.startswith("models--"):
            # Check it has actual model content
            for sub in ("blobs", "snapshots", "refs"):
                sub_path = os.path.join(entry_path, sub)
                if os.path.isdir(sub_path) and os.listdir(sub_path):
                    models.append({"name": entry, "type": "huggingface", "repo": _dirname_to_repo(entry)})
                    break
        elif os.path.isfile(entry_path):
            ext = os.path.splitext(entry)[1].lower()
            if ext in (".pth", ".pt", ".bin", ".safetensors", ".ckpt", ".onnx"):
                models.append({"name": entry, "type": "file", "size": os.path.getsize(entry_path)})
    return models

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
_use_gpu = False


def set_use_gpu(enabled: bool):
    """Set whether the tagger should use GPU acceleration."""
    global _use_gpu, _tagger_model
    _use_gpu = enabled
    # Reset model if already loaded so it gets reloaded on next tag extraction
    if _tagger_model is not None:
        logger.info("GPU setting changed, reloading tagger model on next extraction")
        _tagger_model = None


def is_model_cached(repo: str = None) -> bool:
    """Check whether a tagger model has been downloaded to the local cache."""
    if repo is None:
        repo = _model_repo
    model_cache_dir = os.path.join(MODELS_DIR, _repo_to_dirname(repo))
    if not os.path.isdir(model_cache_dir):
        return False
    blobs_dir = os.path.join(model_cache_dir, "blobs")
    if os.path.isdir(blobs_dir) and os.listdir(blobs_dir):
        return True
    for sub in ("snapshots", "refs"):
        d = os.path.join(model_cache_dir, sub)
        if os.path.isdir(d) and os.listdir(d):
            return True
    return False


def download_model():
    """Pre-download the tagger model to the local cache (blocking)."""
    logger.info("Pre-downloading tagger model...")
    _load_tagger()
    logger.info("Tagger model download complete.")


def _load_tagger():
    """Lazy-load and cache the WD EVA02-Large Tagger v3 model."""
    global _tagger_model, _tagger_tag_names, _tagger_rating_indexes
    global _tagger_general_indexes, _tagger_char_indexes, _tagger_transform

    if _tagger_model is not None:
        return

    device = "cuda" if (_use_gpu and torch.cuda.is_available()) else "cpu"
    if _use_gpu and not torch.cuda.is_available():
        logger.warning("GPU enabled but CUDA not available, falling back to CPU")

    logger.info("Loading tagger model %s on %s (first call downloads weights)...", _model_repo, device)
    model = timm.create_model(f"hf_hub:{_model_repo}", pretrained=True)
    model.eval()
    _tagger_model = model.to(device)

    logger.info("Downloading tag labels...")
    labels_path = hf_hub_download(
        repo_id=_model_repo,
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
