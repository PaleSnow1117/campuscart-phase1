import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { authService } from "./data/authService";
import { imageService, MAX_IMAGES } from "./data/imageService";
import { artKind, formatPostedAt, formatPrice, listingService, parsePrice, savedService } from "./data/listingService";
import { formatConversationTime, formatDayLabel, formatMessageTime, initialsOf, messageService, otherPartyName } from "./data/messageService";
import { CAMPUSES, LISTING_CATEGORIES, LISTING_CONDITIONS, type Listing, type ListingCategory, type ListingCondition, type Message, type ProfileChanges, type User } from "./data/types";

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
  | "create"
  | "mylistings"
  | "edit"
  | "campus"
  | "account"
  | "help";

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
  "/my-listings": "mylistings",
  "/edit": "edit",
  "/campus": "campus",
  "/account": "account",
  "/help": "help",
};

const routeToPath: Record<Route, string> = Object.fromEntries(
  Object.entries(pathToRoute).map(([path, route]) => [route, path]),
) as Record<Route, string>;

type GoFn = (route: Route, listingId?: string) => void;

// Screens that need a signed-in user (profile as in Phase 1; create needs a seller ID; messages belong to an account).
const protectedRoutes: Route[] = ["profile", "create", "messages", "chat", "mylistings", "edit", "campus", "account", "help"];
const guard = (route: Route, user: User | null): Route => (protectedRoutes.includes(route) && !user ? "login" : route);

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

function Topbar({ go, back, title }: { go: GoFn; back?: Route; title?: string }) {
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

function ProductArt({ kind, large = false, image }: { kind: string; large?: boolean; image?: string }) {
  if (image) return <div className={`product-art ${large ? "large" : ""} art-${kind}`}><img src={image} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0, pointerEvents: "none" }} /></div>;
  return <div className={`product-art ${large ? "large" : ""} art-${kind}`}><span className="art-label">URS</span><Icon name={kind === "book" ? "book" : kind === "uniform" ? "uniform" : "plus"} size={large ? 92 : 54} /></div>;
}

function ListingCard({ listing, saved, toggleSaved, go }: { listing: Listing; saved: boolean; toggleSaved: (id: string) => void; go: GoFn }) {
  return (
    <article className="listing-card">
      <button className="card-image" type="button" onClick={() => go("product", listing.id)}><ProductArt kind={artKind(listing.category)} image={listing.images[0]} /></button>
      <button className={`save-button ${saved ? "is-saved" : ""}`} type="button" aria-label="Save item" onClick={() => toggleSaved(listing.id)}><Icon name="heart" size={19} /></button>
      <button className="listing-info" type="button" onClick={() => go("product", listing.id)}>
        <small>{listing.condition}</small><h3>{listing.title}</h3><strong>{formatPrice(listing.price)}</strong><p>From {listing.sellerName}</p>
      </button>
    </article>
  );
}

