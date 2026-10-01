import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { authService } from "./data/authService";
import type { User } from "./data/types";

type Route =
  | "welcome"
  | "home"
  | "login"
  | "signup"
  | "product"
  | "saved"
  | "messages"
  | "chat"
  | "profile"
  | "create";

type IconName =
  | "arrow"
  | "back"
  | "book"
  | "bookmark"
  | "camera"
  | "cart"
  | "chat"
  | "check"
  | "chevron"
  | "clock"
  | "food"
  | "heart"
  | "home"
  | "location"
  | "menu"
  | "plus"
  | "profile"
  | "search"
  | "send"
  | "shield"
  | "uniform";

const pathToRoute: Record<string, Route> = {
  "/": "home",
  "/welcome": "welcome",
  "/login": "login",
  "/signup": "signup",
  "/marketplace": "home",
  "/product": "product",
  "/saved": "saved",
  "/messages": "messages",
  "/chat": "chat",
  "/profile": "profile",
  "/create": "create",
};

const routeToPath: Record<Route, string> = Object.fromEntries(
  Object.entries(pathToRoute).map(([path, route]) => [route, path]),
) as Record<Route, string>;

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <><path d="M5 12h13M13 7l5 5-5 5" /></>,
    back: <><path d="m15 18-6-6 6-6" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    camera: <><path d="M4 7h3l2-3h6l2 3h3v13H4z" /><circle cx="12" cy="13" r="3.5" /></>,
    cart: <><path d="M3 5h2l2 10h10l2-7H7" /><circle cx="9" cy="19" r="1" /><circle cx="17" cy="19" r="1" /></>,
    chat: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    food: <><path d="M7 3v8M4 3v5c0 2 1 3 3 3s3-1 3-3V3M7 11v10" /><path d="M16 3c3 3 3 8 0 11v7M16 3v11h3" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z" />,
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v11h14V10M9 21v-6h6v6" /></>,
    location: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z" /><circle cx="12" cy="10" r="2.5" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-5" /></>,
    uniform: <path d="m8 3-5 4 3 5 2-1v10h8V11l2 1 3-5-5-4a5 5 0 0 1-8 0z" />,
  };
  return <svg aria-hidden="true" className={`icon icon-${name}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button className="brand" onClick={onClick} type="button" aria-label="CampusCart home">
      <span className="brand-mark"><Icon name="cart" size={25} /><span className="cap">⌃</span></span>
      <strong>CampusCart</strong>
    </button>
  );
}

function Topbar({ go, back, title }: { go: (route: Route) => void; back?: Route; title?: string }) {
  if (back) {
    return <header className="sub-header"><button className="icon-button" onClick={() => go(back)} type="button" aria-label="Back"><Icon name="back" /></button><h1>{title}</h1><span className="header-spacer" /></header>;
  }
  return <header className="topbar"><Logo onClick={() => go("home")} /><button className="avatar-mini" type="button" onClick={() => go("profile")} aria-label="Open profile">B</button></header>;
}

const navItems: { route: Route; label: string; icon: IconName }[] = [
  { route: "home", label: "Home", icon: "home" },
  { route: "saved", label: "Saved", icon: "heart" },
  { route: "messages", label: "Messages", icon: "chat" },
  { route: "profile", label: "Profile", icon: "profile" },
];

function BottomNav({ current, go }: { current: Route; go: (route: Route) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map((item) => <button key={item.route} className={current === item.route ? "active" : ""} type="button" onClick={() => go(item.route)}><Icon name={item.icon} size={21} /><span>{item.label}</span></button>)}
    </nav>
  );
}

const listings = [
  { id: 1, title: "URS P.E UNIFORM", condition: "Good as new", price: "₱1M", seller: "Balmond R.", kind: "uniform" },
  { id: 2, title: "CALCULUS BOOK", condition: "Good as new", price: "₱250", seller: "Miya S.", kind: "book" },
  { id: 3, title: "DRAFTING SET", condition: "Lightly used", price: "₱180", seller: "Clint M.", kind: "tools" },
];

function ProductArt({ kind, large = false }: { kind: string; large?: boolean }) {
  return <div className={`product-art ${large ? "large" : ""} art-${kind}`}><span className="art-label">URS</span><Icon name={kind === "book" ? "book" : kind === "uniform" ? "uniform" : "plus"} size={large ? 92 : 54} /></div>;
}

function ListingCard({ listing, saved, toggleSaved, go }: { listing: typeof listings[number]; saved: boolean; toggleSaved: (id: number) => void; go: (route: Route) => void }) {
  return (
    <article className="listing-card">
      <button className="card-image" type="button" onClick={() => go("product")}><ProductArt kind={listing.kind} /></button>
      <button className={`save-button ${saved ? "is-saved" : ""}`} type="button" aria-label="Save item" onClick={() => toggleSaved(listing.id)}><Icon name="heart" size={19} /></button>
      <button className="listing-info" type="button" onClick={() => go("product")}>
        <small>{listing.condition}</small><h3>{listing.title}</h3><strong>{listing.price}</strong><p>From {listing.seller}</p>
      </button>
    </article>
  );
}

function HomeScreen({ go, saved, toggleSaved }: { go: (route: Route) => void; saved: number[]; toggleSaved: (id: number) => void }) {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const filteredListings = listings.filter((listing) => {
    const matchesCategory =
      category === "All" ||
      (category === "Books" && listing.kind === "book") ||
      (category === "Uniforms" && listing.kind === "uniform");

    const query = search.toLowerCase().trim();

    const matchesSearch =
      !query ||
      listing.title.toLowerCase().includes(query) ||
      listing.condition.toLowerCase().includes(query) ||
      listing.seller.toLowerCase().includes(query);

    return matchesCategory && matchesSearch;
  });

  return <div className="screen main-screen">
    <Topbar go={go} />
    <main className="home-content">
      <section className="intro">
        <p className="eyebrow location"><Icon name="location" size={12} /> URSB MARKETPLACE</p>
        <p className="under-label">THE STUDENT MARKETPLACE</p>
        <h1>Good finds,<br /><em>five minutes</em><br />from class.</h1>
        <p className="intro-copy">Uniforms, books and the little things that make campus feel more like home all from students nearby.</p>
        <button className="primary-button compact" type="button" onClick={() => document.getElementById("finds")?.scrollIntoView({ behavior: "smooth" })}>Start browsing <Icon name="arrow" size={14} /></button>
        <button className="seller-link" type="button" onClick={() => go("create")}>Have something to sell?</button>
      </section>

      <section className="finds" id="finds">
        <p className="section-kicker">FRESH LISTINGS THIS WEEK</p>
        <h2>Find your next <em>good<br />thing.</em></h2>

        <label className="search-box">
          <Icon name="search" size={17} />
          <input
            aria-label="Search marketplace"
            placeholder="Search textbooks, furniture, anything"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <div className="category-row">
          {["All", "Books", "Uniforms", "Food"].map((item) => <button className={category === item ? "selected" : ""} key={item} type="button" onClick={() => setCategory(item)}>{item}</button>)}
        </div>

        <div className="listing-grid">
          {filteredListings.map((listing) => <ListingCard key={listing.id} listing={listing} saved={saved.includes(listing.id)} toggleSaved={toggleSaved} go={go} />)}
        </div>
      </section>
    </main>

    <button className="fab" onClick={() => go("create")} type="button" aria-label="List an item"><Icon name="plus" size={25} /></button>
    <BottomNav current="home" go={go} />
  </div>;
}

function WelcomeScreen({ go }: { go: (route: Route) => void }) {
  return <div className="screen welcome-screen">
    <div className="welcome-top"><Logo onClick={() => go("home")} /><span className="trust-pill"><Icon name="shield" size={14} /> Campus only</span></div>
    <div className="welcome-graphic"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="welcome-cart"><Icon name="cart" size={72} /></div><span className="float-card card-a"><Icon name="book" size={25} /></span><span className="float-card card-b"><Icon name="uniform" size={25} /></span></div>
    <main className="welcome-copy"><p className="under-label">THE MARKETPLACE THAT STAYS ON CAMPUS</p><h1>Campus<span>Cart</span></h1><p>Buy and sell campus items easily, all in one simple, trusted app.</p><button className="primary-button wide" type="button" onClick={() => go("home")}>Get Started <Icon name="arrow" size={18} /></button><button className="outline-button" type="button" onClick={() => go("login")}>Login</button><p className="account-prompt">Don&apos;t Have An Account? <button type="button" onClick={() => go("signup")}>Sign up</button></p></main>
  </div>;
}

function AuthScreen({ mode, go, onAuthenticated }: { mode: "login" | "signup"; go: (route: Route) => void; onAuthenticated: (user: User) => void }) {
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const username = String(fields.get("username") ?? "");
      const password = String(fields.get("password") ?? "");
      const user = mode === "login"
        ? authService.login(username, password)
        : authService.signUp({
            fullName: String(fields.get("fullName") ?? ""),
            username,
            email: String(fields.get("email") ?? ""),
            password,
          });
      onAuthenticated(user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save your account. Please try again.");
    }
  };
  const login = mode === "login";
  return <div className="screen auth-screen"><Topbar go={go} back="welcome" title={login ? "Login" : "Create account"} /><main className="auth-content"><div className="auth-mark"><Icon name={login ? "profile" : "cart"} size={29} /></div><p className="under-label">{login ? "WELCOME BACK TO CAMPUSCART" : "JOIN YOUR CAMPUS MARKETPLACE"}</p><h2>{login ? "Good to see you again." : "Start finding good things."}</h2><p className="auth-intro">{login ? "Login to continue buying and selling with students nearby." : "Create your account and keep your campus finds close."}</p><form onSubmit={submit}>
    {!login && <label>Full Name<input required name="fullName" placeholder="Enter your full name" /></label>}
    <label>Username<input required name="username" placeholder="Enter your username" /></label>
    {!login && <label>Campus Email<input required name="email" type="email" placeholder="name@urs.edu.ph" /></label>}
    <label>Password<input required name="password" type="password" placeholder="Enter your password" /></label>
    {login && <div className="form-options"><label className="check-label"><input type="checkbox" /> <span>Remember Me</span></label><button type="button" onClick={() => setError("Password recovery is not available for local accounts.")}>Forgot Password?</button></div>}
    {error && <p role="alert" style={{ margin: 0, color: "#b13a3a", fontSize: 11 }}>{error}</p>}
    <button className="primary-button wide" type="submit">{login ? "Login" : "Sign up"} <Icon name="arrow" size={17} /></button>
  </form>{login && <div className="continue"><span>Continue With</span><button type="button" onClick={() => setError("Google login is not available for local accounts.")}>G&nbsp;&nbsp; Google</button></div>}<p className="account-prompt">{login ? "Don't Have An Account? " : "Already have an account? "}<button type="button" onClick={() => go(login ? "signup" : "login")}>{login ? "Sign up" : "Login"}</button></p></main></div>;
}

function ProductScreen({ go, saved, toggleSaved }: { go: (route: Route) => void; saved: number[]; toggleSaved: (id: number) => void }) {
  const item = listings[0];
  return <div className="screen detail-screen"><Topbar go={go} back="home" title="Item details" /><main><div className="detail-art"><ProductArt kind="uniform" large /><button className={`save-button detail-save ${saved.includes(1) ? "is-saved" : ""}`} type="button" onClick={() => toggleSaved(1)}><Icon name="heart" /></button><span className="photo-count">1 / 3</span></div><div className="detail-info"><div className="condition-row"><span>Good as new</span><small>Posted today</small></div><h2>{item.title}</h2><strong className="detail-price">{item.price}</strong><div className="seller-box"><span className="seller-avatar">BR</span><div><small>SELLER</small><strong>Balmond R.</strong><p><Icon name="location" size={12} /> URS Binangonan Campus</p></div><Icon name="chevron" /></div><h3>About this item</h3><p className="description">Complete URS P.E uniform in excellent condition. Clean, comfortable, and ready to use. Meet-up inside campus preferred.</p><div className="safety-note"><Icon name="shield" /><p><strong>Buy safely on campus</strong><br />Meet in a public campus area and inspect the item before paying.</p></div></div></main><div className="detail-actions"><button className="outline-button" type="button" onClick={() => toggleSaved(1)}><Icon name="heart" size={18} /> Save</button><button className="primary-button" type="button" onClick={() => go("chat")}><Icon name="chat" size={18} /> Message seller</button></div></div>;
}

function SavedScreen({ go, saved, toggleSaved }: { go: (route: Route) => void; saved: number[]; toggleSaved: (id: number) => void }) {
  const items = listings.filter((item) => saved.includes(item.id));
  return <div className="screen nav-screen"><Topbar go={go} /><main className="page-content"><p className="section-kicker">YOUR SHORTLIST</p><h1>Saved <em>finds.</em></h1>{items.length ? <div className="listing-grid saved-grid">{items.map((listing) => <ListingCard key={listing.id} listing={listing} saved toggleSaved={toggleSaved} go={go} />)}</div> : <div className="empty-state"><span><Icon name="heart" size={33} /></span><h2>No saved finds yet</h2><p>Tap the heart on anything you want to come back to.</p><button className="primary-button" type="button" onClick={() => go("home")}>Browse listings</button></div>}</main><BottomNav current="saved" go={go} /></div>;
}

function MessagesScreen({ go }: { go: (route: Route) => void }) {
  return <div className="screen nav-screen"><Topbar go={go} /><main className="page-content"><p className="section-kicker">CAMPUS CONVERSATIONS</p><h1>Your <em>messages.</em></h1><label className="search-box message-search"><Icon name="search" size={17} /><input placeholder="Search messages" /></label><button className="conversation" type="button" onClick={() => go("chat")}><span className="seller-avatar">BR</span><span className="conversation-copy"><strong>Balmond R.</strong><small>URS P.E UNIFORM</small><p>Yes, it&apos;s still available!</p></span><span className="conversation-meta"><small>10:42</small><b>1</b></span></button><button className="conversation" type="button"><span className="seller-avatar gold">MS</span><span className="conversation-copy"><strong>Miya S.</strong><small>CALCULUS BOOK</small><p>Thank you!</p></span><span className="conversation-meta"><small>Yesterday</small></span></button></main><BottomNav current="messages" go={go} /></div>;
}

function ChatScreen({ go }: { go: (route: Route) => void }) {
  const [messages, setMessages] = useState([
    { id: 1, text: "Hi! Is the P.E uniform still available?", mine: true },
    { id: 2, text: "Yes, it’s still available!", mine: false },
  ]);
  const [draft, setDraft] = useState("");
  const send = (event: FormEvent) => { event.preventDefault(); if (draft.trim()) { setMessages([...messages, { id: Date.now(), text: draft.trim(), mine: true }]); setDraft(""); } };
  return <div className="screen chat-screen"><header className="chat-header"><button className="icon-button" onClick={() => go("messages")} type="button"><Icon name="back" /></button><span className="seller-avatar">BR</span><div><strong>Balmond R.</strong><small>Active now</small></div></header><div className="chat-item"><ProductArt kind="uniform" /><div><small>ABOUT THIS ITEM</small><strong>URS P.E UNIFORM</strong><span>₱1M</span></div></div><main className="bubbles"><span className="day-label">TODAY</span>{messages.map((message, index) => <div key={message.id} className={`bubble ${message.mine ? "mine" : "theirs"}`}>{message.text}<small>{index === messages.length - 1 ? "10:42" : "10:40"}</small></div>)}</main><form className="message-form" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message..." aria-label="Message" /><button type="submit" aria-label="Send"><Icon name="send" size={18} /></button></form></div>;
}

function ProfileScreen({ go, user, onLogout }: { go: (route: Route) => void; user: User; onLogout: () => void }) {
  const rows: { label: string; icon: IconName; route?: Route }[] = [{ label: "My listings", icon: "uniform" }, { label: "Saved items", icon: "heart", route: "saved" }, { label: "Campus & account", icon: "location" }, { label: "Help and safety", icon: "shield" }];
  const initials = user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  return <div className="screen nav-screen"><Topbar go={go} /><main className="page-content profile-content"><p className="section-kicker">YOUR CAMPUSCART</p><h1>Profile.</h1><div className="profile-card"><span className="profile-avatar">{initials}</span><div><h2>{user.fullName}</h2><p><Icon name="location" size={12} /> {user.campus}</p><span><Icon name="check" size={11} /> Campus account</span></div></div><button className="primary-button list-button" onClick={() => go("create")} type="button"><Icon name="plus" /> List an item</button><div className="profile-menu">{rows.map((row) => <button key={row.label} onClick={() => row.route && go(row.route)} type="button"><span><Icon name={row.icon} size={19} /></span>{row.label}<Icon name="chevron" size={17} /></button>)}</div><button className="logout" type="button" onClick={onLogout}>Log out</button></main><BottomNav current="profile" go={go} /></div>;
}

function CreateScreen({ go }: { go: (route: Route) => void }) {
  const [done, setDone] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); setDone(true); };
  if (done) return <div className="screen success-screen"><span><Icon name="check" size={36} /></span><p className="under-label">LISTING PUBLISHED</p><h1>Your good find is now live.</h1><p>Students nearby can now discover and message you about your item.</p><button className="primary-button wide" type="button" onClick={() => go("home")}>Back to marketplace</button></div>;
  return <div className="screen create-screen"><Topbar go={go} back="home" title="List an item" /><main className="create-content"><p className="section-kicker">SELL ON CAMPUS</p><h1>Pass on a <em>good thing.</em></h1><form onSubmit={submit}><button className="photo-upload" type="button"><Icon name="camera" size={28} /><strong>Add photos</strong><small>Add up to 5 clear photos</small></button><label>Item title<input required placeholder="What are you selling?" /></label><div className="two-fields"><label>Price<input required placeholder="₱ 0.00" /></label><label>Condition<select defaultValue="Good as new"><option>Good as new</option><option>Brand new</option><option>Lightly used</option></select></label></div><label>Category<select defaultValue="Uniforms"><option>Books</option><option>Uniforms</option><option>Food</option><option>Other</option></select></label><label>Description<textarea required placeholder="Share useful details about your item" /></label><button className="primary-button wide" type="submit">Publish listing <Icon name="arrow" size={17} /></button></form></main></div>;
}

function App() {
  const [user, setUser] = useState<User | null>(() => authService.getCurrentUser());
  const [route, setRoute] = useState<Route>(() => {
    const requested = pathToRoute[window.location.pathname] ?? "home";
    return requested === "profile" && !authService.getCurrentUser() ? "login" : requested;
  });
  const [saved, setSaved] = useState<number[]>([2]);
  useEffect(() => {
    const onPop = () => {
      const requested = pathToRoute[window.location.pathname] ?? "home";
      setRoute(requested === "profile" && !authService.getCurrentUser() ? "login" : requested);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (next: Route) => {
    const destination = next === "profile" && !user ? "login" : next;
    window.history.pushState({}, "", routeToPath[destination]);
    setRoute(destination);
    window.scrollTo(0, 0);
  };
  const onAuthenticated = (account: User) => { setUser(account); go("home"); };
  const onLogout = () => {
    authService.logout();
    setUser(null);
    window.history.replaceState({}, "", routeToPath.welcome);
    setRoute("welcome");
    window.scrollTo(0, 0);
  };
  const toggleSaved = (id: number) => setSaved((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const screens: Record<Route, ReactNode> = {
    welcome: <WelcomeScreen go={go} />, home: <HomeScreen go={go} saved={saved} toggleSaved={toggleSaved} />, login: <AuthScreen key="login" mode="login" go={go} onAuthenticated={onAuthenticated} />, signup: <AuthScreen key="signup" mode="signup" go={go} onAuthenticated={onAuthenticated} />, product: <ProductScreen go={go} saved={saved} toggleSaved={toggleSaved} />, saved: <SavedScreen go={go} saved={saved} toggleSaved={toggleSaved} />, messages: <MessagesScreen go={go} />, chat: <ChatScreen go={go} />, profile: user ? <ProfileScreen go={go} user={user} onLogout={onLogout} /> : <AuthScreen mode="login" go={go} onAuthenticated={onAuthenticated} />, create: <CreateScreen go={go} />,
  };
  return <div className="app-shell">{screens[route]}</div>;
}

export default App;
