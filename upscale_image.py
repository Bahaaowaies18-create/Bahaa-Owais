#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تكبير وتحسين حدّة الصور الجاهزة.

    python upscale_image.py صورتي.png                  # مقاسات الإنستا + 4K
    python upscale_image.py صورتي.png --preset story    # ستوري بس
    python upscale_image.py صورتي.png --width 2160      # عرض مخصص

مهم: هاد تكبير مقاس + شحذ حدّة — مش اختراع تفاصيل جديدة.
للتفاصيل الحقيقية الأعلى، ولّد الصورة من الأول بدقة أعلى.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent

# مقاسات إنستغرام الرسمية
PRESETS = {
    "story":  (1080, 1920),   # ستوري / ريل  9:16
    "post":   (1080, 1350),   # بوست عمودي   4:5
    "square": (1080, 1080),   # مربع         1:1
    "4k":     (2160, 3840),   # 4K عمودي
}


def fit_to_aspect(im: Image.Image, tw: int, th: int, anchor: float = 0.30) -> Image.Image:
    """
    بيقص الصورة لنسبة المقاس المطلوب قبل التحجيم — بدون مط ولا تشويه.

    anchor: وين يقص عمودياً (0 = من فوق، 0.5 = النص، 1 = من تحت).
            الافتراضي 0.30 عشان الوجه يضل بالكادر.
    """
    ow, oh = im.size
    target, source = tw / th, ow / oh
    if abs(target - source) < 0.01:
        return im

    if source > target:                       # الأصل أعرض -> نقص من الجوانب
        new_w = round(oh * target)
        x = round((ow - new_w) / 2)
        return im.crop((x, 0, x + new_w, oh))

    new_h = round(ow / target)                # الأصل أطول -> نقص من فوق/تحت
    y = round((oh - new_h) * anchor)
    return im.crop((0, y, ow, y + new_h))


def resize_image(
    im: Image.Image,
    width: int,
    height: int | None = None,
    sharpen: float = 1.0,
    anchor: float = 0.30,
) -> Image.Image:
    """قص للنسبة + تحجيم + شحذ — بترجع صورة بالذاكرة بدون حفظ."""
    im = im.convert("RGB")
    ow, oh = im.size
    if height is None:
        height = round(oh * width / ow)

    im = fit_to_aspect(im, width, height, anchor)
    scale = width / im.width
    im = im.resize((width, height), Image.LANCZOS)

    if sharpen > 0 and scale > 1:
        radius = min(3.0, 0.8 * scale) * sharpen
        percent = int(min(110, 45 * scale) * sharpen)
        im = im.filter(
            ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3)
        )
    return im


def enhance(
    src: Path,
    width: int,
    height: int | None = None,
    sharpen: float = 1.0,
    jpeg: bool = False,
    suffix: str = "",
    anchor: float = 0.30,
) -> Path:
    """قص للنسبة المطلوبة + تكبير بـ LANCZOS + شحذ حدّة متدرّج."""
    im = Image.open(src).convert("RGB")
    ow, oh = im.size

    if height is None:
        height = round(oh * width / ow)

    cropped = fit_to_aspect(im, width, height, anchor)
    if cropped.size != im.size:
        print(f"    (انقصّت للنسبة المطلوبة: {ow}x{oh} → {cropped.width}x{cropped.height})")
    im = cropped

    scale = width / im.width
    im = im.resize((width, height), Image.LANCZOS)

    # شحذ بقدر التكبير — كل ما كبّرنا أكتر، احتجنا شحذ أقوى
    if sharpen > 0 and scale > 1:
        radius = min(3.0, 0.8 * scale) * sharpen
        percent = int(min(110, 45 * scale) * sharpen)
        im = im.filter(
            ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=3)
        )

    ext = ".jpg" if jpeg else ".png"
    dst = src.with_name(f"{src.stem}{suffix or f'_{width}x{height}'}{ext}")
    if jpeg:
        im.save(dst, quality=95, subsampling=0, optimize=True)
    else:
        im.save(dst, optimize=True)

    mb = dst.stat().st_size / 1024 / 1024
    print(f"[✓] {ow}x{oh} → {width}x{height}  ({mb:.1f} MB)  {dst.name}")
    return dst


def main() -> None:
    p = argparse.ArgumentParser(description="تكبير وتحسين حدّة صورة")
    p.add_argument("source", type=Path)
    p.add_argument("--preset", choices=sorted(PRESETS), help="مقاس جاهز")
    p.add_argument("--width", type=int, help="عرض مخصص بالبكسل")
    p.add_argument("--sharpen", type=float, default=1.0, help="0 = بدون شحذ، 1.5 = أقوى")
    p.add_argument("--jpeg", action="store_true", help="يحفظ JPEG بدل PNG")
    p.add_argument("--anchor", type=float, default=0.30,
                   help="وين يقص عمودياً: 0 فوق، 0.5 نص، 1 تحت")
    args = p.parse_args()

    if not args.source.exists():
        raise SystemExit(f"[!] ما لقيت الملف: {args.source}")

    if args.width:
        enhance(args.source, args.width, sharpen=args.sharpen, jpeg=args.jpeg,
                anchor=args.anchor)
    elif args.preset:
        w, h = PRESETS[args.preset]
        enhance(args.source, w, h, sharpen=args.sharpen, jpeg=args.jpeg,
                suffix=f"_{args.preset}", anchor=args.anchor)
    else:
        # الافتراضي: ستوري إنستا + نسخة 4K
        enhance(args.source, *PRESETS["story"], sharpen=args.sharpen,
                jpeg=True, suffix="_story_1080x1920", anchor=args.anchor)
        enhance(args.source, *PRESETS["4k"], sharpen=args.sharpen,
                suffix="_4k_2160x3840", anchor=args.anchor)


if __name__ == "__main__":
    main()
