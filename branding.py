# -*- coding: utf-8 -*-
"""
تركيب الشعار والاسم على الصورة بعد التوليد.

ليش بعد التوليد مش بالبرومبت؟ لأن موديلات الصور بتشوّه الشعارات والكتابة.
هون الشعار بينحط كما هو بالضبط — نفس الألوان ونفس الإملاء كل مرة.
"""

from __future__ import annotations

import io
from pathlib import Path

import config

ROOT = Path(__file__).resolve().parent

# خطوط بنجرّبها بالترتيب حسب نظام التشغيل
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Georgia.ttf",          # macOS
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "C:/Windows/Fonts/georgia.ttf",                            # Windows
    "C:/Windows/Fonts/times.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",   # Linux
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _hex(value: str) -> tuple[int, int, int]:
    v = str(value).lstrip("#")
    return tuple(int(v[i : i + 2], 16) for i in (0, 2, 4))


def _find_font(size: int):
    from PIL import ImageFont

    paths = []
    if getattr(config, "BRAND_FONT", None):
        paths.append(str(resolve(config.BRAND_FONT)))
    paths += FONT_CANDIDATES
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:  # noqa: BLE001 — منجرّب الخط اللي بعده
            continue
    print("[i] ما لقيت خط مناسب — استعملت الخط الافتراضي. حدّد BRAND_FONT بـ config.py")
    return ImageFont.load_default()


def resolve(path_like):
    p = Path(path_like)
    return p if p.is_absolute() else ROOT / p


def _anchor(position: str, box_w: int, box_h: int, img_w: int, img_h: int, pad: int):
    """يحسب إحداثيات الزاوية حسب الموقع المطلوب."""
    left = pad
    right = img_w - box_w - pad
    center = (img_w - box_w) // 2
    top = pad
    bottom = img_h - box_h - pad

    table = {
        "top-left": (left, top),
        "top-right": (right, top),
        "top-center": (center, top),
        "bottom-left": (left, bottom),
        "bottom-right": (right, bottom),
        "bottom-center": (center, bottom),
    }
    if position not in table:
        raise ValueError(
            f"موقع غير معروف: {position} — المتاح: {', '.join(table)}"
        )
    return table[position]


def _avg_luma(img, box) -> float:
    """متوسط سطوع منطقة — منستعمله نختار لون الكتابة تلقائياً."""
    x0, y0, x1, y1 = (max(0, box[0]), max(0, box[1]),
                      min(img.width, box[2]), min(img.height, box[3]))
    if x1 <= x0 or y1 <= y0:
        return 128.0
    small = img.crop((x0, y0, x1, y1)).convert("RGB").resize((12, 12))
    pixels = list(small.getdata())
    return sum(0.299 * r + 0.587 * g + 0.114 * b for r, g, b in pixels) / len(pixels)


def _pick_text_color(img, box) -> str:
    """auto = غامق على الخلفية الفاتحة، فاتح على الغامقة."""
    setting = str(getattr(config, "BRAND_TEXT_COLOR", "auto"))
    if setting.lower() != "auto":
        return setting
    return config.BRAND_DARK if _avg_luma(img, box) > 140 else config.BRAND_LIGHT


def _pick_logo(img, box):
    """بيختار نسخة الشعار المناسبة لسطوع الخلفية وراه."""
    light_bg = _avg_luma(img, box) > 140
    dark_variant = getattr(config, "BRAND_LOGO_DARK", None)
    if light_bg and dark_variant:
        p = resolve(dark_variant)
        if p.exists():
            return p
    return resolve(config.BRAND_LOGO) if config.BRAND_LOGO else None


def apply_branding(image_bytes: bytes) -> bytes:
    """بيركّب الشعار + كلمة SMILE_JO + شريط اللون على الصورة."""
    if not getattr(config, "BRAND_ENABLED", False):
        return image_bytes

    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print("[i] تخطّيت الشعار — نصّب Pillow:  pip install pillow")
        return image_bytes

    base = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    W, H = base.size
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    pad = int(W * config.BRAND_MARGIN)
    opacity = int(255 * config.BRAND_OPACITY)

    # ── ١) شريط لون الهوية على الحافة السفلية ──────────────────────────────
    if config.BRAND_BAR:
        bar_h = max(4, int(H * 0.006))
        draw.rectangle([0, H - bar_h, W, H], fill=_hex(config.BRAND_PRIMARY) + (255,))

    # ── ٢) الشعار ───────────────────────────────────────────────────────────
    logo_bottom = pad
    probe_w = int(W * config.BRAND_LOGO_SIZE)
    probe_x, probe_y = _anchor(config.BRAND_POSITION, probe_w, probe_w, W, H, pad)
    logo_path = _pick_logo(base, (probe_x, probe_y, probe_x + probe_w, probe_y + probe_w))

    if logo_path and logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA")
        target_w = probe_w
        target_h = round(logo.height * target_w / logo.width)
        logo = logo.resize((target_w, target_h), Image.LANCZOS)

        if opacity < 255:
            alpha = logo.getchannel("A").point(lambda a: a * opacity // 255)
            logo.putalpha(alpha)

        x, y = _anchor(config.BRAND_POSITION, target_w, target_h, W, H, pad)
        layer.alpha_composite(logo, (x, y))
        logo_bottom = y + target_h
    elif logo_path:
        print(f"[i] ما لقيت ملف الشعار: {logo_path} — ركّبت الاسم بس")

    # ── ٣) كلمة SMILE_JO ────────────────────────────────────────────────────
    text = str(config.BRAND_TEXT or "").strip()
    if text:
        font = _find_font(max(14, int(W * config.BRAND_TEXT_SIZE)))
        l, t, r, b = draw.textbbox((0, 0), text, font=font)
        tw, th = r - l, b - t

        if config.BRAND_TEXT_UNDER_LOGO and logo_path and logo_path.exists():
            # تحت الشعار وبمحاذاته
            lx, _ = _anchor(
                config.BRAND_POSITION,
                int(W * config.BRAND_LOGO_SIZE),
                0, W, H, pad,
            )
            tx = lx + (int(W * config.BRAND_LOGO_SIZE) - tw) // 2
            ty = logo_bottom + int(W * 0.012)
        else:
            tx, ty = _anchor(config.BRAND_TEXT_POSITION, tw, th, W, H, pad)

        # لون الكتابة: تلقائي حسب سطوع الخلفية وراها
        text_color = _pick_text_color(base, (tx, ty, tx + tw, ty + th))
        shadow_color = (
            config.BRAND_LIGHT
            if text_color.lower() == str(config.BRAND_DARK).lower()
            else config.BRAND_DARK
        )

        # ظل خفيف عشان يضل مقروء على أي خلفية
        off = max(1, int(W * 0.0015))
        draw.text(
            (tx - l + off, ty - t + off), text, font=font,
            fill=_hex(shadow_color) + (int(opacity * 0.40),),
        )
        draw.text(
            (tx - l, ty - t), text, font=font,
            fill=_hex(text_color) + (opacity,),
        )

    out = Image.alpha_composite(base, layer).convert("RGB")
    buf = io.BytesIO()
    out.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
