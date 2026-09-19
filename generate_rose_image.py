#!/usr/bin/env python3
"""توليد صورة لروز وهي ماسكة علبة الفنير المتحرك (SMILE_JO).

بياخد صورتين مرجعيتين:
  assets/rose.png           -> الشخص (روز)
  assets/retainer_case.png  -> المنتج (علبة الفنير الصفرا)

وبيطلع صورة جديدة بمجلد output/.

مثال:
    python generate_rose_image.py
    python generate_rose_image.py --style social -n 3
    python generate_rose_image.py --provider openai --size 1024x1536
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

from prompts import PROMPTS

ROOT = Path(__file__).resolve().parent
DEFAULT_PERSON = ROOT / "assets" / "rose.png"
DEFAULT_PRODUCT = ROOT / "assets" / "retainer_case.png"
DEFAULT_OUTPUT_DIR = ROOT / "output"

# حدود قص المنتج من الصورة المرجعية الثانية (left, top, right, bottom)
PRODUCT_CROP_BOX = (150, 660, 500, 1070)


# --------------------------------------------------------------------------- #
# أدوات مساعدة
# --------------------------------------------------------------------------- #
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


def read_image(path: Path) -> tuple[bytes, str]:
    if not path.exists():
        sys.exit(f"[!] ما لقيت الصورة: {path}")
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return path.read_bytes(), mime


def save_image(data: bytes, out_dir: Path, style: str, index: int, ext: str = "png") -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = out_dir / f"rose_case_{style}_{stamp}_{index:02d}.{ext}"
    out_path.write_bytes(data)
    return out_path


def crop_product(src: Path, dst: Path, box: tuple[int, int, int, int]) -> Path:
    """قص علبة الفنير لحالها من الصورة المرجعية — بيقلل احتمال خلط الوجوه."""
    try:
        from PIL import Image
    except ImportError:
        sys.exit("[!] لازم تنصب Pillow لاستخدام --crop-product:  pip install pillow")
    with Image.open(src) as im:
        im.convert("RGB").crop(box).save(dst)
    print(f"[i] انقصّت صورة المنتج -> {dst}")
    return dst


# --------------------------------------------------------------------------- #
# المزوّد: Gemini (الافتراضي — بياخد الصورتين المرجعيتين مع بعض)
# --------------------------------------------------------------------------- #
def generate_with_gemini(
    prompt: str,
    person: Path,
    product: Path,
    model: str,
    aspect_ratio: str,
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
    product_bytes, product_mime = read_image(product)

    contents = [
        prompt,
        "FIRST reference image (the woman — keep her face exactly):",
        types.Part.from_bytes(data=person_bytes, mime_type=person_mime),
        "SECOND reference image (use ONLY the yellow retainer case product):",
        types.Part.from_bytes(data=product_bytes, mime_type=product_mime),
    ]

    def build_config():
        """بعض إصدارات الـ SDK ما بتدعم image_config — منرجع خيارين."""
        configs = []
        if hasattr(types, "ImageConfig"):
            configs.append(
                types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    image_config=types.ImageConfig(aspect_ratio=aspect_ratio),
                )
            )
        configs.append(types.GenerateContentConfig(response_modalities=["IMAGE"]))
        configs.append(types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]))
        return configs

    images: list[bytes] = []
    for i in range(count):
        last_error: Exception | None = None
        for config in build_config():
            try:
                response = client.models.generate_content(
                    model=model, contents=contents, config=config
                )
                break
            except Exception as exc:  # noqa: BLE001 — منجرّب الإعداد اللي بعده
                last_error = exc
                response = None
                # غلط مفتاح/صلاحيات؟ ما في فايدة من تجربة باقي الإعدادات
                if any(k in str(exc) for k in ("API key", "PERMISSION_DENIED", "UNAUTHENTICATED")):
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


# --------------------------------------------------------------------------- #
# المزوّد البديل: OpenAI gpt-image-1
# --------------------------------------------------------------------------- #
def generate_with_openai(
    prompt: str,
    person: Path,
    product: Path,
    model: str,
    size: str,
    count: int,
) -> list[bytes]:
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("[!] نصّب المكتبة أول:  pip install openai")

    if not os.getenv("OPENAI_API_KEY"):
        sys.exit("[!] حط OPENAI_API_KEY بملف .env أو بالبيئة")

    client = OpenAI()
    with person.open("rb") as f1, product.open("rb") as f2:
        result = client.images.edit(
            model=model,
            image=[f1, f2],
            prompt=prompt,
            size=size,
            n=count,
        )
    return [base64.b64decode(item.b64_json) for item in result.data]


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="توليد صورة لروز ماسكة علبة الفنير المتحرك",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--provider", choices=["gemini", "openai"], default="gemini", help="مزوّد التوليد"
    )
    parser.add_argument(
        "--style", choices=sorted(PROMPTS), default="main", help="شكل الصورة المطلوبة"
    )
    parser.add_argument("--prompt", help="برومبت مخصص بدل الجاهز")
    parser.add_argument("--prompt-file", type=Path, help="ملف نصي فيه البرومبت")
    parser.add_argument("--person", type=Path, default=DEFAULT_PERSON, help="صورة روز")
    parser.add_argument("--product", type=Path, default=DEFAULT_PRODUCT, help="صورة العلبة")
    parser.add_argument(
        "--crop-product",
        action="store_true",
        help="قص العلبة لحالها من صورة المنتج قبل الإرسال (بينصح فيه)",
    )
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="مجلد الحفظ")
    parser.add_argument("-n", "--count", type=int, default=1, help="عدد النسخ")
    parser.add_argument("--model", help="اسم الموديل (افتراضي حسب المزوّد)")
    parser.add_argument("--aspect", default="9:16", help="نسبة الأبعاد (Gemini)")
    parser.add_argument("--size", default="1024x1536", help="أبعاد الصورة (OpenAI)")
    return parser.parse_args()


def main() -> None:
    load_dotenv()
    args = parse_args()

    if args.prompt_file:
        prompt = args.prompt_file.read_text(encoding="utf-8")
    elif args.prompt:
        prompt = args.prompt
    else:
        prompt = PROMPTS[args.style]

    product = args.product
    if args.crop_product:
        product = crop_product(
            args.product, args.out_dir / "product_cropped.png", PRODUCT_CROP_BOX
        )

    print(f"[i] المزوّد: {args.provider} | الستايل: {args.style} | عدد النسخ: {args.count}")

    try:
        if args.provider == "gemini":
            model = args.model or "gemini-2.5-flash-image"
            images = generate_with_gemini(
                prompt, args.person, product, model, args.aspect, args.count
            )
        else:
            model = args.model or "gpt-image-1"
            images = generate_with_openai(
                prompt, args.person, product, model, args.size, args.count
            )
    except Exception as exc:  # noqa: BLE001 — رسالة واضحة بدل traceback
        sys.exit(f"[!] {exc}")

    if not images:
        sys.exit("[!] ما طلعت ولا صورة. جرّب مرة تانية أو غيّر البرومبت.")

    for i, data in enumerate(images, start=1):
        path = save_image(data, args.out_dir, args.style, i)
        print(f"[✓] انحفظت: {path}")


if __name__ == "__main__":
    main()