function HomeScreen({ go, listings, saved, toggleSaved }: { go: GoFn; listings: Listing[]; saved: string[]; toggleSaved: (id: string) => void }) {
  const [category, setCategory] = useState<ListingCategory | "All">("All");
  const [search, setSearch] = useState("");
  const filteredListings = listingService.filter(listings, { category, query: search });

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
          {(["All", "Books", "Uniforms", "Food"] as const).map((item) => <button className={category === item ? "selected" : ""} key={item} type="button" onClick={() => setCategory(item)}>{item}</button>)}
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

function ProductScreen({ go, item, saved, toggleSaved, onMessageSeller }: { go: GoFn; item?: Listing; saved: string[]; toggleSaved: (id: string) => void; onMessageSeller: (listing: Listing) => string | null }) {
  const [photo, setPhoto] = useState(0);
  const [notice, setNotice] = useState("");
  if (!item) return <div className="screen detail-screen"><Topbar go={go} back="home" title="Item details" /><main className="page-content"><div className="empty-state"><span><Icon name="search" size={33} /></span><h2>Listing not found</h2><p>This item may have been removed.</p><button className="primary-button" type="button" onClick={() => go("home")}>Browse listings</button></div></main></div>;
  const isSaved = saved.includes(item.id);
  const photos = item.images.length;
  const initials = item.sellerName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return <div className="screen detail-screen"><Topbar go={go} back="home" title="Item details" /><main><div className="detail-art" onClick={() => photos > 1 && setPhoto((photo + 1) % photos)}><ProductArt kind={artKind(item.category)} image={item.images[photo % Math.max(photos, 1)]} large /><button className={`save-button detail-save ${isSaved ? "is-saved" : ""}`} type="button" onClick={(event) => { event.stopPropagation(); toggleSaved(item.id); }}><Icon name="heart" /></button><span className="photo-count">{(photo % Math.max(photos, 1)) + 1} / {Math.max(photos, 1)}</span></div><div className="detail-info"><div className="condition-row"><span>{item.condition}</span><small>{formatPostedAt(item.createdAt)}</small></div><h2>{item.title}</h2><strong className="detail-price">{formatPrice(item.price)}</strong><div className="seller-box"><span className="seller-avatar">{initials}</span><div><small>SELLER</small><strong>{item.sellerName}</strong><p><Icon name="location" size={12} /> {item.campus} Campus</p></div><Icon name="chevron" /></div><h3>About this item</h3><p className="description">{item.description}</p>{notice && <p role="alert" style={{ margin: "0 0 10px", color: "#b13a3a", fontSize: 11 }}>{notice}</p>}<div className="safety-note"><Icon name="shield" /><p><strong>Buy safely on campus</strong><br />Meet in a public campus area and inspect the item before paying.</p></div></div></main><div className="detail-actions"><button className="outline-button" type="button" onClick={() => toggleSaved(item.id)}><Icon name="heart" size={18} /> Save</button><button className="primary-button" type="button" onClick={() => setNotice(onMessageSeller(item) ?? "")}><Icon name="chat" size={18} /> Message seller</button></div></div>;
}

function SavedScreen({ go, listings, saved, toggleSaved }: { go: GoFn; listings: Listing[]; saved: string[]; toggleSaved: (id: string) => void }) {
  const items = listings.filter((item) => saved.includes(item.id));
  return <div className="screen nav-screen"><Topbar go={go} /><main className="page-content"><p className="section-kicker">YOUR SHORTLIST</p><h1>Saved <em>finds.</em></h1>{items.length ? <div className="listing-grid saved-grid">{items.map((listing) => <ListingCard key={listing.id} listing={listing} saved toggleSaved={toggleSaved} go={go} />)}</div> : <div className="empty-state"><span><Icon name="heart" size={33} /></span><h2>No saved finds yet</h2><p>Tap the heart on anything you want to come back to.</p><button className="primary-button" type="button" onClick={() => go("home")}>Browse listings</button></div>}</main><BottomNav current="saved" go={go} /></div>;
}

function MessagesScreen({ go, user }: { go: GoFn; user: User }) {
  const [conversations] = useState(() => messageService.getConversations(user.id));
  const [search, setSearch] = useState("");
  const text = search.toLowerCase().trim();
  const visible = conversations.filter((conversation) => !text || [otherPartyName(conversation, user.id), conversation.listingTitle, conversation.lastMessage].some((field) => field.toLowerCase().includes(text)));
  return <div className="screen nav-screen"><Topbar go={go} /><main className="page-content"><p className="section-kicker">CAMPUS CONVERSATIONS</p><h1>Your <em>messages.</em></h1><label className="search-box message-search"><Icon name="search" size={17} /><input aria-label="Search messages" placeholder="Search messages" value={search} onChange={(event) => setSearch(event.target.value)} /></label>{conversations.length === 0 ? <div className="empty-state"><span><Icon name="chat" size={33} /></span><h2>No messages yet</h2><p>Open a listing and tap Message seller to start a conversation.</p><button className="primary-button" type="button" onClick={() => go("home")}>Browse listings</button></div> : visible.length === 0 ? <div className="empty-state"><h2>No matches</h2><p>Try a different name, item or word.</p></div> : visible.map((conversation, index) => { const name = otherPartyName(conversation, user.id); return <button key={conversation.id} className="conversation" type="button" onClick={() => go("chat", conversation.id)}><span className={`seller-avatar ${index % 2 ? "gold" : ""}`}>{initialsOf(name)}</span><span className="conversation-copy"><strong>{name}</strong><small>{conversation.listingTitle}</small><p>{conversation.lastMessage || "No messages yet. Say hi!"}</p></span><span className="conversation-meta"><small>{formatConversationTime(conversation.updatedAt)}</small></span></button>; })}</main><BottomNav current="messages" go={go} /></div>;
}

function ChatScreen({ go, user, conversationId, listings }: { go: GoFn; user: User; conversationId: string | null; listings: Listing[] }) {
  const conversation = messageService.getConversation(conversationId, user.id);
  const [messages, setMessages] = useState<Message[]>(() => (conversationId ? messageService.getMessages(conversationId, user.id) : []));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages]);
  if (!conversation) return <div className="screen nav-screen"><Topbar go={go} back="messages" title="Conversation" /><main className="page-content"><div className="empty-state"><span><Icon name="chat" size={33} /></span><h2>Conversation not found</h2><p>It may not exist, or it belongs to another account.</p><button className="primary-button" type="button" onClick={() => go("messages")}>Back to messages</button></div></main></div>;
  const name = otherPartyName(conversation, user.id);
  const listing = listings.find((item) => item.id === conversation.listingId);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    try {
      const sent = messageService.send(conversation.id, user, draft);
      setMessages((current) => [...current, sent]);
      setDraft("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send your message.");
    }
  };
  return <div className="screen chat-screen"><header className="chat-header"><button className="icon-button" onClick={() => go("messages")} type="button" aria-label="Back to messages"><Icon name="back" /></button><span className="seller-avatar">{initialsOf(name)}</span><div><strong>{name}</strong><small>Active now</small></div></header><div className="chat-item"><ProductArt kind={listing ? artKind(listing.category) : "tools"} image={listing?.images[0]} /><div><small>ABOUT THIS ITEM</small><strong>{listing?.title ?? conversation.listingTitle}</strong><span>{formatPrice(listing?.price ?? conversation.listingPrice)}</span></div></div><main className="bubbles">{messages.length === 0 && <span className="day-label">No messages yet. Say hi!</span>}{messages.map((message, index) => <div key={message.id} style={{ display: "contents" }}>{(index === 0 || formatDayLabel(message.createdAt) !== formatDayLabel(messages[index - 1].createdAt)) && <span className="day-label">{formatDayLabel(message.createdAt)}</span>}<div className={`bubble ${message.senderId === user.id ? "mine" : "theirs"}`}>{message.text}<small>{formatMessageTime(message.createdAt)}</small></div></div>)}{error && <p role="alert" style={{ margin: 0, color: "#b13a3a", fontSize: 11, alignSelf: "center" }}>{error}</p>}<div ref={bottom} /></main><form className="message-form" onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message..." aria-label="Message" maxLength={1000} /><button type="submit" aria-label="Send"><Icon name="send" size={18} /></button></form></div>;
}

