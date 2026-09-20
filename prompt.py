#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
يجهّزلك البرومبت جاهز للصق بـ ChatGPT.

    python prompt.py                    # البرومبت الأساسي
    python prompt.py --style social     # ستوري مع مساحة للكتابة
    python prompt.py --short            # نسخة أقصر
    python prompt.py --no-file          # يطبع بس بدون ما يحفظ ملف

بيحفظ البرومبت بملف prompt.txt عشان تفتحه وتنسخ منه بسهولة.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import config
from prompts import STYLES, build_outfit_edit, build_prompt, build_prompt_short

ROOT = Path(__file__).resolve().parent

STEPS = """
════════════════════════════════════════════════════════════════
  الخطوات بـ ChatGPT
════════════════════════════════════════════════════════════════

 ١. افتح شات جديد بـ ChatGPT

 ٢. ارفع الصورتين مع بعض من علامة +  :
      • {person}      ← الشخص
      • {product}      ← المنتج

 ٣. اكتب هالسطر أول:
      Use the FIRST image for the person and the SECOND image only
      for the product. Generate a vertical {aspect} image.

 ٤. الصق البرومبت اللي تحت واضغط إرسال

 ٥. لما تجيك الصورة، نزّلها وشغّل:
      python finish.py الصورة.png

    (بيركّب الشعار والجملة والاسم وبيطلّع مقاسات الإنستا)

════════════════════════════════════════════════════════════════
"""

EDIT_STEPS = """
════════════════════════════════════════════════════════════════
  تبديل اللبس على صورة جاهزة
════════════════════════════════════════════════════════════════

 ١. افتح شات جديد بـ ChatGPT

 ٢. ارفع الصورة اللي طالعة معك (وحدة بس — قبل ما تحط الشعار)

 ٣. الصق البرومبت اللي تحت

 ٤. لما تجيك الصورة، نزّلها وشغّل:
      python finish.py الصورة.png

 ملاحظة: اللبس الجديد بتغيّره من OUTFIT بملف config.py

════════════════════════════════════════════════════════════════
"""


def main() -> None:
    p = argparse.ArgumentParser(description="جهّز البرومبت للصق بـ ChatGPT")
    p.add_argument("--style", choices=STYLES, default="main")
    p.add_argument("--short", action="store_true", help="نسخة أقصر")
    p.add_argument("--edit-outfit", dest="edit_outfit", action="store_true",
                   help="برومبت تبديل اللبس على صورة جاهزة")
    p.add_argument("--no-file", action="store_true", help="بدون حفظ ملف")
    p.add_argument("--no-steps", action="store_true", help="البرومبت بس")
    args = p.parse_args()

    if args.edit_outfit:
        print(EDIT_STEPS)
        print(build_outfit_edit())
        print()
        if not args.no_file:
            out = ROOT / "prompt.txt"
            out.write_text(build_outfit_edit() + "\n", encoding="utf-8")
            print(f"[✓] انحفظ كمان بملف: {out.name}  (افتحه وانسخ منه)")
        return

    text = (build_prompt_short if args.short else build_prompt)(args.style)

    if not args.no_steps:
        product = Path(config.PRODUCT_IMAGE).name if config.PRODUCT_IMAGE else "—"
        print(
            STEPS.format(
                person=Path(config.PERSON_IMAGE).name,
                product=product,
                aspect=config.ASPECT_RATIO,
            )
        )

    print(text)
    print()

    if not args.no_file:
        out = ROOT / "prompt.txt"
        out.write_text(text + "\n", encoding="utf-8")
        print(f"[✓] انحفظ كمان بملف: {out.name}  (افتحه وانسخ منه)")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:  # لما الإخراج ينقطع بـ | head
        pass
