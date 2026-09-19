# -*- coding: utf-8 -*-
"""
===============================================================================
  ملف الإعدادات — هاد الملف الوحيد اللي بتغيّره
===============================================================================
  كل مرة بدك صورة جديدة:
     ١. حط صورتك الجديدة بمجلد  assets/
     ٢. غيّر اسم الصورة تحت بـ PERSON_IMAGE
     ٣. عدّل الوصف إذا الشخص أو المنتج اختلف
     ٤. شغّل:  python generate_rose_image.py
  باقي الملفات ما بتلمسها.
===============================================================================
"""

# ─────────────────────────────────────────────────────────────────────────────
#  ١) الصور المرجعية
# ─────────────────────────────────────────────────────────────────────────────

# صورة الشخص — غيّر الاسم بس
PERSON_IMAGE = "assets/rose.png"

# صورة المنتج — حط None إذا ما في منتج بالصورة
PRODUCT_IMAGE = "assets/retainer_case.png"


# ─────────────────────────────────────────────────────────────────────────────
#  ٢) وصف الشخص  (كل ما كان أدق، كل ما ضلّت الملامح أقرب للأصل)
# ─────────────────────────────────────────────────────────────────────────────
PERSON_DESCRIPTION = """
A woman in her late twenties with long dark brown wavy hair falling over her
left shoulder, warm olive skin, thick natural eyebrows, light brown eyes,
and a soft natural smile. She wears a cream tailored blazer over an ivory
satin button-down shirt.
"""


# ─────────────────────────────────────────────────────────────────────────────
#  ٣) وصف المنتج  (خليه "" إذا PRODUCT_IMAGE = None)
# ─────────────────────────────────────────────────────────────────────────────
PRODUCT_DESCRIPTION = """
A glossy bright yellow orthodontic retainer / clear-aligner case: a plastic
clamshell box with two small dark hinge dots on the top edge, and a round
white sticker on the front showing a thin blue triangle outline with the
black "SMILE_JO" monogram inside it. The sticker artwork and its text must
stay sharp, upright, correctly spelled and fully readable.
"""


# ─────────────────────────────────────────────────────────────────────────────
#  ٤) الوضعية — كيف بدك ياها ماسكة المنتج
# ─────────────────────────────────────────────────────────────────────────────
POSE = """
Waist-up vertical portrait. She holds the closed product up beside her face at
about cheek height with her right hand, fingers relaxed and natural, the front
label facing the camera and not covered by her fingers. Her face stays fully
visible and unobstructed. She looks straight into the lens.
"""


# ─────────────────────────────────────────────────────────────────────────────
#  ٥) الخلفية والإضاءة
# ─────────────────────────────────────────────────────────────────────────────
SCENE = """
Clean seamless studio backdrop in soft warm beige. One large softbox key light
from the front-left at 45 degrees, a gentle fill from the right, and a subtle
hair light. Soft natural shadows, no harsh contrast.
"""


# ─────────────────────────────────────────────────────────────────────────────
#  ٦) إعدادات المخرجات
# ─────────────────────────────────────────────────────────────────────────────

ASPECT_RATIO = "9:16"   # "9:16" ستوري | "4:5" بوست | "1:1" مربع | "16:9" عرضي
RESOLUTION   = "2K"     # "1K" | "2K" | "4K"  (حسب دعم الموديل)
COUNT        = 2        # عدد النسخ بكل تشغيلة
UPSCALE_4K   = True     # يكبّر الناتج لعرض 3840px قبل الحفظ

# الموديل — للواقعية الأعلى جرّب: "gemini-3-pro-image-preview"
MODEL = "gemini-2.5-flash-image"
