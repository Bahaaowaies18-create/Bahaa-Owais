# قالب توليد الصور — واقعية عالية بنمط 4K

قالب جاهز بتستعمله دايماً. كل مرة بدك صورة جديدة **بتغيّر ملف واحد بس**:
`config.py`.

## الملفات

| الملف | بتلمسه؟ | الوظيفة |
|---|---|---|
| **`config.py`** | ✅ **هاد اللي بتغيّره** | الصور + الأوصاف + الإعدادات |
| `prompts.py` | ❌ | بيركّب البرومبت + بلوك الواقعية |
| `generate_rose_image.py` | ❌ | المحرّك |
| `assets/` | ✅ | حط صورك هون |
| `output/` | — | الصور المولّدة |

---

## الاستخدام اليومي (٣ خطوات)

**١. حط صورتك الجديدة بمجلد `assets/`** — مثلاً `assets/sara.png`

**٢. افتح `config.py` وغيّر سطرين:**

```python
PERSON_IMAGE = "assets/sara.png"        # ← اسم صورتك الجديدة

PERSON_DESCRIPTION = """
A woman in her thirties with shoulder-length straight black hair,
fair skin, dark brown eyes, wearing a navy blue medical scrub top.
"""
```

**٣. شغّل:**

```bash
python generate_rose_image.py
```

خلص. الصور بتنحفظ بـ `output/`.

---

## تغيير المنتج

```python
PRODUCT_IMAGE = "assets/whitening_kit.png"

PRODUCT_DESCRIPTION = """
A white teeth-whitening kit box with a silver foil logo on the front.
"""
```

**ما في منتج بالصورة؟** حط:

```python
PRODUCT_IMAGE = None
```

والسكربت بيتجاهل كل إشي له علاقة بالمنتج تلقائياً.

---

## الستايلات الجاهزة

```bash
python generate_rose_image.py --style main      # ماسكة المنتج جنب وجهها
python generate_rose_image.py --style closeup   # كلوز أب على المنتج
python generate_rose_image.py --style social    # ستوري ٩:١٦ مع مساحة للكتابة
python generate_rose_image.py --style portrait  # بورتريه بدون منتج
```

---

## إعدادات الجودة (بـ `config.py`)

```python
ASPECT_RATIO = "9:16"   # ستوري | "4:5" بوست | "1:1" مربع | "16:9" عرضي
RESOLUTION   = "2K"     # "1K" | "2K" | "4K"
COUNT        = 2        # كم نسخة بكل تشغيلة
UPSCALE_4K   = True     # يكبّر الناتج لعرض 3840px
MODEL = "gemini-2.5-flash-image"
```

**ملاحظة مهمة عن الـ 4K:** `RESOLUTION` بيطلب من الموديل يولّد بدقة أعلى —
هاد تفاصيل حقيقية. أما `UPSCALE_4K` فبكبّر الصورة بعد التوليد، يعني بيعطيك
ملف بمقاس 4K بس **بدون تفاصيل جديدة**. للتفاصيل الحقيقية الأعلى، جرّب موديل
أقوى:

```python
MODEL = "gemini-3-pro-image-preview"
```

إذا طلع خطأ إن الموديل مش متاح لحسابك، ارجع للافتراضي.

---

## من وين بتجي الواقعية؟

كل برومبت بينبني تلقائياً وجواه بلوك اسمه `REALISM` بملف `prompts.py`، وهو
اللي بيمنع "الوجه البلاستيكي" المعروف بصور الـ AI. بيطلب:

- **ثبات الملامح:** نفس الفك، الأنف، شكل العيون والمسافة بينهن، الحواجب،
  الشفايف، وخط الشعر — بدون تنحيف ولا تصغير أنف ولا تكبير عيون.
- **بشرة حقيقية:** مسام ظاهرة، شعيرات ناعمة، احمرار طبيعي حوالين الأنف وتحت
  العيون، لمعة دهنية طبيعية مش موحّدة.
- **عيون وشعر:** انعكاس ضوء حاد بالعين، نسيج القزحية، رموش منفصلة، شعيرات
  طايرة عند خط الشعر.
- **عدسة حقيقية:** 85mm f/1.8، فوكس حاد على العين، تدرّج طبيعي بالخلفية.
- **قائمة ممنوعات:** بشرة شمعية، تنعيم زايد، تناظر مبالغ فيه، أصابع زيادة،
  شعار مشوّه، علامات مائية.

بدك تزيد أو تنقّص شدّة الواقعية؟ عدّل `REALISM` بملف `prompts.py`.

---

## أوامر مفيدة

```bash
# شوف البرومبت قبل ما تولّد (بدون ما تصرف رصيد)
python generate_rose_image.py --show-prompt

# ٦ نسخ واختار الأحسن
python generate_rose_image.py -n 6

# تجاوز مؤقت بدون ما تعدّل config
python generate_rose_image.py --person assets/lara.png --aspect 4:5

# بدون تكبير
python generate_rose_image.py --no-upscale
```

---

## التنصيب (مرة وحدة)

```bash
pip install -r requirements.txt
cp .env.example .env     # وحط GEMINI_API_KEY جواه
```

المفتاح من: https://aistudio.google.com/apikey

---

## نصائح للنتيجة الأحسن

1. **صورة مرجعية واضحة** = ملامح أثبت. صورة ضبابية أو صغيرة بتخلي الموديل
   "يخترع" ملامح.
2. **ولّد ٤–٦ نسخ** واختار — اليدين والشعارات أكتر إشي بيطلع مشوّه.
3. **الوصف الدقيق بيثبّت الملامح.** كل ما كتبت تفاصيل أكتر بـ
   `PERSON_DESCRIPTION` (لون العيون، شكل الشعر، اللبس)، كل ما قلّ الانحراف.
4. **إذا الشعار طلع مشوّه:** صوّر المنتج لحاله على خلفية بيضا واستعمل تلك
   الصورة كـ `PRODUCT_IMAGE`.
