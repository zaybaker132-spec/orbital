import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { IntroScreen, type IntroKind } from "./components/IntroScreen";
import { EnvironmentEffects, resolveEnvironment } from "./state/environment";
import { useResource } from "./lib/resource";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useApp } from "./state/app";
import { api } from "./lib/api";
import { toast, toastError } from "./state/ui";
import { useLiveEvents } from "./state/events";
import { Shell } from "./components/Shell";
import { Pulse } from "./components/ui";
import { AuthPage } from "./pages/Auth";
import { ChatPage } from "./pages/Chat";
import { NotFoundPage } from "./pages/NotFound";
import { isAppRoute } from "@shared/routes";

const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const MediaPage = lazy(() => import("./pages/Media").then((m) => ({ default: m.MediaPage })));
const CorePage = lazy(() => import("./pages/Core").then((m) => ({ default: m.CorePage })));
const ResearchPage = lazy(() => import("./pages/Research").then((m) => ({ default: m.ResearchPage })));
const KnowledgePage = lazy(() => import("./pages/Knowledge").then((m) => ({ default: m.KnowledgePage })));
const ConnectionsPage = lazy(() => import("./pages/Connections").then((m) => ({ default: m.ConnectionsPage })));
const ProjectsPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsPage })));
const OpportunitiesPage = lazy(() => import("./pages/Opportunities").then((m) => ({ default: m.OpportunitiesPage })));
const OperationsPage = lazy(() => import("./pages/Operations").then((m) => ({ default: m.OperationsPage })));
const TeamPage = lazy(() => import("./pages/Team").then((m) => ({ default: m.TeamPage })));
const WaitlistPage = lazy(() => import("./pages/Waitlist").then((m) => ({ default: m.WaitlistPage })));
const MeetingsPage = lazy(() => import("./pages/Meetings").then((m) => ({ default: m.MeetingsPage })));
const MeetingRoomPage = lazy(() => import("./pages/MeetingRoom").then((m) => ({ default: m.MeetingRoomPage })));
const RemindersPage = lazy(() => import("./pages/Reminders").then((m) => ({ default: m.RemindersPage })));
const FocusPage = lazy(() => import("./pages/Focus").then((m) => ({ default: m.FocusPage })));
const HypothesesPage = lazy(() => import("./pages/Hypotheses").then((m) => ({ default: m.HypothesesPage })));
const MaintenancePage = lazy(() => import("./pages/Maintenance").then((m) => ({ default: m.MaintenancePage })));
const SearchPage = lazy(() => import("./pages/Search").then((m) => ({ default: m.SearchPage })));
const ClipPage = lazy(() => import("./pages/Clip").then((m) => ({ default: m.ClipPage })));
const DocsHome = lazy(() => import("./pages/docs/DocsHome").then((m) => ({ default: m.DocsHome })));
const DocEditorPage = lazy(() => import("./pages/docs/DocEditor").then((m) => ({ default: m.DocEditorPage })));
/** Papers used to be called Docs: old links still open. */
function LegacyDocRedirect() { const { id } = useParams(); return <Navigate to={`/papers/${id}`} replace />; }
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));

/** Invite links (/invite/<token>) survive sign-in: the token is held for this tab until accepted. */
const INVITE_KEY = "orbital.invite";
const NEXT_KEY = "orbital.next";
const inviteMatch = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{10,200})$/);
if (inviteMatch) { try { sessionStorage.setItem(INVITE_KEY, inviteMatch[1]); } catch { /* ignore */ } history.replaceState(null, "", "/"); }

