import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
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
const SearchPage = lazy(() => import("./pages/Search").then((m) => ({ default: m.SearchPage })));
const ClipPage = lazy(() => import("./pages/Clip").then((m) => ({ default: m.ClipPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));

/** Invite links (/invite/<token>) survive sign-in: the token is held for this tab until accepted. */
const INVITE_KEY = "orbital.invite";
const NEXT_KEY = "orbital.next";
const inviteMatch = location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{10,200})$/);
if (inviteMatch) { try { sessionStorage.setItem(INVITE_KEY, inviteMatch[1]); } catch { /* ignore */ } history.replaceState(null, "", "/"); }

export function App() {
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
              <Route path="/core" element={<CorePage />} />
              <Route path="/research" element={<ResearchPage />} />
              <Route path="/research/:id" element={<ResearchPage />} />
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
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}
