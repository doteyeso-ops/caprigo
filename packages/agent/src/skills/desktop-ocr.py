#!/usr/bin/env python3
"""
Caprigo desktop OCR — RapidOCR ONNX → JSON blocks with click centers.
Usage: python desktop-ocr.py <image_path> [--max N]
Stdout: single JSON object.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def emit(obj: dict) -> None:
    data = json.dumps(obj, ensure_ascii=False)
    sys.stdout.buffer.write(data.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()


def main() -> int:
    if len(sys.argv) < 2:
        emit({"success": False, "error": "usage: desktop-ocr.py <image> [--max N]"})
        return 1
    path = Path(sys.argv[1])
    max_blocks = 120
    if "--max" in sys.argv:
        i = sys.argv.index("--max")
        if i + 1 < len(sys.argv):
            try:
                max_blocks = max(1, int(sys.argv[i + 1]))
            except ValueError:
                pass

    if not path.is_file():
        emit({"success": False, "error": f"file not found: {path}"})
        return 1

    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        try:
            from rapidocr import RapidOCR  # type: ignore
        except ImportError:
            emit(
                {
                    "success": False,
                    "error": "rapidocr not installed",
                    "hint": "pip install rapidocr-onnxruntime",
                }
            )
            return 2

    engine = RapidOCR()
    result, elapse = engine(str(path))
    blocks = []
    lines = []
    if result:
        for item in result:
            # formats: [box, text, score] or dict-like
            if isinstance(item, (list, tuple)) and len(item) >= 3:
                box, text, score = item[0], item[1], item[2]
            elif isinstance(item, dict):
                box = item.get("box") or item.get("dt_boxes")
                text = item.get("text") or item.get("rec_txt") or ""
                score = item.get("score") or item.get("confidence") or 0
            else:
                continue
            text = str(text or "").strip()
            if not text:
                continue
            xs, ys = [], []
            try:
                for pt in box:
                    xs.append(float(pt[0]))
                    ys.append(float(pt[1]))
            except Exception:
                continue
            if not xs or not ys:
                continue
            x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
            cx = round((x0 + x1) / 2)
            cy = round((y0 + y1) / 2)
            conf = float(score) if score is not None else 0.0
            blocks.append(
                {
                    "text": text,
                    "x": int(x0),
                    "y": int(y0),
                    "w": int(max(1, x1 - x0)),
                    "h": int(max(1, y1 - y0)),
                    "cx": cx,
                    "cy": cy,
                    "conf": round(conf, 4),
                }
            )
            lines.append(text)

    blocks = blocks[:max_blocks]
    emit(
        {
            "success": True,
            "engine": "rapidocr",
            "path": str(path.resolve()),
            "count": len(blocks),
            "blocks": blocks,
            "text": "\n".join(lines[:max_blocks]),
            "elapsed": elapse,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
