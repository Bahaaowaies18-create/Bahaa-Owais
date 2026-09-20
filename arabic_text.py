# -*- coding: utf-8 -*-
"""
تجهيز النص العربي للرسم على الصورة.

Pillow بترسم الحروف كما هي — يعني العربي بيطلع مقطّع ومقلوب.
هاد الملف بيوصّل الحروف ببعض وبيقلب اتجاه السطر عشان يطلع صح.

إذا كانت المكتبات arabic-reshaper و python-bidi مركّبة بيستعملها (أدق)،
وإذا مش مركّبة بيشتغل بالطريقة المدمجة هون — بدون ما تنصّب إشي.
"""

from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
#  أشكال الحروف: (منفصل، آخر الكلمة، أول الكلمة، وسط الكلمة)
#  None = الحرف ما بوصل من هالجهة
# ─────────────────────────────────────────────────────────────────────────────
FORMS = {
    "ء": ("ﺀ", None, None, None),                      # ء
    "آ": ("ﺁ", "ﺂ", None, None),                  # آ
    "أ": ("ﺃ", "ﺄ", None, None),                  # أ
    "ؤ": ("ﺅ", "ﺆ", None, None),                  # ؤ
    "إ": ("ﺇ", "ﺈ", None, None),                  # إ
    "ئ": ("ﺉ", "ﺊ", "ﺋ", "ﺌ"),          # ئ
    "ا": ("ﺍ", "ﺎ", None, None),                  # ا
    "ب": ("ﺏ", "ﺐ", "ﺑ", "ﺒ"),          # ب
    "ة": ("ﺓ", "ﺔ", None, None),                  # ة
    "ت": ("ﺕ", "ﺖ", "ﺗ", "ﺘ"),          # ت
    "ث": ("ﺙ", "ﺚ", "ﺛ", "ﺜ"),          # ث
    "ج": ("ﺝ", "ﺞ", "ﺟ", "ﺠ"),          # ج
    "ح": ("ﺡ", "ﺢ", "ﺣ", "ﺤ"),          # ح
    "خ": ("ﺥ", "ﺦ", "ﺧ", "ﺨ"),          # خ
    "د": ("ﺩ", "ﺪ", None, None),                  # د
    "ذ": ("ﺫ", "ﺬ", None, None),                  # ذ
    "ر": ("ﺭ", "ﺮ", None, None),                  # ر
    "ز": ("ﺯ", "ﺰ", None, None),                  # ز
    "س": ("ﺱ", "ﺲ", "ﺳ", "ﺴ"),          # س
    "ش": ("ﺵ", "ﺶ", "ﺷ", "ﺸ"),          # ش
    "ص": ("ﺹ", "ﺺ", "ﺻ", "ﺼ"),          # ص
    "ض": ("ﺽ", "ﺾ", "ﺿ", "ﻀ"),          # ض
    "ط": ("ﻁ", "ﻂ", "ﻃ", "ﻄ"),          # ط
    "ظ": ("ﻅ", "ﻆ", "ﻇ", "ﻈ"),          # ظ
    "ع": ("ﻉ", "ﻊ", "ﻋ", "ﻌ"),          # ع
    "غ": ("ﻍ", "ﻎ", "ﻏ", "ﻐ"),          # غ
    "ـ": ("ـ", "ـ", "ـ", "ـ"),          # ـ التطويل
    "ف": ("ﻑ", "ﻒ", "ﻓ", "ﻔ"),          # ف
    "ق": ("ﻕ", "ﻖ", "ﻗ", "ﻘ"),          # ق
    "ك": ("ﻙ", "ﻚ", "ﻛ", "ﻜ"),          # ك
    "ل": ("ﻝ", "ﻞ", "ﻟ", "ﻠ"),          # ل
    "م": ("ﻡ", "ﻢ", "ﻣ", "ﻤ"),          # م
    "ن": ("ﻥ", "ﻦ", "ﻧ", "ﻨ"),          # ن
    "ه": ("ﻩ", "ﻪ", "ﻫ", "ﻬ"),          # ه
    "و": ("ﻭ", "ﻮ", None, None),                  # و
    "ى": ("ﻯ", "ﻰ", None, None),                  # ى
    "ي": ("ﻱ", "ﻲ", "ﻳ", "ﻴ"),          # ي
}

# لام + ألف = حرف واحد
LAM_ALEF = {
    "آ": ("ﻵ", "ﻶ"),   # لآ
    "أ": ("ﻷ", "ﻸ"),   # لأ
    "إ": ("ﻹ", "ﻺ"),   # لإ
    "ا": ("ﻻ", "ﻼ"),   # لا
}

