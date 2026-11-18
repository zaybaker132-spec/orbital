/**
 * Every page address the web app serves. The server uses this to answer unknown addresses with a
 * real 404 status (while still serving the app, which shows the "not found" page); the app uses it
 * to tell a mistyped link from a page that needs signing in.
 */
const SEG = "[^/]+";
export const APP_ROUTES: RegExp[] = [
  "/", "/login", "/waitlist", "/clip", "/core", "/connections", "/opportunities", "/operations", "/team",
  "/meetings", "/reminders", "/focus", "/search", "/settings",
  `/c/${SEG}`, `/m/${SEG}`, `/invite/${SEG}`,
  `/research(/${SEG})?`, `/knowledge(/${SEG})?`, `/projects(/${SEG})?`,
].map((p) => new RegExp(`^${p}/?$`));

export const isAppRoute = (pathname: string) => APP_ROUTES.some((r) => r.test(pathname));