function ProfileScreen({ go, user, onLogout }: { go: (route: Route) => void; user: User; onLogout: () => void }) {
  const rows: { label: string; icon: IconName; route: Route }[] = [{ label: "My listings", icon: "uniform", route: "mylistings" }, { label: "Saved items", icon: "heart", route: "saved" }, { label: "Campus", icon: "location", route: "campus" }, { label: "Account", icon: "profile", route: "account" }, { label: "Help and safety", icon: "shield", route: "help" }];
  const initials = initialsOf(user.fullName || user.username);
  return <div className="screen nav-screen"><Topbar go={go} /><main className="page-content profile-content"><p className="section-kicker">YOUR CAMPUSCART</p><h1>Profile.</h1><div className="profile-card"><span className="profile-avatar">{initials}</span><div><h2>{user.fullName || user.username}</h2><p><Icon name="location" size={12} /> {user.campus || "No campus selected"}</p><span><Icon name="check" size={11} /> Campus account</span></div></div><button className="primary-button list-button" onClick={() => go("create")} type="button"><Icon name="plus" /> List an item</button><div className="profile-menu">{rows.map((row) => <button key={row.label} onClick={() => go(row.route)} type="button"><span><Icon name={row.icon} size={19} /></span>{row.label}<Icon name="chevron" size={17} /></button>)}</div><button className="logout" type="button" onClick={onLogout}>Log out</button></main><BottomNav current="profile" go={go} /></div>;
}

