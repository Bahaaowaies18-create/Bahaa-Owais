#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
المحرّك — ما بتحتاج تعدّل هون. كل الإعدادات بملف config.py

    python generate_rose_image.py                 # حسب config.py
    python generate_rose_image.py --style social  # ستايل تاني
    python generate_rose_image.py -n 4            # ٤ نسخ
    python generate_rose_image.py --show-prompt   # يطبع البرومبت بدون ما يولّد
"""

from __future__ import annotations

import argparse
import base64
import mimetypes
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import config
from branding import apply_branding
from prompts import STYLES, build_prompt

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "output"

# عرض الصورة النهائية لما UPSCALE_4K = True
UPSCALE_WIDTH = 3840


# ─────────────────────────────── أدوات مساعدة ──────────────────────────────
def load_dotenv(path: Path = ROOT / ".env") -> None:
    """قراءة بسيطة لملف .env بدون مكتبات خارجية."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def resolve(path_like) -> Path | None:
    """يحوّل المسار اللي بـ config لمسار كامل."""
    if not path_like:
        return None
    p = Path(path_like)
    return p if p.is_absolute() else ROOT / p


def read_image(path: Path) -> tuple[bytes, str]:
    if not path.exists():
        sys.exit(f"[!] ما لقيت الصورة: {path}\n    تأكد إن الاسم بملف config.py مظبوط.")
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return path.read_bytes(), mime


def upscale(data: bytes, width: int = UPSCALE_WIDTH) -> bytes:
    """تكبير الناتج لعرض أكبر. ملاحظة: إعادة تحجيم، مش تفاصيل جديدة."""
    try:
        import io

        from PIL import Image
    except ImportError:
        print("[i] تخطّيت التكبير — نصّب Pillow:  pip install pillow")
        return data

    with Image.open(io.BytesIO(data)) as im:
        if im.width >= width:
            return data
        height = round(im.height * width / im.width)
        big = im.convert("RGB").resize((width, height), Image.LANCZOS)
        buf = io.BytesIO()
        big.save(buf, format="PNG", optimize=True)
        print(f"[i] كبّرت الصورة: {im.width}px -> {width}px")
        return buf.getvalue()


def save_image(data: bytes, out_dir: Path, style: str, index: int) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = out_dir / f"{style}_{stamp}_{index:02d}.png"
    out_path.write_bytes(data)
    return out_path


# ───────────────────────────── المزوّد: Gemini ─────────────────────────────
def generate_with_gemini(
    prompt: str,
    person: Path,
    product: Path | None,
    model: str,
    aspect_ratio: str,
    resolution: str,
    count: int,
) -> list[bytes]:
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        sys.exit("[!] نصّب المكتبة أول:  pip install google-genai")

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        sys.exit("[!] حط GEMINI_API_KEY بملف .env أو بالبيئة")

    client = genai.Client(api_key=api_key)

    person_bytes, person_mime = read_image(person)
    contents = [
        prompt,
        "FIRST reference image — the person. Keep her face and features exactly:",
        types.Part.from_bytes(data=person_bytes, mime_type=person_mime),
    ]
    if product:
        product_bytes, product_mime = read_image(product)
        contents += [
            "SECOND reference image — use ONLY the product from it:",
            types.Part.from_bytes(data=product_bytes, mime_type=product_mime),
        ]

    def candidate_configs():
        """من الأدق للأبسط — إذا الموديل ما دعم إعداد، منجرّب اللي بعده."""
        out = []
        if hasattr(types, "ImageConfig"):
            fields = types.ImageConfig.model_fields
            if resolution and "image_size" in fields:
                out.append(
                    (
                        f"دقة {resolution}",
                        types.GenerateContentConfig(
                            response_modalities=["IMAGE"],
                            image_config=types.ImageConfig(
                                aspect_ratio=aspect_ratio, image_size=resolution
                            ),
                        ),
                    )
                )
            out.append(
                (
                    "الدقة الافتراضية للموديل",
                    types.GenerateContentConfig(
                        response_modalities=["IMAGE"],
                        image_config=types.ImageConfig(aspect_ratio=aspect_ratio),
                    ),
                )
            )
        out.append(
            ("بدون إعدادات صورة", types.GenerateContentConfig(response_modalities=["IMAGE"]))
        )
        out.append(
            (
                "وضع نص + صورة",
                types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
            )
        )
        return out

    images: list[bytes] = []
    for i in range(count):
        response, last_error = None, None
        for attempt, (label, cfg) in enumerate(candidate_configs()):
            try:
                response = client.models.generate_content(
                    model=model, contents=contents, config=cfg
                )
                if attempt > 0 and i == 0:
                    print(
                        f"[!] الموديل {model} ما قبل الإعداد المطلوب — "
                        f"الصورة اتولّدت بـ({label}) مش بدقة {resolution}.\n"
                        f"    للدقة الأعلى فعلياً، جرّب بـ config.py:\n"
                        f'    MODEL = "gemini-3-pro-image-preview"'
                    )
                break
            except Exception as exc:  # noqa: BLE001 — منجرّب الإعداد اللي بعده
                last_error = exc
                # غلط مفتاح/صلاحيات؟ ما في فايدة من باقي المحاولات
                if any(
                    k in str(exc)
                    for k in ("API key", "PERMISSION_DENIED", "UNAUTHENTICATED")
                ):
                    break
        if response is None:
            raise RuntimeError(f"فشل طلب Gemini: {last_error}")

        found = False
        for candidate in response.candidates or []:
            for part in candidate.content.parts or []:
                inline = getattr(part, "inline_data", None)
                if inline and inline.data:
                    images.append(inline.data)
                    found = True
                elif getattr(part, "text", None):
                    print(f"[model] {part.text.strip()[:300]}")
        if not found:
            print(f"[!] النسخة رقم {i + 1} ما رجّعت صورة — جرّب مرة تانية.")
        if i < count - 1:
            time.sleep(1.5)

    return images


