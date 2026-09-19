# توليد صور روز مع علبة الفنير المتحرك (SMILE_JO)

سكربت بايثون بياخد صورتين مرجعيتين — روز والعلبة الصفرا — وبيولّد صورة جديدة
لروز وهي ماسكة العلبة، بنفس ستايل التصوير الاستوديو.

## الملفات

| الملف | الوظيفة |
|---|---|
| `generate_rose_image.py` | السكربت الرئيسي (CLI) |
| `prompts.py` | البرومبتات الجاهزة: `main` / `closeup` / `social` |
| `assets/rose.png` | صورة روز المرجعية |
| `assets/retainer_case.png` | صورة علبة الفنير المرجعية |
| `output/` | مكان حفظ الصور المولّدة |

## التنصيب

```bash
pip install -r requirements.txt
cp .env.example .env     # وبعدين حط مفتاحك جوا .env
```

المفتاح من [Google AI Studio](https://aistudio.google.com/apikey):

```
GEMINI_API_KEY=ضع_مفتاحك_هنا
```

## التشغيل

```bash
# الصورة الأساسية: روز ماسكة العلبة جنب وجهها
python generate_rose_image.py

# نسخة ستوري/ريل عمودية مع مساحة فاضية للكتابة
python generate_rose_image.py --style social

# كلوز أب على المنتج
python generate_rose_image.py --style closeup

# ٣ نسخ مع قص العلبة لحالها من الصورة المرجعية (نتيجة أدق)
python generate_rose_image.py -n 3 --crop-product

# برومبت مخصص
python generate_rose_image.py --prompt "نص البرومبت هون"
python generate_rose_image.py --prompt-file my_prompt.txt
```

الصور بتنحفظ بـ `output/rose_case_<style>_<تاريخ>_<رقم>.png`.

## خيارات مهمة

| الخيار | الشرح | الافتراضي |
|---|---|---|
| `--provider` | `gemini` أو `openai` | `gemini` |
| `--style` | `main` / `closeup` / `social` | `main` |
| `-n` | عدد النسخ | `1` |
| `--crop-product` | يقص العلبة لحالها قبل الإرسال | مطفي |
| `--aspect` | نسبة الأبعاد لـ Gemini (`9:16`, `1:1`, `4:5`) | `9:16` |
| `--size` | أبعاد OpenAI (`1024x1536`) | `1024x1536` |
| `--model` | اسم موديل مخصص | حسب المزوّد |
| `--person` / `--product` | مسارات صور مرجعية بديلة | اللي بـ `assets/` |

## نصائح للنتيجة

- **`--crop-product`** بينصح فيه: بيقص العلبة لحالها فما يختلط وجه البنت
  التانية بوجه روز. إذا القص طلع غلط، عدّل `PRODUCT_CROP_BOX` بأول
  `generate_rose_image.py`.
- ولّد **٣–٤ نسخ** واختار الأحسن — اليدين وشعار `SMILE_JO` أكتر إشيين بيطلعوا
  مشوّهين.
- إذا الشعار طلع غير واضح، زيد بالبرومبت: `the SMILE_JO logo must be perfectly
  sharp and correctly spelled`.
- لو تغيّر لبس روز بالنتيجة، أضف وصف اللبس بشكل أوضح بالبرومبت.

## استخدام OpenAI بدل Gemini

```bash
export OPENAI_API_KEY=...
python generate_rose_image.py --provider openai --size 1024x1536
```