function MyListingsScreen({ go, user, listings, saved, toggleSaved, onDelete }: { go: GoFn; user: User; listings: Listing[]; saved: string[]; toggleSaved: (id: string) => void; onDelete: (id: string) => void }) {
  const [error, setError] = useState("");
  const mine = listingService.forSeller(listings, user.id);
  const remove = (listing: Listing) => {
    if (!window.confirm(`Delete "${listing.title}"? This can't be undone.`)) return;
    try { setError(""); onDelete(listing.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete this listing."); }
  };
  return <div className="screen nav-screen"><Topbar go={go} back="profile" title="My listings" /><main className="page-content"><p className="section-kicker">YOUR SHELF</p><h1>My <em>listings.</em></h1>{error && <p role="alert" style={{ margin: "0 0 10px", color: "#b13a3a", fontSize: 11 }}>{error}</p>}{mine.length ? <div className="listing-grid saved-grid">{mine.map((listing) => <div key={listing.id}><ListingCard listing={listing} saved={saved.includes(listing.id)} toggleSaved={toggleSaved} go={go} /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}><button className="outline-button" type="button" style={{ minHeight: 34, fontSize: 11 }} onClick={() => go("edit", listing.id)}>Edit</button><button className="outline-button" type="button" style={{ minHeight: 34, fontSize: 11, color: "#b13a3a" }} onClick={() => remove(listing)}>Delete</button></div></div>)}</div> : <div className="empty-state"><span><Icon name="uniform" size={33} /></span><h2>No listings yet</h2><p>Items you list for sale will show up here.</p><button className="primary-button" type="button" onClick={() => go("create")}>List an item</button></div>}</main><BottomNav current="profile" go={go} /></div>;
}

function CampusScreen({ go, user, onSave }: { go: GoFn; user: User; onSave: (changes: ProfileChanges) => void }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const options: string[] = [...CAMPUSES];
  if (user.campus && !options.includes(user.campus)) options.unshift(user.campus);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onSave({ campus: String(new FormData(event.currentTarget).get("campus") ?? "") });
      setMessage({ text: "Campus updated.", error: false });
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Unable to update your campus.", error: true });
    }
  };
  return <div className="screen nav-screen"><Topbar go={go} back="profile" title="Campus" /><main className="create-content"><p className="section-kicker">YOUR CAMPUS</p><h1>Where do you <em>sell?</em></h1><form onSubmit={submit}><label>Campus<select name="campus" defaultValue={user.campus || options[0]}>{options.map((campus) => <option key={campus}>{campus}</option>)}</select></label><p className="description">New listings you post will show this campus. Listings you already posted keep the campus they were posted with.</p>{message && <p role={message.error ? "alert" : "status"} style={{ margin: 0, color: message.error ? "#b13a3a" : "var(--blue)", fontSize: 11 }}>{message.text}</p>}<button className="primary-button wide" type="submit">Save campus <Icon name="arrow" size={17} /></button></form></main><BottomNav current="profile" go={go} /></div>;
}

function AccountScreen({ go, user, onSave }: { go: GoFn; user: User; onSave: (changes: ProfileChanges) => void }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      onSave({ fullName: String(fields.get("fullName") ?? ""), username: String(fields.get("username") ?? ""), email: String(fields.get("email") ?? "") });
      setMessage({ text: "Account updated.", error: false });
    } catch (cause) {
      setMessage({ text: cause instanceof Error ? cause.message : "Unable to update your account.", error: true });
    }
  };
  const joined = new Date(user.createdAt);
  return <div className="screen nav-screen"><Topbar go={go} back="profile" title="Account" /><main className="create-content"><p className="section-kicker">YOUR ACCOUNT</p><h1>Account <em>details.</em></h1><form key={`${user.fullName}|${user.username}|${user.email}`} onSubmit={submit}><label>Full Name<input required name="fullName" defaultValue={user.fullName} placeholder="Enter your full name" /></label><label>Username<input required name="username" defaultValue={user.username} placeholder="Enter your username" /></label><label>Campus Email<input required name="email" type="email" defaultValue={user.email} placeholder="name@urs.edu.ph" /></label><p className="description">{Number.isNaN(joined.getTime()) ? "Member of CampusCart" : `Member since ${joined.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}`} · {user.campus || "No campus selected"}</p>{message && <p role={message.error ? "alert" : "status"} style={{ margin: 0, color: message.error ? "#b13a3a" : "var(--blue)", fontSize: 11 }}>{message.text}</p>}<button className="primary-button wide" type="submit">Save changes <Icon name="arrow" size={17} /></button></form><button className="outline-button wide" type="button" disabled style={{ width: "100%", marginTop: 22, opacity: 0.55 }}>Change password</button><p className="description" style={{ marginTop: 8 }}>Password changes will be available once online accounts are added. Your password is never shown here.</p></main><BottomNav current="profile" go={go} /></div>;
}