function AppRoutes() {
  const { loaded, user, load, workspace, refreshWorkspaces, switchWorkspace, desktop } = useApp();
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => { load().catch(() => useApp.setState({ loaded: true })); }, [load]);
  useLiveEvents(!!user, workspace?.id);

  // After signing in, continue to the link that brought you here.
  useEffect(() => {
    if (!user) return;
    let next: string | null = null;
    try { next = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); } catch { /* ignore */ }
    if (next && next.startsWith("/") && !next.startsWith("//")) navigate(next, { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    if (!user) return;
    let token: string | null = null;
    try { token = sessionStorage.getItem(INVITE_KEY); sessionStorage.removeItem(INVITE_KEY); } catch { /* ignore */ }
    if (!token) return;
    api.post("/invites/accept", { token })
      .then(async (w) => { await refreshWorkspaces(); switchWorkspace(w.id); toast(`You joined ${w.name} as ${w.role}`); navigate("/"); })
      .catch(toastError);
  }, [user, refreshWorkspaces, switchWorkspace, navigate]);

  // The waitlist is public: no account, no app shell.
  if (loc.pathname === "/waitlist") return <Suspense fallback={<div className="h-full bg-black" />}><WaitlistPage /></Suspense>;
  if (!loaded) return <div className="flex h-full items-center justify-center bg-black"><Pulse /></div>;
  // A password reset link works whether or not this browser is signed in.
  if (loc.pathname === "/reset-password") return <AuthPage />;
  if (!user) {
    // Signed out: the waitlist is the front door (the desktop app goes straight to sign-in).
    if (loc.pathname === "/" && !desktop) return <Suspense fallback={<div className="h-full bg-black" />}><WaitlistPage /></Suspense>;
    // A mistyped address isn't a page behind sign-in: say so instead of asking to sign in.
    if (!isAppRoute(loc.pathname)) return <NotFoundPage standalone />;
    // Any other link (a meeting, a project) continues there after signing in.
    if (loc.pathname !== "/" && loc.pathname !== "/login") { try { sessionStorage.setItem(NEXT_KEY, loc.pathname + loc.search); } catch { /* ignore */ } }
    return <AuthPage />;
  }
  if (loc.pathname === "/login") return <Navigate to="/" replace />;
  // The web clipper opens in a small window of its own: no app shell.
  if (loc.pathname === "/clip") return <Suspense fallback={<div className="h-full bg-black" />}><ClipPage /></Suspense>;

  // Top-level section key: transitions between sections, not between items inside one.
  const section = loc.pathname === "/" || loc.pathname.startsWith("/c/") ? "chat" : loc.pathname.split("/")[1];
  return (
    <Shell>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={`${workspace?.id}:${section}`} className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Pulse /></div>}>
            <Routes location={loc}>
              <Route path="/" element={<ChatPage />} />
              <Route path="/c/:id" element={<ChatPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/media" element={<MediaPage />} />
              <Route path="/media/:id" element={<MediaPage />} />
              <Route path="/core" element={<CorePage />} />
              <Route path="/research" element={<ResearchPage />} />
              <Route path="/research/:id" element={<ResearchPage />} />
              <Route path="/papers" element={<DocsHome />} />
              <Route path="/papers/:id" element={<DocEditorPage />} />
              <Route path="/docs" element={<Navigate to="/papers" replace />} />
              <Route path="/docs/:id" element={<LegacyDocRedirect />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/knowledge/:id" element={<KnowledgePage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectsPage />} />
              <Route path="/opportunities" element={<OpportunitiesPage />} />
              <Route path="/operations" element={<OperationsPage />} />
              <Route path="/team" element={<TeamPage />} />
              <Route path="/meetings" element={<MeetingsPage />} />
              <Route path="/m/:code" element={<MeetingRoomPage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/focus" element={<FocusPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/hypotheses" element={<HypothesesPage />} />
              <Route path="/maintenance" element={<MaintenancePage />} />
              <Route path="/hypotheses/:id" element={<HypothesesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}

/**
 * The intro screen plays when Orbital opens (once per session: a refresh doesn't replay it; the desktop
 * app plays it on every launch) and again right after signing in, covering the load of the workspace.
 * It leaves once the app is ready, and never before its animation has had time to finish.
 */
const OPENED_KEY = "orbital.opened";
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Never shorter than 2.5 s (even with reduced motion, where it shows a still version instead).
const minShow = (kind: IntroKind) => (reducedMotion() ? 2500 : kind === "open" ? 4400 : 4200);

export function App() {
  const { loaded, user, workspace } = useApp();
  const [intro, setIntro] = useState<{ kind: IntroKind; leaving: boolean; at: number } | null>(() => {
    if (location.pathname === "/clip") return null; // the web clipper's small window
    let seen = false;
    try { seen = sessionStorage.getItem(OPENED_KEY) === "1"; sessionStorage.setItem(OPENED_KEY, "1"); } catch { /* ignore */ }
    return seen ? null : { kind: "open", leaving: false, at: performance.now() };
  });
  const prevUser = useRef<string | null | undefined>(undefined);

  // Signing in (or creating an account, or resetting a password) plays the welcome.
  useEffect(() => {
    if (!loaded) return;
    const id = user?.id ?? null;
    if (prevUser.current === null && id) setIntro({ kind: "welcome", leaving: false, at: performance.now() });
    prevUser.current = id;
  }, [loaded, user?.id]);

  // Leave when ready: the app has loaded (and, signed in, the workspace too).
  const ready = loaded && (!user || !!workspace);
  useEffect(() => {
    if (!intro || intro.leaving || !ready) return;
    const wait = Math.max(0, minShow(intro.kind) - (performance.now() - intro.at));
    const t = setTimeout(() => setIntro((i) => (i ? { ...i, leaving: true } : i)), wait);
    return () => clearTimeout(t);
  }, [intro, ready]);
  const done = useCallback(() => setIntro(null), []);

  // Your environment's start-up choices: open on your dashboard, and the context panel open or closed.
  const navigate = useNavigate();
  const started = useRef(false);
  useEffect(() => {
    if (!loaded || !user || started.current) return;
    started.current = true;
    const env = resolveEnvironment(useApp.getState().prefs.environment);
    if (env.contextPanel !== "remember") useApp.getState().toggleRightPanel(env.contextPanel === "open");
    if (env.home === "dashboard" && location.pathname === "/" && !location.search) navigate("/dashboard", { replace: true });
  }, [loaded, user, navigate]);

  return (
    <>
      <EnvironmentEffects />
      {user && <ReminderSignals />}
      <AppRoutes />
      {intro && <IntroScreen key={intro.kind + intro.at} kind={intro.kind} name={user?.displayName} leaving={intro.leaving} onGone={done} />}
    </>
  );
}

/**
 * Reminders that are due show as a badge on the Dock / taskbar icon (desktop) or a count in the tab
 * title (browser), and a notification or tray click opens the page it points at.
 */
function ReminderSignals() {
  const navigate = useNavigate();
  const { data } = useResource<any[]>("/reminders");
  const due = data?.filter((r) => r.status === "fired").length ?? 0;
  useEffect(() => {
    const desk = window.orbitalDesktop;
    if (desk?.setBadge) { void desk.setBadge(due).catch(() => {}); return; }
    const base = document.title.replace(/^\(\d+\)\s+/, "");
    document.title = due ? `(${due}) ${base}` : base;
  }, [due]);
  useEffect(() => window.orbitalDesktop?.onNavigate?.((p) => navigate(p)), [navigate]);
  return null;
}
