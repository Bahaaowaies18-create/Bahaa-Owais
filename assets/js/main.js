/* ==========================================================================
   Smile JO — منطق الصفحة
   جافاسكربت خالص بدون أي مكتبة خارجية: أسرع تحميل وأقل نقاط فشل.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1) بيانات المنتجات
   ⬇️ هذا هو المكان الوحيد الذي تعدّله لتغيير المنتجات.
   عند الربط بمتجر حقيقي (سلة / شوبيفاي / ووكومرس) استبدل هذه المصفوفة
   بنتيجة طلب fetch من واجهة المتجر — بقية الكود لا يتغيّر.
   -------------------------------------------------------------------------- */
const PRODUCTS = [
  { id: 'p1', name: 'اسم المنتج الأول', price: 12.90, oldPrice: 18.00, rating: 4.9, reviews: 86,  stock: 7,  badge: 'خصم 28%' },
  { id: 'p2', name: 'اسم المنتج الثاني', price: 24.50, oldPrice: null,  rating: 4.7, reviews: 51,  stock: 23, badge: 'جديد', badgeType: 'new' },
  { id: 'p3', name: 'اسم المنتج الثالث', price: 9.90,  oldPrice: 14.00, rating: 4.8, reviews: 134, stock: 4,  badge: 'خصم 29%' },
  { id: 'p4', name: 'اسم المنتج الرابع', price: 32.00, oldPrice: null,  rating: 5.0, reviews: 19,  stock: 12, badge: null },
  { id: 'p5', name: 'اسم المنتج الخامس', price: 15.75, oldPrice: 21.00, rating: 4.6, reviews: 63,  stock: 9,  badge: 'خصم 25%' },
  { id: 'p6', name: 'اسم المنتج السادس', price: 45.00, oldPrice: null,  rating: 4.9, reviews: 28,  stock: 15, badge: null },
  { id: 'p7', name: 'اسم المنتج السابع', price: 7.50,  oldPrice: 11.00, rating: 4.5, reviews: 97,  stock: 31, badge: 'خصم 32%' },
  { id: 'p8', name: 'اسم المنتج الثامن', price: 19.90, oldPrice: null,  rating: 4.8, reviews: 42,  stock: 6,  badge: 'جديد', badgeType: 'new' }
];

/* إعدادات المتجر — غيّرها من هنا */
const CONFIG = {
  currency: 'د.أ',
  freeShippingAt: 25,          // حدّ الشحن المجاني بالدينار
  whatsapp: '962790000000',    // رقم واتساب بصيغة دولية بدون +
  checkoutUrl: '#'             // ضع هنا رابط صفحة الدفع الحقيقية
};

/* --------------------------------------------------------------------------
   2) أدوات مساعدة
   -------------------------------------------------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const money = n => `${n.toFixed(2)} ${CONFIG.currency}`;

/* يمنع حقن HTML من أي نص خارجي — مهم عند ربط بيانات حقيقية */
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const starsFor = r => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));

/* التخزين المحلي قد يفشل في وضع التصفح الخاص — نحميه دائماً */
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* تجاهل بصمت — الصفحة تعمل بدونه */ }
  }
};

/* --------------------------------------------------------------------------
   3) بناء شبكة المنتجات
   -------------------------------------------------------------------------- */
function productCard(p) {
  const badge = p.badge
    ? `<span class="card__badge ${p.badgeType === 'new' ? 'card__badge--new' : ''}">${esc(p.badge)}</span>`
    : '';

  // مؤشر مخزون صادق: يظهر فقط عندما تكون الكمية فعلاً منخفضة
  const lowStock = p.stock <= 10
    ? `<div class="stock">باقي ${p.stock} قطع فقط
         <span class="stock__bar"><i style="width:${Math.max(8, p.stock * 8)}%"></i></span>
       </div>`
    : '';

  return `
    <article class="card reveal">
      <div class="card__media ph" data-label="صورة ${esc(p.name)}">${badge}</div>
      <div class="card__body">
        <h3 class="card__title">${esc(p.name)}</h3>
        <div class="card__rating"><span class="stars">${starsFor(p.rating)}</span> ${p.rating} (${p.reviews})</div>
        ${lowStock}
        <div class="price">
          <b>${money(p.price)}</b>
          ${p.oldPrice ? `<s>${money(p.oldPrice)}</s>` : ''}
        </div>
        <button class="btn btn-primary btn-block" data-add="${p.id}" style="margin-block-start:var(--s-3)">
          أضف للسلة
        </button>
      </div>
    </article>`;
}

function renderProducts() {
  const grid = $('#productGrid');
  if (!grid) return;
  grid.innerHTML = PRODUCTS.map(productCard).join('');
  observeReveals(grid);

  // أرخص سعر يظهر في شريط الشراء الملتصق
  const min = Math.min(...PRODUCTS.map(p => p.price));
  const buybarPrice = $('#buybarPrice');
  if (buybarPrice) buybarPrice.textContent = `من ${money(min)}`;
}

/* --------------------------------------------------------------------------
   4) السلة
   -------------------------------------------------------------------------- */
let cart = store.get('smilejo_cart', {});   // { productId: quantity }

function cartLines() {
  return Object.entries(cart)
    .map(([id, qty]) => ({ product: PRODUCTS.find(p => p.id === id), qty }))
    .filter(line => line.product);
}

const cartTotal = () => cartLines().reduce((sum, l) => sum + l.product.price * l.qty, 0);
const cartCount = () => cartLines().reduce((sum, l) => sum + l.qty, 0);

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveAndRenderCart();
  openCart();
}

function removeFromCart(id) {
  delete cart[id];
  saveAndRenderCart();
}

