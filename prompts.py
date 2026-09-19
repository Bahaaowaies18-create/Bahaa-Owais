# -*- coding: utf-8 -*-
"""
بناء البرومبت — عادةً ما بتحتاج تعدّل هون.
الإشي الوحيد اللي ممكن تلعب فيه: REALISM (شدّة الواقعية) إذا بدك.
"""

import textwrap

import config


def _clean(text: str) -> str:
    return textwrap.dedent(str(text)).strip()


# ═══════════════════════════════════════════════════════════════════════════
#  بلوك الواقعية — هاد قلب القالب: ملامح حقيقية + تفاصيل 4K
# ═══════════════════════════════════════════════════════════════════════════
REALISM = """
PHOTOREALISM AND DETAIL — highest priority:

Ultra-detailed 4K editorial photograph, shot on a full-frame camera with an
85mm f/1.8 portrait lens, RAW file quality, natural film-like micro-contrast.

FACIAL IDENTITY — must match the reference exactly:
Preserve the person's real facial structure: the same jawline, chin, cheek
bones, nose shape and width, eye shape, eye color and spacing, eyebrow shape
and thickness, lip shape and thickness, hairline, and hair texture. Do NOT
make the face younger, thinner, more symmetrical, or more "perfect" than the
reference. Keep any freckles, moles, or asymmetries exactly where they are.
The result must read as the same real person, not a lookalike.

SKIN — real, not retouched:
Visible skin pores, fine vellus hair, natural texture and subtle
imperfections, faint natural redness around the nose and under the eyes,
realistic subsurface scattering with soft light passing through the ears and
nose tip. Natural sebum sheen on the forehead, nose and cheekbones — not a
uniform glow. Skin must NOT look smooth, plastic, waxy, airbrushed or
3D-rendered. No beauty filter, no skin smoothing, no face slimming, no eye
enlargement.

EYES, LIPS, HAIR:
Sharp natural catchlights in both eyes, visible iris fiber texture and limbal
ring, natural corneal moisture, individually separated eyelashes with natural
direction. Lips with real texture, fine vertical lines and uneven natural
color. Individual hair strands visible along the hairline with a few natural
flyaways catching the light.

OPTICS AND COLOR:
Tack-sharp focus on the near eye with natural depth-of-field falloff toward
the ears and background. True-to-life color, neutral white balance, accurate
skin tones, no over-saturation, no HDR glow, no heavy vignette, no artificial
sharpening halos.
"""


# ═══════════════════════════════════════════════════════════════════════════
#  الإشي اللي لازم يتجنبه
# ═══════════════════════════════════════════════════════════════════════════
NEGATIVE = """
AVOID COMPLETELY:
plastic or waxy skin, airbrushed or over-smoothed face, AI sheen, uncanny
symmetry, doll-like features, a different person's face, extra or missing
fingers, deformed or fused hands, warped or misspelled logo text, duplicated
limbs, floating objects, text overlays, captions, watermarks, signatures,
cartoon or 3D-render look, over-processed HDR.
"""


# ═══════════════════════════════════════════════════════════════════════════
#  تركيبات الكادر — اختار وحدة بـ --style
# ═══════════════════════════════════════════════════════════════════════════
FRAMINGS = {
    # الوضعية اللي حاططها بملف config
    "main": lambda: _clean(config.POSE),

    # كلوز أب: المنتج قريب من العدسة والوجه وراه
    "closeup": lambda: """
Tight vertical close-up. She holds the product close to the camera with her
right hand, slightly nearer to the lens than her face, the front label facing
the camera and fully readable. Her smiling face sits just behind it, still
sharp enough to read her expression. Shoulders and upper chest visible.
""".strip(),

    # ستوري/ريل مع مساحة فاضية للكتابة
    "social": lambda: """
Vertical 9:16 social-media frame. Compose her in the lower two thirds of the
image, slightly to the right, holding the product up beside her face with her
right hand. Keep the upper-left area as clean empty backdrop so text can be
placed there later. Do not put any text in the image itself.
""".strip(),

    # بورتريه بدون منتج
    "portrait": lambda: """
Waist-up vertical studio portrait. Hands relaxed at her sides or lightly
crossed in front, shoulders slightly angled to the camera, face turned toward
the lens with a natural confident expression.
""".strip(),
}

STYLES = sorted(FRAMINGS)


def build_prompt(style: str = "main") -> str:
    """يركّب البرومبت النهائي من ملف config + بلوك الواقعية."""
    if style not in FRAMINGS:
        raise ValueError(f"ستايل غير معروف: {style} — المتاح: {', '.join(STYLES)}")

    has_product = bool(config.PRODUCT_IMAGE) and bool(str(config.PRODUCT_DESCRIPTION).strip())

    parts = [
        "Create ONE photorealistic vertical commercial photograph.",
        "",
        "SUBJECT — take the person from the FIRST reference image:",
        _clean(config.PERSON_DESCRIPTION),
        "Keep her exactly as she appears in the first reference image. She must "
        "be instantly recognizable as the same person.",
    ]

    if has_product:
        parts += [
            "",
            "PRODUCT — take it from the SECOND reference image:",
            _clean(config.PRODUCT_DESCRIPTION),
            "",
            "IMPORTANT: use ONLY the product from the second image. Do NOT copy "
            "any person, hair, clothing, lighting or background from it.",
        ]

    parts += [
        "",
        "POSE AND FRAMING:",
        FRAMINGS[style](),
        "",
        "LIGHTING AND BACKGROUND:",
        _clean(config.SCENE),
        "",
        _clean(REALISM),
        "",
        _clean(NEGATIVE),
    ]

    return "\n".join(parts)


# توافق مع النسخة القديمة
PROMPTS = {name: build_prompt(name) for name in STYLES}


if __name__ == "__main__":  # للمعاينة:  python prompts.py
    print(build_prompt("main"))