function HelpScreen({ go }: { go: GoFn }) {
  const sections: { title: string; items: string[] }[] = [
    { title: "How buying works", items: ["Browse the marketplace or search for what you need.", "Open a listing to see photos, condition, price and the seller.", "Tap Message seller to ask questions and agree on a meet-up.", "Inspect the item before you pay."] },
    { title: "How selling works", items: ["Tap List an item and add clear photos, a title, price, condition and description.", "Find your items any time under Profile > My listings, where you can edit or delete them.", "Reply to interested students from Messages.", "Delete the listing once the item is sold."] },
    { title: "Marketplace safety tips", items: ["Keep conversations inside CampusCart.", "Never share your password or personal ID numbers.", "Be careful with prices that look too good to be true.", "Pay only after you have seen the item."] },
    { title: "Meeting up on campus", items: ["Meet in a public, busy campus area during the day.", "Bring a friend if you can, and tell someone where you are going.", "Do not go to private places or leave campus for a meet-up.", "Leave if anything feels wrong."] },
    { title: "If something seems suspicious", items: ["Stop replying and do not send money or personal details.", "Note the listing title and the seller's name.", "Do not meet up with someone who pressures you or keeps changing the plan."] },
  ];
  return <div className="screen nav-screen"><Topbar go={go} back="profile" title="Help and safety" /><main className="page-content"><p className="section-kicker">WE'VE GOT YOU</p><h1>Help &amp; <em>safety.</em></h1><div className="detail-info" style={{ padding: 0 }}>{sections.map((section) => <div key={section.title}><h3>{section.title}</h3><ul className="description" style={{ margin: 0, paddingLeft: 18 }}>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></div>)}<h3>Reporting a problem</h3><p className="description">CampusCart can&apos;t take reports inside the app yet, so nothing you do here is sent to anyone. If a listing or user seems unsafe, tell your campus security or student affairs office and share the listing title and seller name. In an emergency, call 911.</p><div className="safety-note"><Icon name="shield" /><p><strong>Your data stays on this device</strong><br />This prototype saves accounts, listings and messages in your browser only.</p></div></div></main><BottomNav current="profile" go={go} /></div>;
}

function MissingListingScreen({ go }: { go: GoFn }) {
  return <div className="screen nav-screen"><Topbar go={go} back="mylistings" title="Edit listing" /><main className="page-content"><div className="empty-state"><span><Icon name="search" size={33} /></span><h2>Listing not found</h2><p>It may have been deleted, or it isn&apos;t yours to edit.</p><button className="primary-button" type="button" onClick={() => go("mylistings")}>Back to my listings</button></div></main></div>;
}

