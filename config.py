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


# ─────────────────────────────────────────────────────────────────────────────
#  ٧) الهوية البصرية — SMILE_JO
#     الألوان هاي مستخرجة من صورة العلبة تبعتك.
#     إذا ألوان الإنستا عندك مختلفة، بدّل الأكواد تحت بس.
# ─────────────────────────────────────────────────────────────────────────────

BRAND_ENABLED = True            # False = صورة بدون شعار

# ملف الشعار (PNG بخلفية شفافة)
BRAND_LOGO = "assets/logo.png"

# نسخة الشعار للخلفيات الفاتحة (الأبيض فيها صار غامق)
# خليها None إذا بدك نفس الشعار دايماً
BRAND_LOGO_DARK = "assets/logo_dark.png"

# الكلمة اللي بتنكتب — بالإنجليزي
BRAND_TEXT = ""                  # "" = الشعار لحاله (الكلمة أصلاً جواه)
                                 # حط "SMILE_JO" إذا بدك الكلمة كمان تحته

# ألوان الهوية — مستخرجة من ملف الشعار الأصلي
BRAND_PRIMARY      = "#014FC9"   # أزرق المثلث
BRAND_ACCENT       = "#F9C03C"   # أصفر العلبة
BRAND_DARK         = "#23232A"   # الغامق
BRAND_LIGHT        = "#F7F7F7"   # أبيض الشعار

BRAND_TEXT_COLOR   = "auto"     # "auto" = يختار حسب الخلفية | أو حط كود لون
BRAND_TEXT_SHADOW  = "#23232A"   # لون الظل خلف الكتابة

# مكان الشعار: top-left | top-right | top-center
#              bottom-left | bottom-right | bottom-center
BRAND_POSITION = "top-right"

# مكان الكتابة لما BRAND_TEXT_UNDER_LOGO = False
BRAND_TEXT_POSITION = "bottom-center"
BRAND_TEXT_UNDER_LOGO = True     # True = الكلمة تحت الشعار مباشرة

# المقاسات كنسبة من عرض الصورة
BRAND_LOGO_SIZE = 0.22           # حجم الشعار  (0.12 صغير — 0.28 كبير)
BRAND_TEXT_SIZE = 0.030          # حجم الكتابة
BRAND_MARGIN    = 0.045          # بعده عن الحافة
BRAND_OPACITY   = 0.95           # الشفافية (1.0 = صريح تماماً)

BRAND_BAR = True                 # شريط رفيع بلون الهوية تحت الصورة

# خط الكتابة — حط مسار ملف .ttf إذا بدك خط الهوية بالضبط
BRAND_FONT = None

# يخلي ألوان الصورة نفسها (خلفية، إضاءة، إكسسوارات) تمشي مع الهوية
BRAND_PALETTE_IN_PROMPT = True