function saveAndRenderCart() {
  store.set('smilejo_cart', cart);
  renderCart();
}

function renderCart() {
  const lines = cartLines();
  const total = cartTotal();

  $('#cartCount').textContent = cartCount();

  $('#cartItems').innerHTML = lines.length
    ? lines.map(({ product: p, qty }) => `
        <div class="line-item">
          <div class="thumb ph"></div>
          <div>
            <b>${esc(p.name)}</b>
            <span>${qty} × ${money(p.price)}</span>
          </div>
          <button class="remove" data-remove="${p.id}">حذف</button>
        </div>`).join('')
    : `<div class="empty-cart">سلتك فارغة حالياً.<br>اختر منتجاً وابدأ طلبك.</div>`;

  $('#cartTotal').textContent = money(total);

  // شريط تقدّم الشحن المجاني
  const remaining = Math.max(0, CONFIG.freeShippingAt - total);
  const pct = Math.min(100, (total / CONFIG.freeShippingAt) * 100);
  $('#shipBar').style.width = `${pct}%`;
  $('#shipMsg').textContent = remaining > 0
    ? `أضف ${money(remaining)} للحصول على شحن مجاني 🚚`
    : '🎉 مبروك! حصلت على الشحن المجاني';

  // رسالة واتساب جاهزة بمحتوى الطلب — أهم قناة بيع في السوق المحلي
  const body = lines.length
    ? `مرحباً، أريد طلب:\n${lines.map(l => `• ${l.product.name} × ${l.qty}`).join('\n')}\nالمجموع: ${money(total)}`
    : 'مرحباً، أريد الاستفسار عن منتجاتكم';
  $('#waOrderBtn').href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(body)}`;
  $('#checkoutBtn').href = CONFIG.checkoutUrl;
}

/* فتح وإغلاق السلة */
const openCart = () => {
  $('#cartDrawer').classList.add('is-open');
  $('#overlay').classList.add('is-open');
  document.body.classList.add('is-locked');
};

const closeCart = () => {
  $('#cartDrawer').classList.remove('is-open');
  $('#overlay').classList.remove('is-open');
  document.body.classList.remove('is-locked');
};

/* --------------------------------------------------------------------------
   5) البحث الفوري
   -------------------------------------------------------------------------- */
function initSearch() {
  const input = $('#q');
  const box = $('#searchResults');
  if (!input || !box) return;

  const render = term => {
    const q = term.trim();
    if (!q) { box.classList.remove('is-open'); return; }

    const hits = PRODUCTS.filter(p => p.name.includes(q)).slice(0, 6);
    box.innerHTML = hits.length
      ? hits.map(p => `
          <a class="search__row" href="#products">
            <span class="thumb ph"></span>
            <span>
              <b>${esc(p.name)}</b><br>
              <small style="color:var(--ink-3)">${money(p.price)}</small>
            </span>
          </a>`).join('')
      : `<div class="search__empty">لا نتائج لـ "${esc(q)}" — جرّب كلمة أقصر</div>`;
    box.classList.add('is-open');
  };

  input.addEventListener('input', e => render(e.target.value));
  input.addEventListener('focus', e => render(e.target.value));

  document.addEventListener('click', e => {
    if (!e.target.closest('.search')) box.classList.remove('is-open');
  });
}

/* --------------------------------------------------------------------------
   6) الأسئلة الشائعة (أكورديون) — واحد مفتوح في كل مرة
   -------------------------------------------------------------------------- */
function initFaq() {
  $$('.faq__q').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq__item');
      const wasOpen = item.classList.contains('is-open');

      $$('.faq__item').forEach(i => {
        i.classList.remove('is-open');
        $('.faq__q', i).setAttribute('aria-expanded', 'false');
      });

      if (!wasOpen) {
        item.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/* --------------------------------------------------------------------------
   7) ظهور تدريجي عند التمرير — يُلغى تلقائياً لمن يفضّل تقليل الحركة
   -------------------------------------------------------------------------- */
let revealObserver = null;

function observeReveals(root = document) {
  if (!revealObserver) return;
  $$('.reveal', root).forEach(el => revealObserver.observe(el));
}

function initReveals() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) {
    $$('.reveal').forEach(el => el.classList.add('is-in'));
    return;
  }

  revealObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      obs.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -60px 0px', threshold: .1 });

  observeReveals();
}

/* --------------------------------------------------------------------------
   8) سلوك التمرير: ظل الهيدر + إظهار شريط الشراء بعد مغادرة الهيرو
   -------------------------------------------------------------------------- */
function initScroll() {
  const header = $('#header');
  const buybar = $('#buybar');

  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-stuck', y > 8);
    buybar.classList.toggle('is-visible', y > window.innerHeight * .7);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* --------------------------------------------------------------------------
   9) التشغيل
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  $('#year').textContent = new Date().getFullYear();

  initReveals();
  renderProducts();
  renderCart();
  initSearch();
  initFaq();
  initScroll();

  // تفويض الأحداث: زر واحد يخدم كل الأزرار الحالية والمستقبلية
  document.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) { addToCart(add.dataset.add); return; }

    const remove = e.target.closest('[data-remove]');
    if (remove) { removeFromCart(remove.dataset.remove); return; }
  });

  $('#cartBtn').addEventListener('click', openCart);
  $('#cartClose').addEventListener('click', closeCart);
  $('#overlay').addEventListener('click', closeCart);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCart();
  });

  // قائمة الموبايل: تمرير سلس إلى المنتجات (استبدلها بقائمة كاملة عند الحاجة)
  $('#navToggle').addEventListener('click', () => {
    $('#products').scrollIntoView({ behavior: 'smooth' });
  });
});
