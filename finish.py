#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تظبيط الصورة اللي طلعت من ChatGPT: شعار + مقاسات الإنستا.

    python finish.py صورتي.png                 # كل المقاسات المحددة بـ config
    python finish.py صورتي.png --preset story  # مقاس واحد
    python finish.py *.png                     # كذا صورة مع بعض
    python finish.py صورتي.png --no-brand      # بدون شعار

الملفات الجاهزة بتنحفظ بمجلد output/
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path

from PIL import Image

import config
from branding import apply_branding
from upscale_image import PRESETS, resize_image

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"

# JPEG للمقاسات الجاهزة للنشر، PNG للـ 4K
AS_JPEG = {"story", "post", "square"}


def finish_one(src: Path, presets: list[str], brand: bool, sharpen: float) -> list[Path]:
    if not src.exists():
        print(f"[!] ما لقيت: {src}")
        return []

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(src)
    print(f"[i] {src.name}  ({source.width}x{source.height})")

    made = []
    for name in presets:
        w, h = PRESETS[name]

        # ١) نحجّم أول — عشان الشعار ينحط على المقاس النهائي وما ينقص
        out_im = resize_image(source, w, h, sharpen=sharpen, anchor=config.CROP_ANCHOR)

        buf = io.BytesIO()
        out_im.save(buf, format="PNG")
        data = buf.getvalue()

        # ٢) وبعدين الشعار
        if brand:
            data = apply_branding(data)

        as_jpeg = name in AS_JPEG
        dst = OUTPUT_DIR / f"{src.stem}_{name}{'.jpg' if as_jpeg else '.png'}"
        if as_jpeg:
            Image.open(io.BytesIO(data)).convert("RGB").save(
                dst, quality=95, subsampling=0, optimize=True
            )
        else:
            dst.write_bytes(data)

        mb = dst.stat().st_size / 1024 / 1024
        print(f"[✓] {name:>6}  {w}x{h}  ({mb:.1f} MB)  {dst.name}")
        made.append(dst)

    if config.KEEP_BRANDED_ORIGINAL:
        data = src.read_bytes()
        if brand:
            data = apply_branding(data)
        keep = OUTPUT_DIR / f"{src.stem}_full.png"
        keep.write_bytes(data)
        print(f"[✓] النسخة الكاملة: {keep.name}")
        made.append(keep)

    return made


def main() -> None:
    p = argparse.ArgumentParser(description="ظبّط صورة ChatGPT: شعار + مقاسات")
    p.add_argument("sources", nargs="+", type=Path, help="الصور اللي نزّلتها")
    p.add_argument("--preset", choices=sorted(PRESETS), action="append",
                   help="مقاس معيّن (بتقدر تكرره)")
    p.add_argument("--no-brand", action="store_true", help="بدون شعار")
    p.add_argument("--sharpen", type=float, default=1.0, help="قوة الشحذ")
    args = p.parse_args()

    presets = args.preset or list(config.OUTPUT_SIZES)
    brand = config.BRAND_ENABLED and not args.no_brand

    print(f"[i] مقاسات: {', '.join(presets)} | شعار: {'نعم' if brand else 'لا'}\n")

    total = []
    for src in args.sources:
        total += finish_one(src, presets, brand, args.sharpen)

    print(f"\n[✓] خلص — {len(total)} ملف بمجلد output/")


if __name__ == "__main__":
    main()
