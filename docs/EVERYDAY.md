# Everyday tools

Eight features for daily use, on top of the five engines. Each one runs on Orbital's own server and data. The table shows which ones need an AI provider or another service.

| Feature | Where | Needs |
|---|---|---|
| [Voice](#voice) | Chat: mic and **Talk** buttons, or `⌘K` → "Talk to Orbital" | Chrome, Edge or Safari for speech recognition, **or** a transcription service on the server |
| [Universal search](#universal-search) | `/search`, or `⌘K` → "Search everything" | — |
| [File intelligence](#file-intelligence) | Knowledge → **Import**, or the paperclip in chat | An AI provider only for images and scanned PDFs |
| [Project tracking](#project-tracking) | Projects | — |
| [Smart reminders](#smart-reminders) | **Reminders** in the sidebar, plus the bell on tasks, notes, projects and opportunities | — |
| [Web clipper](#web-clipper) | Knowledge → **Clip a page**, or the bookmarklet | — |
| [Learning mode](#learning-mode) | Chat → **Learning**, or `⌘K` → "Learn about…" | An AI provider |
| [Focus mode](#focus-mode) | **Focus** in the sidebar, or **Focus on this** on a project | — |
| [Knowledge maintenance](#knowledge-maintenance) | Knowledge → **Knowledge health** | An AI provider only for reading memory pairs for conflicts (a simpler check runs without one) |

## Voice

- **Dictation.** The mic in the chat box turns speech into text in the message box, so you can check it before sending.
- **Talk.** The waveform button opens a voice conversation with the Neural Core full screen. Orbital listens, answers, reads the answer aloud, then listens again.
  - Space interrupts it while it's speaking.
  - Esc ends the conversation.
  - Answers are read without code blocks, links or citation markers.
- **Save to memory.** This works on any conversation, typed or spoken, from the chat header or the voice screen.
  - Orbital keeps the whole conversation as a searchable note tagged `#conversation`. Saving again updates the same note.
  - With an AI provider, Orbital also turns the facts you stated into memories, using the same evidence checks as automatic memory extraction.
  - "Remember that…" always works, even without AI.

**Speech recognition** comes from one of two places:
1. **The browser's own recogniser**, in Chrome, Edge and Safari. In Chrome and Edge, audio goes to the browser vendor's speech service.
2. **A transcription service on the server.** This is used where the browser has no recogniser: the desktop app and Firefox. Orbital records a clip, stops after about a second of silence, and sends it to any OpenAI-compatible `/audio/transcriptions` endpoint. Audio is never stored.

| Variable | Default | |
|---|---|---|
| `TRANSCRIPTION_BASE_URL` | `OPENAI_BASE_URL` when `OPENAI_API_KEY` is set | For example `https://api.openai.com/v1`, `https://api.groq.com/openai/v1`, or a local whisper.cpp / faster-whisper server |
| `TRANSCRIPTION_API_KEY` | `OPENAI_API_KEY` | |
| `TRANSCRIPTION_MODEL` | `whisper-1` | |

Spoken answers use the operating system's voices (`speechSynthesis`). On Linux that needs `speech-dispatcher`.

## Universal search

One search box covers the following:
- your own conversations (other people's never appear)
- notes, imported files and web clips
- research reports, both the question and the synthesized summary and findings
- memories
- projects, tasks and opportunities

Search matches words inside the content, not just titles, and highlights them in the snippet. It supports `"exact phrase"`, `or` and `-exclude`, and you can filter by type. The URL keeps the query, so a search can be shared and Back works.

## File intelligence

| File | How it's read |
|---|---|
| PDF | Text layer. Scanned PDFs with no text are read by Claude when `ANTHROPIC_API_KEY` is set |
| Word `.docx` | Locally: headings, lists and tables become Markdown |
| Excel `.xlsx` | Locally: each sheet becomes a Markdown table (first 2,000 rows, 60 columns) |
| PowerPoint `.pptx` | Locally: slide by slide, with speaker notes |
| PNG, JPEG, GIF, WebP | By the AI provider: text transcribed, plus a description of what the image shows. Without AI, the image is kept and shown but isn't searchable until you describe it |
| Markdown, text, CSV, TSV, JSON, HTML | As-is |

Files are checked by their actual bytes, not just their extension, and parsed on the server; nothing is ever run.
- Images are kept so the Knowledge page can show them, and are served only to their own workspace.
- Text that the AI read is labelled **AI-generated**.
- The upload limit is `MAX_UPLOAD_MB` (25 MB by default), and 3.75 MB for images.

## Project tracking

- **Projects list:** completion %, overdue tasks, milestones reached, next due date, and the deadline (amber within a week, red when late).
- **Project page:**
  - a progress strip: % done, milestones, overdue tasks, and days to the deadline (click it to set one)
  - due dates on tasks and target dates on milestones (click the date)
  - a reminder bell on each open task
  - **Focus on this**, which starts a focus session on the project

"Overdue" uses your own calendar day, which the browser sends to the server.

**Activity grid.** Like a GitHub contribution graph: one square per day for the last year, in your own time zone.
- The **project page** shows the grid for that project. So does an **opportunity** you've turned into a project with **Track progress**.
- The **Neural Core** page shows it for everything you do.
- Each day takes the colour of the work that led it:
  - green for build (tasks, milestones, focus)
  - cyan for knowledge (notes, files, clips, memories)
  - violet for research
  - magenta for conversations
  - yellow for opportunities
- More work makes the square brighter. Click a colour to show only that kind of work.
- Above the grid: total contributions, current and longest streak, active days and your busiest day.

## Smart reminders

**Reminders you set:**
- Type them the way you'd say them, on the Reminders page, in chat, or in `⌘K`:
  - "call Sam friday at 3", "stretch in 20 minutes", "dentist March 5 at 2pm", "lunch with Jo on the 28th at noon"
  - "pay rent every month on the 1st", "standup every weekday at 9:30", "gym every mon, wed and fri at 6:30am until dec 31", "review every other friday"
  - The Reminders page shows what it understood (title, time, repeat) before you save. Anything it doesn't read as a time stays in the title.
  - In chat (typed or spoken), a message starting with "remind me…" or "set a reminder…" is set straight away, with no AI needed. In `⌘K`, the first result becomes "Set reminder: …".
  - Typed reminders are read in English for now; the rest of Orbital follows your language.
- Or use the bell on any task, note, project or opportunity, or the quick choices: "In 1 hour", "This evening", "Tomorrow morning", "Next week", or any time.
- **Repeating reminders:** every day, every weekday, chosen days of the week, every N days/weeks/months/years, with an optional end date. They follow your own clock (9:00 stays 9:00 across daylight-saving changes; "the 31st" falls on the last day of shorter months). Each time one comes due, it appears as its own reminder to complete or snooze, and the series moves to its next time. If Orbital was off, you get one reminder, not one for every missed day. Hover a repeating reminder to stop repeating it.
- When a reminder is due, it appears in Orbital straight away, the Reminders item in the sidebar shows a count, and the Dock or taskbar icon (desktop) or the browser tab shows how many are due.
- **Desktop app:** closing the window keeps Orbital running in the menu bar (Mac) or system tray (Windows, Linux), so reminders still arrive as system notifications. Click one to open it. The menu-bar icon shows how many are due and has Open, New reminder and Quit. In **Settings → Desktop** you can turn this off and choose to open Orbital when you log in (Mac and Windows), so reminders work as soon as your computer is on.
- In a browser, allow notifications for system notifications while the tab is in the background.
- From there you can snooze it, push it to tomorrow, or mark it done. Only you see your reminders, even in a shared workspace.

**"Orbital noticed"** is worked out from your real data each time you open the page. Nothing is invented, and each item links to its source:
- tasks that are overdue, or due today or tomorrow
- milestones and project deadlines coming up, with how much is done
- active projects with open tasks and no progress for 14 days
- **unfinished ideas**: notes tagged `#idea`, `#draft`, `#todo`, `#wip`, `#someday` or `#brainstorm` that you haven't touched for 5 days
- opportunities sitting still for 10 days
- open questions from Learning and Deep Thinking that are older than a week

Each one can become a reminder for tomorrow, be snoozed for 3 days, or be dismissed.

## Web clipper

- Paste a link in **Knowledge → Clip a page**.
- Or drag the **Clip to Orbital** bookmarklet from that dialog to your bookmarks bar, then click it on any page. Select text first to save it as a highlight.

The server fetches the page and keeps the readable article:
- title, site, author and date
- headings, lists, quotes and links (made absolute)
- **not** the menus, ads and scripts

The clip becomes a document tagged `#web-clip` with its source link, so it's searchable and joins the knowledge graph. PDFs and plain-text links work too.

Pages behind a login or that block automated access can't be fetched, but your selection is still saved. Clipping the same link twice opens the existing clip.

Safety: the clipper only fetches `http(s)` pages on the public internet. It refuses private and local network addresses at every redirect, gives up after 15 seconds, and won't fetch more than 5 MB. The desktop app allows local addresses, because it only serves you.

The bookmarklet opens your Orbital server's `/clip` page. That needs you to be signed in to that server in the same browser, so with the desktop app use the dialog instead.

## Learning mode

Learning is one of the chat modes. It teaches a topic starting from what Orbital already knows about you:
- your memories, notes and research are retrieved first, so explanations build on what you know
- it uses concrete examples
- it ends with a **learning path** (the next topics, in order) and **check your understanding** questions
- gaps it notices are saved as open questions, which later show up in Reminders

Start it from `⌘K` → "Learn about…" with a topic, or pick **Learning** above the chat box.

## Focus mode

Pick one objective. If you start from a project, Orbital suggests its next open task. Choose 25, 50 or 90 minutes. The rest of Orbital then steps back:
- The navigation is hidden.
- Notifications are held and counted, then shown when you finish.
- The screen holds four things:
  - a timer (Space to pause; a soft chime when time's up, and it keeps counting)
  - the project's open tasks, to tick off or add to
  - a scratchpad, saved as you type to a Knowledge note tagged `#focus` and linked to the project
- **Step out** leaves the session running.
- **End session** asks how it went, then records:
  - the time focused
  - tasks finished during the session
  - your outcome

The Focus page shows this week's focused time and recent sessions.

## Knowledge maintenance

**Knowledge health** (`/maintenance`, linked from Knowledge, the Neural Core page and `⌘K`). Orbital checks your knowledge once a day, or whenever you press **Check now**. It looks for:

| Issue | How it's found | Suggested fix |
|---|---|---|
| **Duplicate notes** | Similar notes, or notes with the same title, whose passages overlap heavily, or where one note's text is inside the other | Merge into the fuller note. The other note's text is added under "Merged from …" unless it's already there, so nothing is lost. Or keep both. |
| **Duplicate memories** | Nearly identical memories (with AI: memories that say the same thing in different words) | Keep one; the other is archived |
| **Conflicting memories** | Related memories where one negates the other, or that give different figures for the same thing. With AI, every related pair is read once and only genuine contradictions are raised. | Choose which is true now (the newer statement of a change is suggested), correct it, or say both are true. The other one is archived. |
| **Outdated information** | Memories that refer to a past year as if it were still ahead, say "next month" months later, or describe a project as in progress after it was completed; old goals and decisions that haven't come up since; research reports with stale facts | Still true (it won't be flagged for 6 months), update it, archive it, or refresh the report |
| **Disconnected concepts** | Notes, concepts and findings with no connections at all | Connect to one of the three closest items, or remove a standalone concept from the graph |
| **Broken links** | `[[Links]]` to notes that don't exist | Create the note, or fix the link |

**Nothing changes on its own:**
- A check only makes suggestions; important information is never silently changed.
- When you apply a fix, removed memories are **archived**, not deleted, and merged notes are kept in full.
- Every applied change can be **undone for 30 days**.
- **Dismissed** issues are remembered and never raised again. **Snoozed** ones come back in 30 days.

**Health score:** the score falls with each open issue, weighted by how serious it is (conflicts count most) and scaled to how much knowledge you have. Conflicts, or five or more open suggestions, also show up in Reminders under "Orbital noticed".