# ────────────────────────── المزوّد البديل: OpenAI ─────────────────────────
def generate_with_openai(
    prompt: str, person: Path, product: Path | None, model: str, size: str, count: int
) -> list[bytes]:
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("[!] نصّب المكتبة أول:  pip install openai")

    if not os.getenv("OPENAI_API_KEY"):
        sys.exit("[!] حط OPENAI_API_KEY بملف .env أو بالبيئة")

    client = OpenAI()
    handles = [person.open("rb")]
    if product:
        handles.append(product.open("rb"))
    try:
        result = client.images.edit(
            model=model, image=handles, prompt=prompt, size=size, n=count
        )
    finally:
        for h in handles:
            h.close()
    return [base64.b64decode(item.b64_json) for item in result.data]


# ─────────────────────────────────── CLI ───────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="قالب توليد صور — الإعدادات بملف config.py",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--style", choices=STYLES, default="main")
    p.add_argument("--provider", choices=["gemini", "openai"], default="gemini")
    p.add_argument("-n", "--count", type=int, default=config.COUNT)
    p.add_argument("--person", type=Path, default=None, help="يتجاوز config")
    p.add_argument("--product", type=Path, default=None, help="يتجاوز config")
    p.add_argument("--aspect", default=config.ASPECT_RATIO)
    p.add_argument("--resolution", default=config.RESOLUTION, help="1K / 2K / 4K")
    p.add_argument("--model", default=None)
    p.add_argument("--out-dir", type=Path, default=OUTPUT_DIR)
    p.add_argument("--prompt", help="برومبت مخصص بالكامل")
    p.add_argument("--prompt-file", type=Path)
    p.add_argument("--no-upscale", action="store_true", help="بدون تكبير")
    p.add_argument("--no-brand", action="store_true", help="بدون شعار")
    p.add_argument("--show-prompt", action="store_true", help="اطبع البرومبت وبس")
    p.add_argument("--size", default="1024x1536", help="أبعاد OpenAI")
    return p.parse_args()


def main() -> None:
    load_dotenv()
    args = parse_args()

    if args.prompt_file:
        prompt = args.prompt_file.read_text(encoding="utf-8")
    elif args.prompt:
        prompt = args.prompt
    else:
        prompt = build_prompt(args.style)

    if args.show_prompt:
        print(prompt)
        return

    person = args.person or resolve(config.PERSON_IMAGE)
    product = args.product or resolve(config.PRODUCT_IMAGE)

    print(
        f"[i] {args.provider} | ستايل: {args.style} | نسخ: {args.count} | "
        f"أبعاد: {args.aspect} | دقة: {args.resolution}"
    )
    print(f"[i] الشخص: {person.name}" + (f" | المنتج: {product.name}" if product else ""))

    try:
        if args.provider == "gemini":
            model = args.model or config.MODEL
            images = generate_with_gemini(
                prompt, person, product, model, args.aspect, args.resolution, args.count
            )
        else:
            model = args.model or "gpt-image-1"
            images = generate_with_openai(
                prompt, person, product, model, args.size, args.count
            )
    except Exception as exc:  # noqa: BLE001 — رسالة واضحة بدل traceback
        sys.exit(f"[!] {exc}")

    if not images:
        sys.exit("[!] ما طلعت ولا صورة. جرّب مرة تانية أو غيّر البرومبت.")

    do_upscale = config.UPSCALE_4K and not args.no_upscale
    do_brand = config.BRAND_ENABLED and not args.no_brand
    for i, data in enumerate(images, start=1):
        if do_upscale:
            data = upscale(data)
        if do_brand:
            data = apply_branding(data)
        print(f"[✓] انحفظت: {save_image(data, args.out_dir, args.style, i)}")


if __name__ == "__main__":
    main()
