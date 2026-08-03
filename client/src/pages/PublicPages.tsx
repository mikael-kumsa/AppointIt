import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  Building2,
  CalendarPlus,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Flower2,
  Globe2,
  HeartPulse,
  MapPin,
  MessageSquareText,
  Palette,
  Quote,
  ReceiptText,
  RefreshCw,
  Scissors,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
  UploadCloud,
  Zap,
  X
} from "lucide-react";
import { acceptInvite, ApiRequestError, bookPublicAppointment, claimTelebirrPayment, confirmPasswordReset, createRenewalInvoice, demoVendor, getPaymentInvoice, getPublicSlots, getPublicVendor, listPublicPlans, login, requestPasswordReset, resendPhoneOtp, setToken, signupVendor, uploadTelebirrProof, verifyPhoneOtp, type Appointment, type LoginResponse, type PaymentInvoice, type PublicVendor, type SubscriptionPlan } from "../lib/api";
import { cancelManagedAppointment, getManagedAppointment, getManagedAppointmentSlots, rescheduleManagedAppointment, type ManagedAppointment } from "../lib/api";
import { money } from "../lib/format";
import { bookingThemeById, bookingThemeStyle } from "../lib/bookingThemes";

type LandingTheme = "evergreen" | "ocean" | "graphite";

const landingThemes: Array<{ id: LandingTheme; label: string; colors: string[] }> = [
  { id: "evergreen", label: "Evergreen", colors: ["#0f7b54", "#256b8c", "#b84c34"] },
  { id: "ocean", label: "Cobalt", colors: ["#2457a7", "#087a78", "#a64b2a"] },
  { id: "graphite", label: "Sienna", colors: ["#a4432f", "#286f6c", "#7d4d15"] }
];

const pricingIcons = [Zap, Globe2, Settings2];

function planPrice(plan: SubscriptionPlan) {
  const price = plan.currentVersion?.monthlyPriceCents;
  return price == null ? "Custom quote" : money(price);
}

function planFacts(plan: SubscriptionPlan): Array<[string, string]> {
  const entitlements = plan.currentVersion?.entitlements;
  if (!entitlements) return [];
  const limit = (value: number, noun: string) => value === -1 ? `Unlimited ${noun}` : `${value} ${noun}`;
  return [
    ["Locations", limit(entitlements.maxBranches, entitlements.maxBranches === 1 ? "branch" : "branches")],
    ["Team capacity", limit(entitlements.maxStaff, "staff members")],
    ["Booking address", entitlements.customDomain ? "AppointIt URL and custom domain" : "AppointIt booking URL"],
    ["Operations", entitlements.advancedReports ? "Advanced reports and automation" : "Core reports and automation"]
  ];
}

const showcaseBrands = [
  { name: "Addis Dental", sector: "Clinic", icon: HeartPulse },
  { name: "Luma Studio", sector: "Beauty", icon: Sparkles },
  { name: "Morrow", sector: "Barbers", icon: Scissors },
  { name: "Aster House", sector: "Wellness", icon: Flower2 },
  { name: "Meridian", sector: "Advisory", icon: BriefcaseBusiness },
  { name: "Northline", sector: "Health", icon: Building2 }
];

const workflowPerspectives = [
  {
    quote: "The front desk can see the whole day at a glance, make a change once, and know that the customer and provider are working from the same information.",
    role: "Reception perspective",
    business: "Multi-provider clinic"
  },
  {
    quote: "My schedule is no longer a stream of messages. I know who is next, what service they booked, and where I need to be before the appointment begins.",
    role: "Provider perspective",
    business: "Salon and wellness team"
  },
  {
    quote: "Branches stay independent enough to move quickly, while I still have one reliable view of performance, customers, and upcoming demand.",
    role: "Owner perspective",
    business: "Multi-location business"
  }
];

function savedLandingTheme(): LandingTheme {
  try {
    const value = window.localStorage.getItem("appointit-landing-theme");
    return landingThemes.some((theme) => theme.id === value) ? value as LandingTheme : "ocean";
  } catch {
    return "ocean";
  }
}

