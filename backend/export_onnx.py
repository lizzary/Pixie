# """
# One-time script: export the WD EVA02 tagger from PyTorch to ONNX.
#
# Temporary dependencies:
#     pip install torch timm
#
# Usage:
#     python export_onnx.py
#
# Output: models/default/wd-eva02-large-tagger-v3.onnx (+ .onnx.data)
# """
# import os
# import torch
# import timm
#
# MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "default")
# os.makedirs(MODELS_DIR, exist_ok=True)
#
# # Source model on HuggingFace
# HF_REPO = "SmilingWolf/wd-eva02-large-tagger-v3"
#
# # Output filename — this determines the external data reference inside the ONNX.
# # torch.onnx.export uses the output path's basename for the .data file reference.
# # So "wd-eva02-large-tagger-v3.onnx" → references "wd-eva02-large-tagger-v3.onnx.data"
# OUTPUT_NAME = "wd-eva02-large-tagger-v3.onnx"
#
#
# def export():
#     print(f"[1/3] Loading model: {HF_REPO}")
#     model = timm.create_model(f"hf_hub:{HF_REPO}", pretrained=True)
#     model.eval()
#
#     # ViT-Large input: batch × 3 × 448 × 448
#     dummy_input = torch.randn(1, 3, 448, 448)
#
#     output_path = os.path.join(MODELS_DIR, OUTPUT_NAME)
#     print(f"[2/3] Exporting to: {output_path}")
#     torch.onnx.export(
#         model,
#         dummy_input,
#         output_path,
#         opset_version=14,
#         input_names=["input"],
#         output_names=["output"],
#         dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}},
#     )
#
#     onnx_size = os.path.getsize(output_path) / (1024 * 1024)
#     data_path = output_path + ".data"
#     data_size = os.path.getsize(data_path) / (1024 * 1024) if os.path.isfile(data_path) else 0
#     print(f"[3/3] Done — {OUTPUT_NAME} ({onnx_size:.0f} MB) + {OUTPUT_NAME}.data ({data_size:.0f} MB)")
#     print()
#     print("Upload these 2 files to your HF repo:")
#     print(f"  {OUTPUT_NAME}")
#     print(f"  {OUTPUT_NAME}.data")
#     print()
#     print("Then run: pip uninstall torch torchvision timm")
#
#
# if __name__ == "__main__":
#     export()