function CreateScreen({ go, onPublish, listing }: { go: GoFn; listing?: Listing; onPublish: (input: { title: string; price: number; condition: ListingCondition; category: ListingCategory; description: string; images: string[] }) => void }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<string[]>(listing?.images ?? []);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickPhotos = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    setError("");
    try {
      const added = await imageService.processFiles(files, MAX_IMAGES - images.length);
      setImages((current) => [...current, ...added].slice(0, MAX_IMAGES));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add those photos.");
    }
    event.target.value = "";
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const fields = new FormData(event.currentTarget);
    const price = parsePrice(String(fields.get("price") ?? ""));
    if (price === null) { setError("Please enter a valid price, e.g. 250."); return; }
    try {
      onPublish({
        title: String(fields.get("title") ?? ""),
        price,
        condition: String(fields.get("condition")) as ListingCondition,
        category: String(fields.get("category")) as ListingCategory,
        description: String(fields.get("description") ?? ""),
        images,
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to publish your listing. Please try again.");
    }
  };
  if (done && listing) return <div className="screen success-screen"><span><Icon name="check" size={36} /></span><p className="under-label">LISTING UPDATED</p><h1>Your changes are saved.</h1><p>Your listing is up to date for students nearby.</p><button className="primary-button wide" type="button" onClick={() => go("mylistings")}>Back to my listings</button></div>;
  if (done) return <div className="screen success-screen"><span><Icon name="check" size={36} /></span><p className="under-label">LISTING PUBLISHED</p><h1>Your good find is now live.</h1><p>Students nearby can now discover and message you about your item.</p><button className="primary-button wide" type="button" onClick={() => go("home")}>Back to marketplace</button></div>;
  return <div className="screen create-screen"><Topbar go={go} back={listing ? "mylistings" : "home"} title={listing ? "Edit listing" : "List an item"} /><main className="create-content"><p className="section-kicker">{listing ? "EDIT YOUR LISTING" : "SELL ON CAMPUS"}</p><h1>{listing ? <>Update your <em>listing.</em></> : <>Pass on a <em>good thing.</em></>}</h1><form onSubmit={submit}><input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={pickPhotos} /><button className="photo-upload" type="button" onClick={() => fileInput.current?.click()}><Icon name="camera" size={28} /><strong>Add photos</strong><small>{images.length ? `${images.length} of ${MAX_IMAGES} photo${images.length > 1 ? "s" : ""} added` : `Add up to ${MAX_IMAGES} clear photos`}</small></button>{images.length > 0 && <button className="seller-link" type="button" style={{ marginTop: 0, alignSelf: "flex-start" }} onClick={() => setImages([])}>Remove all photos</button>}<label>Item title<input required name="title" defaultValue={listing?.title} placeholder="What are you selling?" /></label><div className="two-fields"><label>Price<input required name="price" inputMode="decimal" defaultValue={listing ? String(listing.price) : undefined} placeholder="₱ 0.00" /></label><label>Condition<select name="condition" defaultValue={listing?.condition ?? "Good as new"}>{LISTING_CONDITIONS.map((item) => <option key={item}>{item}</option>)}</select></label></div><label>Category<select name="category" defaultValue={listing?.category ?? "Uniforms"}>{LISTING_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label><label>Description<textarea required name="description" defaultValue={listing?.description} placeholder="Share useful details about your item" /></label>{error && <p role="alert" style={{ margin: 0, color: "#b13a3a", fontSize: 11 }}>{error}</p>}<button className="primary-button wide" type="submit">{listing ? "Save changes" : "Publish listing"} <Icon name="arrow" size={17} /></button></form></main></div>;
}

function App() {
  const [user, setUser] = useState<User | null>(() => authService.getCurrentUser());
  const [listings, setListings] = useState<Listing[]>(() => listingService.getAll());
  const [saved, setSaved] = useState<string[]>(() => savedService.getIds(authService.getCurrentUser()?.id));
  const [listingId, setListingId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("id"));
  const [conversationId, setConversationId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("c"));
  const [route, setRoute] = useState<Route>(() => guard(pathToRoute[window.location.pathname] ?? "home", authService.getCurrentUser()));
  useEffect(() => {
    const onPop = () => {
      setRoute(guard(pathToRoute[window.location.pathname] ?? "home", authService.getCurrentUser()));
      setListingId(new URLSearchParams(window.location.search).get("id"));
      setConversationId(new URLSearchParams(window.location.search).get("c"));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go: GoFn = (next, id) => {
    const destination = guard(next, user);
    const query = (destination === "product" || destination === "edit") && id ? `?id=${encodeURIComponent(id)}` : destination === "chat" && id ? `?c=${encodeURIComponent(id)}` : "";
    window.history.pushState({}, "", routeToPath[destination] + query);
    if (destination === "product" || destination === "edit") setListingId(id ?? null);
    if (destination === "chat") setConversationId(id ?? null);
    setRoute(destination);
    window.scrollTo(0, 0);
  };
  const onAuthenticated = (account: User) => { setUser(account); setSaved(savedService.getIds(account.id)); go("home"); };
  const onLogout = () => {
    authService.logout();
    setUser(null);
    setSaved(savedService.getIds(null));
    window.history.replaceState({}, "", routeToPath.welcome);
    setRoute("welcome");
    window.scrollTo(0, 0);
  };
  const toggleSaved = (id: string) => setSaved(savedService.toggle(user?.id, id));
  /** Returns an error message to show on the listing, or null when it navigated away. */
  const messageSeller = (listing: Listing): string | null => {
    if (!user) { go("login"); return null; }
    try {
      go("chat", messageService.getOrCreateConversation(listing, user).id);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Unable to open this conversation.";
    }
  };
  const publish: Parameters<typeof CreateScreen>[0]["onPublish"] = (input) => {
    if (!user) throw new Error("Please log in to publish a listing.");
    listingService.create(input, user);
    setListings(listingService.getAll());
  };
  const editListing: Parameters<typeof CreateScreen>[0]["onPublish"] = (input) => {
    if (!user || !listingId) throw new Error("Please log in to edit a listing.");
    listingService.update(listingId, input, user);
    setListings(listingService.getAll());
  };
  const deleteListing = (id: string) => {
    if (!user) throw new Error("Please log in to delete a listing.");
    listingService.remove(id, user);
    setListings(listingService.getAll());
    setSaved(savedService.getIds(user.id));
  };
  const saveProfile = (changes: ProfileChanges) => {
    if (!user) throw new Error("Please log in to update your profile.");
    const updated = authService.updateProfile(user.id, changes);
    setUser(updated);
    if (changes.fullName !== undefined) {
      listingService.syncSellerName(updated);
      messageService.syncUserName(updated);
      setListings(listingService.getAll());
    }
  };
  const loginScreen = <AuthScreen mode="login" go={go} onAuthenticated={onAuthenticated} />;
  const editing = user ? listings.find((item) => item.id === listingId && item.sellerId === user.id) : undefined;
  const screens: Record<Route, ReactNode> = {
    mylistings: user ? <MyListingsScreen go={go} user={user} listings={listings} saved={saved} toggleSaved={toggleSaved} onDelete={deleteListing} /> : loginScreen,
    edit: !user ? loginScreen : editing ? <CreateScreen key={editing.id} go={go} listing={editing} onPublish={editListing} /> : <MissingListingScreen go={go} />,
    campus: user ? <CampusScreen go={go} user={user} onSave={saveProfile} /> : loginScreen,
    account: user ? <AccountScreen go={go} user={user} onSave={saveProfile} /> : loginScreen,
    help: user ? <HelpScreen go={go} /> : loginScreen,
    welcome: <WelcomeScreen go={go} />, home: <HomeScreen go={go} listings={listings} saved={saved} toggleSaved={toggleSaved} />, login: <AuthScreen key="login" mode="login" go={go} onAuthenticated={onAuthenticated} />, signup: <AuthScreen key="signup" mode="signup" go={go} onAuthenticated={onAuthenticated} />, product: <ProductScreen key={listingId ?? "none"} go={go} item={listings.find((item) => item.id === listingId)} saved={saved} toggleSaved={toggleSaved} onMessageSeller={messageSeller} />, saved: <SavedScreen go={go} listings={listings} saved={saved} toggleSaved={toggleSaved} />, messages: user ? <MessagesScreen go={go} user={user} /> : <AuthScreen mode="login" go={go} onAuthenticated={onAuthenticated} />, chat: user ? <ChatScreen key={conversationId ?? "none"} go={go} user={user} conversationId={conversationId} listings={listings} /> : <AuthScreen mode="login" go={go} onAuthenticated={onAuthenticated} />, profile: user ? <ProfileScreen go={go} user={user} onLogout={onLogout} /> : <AuthScreen mode="login" go={go} onAuthenticated={onAuthenticated} />, create: user ? <CreateScreen go={go} onPublish={publish} /> : <AuthScreen mode="login" go={go} onAuthenticated={onAuthenticated} />,
  };
  return <div className="app-shell">{screens[route]}</div>;
}

export default App;