export function LandingPage() {
  const [theme, setTheme] = useState<LandingTheme>(savedLandingTheme);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [publicPlans, setPublicPlans] = useState<SubscriptionPlan[]>([]);
  const [publicPlansLoading, setPublicPlansLoading] = useState(true);
  const [publicPlansError, setPublicPlansError] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [reviewIndex, setReviewIndex] = useState(0);
  const activePricingPlan = publicPlans.find((plan) => plan.id === selectedPlanId) ?? publicPlans[0];
  const activeReview = workflowPerspectives[reviewIndex];
  const activePlanIndex = Math.max(0, publicPlans.findIndex((plan) => plan.id === activePricingPlan?.id));
  const PricingPlanIcon = pricingIcons[activePlanIndex % pricingIcons.length];
  const landingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("appointit-landing-theme", theme);
    } catch {
      // Theme persistence is optional when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThemeMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [themeMenuOpen]);

  const refreshPublicPlans = useCallback(async () => {
    setPublicPlansLoading(true);
    setPublicPlansError("");
    try {
      const plans = await listPublicPlans();
      setPublicPlans(plans);
      setSelectedPlanId((current) => plans.some((plan) => plan.id === current) ? current : plans[0]?.id || "");
    } catch {
      setPublicPlansError("Published plans could not be loaded. Check the API connection and try again.");
    } finally {
      setPublicPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPublicPlans();
    const refreshWhenReturning = () => void refreshPublicPlans();
    window.addEventListener("pageshow", refreshWhenReturning);
    return () => window.removeEventListener("pageshow", refreshWhenReturning);
  }, [refreshPublicPlans]);

  useEffect(() => {
    const root = landingRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const revealItems = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    root.classList.add("reveal-ready");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -7%" });

    revealItems.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <main className={`landing landing-theme-${theme}`} ref={landingRef}>
      <div className="landing-nav-wrap">
        <header className="landing-nav">
          <a className="landing-brand" href="/" aria-label="AppointIt home">
            <span><CalendarCheck2 size={21} /></span>
            <strong>AppointIt</strong>
          </a>
          <nav className="landing-nav-links" aria-label="Primary navigation">
            <a href="#businesses">Businesses</a>
            <a href="#reviews">Reviews</a>
            <a href="#pricing">Pricing</a>
            <a href="#workflow">How it works</a>
          </nav>
          <div className="landing-actions">
            <a className="landing-login" href="/login">Sign in</a>
            <a className="primary" href="/signup">Start free <ArrowRight size={17} /></a>
          </div>
        </header>
      </div>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="hero-kicker"><i aria-hidden="true" /> Built for the rhythm of service businesses</p>
          <h1>Appointment management that keeps your whole business <span>in sync.</span></h1>
          <p className="hero-lead">
            One calm workspace for bookings, staff, customers, reminders, and every location. Your team sees
            what is happening now, what is next, and what needs attention.
          </p>
          <div className="hero-actions">
            <a className="primary landing-primary" href="/signup">Start your workspace <ArrowRight size={18} /></a>
          </div>
          <div className="hero-assurances" aria-label="Platform benefits">
            <span><Check size={16} /> No credit card required</span>
            <span><Check size={16} /> Built for multiple locations</span>
            <span><Check size={16} /> Guided business setup</span>
          </div>
        </div>
      </section>

      <section className="product-stage">
        <div className="product-preview" aria-label="AppointIt appointment workspace preview">
          <div className="product-preview-bar">
            <div className="preview-brand"><CalendarCheck2 size={17} /><strong>AppointIt</strong></div>
            <div className="preview-location"><MapPin size={14} /> Bole Main Branch</div>
            <div className="preview-live"><i aria-hidden="true" /> Live workspace</div>
          </div>
          <div className="product-preview-layout">
            <aside className="preview-sidebar" aria-hidden="true">
              <span><BarChart3 /> Overview</span>
              <span className="active"><CalendarDays /> Appointments</span>
              <span><Users /> Customers</span>
              <span><UserRound /> Staff</span>
              <span><BellRing /> Notifications</span>
              <span><Settings2 /> Settings</span>
            </aside>
            <div className="preview-workspace">
              <div className="preview-heading">
                <div><small>MONDAY, 29 JUNE</small><h2>Good morning, Meron</h2></div>
                <div className="preview-date-controls">
                  <button aria-label="Previous day"><ChevronLeft size={16} /></button>
                  <span>Today</span>
                  <button aria-label="Next day"><ChevronRight size={16} /></button>
                </div>
              </div>
              <div className="preview-summary">
                <div><strong>12</strong><span>appointments today</span></div>
                <div><strong>9</strong><span>confirmed</span></div>
                <div><strong>3</strong><span>providers on duty</span></div>
                <div className="preview-availability"><i /> Schedule healthy</div>
              </div>
              <div className="preview-board">
                <div className="preview-schedule">
                  <div className="schedule-header"><span>Time</span><span>Customer</span><span>Service & provider</span><span>Status</span></div>
                  <div className="schedule-row">
                    <time>09:00</time><strong>Meron Tesfaye</strong><span>Dental consultation <small>Dr. Hana</small></span><b className="confirmed">Confirmed</b>
                  </div>
                  <div className="schedule-row current">
                    <time>10:30</time><strong>Daniel Bekele</strong><span>Teeth cleaning <small>Dr. Samuel</small></span><b className="arrived">Arrived</b>
                  </div>
                  <div className="schedule-row">
                    <time>11:45</time><strong>Ruth Abebe</strong><span>Follow-up visit <small>Dr. Hana</small></span><b className="pending">Pending</b>
                  </div>
                  <div className="schedule-row">
                    <time>13:30</time><strong>Yonas Alemu</strong><span>Dental consultation <small>Dr. Samuel</small></span><b className="confirmed">Confirmed</b>
                  </div>
                </div>
                <aside className="preview-next" aria-label="Next appointment preview">
                  <span className="preview-next-label"><Clock3 size={14} /> Next up</span>
                  <strong>10:30</strong>
                  <h3>Teeth cleaning</h3>
                  <p>Daniel Bekele - Dr. Samuel</p>
                  <div><MessageSquareText size={15} /><span><b>Reminder delivered</b><small>12 minutes ago</small></span></div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="client-showcase" id="businesses" data-reveal>
        <div className="client-showcase-heading">
          <div><p className="eyebrow">Service business showcase</p><h2>Different businesses. One calmer rhythm.</h2></div>
          <p>Preview identities demonstrate the brand system and can be replaced with approved client marks before launch.</p>
        </div>
        <div className="client-logo-marquee" aria-label="Preview service business logos">
          <div className="client-logo-track">
            {[...showcaseBrands, ...showcaseBrands].map(({ name, sector, icon: BrandIcon }, index) => (
              <div className="client-logo" key={`${name}-${index}`} aria-hidden={index >= showcaseBrands.length}>
                <span><BrandIcon size={22} /></span>
                <div><strong>{name}</strong><small>{sector}</small></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-proof" aria-label="AppointIt operational benefits" data-reveal>
        <article><span>01</span><div><strong>Protect every hour</strong><p>Availability rules, service duration, and buffers prevent schedule collisions before they happen.</p></div></article>
        <article><span>02</span><div><strong>Keep everyone oriented</strong><p>Receptionists, owners, and providers work from the same live appointment record.</p></div></article>
        <article><span>03</span><div><strong>Close the communication loop</strong><p>Confirmations, reminders, and delivery status stay attached to the customer journey.</p></div></article>
      </section>

      <section className="landing-section platform-section" id="platform" data-reveal>
        <div className="section-heading">
          <p className="eyebrow">The operational layer behind every booking</p>
          <h2>Less chasing. Fewer surprises. A day your team can actually see.</h2>
          <p>AppointIt connects each step of the appointment journey without turning your front desk into a maze of tools.</p>
        </div>
        <div className="benefit-grid">
          <article>
            <span className="benefit-icon blue"><CalendarDays /></span>
            <h3>A calendar built around reality</h3>
            <p>Working hours, breaks, service duration, and buffers are checked before every appointment so double bookings never reach your calendar.</p>
            <a href="/signup">Build your schedule <ArrowRight size={16} /></a>
          </article>
          <article>
            <span className="benefit-icon green"><Users /></span>
            <h3>The right view for every role</h3>
            <p>Give owners, receptionists, and providers the right access while keeping branches, customers, and schedules together.</p>
            <a href="/signup">Bring your team <ArrowRight size={16} /></a>
          </article>
          <article>
            <span className="benefit-icon coral"><BellRing /></span>
            <h3>Communication with a memory</h3>
            <p>Send branded SMS confirmations, reminders, cancellations, and follow-ups, with delivery history your team can trace.</p>
            <a href="/signup">Connect notifications <ArrowRight size={16} /></a>
          </article>
        </div>
      </section>

      <section className="reviews-section" id="reviews" data-reveal>
        <div className="reviews-inner">
          <div className="reviews-heading">
            <p className="eyebrow">From the people running the day</p>
            <h2>What a calmer workflow sounds like.</h2>
            <p>Role-based perspectives illustrate the experience AppointIt is designed to create. Verified customer stories can replace them as they are approved.</p>
          </div>
          <div className="review-stage">
            <div className="review-quote" key={reviewIndex}>
              <Quote size={30} aria-hidden="true" />
              <blockquote>{activeReview.quote}</blockquote>
              <div className="review-attribution"><span>{String(reviewIndex + 1).padStart(2, "0")}</span><div><strong>{activeReview.role}</strong><small>{activeReview.business}</small></div></div>
            </div>
            <div className="review-controls">
              <div>
                <button type="button" aria-label="Previous perspective" onClick={() => setReviewIndex((reviewIndex - 1 + workflowPerspectives.length) % workflowPerspectives.length)}><ChevronLeft size={19} /></button>
                <button type="button" aria-label="Next perspective" onClick={() => setReviewIndex((reviewIndex + 1) % workflowPerspectives.length)}><ChevronRight size={19} /></button>
              </div>
              <span>{reviewIndex + 1} / {workflowPerspectives.length}</span>
            </div>
          </div>
          <div className="review-selector" role="group" aria-label="Workflow perspectives">
            {workflowPerspectives.map((review, index) => (
              <button type="button" key={review.role} className={index === reviewIndex ? "active" : ""} aria-pressed={index === reviewIndex} onClick={() => setReviewIndex(index)}>
                <span>{String(index + 1).padStart(2, "0")}</span><div><strong>{review.role}</strong><small>{review.business}</small></div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="pricing-section" id="pricing" data-reveal>
        <div className="pricing-inner">
          <div className="pricing-heading">
            <p className="eyebrow">Choose how you grow</p>
            <h2>Paid plans shaped around the way your business operates.</h2>
            <p>Compare the published plans below. Prices, limits, and included capabilities are managed directly by the AppointIt platform team.</p>
          </div>
          {activePricingPlan ? <>
            <div className="pricing-selector" role="group" aria-label="Pricing packages">
              {publicPlans.map((plan, index) => {
                const PlanIcon = pricingIcons[index % pricingIcons.length];
                return <button
                  type="button"
                  key={plan.id}
                  aria-pressed={plan.id === activePricingPlan.id}
                  aria-controls="pricing-plan-panel"
                  className={plan.id === activePricingPlan.id ? "active" : ""}
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  <span><PlanIcon size={19} /></span>
                  <div><strong>{plan.name}</strong><small>{planPrice(plan)}{plan.currentVersion?.monthlyPriceCents != null ? " / month" : ""}</small></div>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                </button>;
              })}
            </div>
            <div className={`pricing-explorer ${activePricingPlan.code.toLowerCase()}`} id="pricing-plan-panel" aria-live="polite">
              <div className="pricing-story" key={`story-${activePricingPlan.id}`}>
                <div className="pricing-story-label"><span><PricingPlanIcon size={19} /></span><small>{activePricingPlan.code.replace(/_/g, " ")}</small></div>
                <h3>{activePricingPlan.name}</h3>
                <p>{activePricingPlan.description}</p>
                <div className="pricing-amount"><strong>{planPrice(activePricingPlan)}</strong><span>{activePricingPlan.currentVersion?.monthlyPriceCents == null ? "priced for your requirements" : "per month"}</span></div>
                <div className="pricing-address"><small>Plan version</small><strong>Version {activePricingPlan.currentVersion?.version} - {activePricingPlan.currentVersion?.currency}</strong></div>
                <a className="primary" href={`/signup?plan=${encodeURIComponent(activePricingPlan.code)}`}>Choose {activePricingPlan.name} <ArrowRight size={17} /></a>
              </div>
              <div className="pricing-details" key={`details-${activePricingPlan.id}`}>
                <div className="pricing-details-heading"><small>What is included</small><strong>{activePricingPlan.name} capabilities</strong></div>
                <dl>
                  {planFacts(activePricingPlan).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
                <div className="pricing-always">
                  <small>Capability access</small>
                  <div>
                    {activePricingPlan.currentVersion?.entitlements.smsAutomation && <span><Check size={16} /> SMS automation</span>}
                    {activePricingPlan.currentVersion?.entitlements.prioritySupport && <span><Check size={16} /> Priority support</span>}
                    {activePricingPlan.currentVersion?.entitlements.customIntegrations && <span><Check size={16} /> Custom integrations</span>}
                  </div>
                </div>
              </div>
            </div>
            <p className="pricing-note"><ShieldCheck size={16} /> Paid subscriptions are activated by the platform administrator while online billing is being integrated.</p>
          </> : <div className="pricing-empty">
            <strong>{publicPlansLoading ? "Loading subscription plans" : "Plans are unavailable"}</strong>
            <span>{publicPlansLoading ? "Fetching the latest published options..." : publicPlansError || "No public subscription plans have been published yet."}</span>
            {!publicPlansLoading && <button type="button" className="secondary" onClick={() => void refreshPublicPlans()}>Try again</button>}
          </div>}
        </div>
      </section>

      <section className="workflow-section" id="workflow" data-reveal>
        <div className="workflow-inner">
          <div className="workflow-copy">
            <p className="eyebrow">Go live with confidence</p>
            <h2>Your first confirmed booking is closer than it looks.</h2>
            <p>Set up the essentials once. AppointIt turns them into a booking flow your staff and customers can depend on.</p>
            <a className="secondary" href="/signup">Set up your workspace <ArrowRight size={17} /></a>
          </div>
          <ol className="workflow-steps">
            <li><span><Building2 size={18} /></span><div><strong>Create your workspace</strong><p>Add your business profile, branches, and contact details.</p></div></li>
            <li><span><ShieldCheck size={18} /></span><div><strong>Verify and configure</strong><p>Confirm ownership, add services, assign staff, and set booking rules.</p></div></li>
            <li><span><Globe2 size={18} /></span><div><strong>Open your booking page</strong><p>Share your link and manage every appointment change from one calendar.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="landing-cta" data-reveal>
        <div>
          <p className="eyebrow">Make room for better work</p>
          <h2>Give your team a calmer way to run the day.</h2>
        </div>
        <a className="primary" href="/signup">Start your workspace <ArrowRight size={18} /></a>
      </section>

      <footer className="landing-footer">
        <a className="landing-brand" href="/"><span><CalendarCheck2 size={20} /></span><strong>AppointIt</strong></a>
        <p>Appointment operations for modern service businesses.</p>
        <div><a href="/login">Sign in</a><a href="/signup">Create account</a></div>
      </footer>

      <div className={`theme-picker${themeMenuOpen ? " open" : ""}`}>
        {themeMenuOpen && (
          <div className="theme-picker-panel" id="landing-theme-menu" role="group" aria-label="Landing page color theme">
            <div className="theme-picker-heading">
              <div><strong>Color theme</strong><small>Saved on this device</small></div>
              <button type="button" onClick={() => setThemeMenuOpen(false)} aria-label="Close color theme menu"><X size={17} /></button>
            </div>
            <div className="theme-options">
              {landingThemes.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className={option.id === theme ? "selected" : ""}
                  aria-pressed={option.id === theme}
                  onClick={() => setTheme(option.id)}
                >
                  <span className="theme-swatches" aria-hidden="true">
                    {option.colors.map((color) => <i key={color} style={{ background: color }} />)}
                  </span>
                  <strong>{option.label}</strong>
                  {option.id === theme && <Check size={16} />}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          className="theme-picker-toggle"
          type="button"
          title="Change color theme"
          aria-label="Change color theme"
          aria-expanded={themeMenuOpen}
          aria-controls="landing-theme-menu"
          onClick={() => setThemeMenuOpen((open) => !open)}
        >
          <Palette size={21} />
        </button>
      </div>

    </main>
  );
}

export function LoginPage() {
  const params = new URLSearchParams(location.search);
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<{ token: string; phone: string; twoFactor: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(() => {
    if (params.get("newAccount")) return "Your workspace is ready. Sign in and we will text a verification code to the owner phone.";
    if (params.get("session") === "expired") return "Your session expired. Please sign in again.";
    return "";
  });
  const [loading, setLoading] = useState(false);

  function finishLogin(result: LoginResponse) {
    setToken(result.accessToken, result.refreshToken);
    const returnTo = params.get("returnTo");
    location.href = returnTo && returnTo.startsWith("/")
      ? returnTo
      : result.user.role === "SUPER_ADMIN" ? "/admin" : "/dashboard";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const result = await login(email, password);
      finishLogin(result);
    } catch (error) {
      if (error instanceof ApiRequestError && error.payload.reason === "SUBSCRIPTION_REQUIRED" && typeof error.payload.renewalToken === "string") {
        location.href = `/renew?token=${encodeURIComponent(error.payload.renewalToken)}`;
        return;
      }
      if (error instanceof ApiRequestError && ["PHONE_VERIFICATION_REQUIRED", "TWO_FACTOR_REQUIRED"].includes(String(error.payload.reason))) {
        const challengeToken = typeof error.payload.challengeToken === "string" ? error.payload.challengeToken : "";
        const phone = typeof error.payload.phone === "string" ? error.payload.phone : "your phone";
        if (challengeToken) {
          const twoFactor = error.payload.reason === "TWO_FACTOR_REQUIRED";
          setChallenge({ token: challengeToken, phone, twoFactor });
          setMessage(twoFactor ? `Two-factor code sent to ${phone}.` : `Verification code sent to ${phone}.`);
          return;
        }
      }
      setMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setLoading(true);
    setMessage("");
    try {
      finishLogin(await verifyPhoneOtp(challenge.token, code));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (!challenge) return;
    setLoading(true);
    try {
      const result = await resendPhoneOtp(challenge.token);
      setMessage(`A new code was sent to ${result.phone}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resend code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="signup-page">
      <section className="signup-card login-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Secure access</p>
            <h1>{challenge ? challenge.twoFactor ? "Two-factor authentication" : "Verify your phone" : "Welcome back"}</h1>
          </div>
          <a href="/">Back</a>
        </div>
        {!challenge ? <form className="setup-form" onSubmit={submit}>
          <fieldset className="single-column">
            <legend>Account</legend>
            <label>Email address<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" type="email" autoComplete="email" required /></label>
            <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" type="password" autoComplete="current-password" required /></label>
          </fieldset>
          {message && <p className="form-message">{message}</p>}
          <button className="primary" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
          <a href="/forgot-password">Forgot password?</a>
        </form> : <form className="setup-form" onSubmit={verify}>
          <fieldset className="single-column">
            <legend>{challenge.twoFactor ? "Security code" : "Phone verification"}</legend>
            <p className="field-note">Enter the six-digit code sent to {challenge.phone}. It expires in five minutes.</p>
            <label>Verification code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" minLength={6} maxLength={6} required autoFocus /></label>
          </fieldset>
          {message && <p className="form-message">{message}</p>}
          <button className="primary" disabled={loading || code.length !== 6}>{loading ? "Verifying..." : "Verify and continue"}</button>
          <button className="secondary" type="button" disabled={loading} onClick={() => void resend()}>Send a new code</button>
          <button className="text-button" type="button" onClick={() => { setChallenge(null); setCode(""); setMessage(""); }}>Use another account</button>
        </form>}
      </section>
    </main>
  );
}

export function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setMessage("");
    try {
      const result = await requestPasswordReset(String(form.get("email")));
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not request reset");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="signup-page">
      <section className="signup-card login-card">
        <div className="panel-head">
          <div><p className="eyebrow">Account recovery</p><h1>Reset password</h1></div>
          <a href="/login">Login</a>
        </div>
        <form className="setup-form" onSubmit={submit}>
          <fieldset><legend>Email</legend><input name="email" placeholder="Account email" type="email" required /></fieldset>
          {message && <p className="form-message">{message}</p>}
          <button className="primary" disabled={loading}>{loading ? "Sending..." : "Send reset email"}</button>
        </form>
      </section>
    </main>
  );
}

export function ResetPasswordPage() {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setMessage("");
    try {
      await confirmPasswordReset(token, String(form.get("password")));
      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return <main className="signup-page"><section className="signup-card success"><CheckCircle2 size={52} /><h1>Password changed</h1><p>You can log in with the new password.</p><a className="primary" href="/login">Login</a></section></main>;
  }

  return (
    <main className="signup-page">
      <section className="signup-card login-card">
        <div className="panel-head"><div><p className="eyebrow">Account recovery</p><h1>Choose a new password</h1></div><a href="/login">Login</a></div>
        <form className="setup-form" onSubmit={submit}>
          <fieldset><legend>Password</legend><input name="password" placeholder="New password" type="password" minLength={8} required /></fieldset>
          {!token && <p className="form-message error">Reset token is missing.</p>}
          {message && <p className="form-message error">{message}</p>}
          <button className="primary" disabled={loading || !token}>{loading ? "Saving..." : "Save password"}</button>
        </form>
      </section>
    </main>
  );
}

export function SignupPage() {
  const requestedPlanCode = new URLSearchParams(location.search).get("plan")?.toUpperCase() || "STANDARD";
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [draft, setDraft] = useState({
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    password: "",
    businessName: "",
    businessType: "Dental clinic",
    slug: "",
    branchName: "Main branch",
    branchAddress: "",
    serviceName: "",
    serviceCategory: "General",
    servicePrice: "",
    serviceDuration: "30",
    bufferAfterMinutes: "0",
    providerName: "",
    providerRole: "Provider",
    providerEmail: "",
    providerPhone: ""
  });

  const steps = ["Owner", "Business", "Location", "Service & staff", "Review"];

  function update(name: keyof typeof draft, value: string) {
    setDraft((current) => {
      const next = { ...current, [name]: value };
      if (name === "ownerName" && (!current.providerName || current.providerName === current.ownerName)) next.providerName = value;
      if (name === "ownerPhone" && (!current.providerPhone || current.providerPhone === current.ownerPhone)) next.providerPhone = value;
      if (name === "ownerEmail" && (!current.providerEmail || current.providerEmail === current.ownerEmail)) next.providerEmail = value;
      if (name === "businessName" && !slugTouched) {
        next.slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      }
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < steps.length - 1) {
      setStep((current) => current + 1);
      setMessage("");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await signupVendor({
        ownerName: draft.ownerName,
        ownerEmail: draft.ownerEmail,
        ownerPhone: draft.ownerPhone,
        password: draft.password,
        planCode: requestedPlanCode,
        businessName: draft.businessName,
        businessType: draft.businessType,
        slug: draft.slug,
        branchName: draft.branchName,
        branchAddress: draft.branchAddress,
        service: {
          name: draft.serviceName,
          category: draft.serviceCategory,
          priceCents: Math.round(Number(draft.servicePrice) * 100),
          durationMinutes: Number(draft.serviceDuration),
          bufferAfterMinutes: Number(draft.bufferAfterMinutes)
        },
        provider: {
          name: draft.providerName,
          roleTitle: draft.providerRole,
          phone: draft.providerPhone || undefined,
          email: draft.providerEmail || undefined
        },
        timezone: "Africa/Addis_Ababa"
      });
      const query = new URLSearchParams({ invoice: result.payment.invoiceId, token: result.payment.token });
      location.assign(`/payment?${query.toString()}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Signup failed. Is the API running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="signup-page">
      <section className="signup-card onboarding-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Business setup</p>
            <h1>Build your AppointIt workspace</h1>
          </div>
          <a href="/">Exit setup</a>
        </div>
        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((label, index) => <span key={label} className={index <= step ? "complete" : ""}><i>{index < step ? <Check size={14} /> : index + 1}</i>{label}</span>)}
        </div>
        <form className="setup-form" onSubmit={submit}>
          {step === 0 && <fieldset><legend>Owner account</legend>
            <label>Full name<input value={draft.ownerName} onChange={(e) => update("ownerName", e.target.value)} autoComplete="name" required /></label>
            <label>Email address<input value={draft.ownerEmail} onChange={(e) => update("ownerEmail", e.target.value)} type="email" autoComplete="email" required /></label>
            <label>Phone number<input value={draft.ownerPhone} onChange={(e) => update("ownerPhone", e.target.value)} type="tel" placeholder="+251..." autoComplete="tel" required minLength={6} /></label>
            <label>Password<input value={draft.password} onChange={(e) => update("password", e.target.value)} type="password" autoComplete="new-password" required minLength={8} /></label>
          </fieldset>}
          {step === 1 && <fieldset><legend>Business profile</legend>
            <label>Business name<input value={draft.businessName} onChange={(e) => update("businessName", e.target.value)} required /></label>
            <label>Business type<select value={draft.businessType} onChange={(e) => update("businessType", e.target.value)} required><option>Dental clinic</option><option>Medical clinic</option><option>Salon & spa</option><option>Barbershop</option><option>Consultancy</option><option>Other service business</option></select></label>
            <label className="field-wide">Booking page address<div className="slug-input"><span>appointit.com/book/</span><input value={draft.slug} onChange={(e) => { setSlugTouched(true); update("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }} required pattern="[a-z0-9-]+" /></div></label>
          </fieldset>}
          {step === 2 && <fieldset><legend>First location</legend>
            <label>Location name<input value={draft.branchName} onChange={(e) => update("branchName", e.target.value)} required /></label>
            <label>Address<input value={draft.branchAddress} onChange={(e) => update("branchAddress", e.target.value)} placeholder="Bole, Addis Ababa" required /></label>
            <p className="field-note field-wide">Your initial working hours will be Monday to Saturday, 9:00 AM to 5:00 PM. You can customize them from Settings.</p>
          </fieldset>}
          {step === 3 && <fieldset><legend>First service and provider</legend>
            <label>Service name<input value={draft.serviceName} onChange={(e) => update("serviceName", e.target.value)} placeholder="Dental consultation" required /></label>
            <label>Category<input value={draft.serviceCategory} onChange={(e) => update("serviceCategory", e.target.value)} required /></label>
            <label>Price (ETB)<input value={draft.servicePrice} onChange={(e) => update("servicePrice", e.target.value)} type="number" min="0" step="0.01" required /></label>
            <label>Duration<select value={draft.serviceDuration} onChange={(e) => update("serviceDuration", e.target.value)}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option></select></label>
            <label>Provider name<input value={draft.providerName} onChange={(e) => update("providerName", e.target.value)} required /></label>
            <label>Provider role<input value={draft.providerRole} onChange={(e) => update("providerRole", e.target.value)} placeholder="Dentist" required /></label>
            <label>Provider phone<input value={draft.providerPhone} onChange={(e) => update("providerPhone", e.target.value)} type="tel" required minLength={6} /></label>
            <label>Provider email<input value={draft.providerEmail} onChange={(e) => update("providerEmail", e.target.value)} type="email" required /></label>
          </fieldset>}
          {step === 4 && <section className="onboarding-review">
            <h2>Review your workspace</h2>
            <dl><div><dt>Owner</dt><dd>{draft.ownerName}<small>{draft.ownerEmail} · {draft.ownerPhone}</small></dd></div><div><dt>Business</dt><dd>{draft.businessName}<small>{draft.businessType}</small></dd></div><div><dt>Subscription</dt><dd>{requestedPlanCode.replace(/_/g, " ")}<small>Paid plan activation follows account verification.</small></dd></div><div><dt>Location</dt><dd>{draft.branchName}<small>{draft.branchAddress}</small></dd></div><div><dt>First service</dt><dd>{draft.serviceName}<small>{draft.serviceDuration} min · {draft.servicePrice || "0"} ETB · {draft.providerName}</small></dd></div></dl>
            <p className="field-note">After creation, sign in and verify the owner phone by SMS. Successful verification activates the vendor automatically.</p>
          </section>}
          {message && <p className="form-message error">{message}</p>}
          <div className="onboarding-actions">
            {step > 0 && <button className="secondary" type="button" onClick={() => setStep((current) => current - 1)}>Back</button>}
            <button className="primary" disabled={loading}>{loading ? "Creating workspace..." : step === steps.length - 1 ? "Create workspace" : "Continue"} {step < steps.length - 1 && <ArrowRight size={17} />}</button>
          </div>
        </form>
      </section>
    </main>
  );
}

export function RenewalPage() {
  const renewalToken = new URLSearchParams(location.search).get("token") ?? "";
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { listPublicPlans().then(setPlans).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load plans")); }, []);
  async function choose(planId: string) { setBusy(true); setMessage(""); try { const payment = await createRenewalInvoice(renewalToken, planId); location.href = `/payment?${new URLSearchParams({ invoice: payment.invoiceId, token: payment.token })}`; } catch (error) { setMessage(error instanceof Error ? error.message : "Could not start renewal"); setBusy(false); } }
  return <main className="payment-page"><nav className="payment-nav"><a className="brand" href="/"><span>A</span><strong>AppointIt</strong></a><span>Subscription renewal</span></nav><section className="renewal-shell"><div className="renewal-heading"><p className="eyebrow">Keep your workspace active</p><h1>Renew or change your plan</h1><p>Choose a monthly plan, then complete the payment securely with Telebirr.</p></div>{message && <p className="form-error">{message}</p>}<div className="billing-plans">{plans.filter((plan) => plan.currentVersion?.monthlyPriceCents != null).map((plan) => <article className="panel" key={plan.id}><span className="badge active">{plan.code}</span><h2>{plan.name}</h2><p>{plan.description}</p><strong className="billing-price">{money(plan.currentVersion!.monthlyPriceCents!)} <small>/ month</small></strong><button className="primary" disabled={busy || !renewalToken} onClick={() => void choose(plan.id)}>Continue with {plan.name}</button></article>)}</div></section></main>;
}

export function PaymentPage() {
  const query = new URLSearchParams(location.search);
  const invoiceId = query.get("invoice") ?? "";
  const token = query.get("token") ?? "";
  const [invoice, setInvoice] = useState<PaymentInvoice | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verificationDeadline, setVerificationDeadline] = useState<number | null>(null);
  const [verificationTimedOut, setVerificationTimedOut] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(20);
  const [proof, setProof] = useState<File | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  const refresh = useCallback(async () => {
    if (!invoiceId || !token) {
      setMessage("This payment link is incomplete. Return to signup and try again.");
      setLoading(false);
      return;
    }
    try {
      const nextInvoice = await getPaymentInvoice(invoiceId, token);
      setInvoice(nextInvoice);
      if (nextInvoice.status === "SUBMITTED" && nextInvoice.submittedAt) {
        const deadline = new Date(nextInvoice.submittedAt).getTime() + 20_000;
        setVerificationDeadline(deadline);
        setVerificationTimedOut(Date.now() >= deadline);
      } else {
        setVerificationDeadline(null);
        setVerificationTimedOut(false);
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment request could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [invoiceId, token]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (invoice?.status !== "SUBMITTED" || verificationTimedOut) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [invoice?.status, refresh, verificationTimedOut]);
  useEffect(() => {
    if (!verificationDeadline || verificationTimedOut) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((verificationDeadline - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining === 0) setVerificationTimedOut(true);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [verificationDeadline, verificationTimedOut]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setVerificationTimedOut(false);
    try {
      await claimTelebirrPayment(invoiceId, token, transactionId);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitProof(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proof) return;
    setUploadingProof(true);
    setMessage("");
    try {
      await uploadTelebirrProof(invoiceId, token, proof);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payment proof could not be uploaded.");
    } finally {
      setUploadingProof(false);
    }
  }

  if (loading) return <main className="payment-page"><div className="payment-loading"><RefreshCw className="spin" /><span>Loading secure payment request...</span></div></main>;
  if (!invoice) return <main className="payment-page"><section className="payment-shell payment-error"><ReceiptText /><h1>Payment request unavailable</h1><p>{message}</p><a className="secondary" href="/signup">Return to signup</a></section></main>;

  const paid = invoice.status === "PAID";
  const underReview = invoice.status === "REVIEW" && Boolean(invoice.proofUploadedAt);
  const canUploadProof = verificationTimedOut || (invoice.status === "REVIEW" && !invoice.proofUploadedAt);
  return (
    <main className="payment-page">
      <nav className="payment-nav"><a className="brand" href="/"><span>A</span><strong>AppointIt</strong></a><span>Secure Telebirr payment</span></nav>
      <section className="payment-shell">
        <div className="payment-summary">
          <p className="eyebrow">Activate your workspace</p>
          <h1>{paid ? "Payment confirmed" : "Complete your subscription"}</h1>
          <p>{paid ? `Your ${invoice.plan.name} subscription is active.` : `One final step for ${invoice.businessName}. Pay the exact amount below from any Telebirr account.`}</p>
          <div className="payment-order">
            <span>{invoice.plan.name} plan <small>Monthly subscription</small></span>
            <strong>{money(invoice.amountCents)}</strong>
          </div>
          <div className="payment-trust"><ShieldCheck size={18} /><span>Your transaction is matched automatically from Ethio telecom's payment confirmation.</span></div>
        </div>

        <div className={`payment-action ${paid || underReview ? "is-paid" : ""}`}>
          {paid ? <>
            <CheckCircle2 size={56} />
            <h2>You're all set</h2>
            <p>Now verify the owner's phone number to finish activating the business account.</p>
            <a className="primary" href={`/login?newAccount=1&email=${encodeURIComponent(invoice.ownerEmail ?? "")}`}>Continue to phone verification <ArrowRight size={18} /></a>
          </> : underReview ? <>
            <CheckCircle2 size={56} />
            <h2>Proof received</h2>
            <p>We will review your payment and contact you soon. You can safely close this page.</p>
          </> : <>
            <div className="payment-step"><i>1</i><div><strong>Send with Telebirr</strong><span>Pay to this mobile number</span></div></div>
            <button className="payment-copy" type="button" onClick={() => void navigator.clipboard.writeText(invoice.destinationPhone)}><span>{invoice.destinationPhone}</span><small>Copy number</small></button>
            <div className="payment-amount"><span>Exact amount</span><strong>{money(invoice.amountCents)}</strong></div>
            <div className="payment-step"><i>2</i><div><strong>Enter the transaction number</strong><span>It appears in your Telebirr confirmation, for example DFT3DDIXIX</span></div></div>
            <form onSubmit={submit} className="payment-form">
              <label>Transaction number<input value={transactionId} onChange={(event) => setTransactionId(event.target.value.toUpperCase().replace(/\s/g, ""))} placeholder="e.g. DFT3DDIXIX" minLength={6} maxLength={32} autoComplete="off" required disabled={invoice.status === "SUBMITTED" && !verificationTimedOut} /></label>
              <button className="primary" disabled={submitting || (invoice.status === "SUBMITTED" && !verificationTimedOut)}>{invoice.status === "SUBMITTED" && !verificationTimedOut ? <><RefreshCw className="spin" size={17} /> Checking payment ({secondsRemaining}s)</> : submitting ? "Submitting..." : verificationTimedOut ? "Try transaction again" : "I have paid"}</button>
            </form>
            {invoice.status === "SUBMITTED" && !verificationTimedOut && <p className="payment-wait">Keep this page open while we match the confirmation SMS.</p>}
            {verificationTimedOut && <div className="payment-unmatched"><strong>We couldn't verify that transaction.</strong><span>Check the transaction number and try again, or upload your Telebirr receipt below.</span></div>}
            {invoice.status === "REVIEW" && !invoice.proofUploadedAt && <p className="form-error">The received amount does not match this invoice. Upload your receipt for review.</p>}
            {canUploadProof && <form className="proof-form" onSubmit={submitProof}>
              <label className="proof-picker"><UploadCloud size={24} /><span><strong>{proof ? proof.name : "Upload payment proof"}</strong><small>JPG, PNG, WebP, or PDF up to 5 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setProof(event.target.files?.[0] ?? null)} required /></label>
              <button className="secondary" disabled={!proof || uploadingProof}>{uploadingProof ? "Uploading..." : "Submit for review"}</button>
            </form>}
            {invoice.status === "EXPIRED" && <p className="form-error">This payment request has expired. Please contact support for a new invoice.</p>}
            {message && <p className="form-error">{message}</p>}
          </>}
        </div>
      </section>
    </main>
  );
}

export function AcceptInvitePage() {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setMessage("");
    try {
      await acceptInvite(token, String(form.get("password")));
      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept invite");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="signup-page">
        <section className="signup-card success">
          <CheckCircle2 size={52} />
          <h1>Account ready</h1>
          <p>Your staff account is active. You can log in now.</p>
          <a className="primary" href="/login">Login</a>
        </section>
      </main>
    );
  }

  return (
    <main className="signup-page">
      <section className="signup-card login-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Staff invite</p>
            <h1>Create your password</h1>
          </div>
          <a href="/login">Login</a>
        </div>
        <form className="setup-form" onSubmit={submit}>
          <fieldset>
            <legend>Password</legend>
            <input name="password" placeholder="Password" type="password" minLength={8} required />
          </fieldset>
          {!token && <p className="form-message error">Invite token is missing.</p>}
          {message && <p className="form-message error">{message}</p>}
          <button className="primary" disabled={loading || !token}>{loading ? "Activating..." : "Activate account"}</button>
        </form>
      </section>
    </main>
  );
}

export function ManageBookingPage() {
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [appointment, setAppointment] = useState<ManagedAppointment | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Array<{ startAt: string; staffId: string }>>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    if (!token) { setMessage("This booking management link is incomplete."); setLoading(false); return; }
    getManagedAppointment(token)
      .then((item) => { setAppointment(item); setDate(dateKeyInTimeZone(new Date(item.startAt), item.vendor.timezone)); })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not open this appointment"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!changing || !date || !appointment?.capabilities.canReschedule) return;
    setSlotsLoading(true);
    setMessage("");
    getManagedAppointmentSlots(token, date)
      .then(setSlots)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load available times"))
      .finally(() => setSlotsLoading(false));
  }, [appointment?.capabilities.canReschedule, changing, date, token]);

  async function chooseSlot(slot: { startAt: string; staffId: string }) {
    setBusy(true);
    setMessage("");
    try {
      const updated = await rescheduleManagedAppointment(token, slot.startAt, slot.staffId);
      setAppointment(updated);
      setChanging(false);
      setMessage("Your appointment has been rescheduled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reschedule appointment");
    } finally { setBusy(false); }
  }

  async function cancel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      setAppointment(await cancelManagedAppointment(token, String(form.get("reason")) || undefined));
      setChanging(false);
      setConfirmingCancel(false);
      setMessage("Your appointment has been cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel appointment");
    } finally { setBusy(false); }
  }

  if (loading) return <main className="booking booking-result"><section className="booking-success-card workspace-state"><span className="loading-line" /><strong>Opening your appointment</strong></section></main>;
  if (!appointment) return <main className="booking booking-result"><section className="booking-success-card"><CalendarDays size={42} /><h1>Link unavailable</h1><p>{message}</p></section></main>;

  const active = !["CANCELLED", "COMPLETED", "NO_SHOW"].includes(appointment.status);
  return <main className="booking manage-booking-page">
    <header className="booking-brand"><span>{appointment.vendor.name.charAt(0)}</span><div><strong>{appointment.vendor.name}</strong><small>Appointment management</small></div></header>
    <section className="manage-booking-shell">
      <div className="booking-card manage-booking-card">
        <div className="manage-booking-heading"><p className="eyebrow">Hello {appointment.customer.name}</p><h1>{active ? "Manage your appointment" : "Appointment details"}</h1><span className={`badge ${appointment.status.toLowerCase()}`}>{appointment.status}</span></div>
        {message && <p className="form-message">{message}</p>}
        <dl className="confirmation-details"><div><dt>Date and time</dt><dd>{formatBookingDateTime(appointment.startAt, appointment.vendor.timezone)}</dd></div><div><dt>Service</dt><dd>{appointment.service.name}</dd></div><div><dt>Provider</dt><dd>{appointment.staff.name}</dd></div><div><dt>Location</dt><dd>{appointment.branch.name}<small>{appointment.branch.address}</small></dd></div></dl>
        {active && <div className="manage-actions">
          <div className="manage-action-block"><button className="primary" disabled={!appointment.capabilities.canReschedule || busy} onClick={() => { setChanging((current) => !current); setConfirmingCancel(false); }}><RefreshCw size={17} /> {changing ? "Close time picker" : "Reschedule appointment"}</button>{appointment.capabilities.rescheduleUnavailableReason && <small>{appointment.capabilities.rescheduleUnavailableReason}</small>}</div>
          <div className="manage-action-block">{confirmingCancel ? <form className="cancel-confirmation" onSubmit={cancel}><strong>Confirm cancellation</strong><p>This releases your reserved time for another customer.</p><input name="reason" placeholder="Cancellation reason (optional)" maxLength={500} /><div><button type="button" className="secondary" onClick={() => setConfirmingCancel(false)}>Keep appointment</button><button className="danger" disabled={busy}>{busy ? "Cancelling..." : "Yes, cancel appointment"}</button></div></form> : <button className="secondary danger" type="button" disabled={!appointment.capabilities.canCancel || busy} onClick={() => { setConfirmingCancel(true); setChanging(false); }}>Cancel appointment</button>}{appointment.capabilities.cancelUnavailableReason && <small>{appointment.capabilities.cancelUnavailableReason}</small>}</div>
        </div>}
        <div className="calendar-actions"><a className="secondary" href={googleCalendarLink(appointment, appointment.vendor.name, appointment.branch.address)} target="_blank" rel="noreferrer"><CalendarPlus size={17} /> Google Calendar</a><button className="secondary" onClick={() => downloadCalendarFile(appointment, appointment.vendor.name, appointment.branch.address)}><Download size={17} /> Apple / calendar app</button></div>
      </div>
      {changing && <aside className="booking-card manage-slots"><div><p className="eyebrow">Choose a new time</p><h2>Available appointments</h2></div><label>New date<input type="date" min={dateKeyInTimeZone(new Date(), appointment.vendor.timezone)} value={date} onChange={(event) => setDate(event.target.value)} /></label>{slotsLoading ? <div className="slots-state"><span className="loading-line" /><strong>Finding open times</strong></div> : slots.length ? <div className="slot-list">{slots.map((slot) => <button key={`${slot.startAt}-${slot.staffId}`} disabled={busy} onClick={() => void chooseSlot(slot)}>{formatBookingTime(slot.startAt, appointment.vendor.timezone)}</button>)}</div> : <div className="booking-empty"><CalendarDays size={26} /><strong>No openings on this date</strong><p>Choose another date.</p></div>}</aside>}
    </section>
  </main>;
  /* Replaced by the explicit in-page action flow above.
  return <main className="booking manage-booking-page"><header className="booking-brand"><span>{appointment.vendor.name.charAt(0)}</span><div><strong>{appointment.vendor.name}</strong><small>Appointment management</small></div></header><section className="manage-booking-shell"><div className="booking-card manage-booking-card"><div className="manage-booking-heading"><p className="eyebrow">Hello {appointment.customer.name}</p><h1>{active ? "Manage your appointment" : "Appointment details"}</h1><span className={`badge ${appointment.status.toLowerCase()}`}>{appointment.status}</span></div>{message && <p className="form-message">{message}</p>}<dl className="confirmation-details"><div><dt>Date and time</dt><dd>{formatBookingDateTime(appointment.startAt, appointment.vendor.timezone)}</dd></div><div><dt>Service</dt><dd>{appointment.service.name}</dd></div><div><dt>Provider</dt><dd>{appointment.staff.name}</dd></div><div><dt>Location</dt><dd>{appointment.branch.name}<small>{appointment.branch.address}</small></dd></div></dl>{active && <div className="manage-actions"><button className="primary" disabled={!appointment.capabilities.canReschedule || busy} onClick={() => setChanging((current) => !current)}><RefreshCw size={17} /> Reschedule</button><form onSubmit={cancel}><input name="reason" placeholder="Cancellation reason (optional)" maxLength={500} /><button className="secondary danger" disabled={!appointment.capabilities.canCancel || busy}>Cancel appointment</button></form></div>}{active && (!appointment.capabilities.canCancel || !appointment.capabilities.canReschedule) && <p className="policy-note">Some online changes are unavailable because of this business's notice period or rescheduling limit. Contact the business directly for help.</p>}<div className="calendar-actions"><a className="secondary" href={googleCalendarLink(appointment, appointment.vendor.name, appointment.branch.address)} target="_blank" rel="noreferrer"><CalendarPlus size={17} /> Google Calendar</a><button className="secondary" onClick={() => downloadCalendarFile(appointment, appointment.vendor.name, appointment.branch.address)}><Download size={17} /> Apple / calendar app</button></div></div>{changing && <aside className="booking-card manage-slots"><div><p className="eyebrow">Choose a new time</p><h2>Available appointments</h2></div><label>New date<input type="date" min={dateKeyInTimeZone(new Date(), appointment.vendor.timezone)} value={date} onChange={(event) => setDate(event.target.value)} /></label>{slotsLoading ? <div className="slots-state"><span className="loading-line" /><strong>Finding open times</strong></div> : slots.length ? <div className="slot-list">{slots.map((slot) => <button key={`${slot.startAt}-${slot.staffId}`} disabled={busy} onClick={() => void chooseSlot(slot)}>{formatBookingTime(slot.startAt, appointment.vendor.timezone)}</button>)}</div> : <div className="booking-empty"><CalendarDays size={26} /><strong>No openings on this date</strong><p>Choose another date.</p></div>}</aside>}</section></main>;
  */
}

export function BookingPage() {
  const [step, setStep] = useState(0);
  const slug = location.pathname.split("/").filter(Boolean)[1] ?? "";
  const customHostname = slug ? "" : location.hostname;
  const locator = slug ? { slug } : { hostname: customHostname };
  const [vendor, setVendor] = useState<PublicVendor>({
    id: "",
    name: "",
    slug,
    branches: [],
    services: [],
    staff: []
  });
  const [booking, setBooking] = useState({
    branchId: "",
    serviceId: "",
    staffId: "",
    startAt: ""
  });
  const today = localDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [slots, setSlots] = useState<Array<{ startAt: string; staffId: string }>>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<Awaited<ReturnType<typeof bookPublicAppointment>> | null>(null);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"loading" | "demo" | "live" | "error">("loading");

  useEffect(() => {
    getPublicVendor(locator)
      .then((loaded) => {
        setVendor(loaded);
        setSelectedDate(dateKeyInTimeZone(new Date(), loaded.timezone));
        setBooking((current) => ({
          ...current,
          branchId: loaded.branches[0]?.id ?? "",
          serviceId: "",
          staffId: ""
        }));
        setMode("live");
      })
      .catch((error) => {
        if (import.meta.env.DEV && slug) {
          setVendor({ id: "demo", name: demoVendor.name, slug: demoVendor.slug, branches: demoVendor.branches, services: demoVendor.services, staff: demoVendor.staff });
          setBooking((current) => ({ ...current, branchId: demoVendor.branches[0]?.id ?? "", serviceId: "" }));
          setMode("demo");
          return;
        }
        setMode("error");
        setMessage(error instanceof Error ? error.message : "This booking page is unavailable.");
      });
  }, [slug, customHostname]);

  useEffect(() => {
    if (step !== 2 || !booking.branchId || !booking.serviceId) return;
    setBooking((current) => ({ ...current, startAt: "" }));
    setMessage("");
    if (mode === "demo") {
      setSlots(demoSlotsForDate(selectedDate, vendor.staff, booking.staffId));
      return;
    }
    if (mode !== "live") return;
    let active = true;
    setSlotsLoading(true);
    setSlots([]);
    getPublicSlots(locator, booking.branchId, booking.serviceId, selectedDate, booking.staffId || undefined)
      .then((available) => { if (active) setSlots(available); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Could not load available times"); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [booking.branchId, booking.serviceId, booking.staffId, mode, selectedDate, step, slug, customHostname]);

  const selectedService = vendor.services.find((service) => service.id === booking.serviceId);
  const selectedBranch = vendor.branches.find((branch) => branch.id === booking.branchId);
  const qualifiedStaff = vendor.staff.filter((staff) => {
    const worksHere = !staff.branchId || staff.branchId === booking.branchId;
    const performsService = !staff.services?.length || staff.services.some((service) => service.serviceId === booking.serviceId);
    return worksHere && performsService;
  });
  const selectedStaff = vendor.staff.find((staff) => staff.id === booking.staffId);
  const selectedProviderName = selectedStaff?.name || (booking.staffId ? "Selected provider" : "Any available provider");
  const publicTheme = bookingThemeById(vendor.bookingTheme);
  const publicThemeStyle = bookingThemeStyle(publicTheme);
  const vendorToday = dateKeyInTimeZone(new Date(), vendor.timezone);
  const bookingDayStart = new Date(`${vendorToday}T12:00:00`);
  const bookingDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(bookingDayStart);
    date.setDate(bookingDayStart.getDate() + index);
    return { key: localDateKey(date), date };
  });

  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "demo") {
      setConfirmed({
        id: "demo-appointment",
        startAt: booking.startAt,
        status: "CONFIRMED",
        customer: { name: String(form.get("name")), phone: String(form.get("phone")) },
        service: { name: selectedService?.name ?? "Service", priceCents: selectedService?.priceCents ?? 0 },
        staff: { name: selectedStaff?.name ?? "Next available provider" },
        branch: { name: selectedBranch?.name ?? "Main location" }
      });
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const appointment = await bookPublicAppointment(locator, {
        branchId: booking.branchId,
        serviceId: booking.serviceId,
        staffId: booking.staffId || undefined,
        startAt: booking.startAt,
        customer: {
          name: String(form.get("name")),
          phone: String(form.get("phone")),
          email: String(form.get("email")) || undefined,
          smsOptIn: form.get("smsOptIn") === "on",
        }
      });
      setConfirmed(appointment);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmed) return (
    <main className="booking booking-result" style={publicThemeStyle}>
      <section className="booking-success-card">
        <span className="success-mark"><CheckCircle2 size={34} /></span>
        <p className="eyebrow">Booking confirmed</p>
        <h1>You're all set.</h1>
        <p>Your appointment with {vendor.name} is confirmed.</p>
        <dl className="confirmation-details">
          <div><dt>Date and time</dt><dd>{formatBookingDateTime(confirmed.startAt, vendor.timezone)}</dd></div>
          <div><dt>Service</dt><dd>{confirmed.service.name}</dd></div>
          <div><dt>Provider</dt><dd>{confirmed.staff.name}</dd></div>
          <div><dt>Location</dt><dd>{confirmed.branch.name}</dd></div>
        </dl>
        <p className="confirmation-note">Keep an eye on your phone or email for confirmation and reminders.</p>
        <div className="calendar-actions"><a className="primary" href={googleCalendarLink(confirmed, vendor.name, selectedBranch?.address)} target="_blank" rel="noreferrer"><CalendarPlus size={17} /> Google Calendar</a><button className="secondary" type="button" onClick={() => downloadCalendarFile(confirmed, vendor.name, selectedBranch?.address)}><Download size={17} /> Apple / calendar app</button></div>
        {confirmed.managementToken && <a className="manage-booking-link" href={`/manage-booking?token=${encodeURIComponent(confirmed.managementToken)}`}>Cancel or reschedule this appointment</a>}
        <a className="booking-again-link" href={location.pathname}>Book another appointment</a>
      </section>
    </main>
  );
  if (mode === "error") return <main className="booking booking-result" style={publicThemeStyle}><section className="booking-success-card"><CalendarDays size={42} /><h1>Booking page unavailable</h1><p>{message}</p></section></main>;

  return (
    <main className="booking" style={publicThemeStyle}>
      <header className="booking-brand"><span className={vendor.logoUrl ? "has-logo" : ""}>{vendor.logoUrl ? <img src={vendor.logoUrl} alt="" /> : (vendor.name || "A").charAt(0)}</span><div><strong>{vendor.name || "AppointIt"}</strong><small>{vendor.businessType || "Online appointment booking"}</small></div></header>
      <div className="booking-layout">
        <aside className="booking-image-panel">
          <img src={vendor.promoImageUrl || "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1600&q=80"} alt="" />
          <div className="booking-image-copy">
            <p className="eyebrow">Book online</p>
            <h1>{vendor.name || "Book your appointment"}</h1>
            <p>{vendor.description || `Choose a service, provider, and available time at ${vendor.businessType || "this business"}.`}</p>
            <div className="booking-hero-facts">
              <span><CalendarCheck2 size={17} /> {vendor.services.length || 0} services</span>
              <span><MapPin size={17} /> {vendor.branches.length || 0} location{vendor.branches.length === 1 ? "" : "s"}</span>
              <span><Users size={17} /> {vendor.staff.length || 0} provider{vendor.staff.length === 1 ? "" : "s"}</span>
            </div>
            <div className="booking-live-summary">
              <div><span>Service</span><strong>{selectedService?.name ?? "Choose a service"}</strong></div>
              <div><span>Location</span><strong>{selectedBranch?.name ?? "Choose location"}</strong></div>
              <div><span>Provider</span><strong>{selectedProviderName}</strong></div>
              <div><span>Time</span><strong>{booking.startAt ? formatBookingDateTime(booking.startAt, vendor.timezone) : "Pick a time"}</strong></div>
            </div>
          </div>
        </aside>
        <section className="booking-card booking-main">
          <div className="booking-main-kicker"><span><ShieldCheck size={16} /> Secure booking request</span><small>{vendor.timezone || "Local time"}</small></div>
          <div className="booking-progress" aria-label="Booking progress">
            {["Service", "Provider", "Time", "Details"].map((label, index) => <span key={label} className={index === step ? "on" : index < step ? "done" : ""}><i>{index < step ? <Check size={14} /> : index + 1}</i>{label}</span>)}
          </div>
          {message && <p className="form-message error booking-error">{message}</p>}
          {mode === "loading" && <div className="workspace-state"><span className="loading-line" /><strong>Loading booking options</strong><p>Checking services and locations...</p></div>}

          {mode !== "loading" && step === 0 && <div className="booking-step"><div className="booking-step-head"><p className="eyebrow">Step 1 of 4</p><h1>What would you like to book?</h1><p>Choose one service to see matching providers and availability.</p></div><div className="service-choices">{vendor.services.map((service) => <button type="button" key={service.id} onClick={() => { setBooking((current) => ({ ...current, serviceId: service.id, staffId: "", startAt: "" })); setStep(1); }}><span className="service-icon"><CalendarCheck2 size={20} /></span><span><strong>{service.name}</strong><small>{service.description || service.category || "Professional service"}</small><em><Clock3 size={15} /> {service.durationMinutes} min</em></span><b>{money(service.priceCents)}</b><ArrowRight size={18} /></button>)}</div>{vendor.services.length === 0 && <div className="booking-empty"><strong>No services are available yet</strong><p>Please contact the business directly.</p></div>}</div>}

          {mode !== "loading" && step === 1 && <div className="booking-step"><button className="booking-back" type="button" onClick={() => setStep(0)}><ChevronLeft size={17} /> Back</button><div className="booking-step-head"><p className="eyebrow">Step 2 of 4</p><h1>Where and with whom?</h1><p>Select a location, then choose a provider or let us find the earliest opening.</p></div><div className="booking-field-group"><label>Location</label><div className="location-choices">{vendor.branches.map((branch) => <button type="button" className={booking.branchId === branch.id ? "selected" : ""} key={branch.id} onClick={() => setBooking((current) => ({ ...current, branchId: branch.id, staffId: "", startAt: "" }))}><MapPin size={18} /><span><strong>{branch.name}</strong><small>{branch.address}</small></span>{booking.branchId === branch.id && <CheckCircle2 size={18} />}</button>)}</div></div><div className="booking-field-group"><label>Provider</label><div className="provider-choices"><button type="button" className={!booking.staffId ? "selected" : ""} onClick={() => setBooking((current) => ({ ...current, staffId: "", startAt: "" }))}><span className="provider-avatar"><Users size={19} /></span><span><strong>Any available provider</strong><small>Best choice for the earliest appointment</small></span>{!booking.staffId && <CheckCircle2 size={18} />}</button>{qualifiedStaff.map((staff) => <button type="button" className={booking.staffId === staff.id ? "selected" : ""} key={staff.id} onClick={() => setBooking((current) => ({ ...current, staffId: staff.id, startAt: "" }))}><span className={`provider-avatar${staff.profileImageUrl ? " has-photo" : ""}`}>{staff.profileImageUrl ? <img src={staff.profileImageUrl} alt="" /> : staff.name.charAt(0)}</span><span><strong>{staff.name}</strong><small>{staff.roleTitle}</small></span>{booking.staffId === staff.id && <CheckCircle2 size={18} />}</button>)}</div></div><div className="booking-actions"><button type="button" className="primary" disabled={!booking.branchId} onClick={() => setStep(2)}>Choose a time <ArrowRight size={17} /></button></div></div>}

          {mode !== "loading" && step === 2 && <div className="booking-step"><button className="booking-back" type="button" onClick={() => setStep(1)}><ChevronLeft size={17} /> Back</button><div className="booking-step-head"><p className="eyebrow">Step 3 of 4</p><h1>Choose a date and time</h1><p>Times shown are available now and will be checked again when you confirm.</p></div><div className="date-strip">{bookingDays.map(({ key, date }) => <button type="button" key={key} className={selectedDate === key ? "selected" : ""} onClick={() => setSelectedDate(key)}><small>{date.toLocaleDateString([], { weekday: "short" })}</small><strong>{date.getDate()}</strong><span>{date.toLocaleDateString([], { month: "short" })}</span></button>)}</div><label className="date-jump">Another date<input type="date" min={vendorToday} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>{slotsLoading ? <div className="slots-state"><span className="loading-line" /><strong>Finding open times</strong></div> : slots.length > 0 ? <div className="slot-groups">{(["Morning", "Afternoon", "Evening"] as const).map((period) => { const periodSlots = slots.filter((slot) => slotPeriod(slot.startAt, vendor.timezone) === period); return periodSlots.length > 0 && <section key={period}><h2>{period}</h2><div className="slot-list">{periodSlots.map((slot) => <button type="button" key={`${slot.startAt}-${slot.staffId}`} onClick={() => { setBooking((current) => ({ ...current, startAt: slot.startAt, staffId: current.staffId || slot.staffId })); setStep(3); }}>{formatBookingTime(slot.startAt, vendor.timezone)}</button>)}</div></section>; })}</div> : <div className="booking-empty"><CalendarDays size={28} /><strong>No openings on this date</strong><p>Choose another day to see more availability.</p></div>}</div>}

          {mode !== "loading" && step === 3 && <div className="booking-step"><button className="booking-back" type="button" onClick={() => setStep(2)}><ChevronLeft size={17} /> Back</button><div className="booking-step-head"><p className="eyebrow">Step 4 of 4</p><h1>Your details</h1><p>We will use these details only for this appointment and its reminders.</p></div><div className="mobile-booking-review"><strong>{selectedService?.name}</strong><span>{formatBookingDateTime(booking.startAt, vendor.timezone)}</span><small>{selectedBranch?.name} · {selectedStaff?.name || "Any available provider"}</small></div><form className="booking-form" onSubmit={submitBooking}><label>Full name<input name="name" autoComplete="name" placeholder="Your full name" minLength={2} required /></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="e.g. +251 9..." minLength={6} required /></label><label>Email <span>Optional</span><input name="email" autoComplete="email" placeholder="you@example.com" type="email" /></label><label className="consent-check"><input name="smsOptIn" type="checkbox" /><span><strong>Send me SMS updates</strong><small>Receive confirmation, reminders, and appointment changes.</small></span></label><button className="primary booking-confirm" disabled={submitting || !booking.startAt}>{submitting ? "Confirming..." : "Confirm appointment"}</button></form></div>}
        </section>

      </div>
    </main>
  );
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyInTimeZone(date: Date, timezone?: string) {
  if (!timezone) return localDateKey(date);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function bookingDateTimeFormatter(timezone?: string, includeDate = true) {
  return new Intl.DateTimeFormat(undefined, {
    ...(includeDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {})
  });
}

function formatBookingDateTime(value: string, timezone?: string) {
  return bookingDateTimeFormatter(timezone).format(new Date(value));
}

function calendarDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

type CalendarEventAppointment = {
  id: string;
  startAt: string;
  endAt?: string;
  service: { name: string };
  staff: { name: string };
  branch: { name: string };
};

function calendarEnd(appointment: { startAt: string; endAt?: string }) {
  return appointment.endAt ?? new Date(new Date(appointment.startAt).getTime() + 30 * 60_000).toISOString();
}

function googleCalendarLink(appointment: CalendarEventAppointment, vendorName: string, address?: string) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${appointment.service.name} at ${vendorName}`,
    dates: `${calendarDate(appointment.startAt)}/${calendarDate(calendarEnd(appointment))}`,
    details: `Appointment with ${appointment.staff.name}.`,
    location: address ?? appointment.branch.name
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function downloadCalendarFile(appointment: CalendarEventAppointment, vendorName: string, address?: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AppointIt//Appointment//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appointment.id}@appointit`,
    `DTSTAMP:${calendarDate(new Date().toISOString())}`,
    `DTSTART:${calendarDate(appointment.startAt)}`,
    `DTEND:${calendarDate(calendarEnd(appointment))}`,
    `SUMMARY:${escapeIcs(`${appointment.service.name} at ${vendorName}`)}`,
    `DESCRIPTION:${escapeIcs(`Appointment with ${appointment.staff.name}.`)}`,
    `LOCATION:${escapeIcs(address ?? appointment.branch.name)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  const url = URL.createObjectURL(new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "appointment.ics";
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatBookingTime(value: string, timezone?: string) {
  return bookingDateTimeFormatter(timezone, false).format(new Date(value));
}

function slotPeriod(value: string, timezone?: string): "Morning" | "Afternoon" | "Evening" {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value)));
  return hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
}

function demoSlotsForDate(date: string, staff: PublicVendor["staff"], staffId: string) {
  const provider = staffId || staff[0]?.id || "";
  return ["09:00", "10:15", "11:30", "14:00", "15:30"].map((time) => ({ startAt: new Date(`${date}T${time}:00`).toISOString(), staffId: provider }));
}
