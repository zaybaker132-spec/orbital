# Your Orbital environment

Make Orbital yours: dashboards of widgets, the app's layout, and its look. Everything is saved to your
account (so it follows you on a hosted server) and applies only to you.

## Dashboards

**Dashboard** in the sidebar (or `g` then `h`). A dashboard is a grid of widgets:

| Widget | Shows |
|---|---|
| Today | A greeting, the date, tasks due and reminders today |
| Ask Orbital | A box that starts a conversation |
| Neural Core | Your orb |
| Quick note | Save a thought as a note (Ctrl/⌘ + Enter) |
| Upcoming tasks | Open tasks across projects, soonest first; tick to complete |
| Projects | Active projects with progress and overdue counts |
| Reminders | What's coming up |
| Nudges | Overdue work, slipping deadlines, stalled projects |
| Recent notes · Recent papers · Research | What you touched last |
| Focus | This week's focused time; start or resume a session |
| Activity | A year of your work, day by day |
| Growth | Knowledge nodes, connections, memories, research, verified findings, resolved questions |
| Open questions | Knowledge gaps ready to research |
| Opportunities | Opportunities you're tracking |

**Customize** puts the dashboard in edit mode: add widgets, drag them (or use the arrows) to reorder,
size each one Small, Medium or Wide, remove it, and rename the dashboard. **+** creates another dashboard
(up to 8) from a template: Overview, Deep work, Research, Founder, or Blank.

## Layout and look (Settings → Your environment)

- **Opens to:** a new conversation or your dashboard
- **Context panel:** as you left it, or always open/closed when Orbital starts
- **Accent colour:** ten colours for the active section, focus rings, selection and progress bars
- **Neural Core colours:** Spectrum, Aurora, Ember, Ocean or Mono (structure and brightness stay the same)
- **Background:** plain, soft glow, dot grid or stars
- **Text size:** small, default or large
- **Sidebar:** show, hide and reorder sections (Settings and New conversation always stay)

Light or dark is under Settings → Appearance.

## How it works

Stored as `environment` in your preferences (`PUT /api/preferences`). The server accepts only known widget
types, sizes, sections and colours, slug ids, short names, and at most 8 dashboards of 24 widgets; anything
else is refused (`server/routes/workspace.ts`, `shared/environment.ts`). Widgets read existing endpoints,
plus `GET /api/dashboard/tasks` for open tasks across the current workspace. Tests: `server/test/environment.test.ts`.
