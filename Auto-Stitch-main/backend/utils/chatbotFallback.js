// Rule-based replies used by the chatbot when no AI provider key is configured.
// Answers come from the platform's own FAQ facts and the catalogue found in the database.

const has = (text, words) => words.some((w) => text.includes(w));

const formatPrice = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK')}`;

const buildOfflineReply = (message, products = [], boutiques = []) => {
  const text = String(message || '').toLowerCase();

  if (has(text, ['hello', 'hi ', 'hey', 'salam', 'assalam']) || /^(hi|hey|hello)\b/.test(text)) {
    return "Hello! I'm Stitchie, your Auto Stitch assistant. I can help you find outfits and boutiques, explain Virtual Try-On, custom tailoring bids, payments, delivery and order tracking. What would you like to know?";
  }

  if (has(text, ['coupon', 'promo', 'discount', 'voucher', 'offer', 'sale'])) {
    return 'You can apply promo codes at checkout: EID20 gives 20% off, AUTOSTITCH10 gives a 10% welcome discount, FLAT500 takes PKR 500 off orders above PKR 3,000, and FREESHIP gives free express shipping.';
  }

  if (has(text, ['track', 'where is my order', 'order status'])) {
    return 'You can follow your order on the Track Order page using your 6-character reference ID (for example #AS-5A2B9C), or open My Orders after logging in. Orders move through: Placed, Accepted, In Tailoring, Quality Passed, Dispatched and Delivered.';
  }

  if (has(text, ['pay', 'payment', 'cod', 'cash on delivery', 'card', 'installment', 'stripe'])) {
    return 'At checkout you can choose Cash on Delivery, or pay by card, or split the payment into installments where card payments are enabled. Cash on Delivery is always available.';
  }

  if (has(text, ['ship', 'delivery', 'deliver', 'courier'])) {
    return 'We deliver across Pakistan, and delivery is free on orders over PKR 5,000. Tailored pieces take a little longer because each one is stitched to order; your boutique shows the estimated time on your order.';
  }

  if (has(text, ['return', 'refund', 'exchange', 'cancel'])) {
    return 'You can request a return from your order details page after delivery, and the boutique will review it. Orders can be cancelled before they reach the tailoring stage. See the Returns page for the full policy.';
  }

  if (has(text, ['try-on', 'try on', 'tryon', 'virtual', 'fitting room'])) {
    return 'Virtual Try-On lets you upload your own photo and see how a selected garment looks on you. Open any product and tap "Virtual Try-On". Your photo is deleted automatically after a short time for privacy.';
  }

  if (has(text, ['custom', 'bespoke', 'bid', 'tailor', 'stitch my', 'design my'])) {
    return 'For custom tailoring, open Customize, describe your design with reference photos and measurements, and boutiques will send you bids. Compare the quotes, chat with the boutique, and accept the one you like to create your order.';
  }

  if (has(text, ['size', 'measurement', 'fit'])) {
    return 'Check our Size Guide for measurement help. For custom pieces you can enter your own measurements in the Customize request, and the boutique will stitch to them.';
  }

  if (has(text, ['contact', 'support', 'help', 'complain', 'problem', 'issue'])) {
    return 'You can reach our team from the Contact page, or open a support ticket from your account. Please include your order reference so we can help faster.';
  }

  if (has(text, ['register', 'sign up', 'signup', 'login', 'log in', 'account', 'password'])) {
    return 'Use Register to create a customer account, or Login if you already have one. Boutique owners sign in from the Boutique Login page. If you forgot your password, use "Forgot password" on the login page.';
  }

  if (products.length > 0 || boutiques.length > 0) {
    let reply = '';
    if (products.length > 0) {
      const list = products
        .slice(0, 4)
        .map((p) => `${p.name} (${formatPrice(p.price)})`)
        .join(', ');
      reply += `Here is what I found for you: ${list}. `;
    }
    if (boutiques.length > 0) {
      reply += `Boutiques you may like: ${boutiques.map((b) => b.name).join(', ')}. `;
    }
    return `${reply}Open the Catalogue to see full details and photos.`;
  }

  return "I couldn't find an exact match for that. You can browse the Catalogue or Boutiques pages, or ask me about Virtual Try-On, custom tailoring, payments, delivery, returns and promo codes.";
};

module.exports = { buildOfflineReply };
