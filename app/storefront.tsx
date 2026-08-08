"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { PRODUCTS, type Product } from "../lib/products";

type CartItem = {
  product: Product;
  size: string;
  quantity: number;
};

type Filter = "All" | "New in" | "1–3 years" | "4–6 years" | "7–10 years";

const FILTERS: Filter[] = [
  "All",
  "New in",
  "1–3 years",
  "4–6 years",
  "7–10 years",
];

const money = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "EUR",
});

function productMatchesFilter(product: Product, filter: Filter) {
  if (filter === "All") return true;
  if (filter === "New in") return product.badge === "New";
  if (filter === "1–3 years") return product.ageMin <= 3 && product.ageMax >= 1;
  if (filter === "4–6 years") return product.ageMin <= 6 && product.ageMax >= 4;
  return product.ageMin <= 10 && product.ageMax >= 7;
}

export function Storefront() {
  const [filter, setFilter] = useState<Filter>("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderReference, setOrderReference] = useState("");
  const [confirmedTotal, setConfirmedTotal] = useState(0);
  const [formError, setFormError] = useState("");

  const visibleProducts = PRODUCTS.filter((product) =>
    productMatchesFilter(product, filter),
  );

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cart.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0,
  );
  const delivery = subtotal >= 60 || subtotal === 0 ? 0 : 4.9;
  const total = subtotal + delivery;

  const freeDeliveryProgress = useMemo(
    () => Math.min(100, Math.round((subtotal / 60) * 100)),
    [subtotal],
  );

  useEffect(() => {
    document.body.style.overflow = cartOpen || checkoutOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [cartOpen, checkoutOpen]);

  function addToCart(product: Product) {
    const size = selectedSizes[product.id] ?? product.sizes[0];
    setCart((current) => {
      const match = current.find(
        (item) => item.product.id === product.id && item.size === size,
      );
      if (match) {
        return current.map((item) =>
          item === match ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...current, { product, size, quantity: 1 }];
    });
    setCartOpen(true);
  }

  function changeQuantity(productId: string, size: string, amount: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.product.id === productId && item.size === size
            ? { ...item, quantity: item.quantity + amount }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function beginCheckout() {
    setCartOpen(false);
    setCheckoutOpen(true);
    setFormError("");
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: {
            name: form.get("name"),
            phone: form.get("phone"),
            address: form.get("address"),
            city: form.get("city"),
            postalCode: form.get("postalCode"),
            notes: form.get("notes"),
          },
          website: form.get("website"),
          items: cart.map((item) => ({
            productId: item.product.id,
            size: item.size,
            quantity: item.quantity,
          })),
        }),
      });
      const data = (await response.json()) as {
        reference?: string;
        error?: string;
      };
      if (!response.ok || !data.reference) {
        throw new Error(data.error ?? "We couldn’t place your order. Please try again.");
      }
      setConfirmedTotal(total);
      setOrderReference(data.reference);
      setCart([]);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "We couldn’t place your order. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function closeCheckout() {
    setCheckoutOpen(false);
    setOrderReference("");
    setConfirmedTotal(0);
  }

  return (
    <main>
      <div className="announcement">
        <span>Free delivery over €60</span>
        <span className="announcement-dot">•</span>
        <span>Pay cash at your door</span>
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="Lovelystep home">
          lovely<span>step</span><i aria-hidden="true">.</i>
        </a>
        <nav className={menuOpen ? "nav-links is-open" : "nav-links"} aria-label="Main navigation">
          <a href="#shop" onClick={() => { setFilter("New in"); setMenuOpen(false); }}>New in</a>
          <a href="#shop" onClick={() => { setFilter("All"); setMenuOpen(false); }}>Shop all</a>
          <a href="#why-us" onClick={() => setMenuOpen(false)}>Why Lovelystep</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>Help</a>
        </nav>
        <div className="header-actions">
          <button
            className="menu-button"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
          <button className="bag-button" type="button" onClick={() => setCartOpen(true)}>
            Bag <span>{cartCount}</span>
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">For the mess, magic &amp; everything between</p>
          <h1>Little clothes.<br /><em>Big adventures.</em></h1>
          <p className="hero-lede">
            Soft, play-ready pieces they’ll reach for. Order in a few taps and
            pay only when it arrives.
          </p>
          <div className="hero-actions">
            <a className="button button-dark" href="#shop">Shop bestsellers <span>↘</span></a>
            <a className="text-link" href="#cod">How cash on delivery works <span>→</span></a>
          </div>
          <div className="hero-proof" aria-label="Customer benefits">
            <div><strong>4.8/5</strong><span>from happy parents</span></div>
            <div><strong>14 days</strong><span>easy returns</span></div>
          </div>
        </div>
        <div className="hero-gallery" aria-label="Children enjoying Lovelystep clothing">
          <div className="hero-main-image">
            <Image src="/images/playtime.jpg" alt="Child enjoying a colorful day of play" fill priority sizes="(max-width: 980px) 71vw, 35vw" />
            <span className="image-label">made to move</span>
          </div>
          <div className="hero-side-image">
            <Image src="/images/sunny-set.jpg" alt="Smiling child in a bright outfit" fill priority sizes="(max-width: 980px) 33vw, 18vw" />
          </div>
          <div className="cod-sticker" aria-label="No card needed">
            <span>No card</span>
            <strong>needed!</strong>
          </div>
        </div>
      </section>

      <section className="marquee" aria-label="Lovelystep product qualities">
        <div>
          <span>Soft on skin</span><i>✦</i><span>Ready for play</span><i>✦</i>
          <span>Parent approved</span><i>✦</i><span>Easy to wash</span><i>✦</i>
          <span>Soft on skin</span><i>✦</i><span>Ready for play</span>
        </div>
      </section>

      <section className="shop-section" id="shop">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The play-all-day edit</p>
            <h2>Small wardrobe.<br />Big personality.</h2>
          </div>
          <p>Everyday favorites in happy colors, made for real kids and real life.</p>
        </div>
        <div className="filter-row" role="group" aria-label="Filter products by age">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item}
              className={filter === item ? "active" : ""}
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="product-grid">
          {visibleProducts.map((product) => (
            <article className="product-card" key={product.id}>
              <div className="product-image">
                <Image src={product.image} alt={product.alt} fill sizes="(max-width: 620px) 48vw, (max-width: 980px) 50vw, 31vw" />
                {product.badge && <span className="product-badge">{product.badge}</span>}
                <button
                  type="button"
                  className="quick-add"
                  onClick={() => addToCart(product)}
                  aria-label={`Add ${product.name} to bag`}
                >
                  + Add
                </button>
              </div>
              <div className="product-meta">
                <div>
                  <h3>{product.name}</h3>
                  <p>{product.color} · {product.category}</p>
                </div>
                <p className="price">
                  {money.format(product.price)}
                  {product.compareAt && <s>{money.format(product.compareAt)}</s>}
                </p>
              </div>
              <label className="size-select">
                <span className="sr-only">Size for {product.name}</span>
                <select
                  value={selectedSizes[product.id] ?? product.sizes[0]}
                  onChange={(event) =>
                    setSelectedSizes((current) => ({
                      ...current,
                      [product.id]: event.target.value,
                    }))
                  }
                >
                  {product.sizes.map((size) => <option key={size}>{size}</option>)}
                </select>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="why-section" id="why-us">
        <div className="why-card why-intro">
          <p className="eyebrow">Why parents pick us</p>
          <h2>Happy clothes.<br /><em>Zero drama.</em></h2>
          <p>
            Thoughtful pieces, honest prices and a checkout that doesn’t ask for
            your card. That’s the whole idea.
          </p>
        </div>
        <div className="why-card why-feature yellow">
          <span className="feature-number">01</span>
          <div>
            <strong>Feel-good fabrics</strong>
            <p>Soft, breathable cotton blends made for sensitive little humans.</p>
          </div>
        </div>
        <div className="why-card why-feature coral">
          <span className="feature-number">02</span>
          <div>
            <strong>Play-proof details</strong>
            <p>Easy fits, comfy seams and care labels that keep laundry simple.</p>
          </div>
        </div>
        <div className="why-card why-image">
          <Image src="/images/cozy-knit.jpg" alt="Happy child in a Lovelystep striped top" fill sizes="(max-width: 980px) 100vw, 55vw" />
        </div>
      </section>

      <section className="cod-section" id="cod">
        <div className="cod-heading">
          <p className="eyebrow">No card? No problem.</p>
          <h2>From our rack<br />to your door.</h2>
        </div>
        <ol className="cod-steps">
          <li><span>1</span><div><strong>Pick their favorites</strong><p>Choose the size, add to bag and review your order.</p></div></li>
          <li><span>2</span><div><strong>Share delivery details</strong><p>Tell us where to send it—no payment details needed.</p></div></li>
          <li><span>3</span><div><strong>Pay when it arrives</strong><p>Have the order total ready for the courier at your door.</p></div></li>
        </ol>
        <a className="button button-light" href="#shop">Build their bundle <span>↑</span></a>
      </section>

      <section className="testimonial-section">
        <p className="eyebrow">The parent group chat says</p>
        <blockquote>
          “The clothes survived a birthday party, finger paint and three washes
          in one week. Still soft, still adorable.”
        </blockquote>
        <div className="testimonial-author">
          <span>★★★★★</span>
          <p><strong>Maya, mum of two</strong><br />Verified order</p>
        </div>
      </section>

      <section className="faq-section" id="faq">
        <div>
          <p className="eyebrow">Good to know</p>
          <h2>Questions,<br />meet answers.</h2>
        </div>
        <div className="faq-list">
          <details open><summary>How does cash on delivery work?<span>+</span></summary><p>Place your order without entering card details. Your courier collects the exact order total when your parcel arrives.</p></details>
          <details><summary>When will my order arrive?<span>+</span></summary><p>Most orders arrive within 3–5 business days. We’ll contact you using the phone number on your order before delivery.</p></details>
          <details><summary>Can I return an item?<span>+</span></summary><p>Yes. Unworn items with tags can be returned within 14 days of delivery. Contact our care team to start a return.</p></details>
          <details><summary>How do I choose the right size?<span>+</span></summary><p>Our fits follow the age range shown on each piece. If your child is between sizes, choose the larger size for extra growing room.</p></details>
        </div>
      </section>

      <footer>
        <div className="footer-top">
          <a className="brand footer-brand" href="#top">lovely<span>step</span><i>.</i></a>
          <p>Clothes for little people<br />with big plans.</p>
          <a className="footer-shop" href="#shop">Shop the edit <span>↗</span></a>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Lovelystep</span>
          <div><a href="#faq">Delivery &amp; returns</a><a href="#faq">Privacy</a><a href="#faq">Contact</a></div>
          <span>Made for everyday magic</span>
        </div>
      </footer>

      {cartCount > 0 && !cartOpen && !checkoutOpen && (
        <button className="mobile-cart-bar" type="button" onClick={() => setCartOpen(true)}>
          <span>View bag · {cartCount} {cartCount === 1 ? "item" : "items"}</span>
          <strong>{money.format(total)}</strong>
        </button>
      )}

      <div className={cartOpen ? "drawer-shell is-open" : "drawer-shell"} aria-hidden={!cartOpen}>
        <button className="drawer-backdrop" type="button" aria-label="Close bag" onClick={() => setCartOpen(false)} />
        <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Shopping bag">
          <div className="drawer-header">
            <div><p className="eyebrow">Your picks</p><h2>Shopping bag <span>{cartCount}</span></h2></div>
            <button type="button" onClick={() => setCartOpen(false)} aria-label="Close shopping bag">×</button>
          </div>
          {cart.length === 0 ? (
            <div className="empty-cart">
              <span aria-hidden="true">☀</span>
              <h3>Your bag is ready for fun.</h3>
              <p>Add a few play-all-day favorites to get started.</p>
              <button className="button button-dark" type="button" onClick={() => setCartOpen(false)}>Keep browsing</button>
            </div>
          ) : (
            <>
              <div className="shipping-progress">
                <p>{subtotal >= 60 ? "You unlocked free delivery!" : `${money.format(60 - subtotal)} away from free delivery`}</p>
                <div><span style={{ width: `${freeDeliveryProgress}%` }} /></div>
              </div>
              <div className="cart-items">
                {cart.map((item) => (
                  <div className="cart-item" key={`${item.product.id}-${item.size}`}>
                    <Image src={item.product.image} alt="" width={96} height={118} />
                    <div className="cart-item-info">
                      <div><h3>{item.product.name}</h3><p>{item.size} · {item.product.color}</p></div>
                      <strong>{money.format(item.product.price * item.quantity)}</strong>
                      <div className="quantity-picker" aria-label={`Quantity for ${item.product.name}`}>
                        <button type="button" onClick={() => changeQuantity(item.product.id, item.size, -1)} aria-label="Decrease quantity">−</button>
                        <span>{item.quantity}</span>
                        <button type="button" onClick={() => changeQuantity(item.product.id, item.size, 1)} aria-label="Increase quantity">+</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="cart-summary">
                <div><span>Subtotal</span><strong>{money.format(subtotal)}</strong></div>
                <div><span>Delivery</span><strong>{delivery === 0 ? "Free" : money.format(delivery)}</strong></div>
                <div className="cart-total"><span>Total</span><strong>{money.format(total)}</strong></div>
                <button className="button button-dark checkout-button" type="button" onClick={beginCheckout}>Checkout · Pay on delivery <span>→</span></button>
                <p>Cash on delivery · 14-day returns</p>
              </div>
            </>
          )}
        </aside>
      </div>

      {checkoutOpen && (
        <div className="checkout-shell">
          <button className="checkout-backdrop" type="button" aria-label="Close checkout" onClick={closeCheckout} />
          <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
            {orderReference ? (
              <div className="order-success">
                <div className="success-mark" aria-hidden="true">✓</div>
                <p className="eyebrow">Order confirmed</p>
                <h2 id="checkout-title">Happy mail is<br />on the way.</h2>
                <p>
                  We’ve saved your order as <strong>{orderReference}</strong>. We’ll
                  call before delivery in 3–5 business days. Pay the courier
                  {money.format(confirmedTotal)} when it arrives.
                </p>
                <button className="button button-dark" type="button" onClick={closeCheckout}>Back to Lovelystep</button>
              </div>
            ) : (
              <>
                <div className="checkout-topbar">
                  <button type="button" onClick={() => { setCheckoutOpen(false); setCartOpen(true); }}>← Back to bag</button>
                  <div><span className="done">Bag</span><i /><span className="active">Details</span><i /><span>Done</span></div>
                  <button type="button" onClick={closeCheckout} aria-label="Close checkout">×</button>
                </div>
                <div className="checkout-grid">
                  <form className="checkout-form" onSubmit={submitOrder}>
                    <p className="eyebrow">Almost yours</p>
                    <h2 id="checkout-title">Where should<br />we send the fun?</h2>
                    <div className="field-row">
                      <label><span>Full name</span><input name="name" autoComplete="name" required maxLength={80} placeholder="Your name" /></label>
                      <label><span>Phone number</span><input name="phone" autoComplete="tel" inputMode="tel" required minLength={7} maxLength={24} placeholder="For delivery updates" /></label>
                    </div>
                    <label><span>Street address</span><input name="address" autoComplete="street-address" required maxLength={140} placeholder="Building, street, area" /></label>
                    <div className="field-row city-row">
                      <label><span>City</span><input name="city" autoComplete="address-level2" required maxLength={80} placeholder="Your city" /></label>
                      <label><span>Postal code</span><input name="postalCode" autoComplete="postal-code" maxLength={16} placeholder="Optional" /></label>
                    </div>
                    <label><span>Delivery note <small>optional</small></span><textarea name="notes" maxLength={300} placeholder="Landmark, preferred time, or anything helpful" /></label>
                    <label className="honeypot" aria-hidden="true"><span>Website</span><input name="website" tabIndex={-1} autoComplete="off" /></label>
                    <div className="payment-choice">
                      <div className="radio-selected" aria-hidden="true"><span /></div>
                      <div><strong>Cash on delivery</strong><p>Pay {money.format(total)} directly to the courier when your order arrives.</p></div>
                      <span>Selected</span>
                    </div>
                    {formError && <p className="form-error" role="alert">{formError}</p>}
                    <button className="button button-dark place-order" type="submit" disabled={submitting}>
                      {submitting ? "Placing your order…" : `Place order · ${money.format(total)}`}
                      {!submitting && <span>→</span>}
                    </button>
                    <p className="form-privacy">By placing this order, you agree that we may use your details to arrange delivery and contact you about this order.</p>
                  </form>
                  <aside className="order-review">
                    <div className="review-heading"><h3>Your order</h3><button type="button" onClick={() => { setCheckoutOpen(false); setCartOpen(true); }}>Edit</button></div>
                    <div className="review-items">
                      {cart.map((item) => (
                        <div key={`${item.product.id}-${item.size}`}>
                          <Image src={item.product.image} alt="" width={58} height={68} />
                          <p><strong>{item.product.name}</strong><span>{item.size} · Qty {item.quantity}</span></p>
                          <strong>{money.format(item.product.price * item.quantity)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="review-totals">
                      <p><span>Subtotal</span><strong>{money.format(subtotal)}</strong></p>
                      <p><span>Delivery</span><strong>{delivery === 0 ? "Free" : money.format(delivery)}</strong></p>
                      <p><span>Total</span><strong>{money.format(total)}</strong></p>
                    </div>
                    <div className="review-promise"><span aria-hidden="true">♡</span><p><strong>The Lovelystep promise</strong><br />Soft favorites, careful packing and easy 14-day returns.</p></div>
                  </aside>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