# التشكيل — بينلزق بالحرف اللي قبله وما بينقلب لحاله
MARKS = set("ًٌٍَُِّْٰٕٓٔ")

# الحروف اللي بتوصل من الجهتين
DUAL = {c for c, f in FORMS.items() if f[2] is not None}

ARABIC_RANGES = ((0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF))


def has_arabic(text: str) -> bool:
    """في حروف عربية بالنص؟"""
    return any(
        any(lo <= ord(ch) <= hi for lo, hi in ARABIC_RANGES)
        for ch in str(text)
    )


def _join(text: str) -> str:
    """يبدّل كل حرف بشكله المظبوط حسب اللي قبله واللي بعده."""
    chars = list(text)
    out: list[str] = []
    i = 0
    prev_links = False   # الحرف السابق بوصل لللي بعده؟

    while i < len(chars):
        ch = chars[i]

        # التشكيل بينحط كما هو وما بيكسر الوصل
        if ch in MARKS:
            out.append(ch)
            i += 1
            continue

        if ch not in FORMS:
            out.append(ch)
            prev_links = False
            i += 1
            continue

        # أول حرف جاي (بدون تشكيل) — عشان نعرف إذا منوصل معه
        j = i + 1
        while j < len(chars) and chars[j] in MARKS:
            j += 1
        nxt = chars[j] if j < len(chars) else ""

        # لام + ألف
        if ch == "ل" and nxt in LAM_ALEF:
            isolated, final = LAM_ALEF[nxt]
            out.append(final if prev_links else isolated)
            out.extend(c for c in chars[i + 1 : j] if c in MARKS)
            prev_links = False
            i = j + 1
            continue

        links_next = ch in DUAL and nxt in FORMS
        isolated, final, initial, medial = FORMS[ch]

        if prev_links and links_next:
            shaped = medial or final or isolated
        elif prev_links:
            shaped = final or isolated
        elif links_next:
            shaped = initial or isolated
        else:
            shaped = isolated

        out.append(shaped)
        prev_links = links_next
        i += 1

    return "".join(out)


def _reverse_rtl(text: str) -> str:
    """
    يقلب السطر عشان يتقرأ من اليمين لليسار.
    الكلمات الإنجليزية والأرقام بتضل بترتيبها الطبيعي.
    """
    def is_rtl(ch: str) -> bool:
        return any(lo <= ord(ch) <= hi for lo, hi in ARABIC_RANGES)

    # منجمّع الحرف مع تشكيله كوحدة وحدة
    clusters: list[str] = []
    for ch in text:
        if ch in MARKS and clusters:
            clusters[-1] += ch
        else:
            clusters.append(ch)

    # منقسّم لمقاطع: عربي / غير عربي
    runs: list[tuple[bool, list[str]]] = []
    for cl in clusters:
        rtl = is_rtl(cl[0])
        if runs and runs[-1][0] == rtl:
            runs[-1][1].append(cl)
        else:
            runs.append((rtl, [cl]))

    # المسافات بين مقطعين لاتينيين بتضل معهم
    out: list[str] = []
    for rtl, items in reversed(runs):
        out.append("".join(reversed(items)) if rtl else "".join(items))
    return "".join(out)


def pillow_shapes_arabic() -> bool:
    """Pillow عندها Raqm؟ يعني بتعرف توصّل الحروف العربية لحالها."""
    try:
        from PIL import features

        return bool(features.check("raqm"))
    except Exception:  # noqa: BLE001 — Pillow مش موجودة أو نسخة قديمة
        return False


def direction(text: str) -> str | None:
    """اتجاه الرسم اللي منمرّره لـ Pillow — None يعني الافتراضي."""
    if has_arabic(text) and pillow_shapes_arabic():
        return "rtl"
    return None


def shape(text: str) -> str:
    """
    بيرجّع النص جاهز للرسم بـ Pillow.
    النص اللاتيني بيرجع كما هو بدون تغيير.

    إذا Pillow فيها Raqm منرجّع النص زي ما هو — هي بتوصّل الحروف أحسن مننا،
    وإذا وصّلناه إحنا كمان بتطلع الحروف مقطّعة.
    """
    text = str(text)
    if not has_arabic(text) or pillow_shapes_arabic():
        return text

    # المكتبات المتخصصة إذا كانت مركّبة
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(text))
    except Exception:  # noqa: BLE001 — منكمّل بالطريقة المدمجة
        pass

    return _reverse_rtl(_join(text))


if __name__ == "__main__":  # معاينة سريعة:  python arabic_text.py
    print(f"Raqm: {pillow_shapes_arabic()}")
    for sample in ("ابتسامتك تستاهل الأفضل", "روز", "SMILE_JO مع"):
        print(f"{sample!r:40} → {_reverse_rtl(_join(sample))!r}")
