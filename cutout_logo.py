#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تفريغ خلفية الشعار — بيشيل الخلفية السودا ويخلي الرسمة زي ما هي بخلفية شفافة.

    python cutout_logo.py logo_raw.jpg
    python cutout_logo.py logo_raw.jpg -o assets/logo.png
    python cutout_logo.py logo_raw.jpg --white-bg     # إذا الخلفية بيضا مش سودا

بيشتغل على أي شعار على خلفية سودا أو بيضا موحّدة.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent


def cutout(
    src: Path,
    dst: Path,
    white_bg: bool = False,
    low: int = 22,
    high: int = 95,
    trim: bool = True,
    pad_ratio: float = 0.04,
) -> Path:
    """
    بيحوّل الخلفية الموحّدة لشفافية.

    low/high: عتبة التدرّج — أقل من low شفاف تماماً، أعلى من high صريح تماماً.
              اللي بينهن بينتقل تدريجياً عشان الحواف تضل ناعمة.
    """
    im = Image.open(src).convert("RGB")
    w, h = im.size
    pixels = im.load()
    out = Image.new("RGBA", (w, h))
    dest = out.load()

    span = max(1, high - low)

    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            if white_bg:
                r, g, b = 255 - r, 255 - g, 255 - b

            # بعد البكسل عن الخلفية = أقوى قناة فيه
            strength = max(r, g, b)
            if strength <= low:
                dest[x, y] = (0, 0, 0, 0)
                continue

            alpha = 255 if strength >= high else round((strength - low) * 255 / span)

            if white_bg:
                r, g, b = 255 - r, 255 - g, 255 - b
                dest[x, y] = (r, g, b, alpha)
                continue

            # إلغاء الضرب المسبق: بيرجّع لمعان الحواف بدل ما تطلع غامقة
            if alpha < 250:
                f = 255 / alpha
                r, g, b = (min(255, round(c * f)) for c in (r, g, b))
            dest[x, y] = (r, g, b, alpha)

    if trim:
        bbox = out.getbbox()
        if bbox:
            pad = round(max(w, h) * pad_ratio)
            out = out.crop(
                (
                    max(0, bbox[0] - pad),
                    max(0, bbox[1] - pad),
                    min(w, bbox[2] + pad),
                    min(h, bbox[3] + pad),
                )
            )

    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst)
    return dst


def recolor(src: Path, dst: Path, from_light: str = "#FFFFFF", to: str = "#23232A") -> Path:
    """
    نسخة للخلفيات الفاتحة: بتحوّل الأبيض اللي بالشعار للون غامق.
    الرسمة ما بتتغير — بس لون الجزء الأبيض.
    """
    target = tuple(int(str(to).lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
    im = Image.open(src).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            # الأبيض = قنوات متقاربة وفاتحة
            if min(r, g, b) > 150 and (max(r, g, b) - min(r, g, b)) < 45:
                px[x, y] = (*target, a)
    im.save(dst)
    return dst


def main() -> None:
    p = argparse.ArgumentParser(description="تفريغ خلفية الشعار")
    p.add_argument("source", type=Path, help="ملف الشعار الأصلي")
    p.add_argument("-o", "--output", type=Path, default=ROOT / "assets" / "logo.png")
    p.add_argument("--white-bg", action="store_true", help="الخلفية بيضا مش سودا")
    p.add_argument("--no-trim", action="store_true", help="بدون قص الفراغ الزايد")
    p.add_argument("--low", type=int, default=22, help="عتبة الشفافية الكاملة")
    p.add_argument("--high", type=int, default=95, help="عتبة الوضوح الكامل")
    p.add_argument(
        "--dark-variant",
        action="store_true",
        help="يطلّع كمان نسخة غامقة للخلفيات الفاتحة",
    )
    args = p.parse_args()

    out = cutout(
        args.source, args.output,
        white_bg=args.white_bg, low=args.low, high=args.high, trim=not args.no_trim,
    )
    size = Image.open(out).size
    print(f"[✓] الخلفية انفرغت: {out}  ({size[0]}x{size[1]})")

    if args.dark_variant:
        dark = out.with_name(out.stem + "_dark" + out.suffix)
        recolor(out, dark)
        print(f"[✓] نسخة للخلفيات الفاتحة: {dark}")


if __name__ == "__main__":
    main()
