import { locale, tx } from "@/i18n";

/** Starting points for a new doc, written in the interface language. `swatch` colours the thumbnail. */
export interface DocTemplate { id: string; label: string; swatch: string; title: () => string; html: () => string }

const today = () => new Date().toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });

export const TEMPLATES: DocTemplate[] = [
  { id: "blank", label: "Blank document", swatch: "#ffffff", title: () => "", html: () => "" },
  {
    id: "meeting", label: "Meeting notes", swatch: "#1fd0ff",
    title: () => tx("Meeting notes"),
    html: () => `<h1>${tx("Meeting notes")}</h1><p><strong>${tx("Date")}:</strong> ${today()}</p><p><strong>${tx("Attendees")}:</strong> </p>
<h2>${tx("Agenda")}</h2><ol><li><p></p></li></ol>
<h2>${tx("Notes")}</h2><p></p>
<h2>${tx("Decisions")}</h2><ul><li><p></p></li></ul>
<h2>${tx("Action items")}</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  },
  {
    id: "proposal", label: "Project proposal", swatch: "#ffd23a",
    title: () => tx("Project proposal"),
    html: () => `<h1>${tx("Project proposal")}</h1><p>${today()}</p>
<h2>${tx("Overview")}</h2><p>${tx("What is this project, and why does it matter now?")}</p>
<h2>${tx("Goals")}</h2><ul><li><p></p></li></ul>
<h2>${tx("Scope")}</h2><p>${tx("What's included, and what isn't.")}</p>
<h2>${tx("Timeline")}</h2><table><tbody><tr><th><p>${tx("Milestone")}</p></th><th><p>${tx("Date")}</p></th><th><p>${tx("Owner")}</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>${tx("Budget and resources")}</h2><p></p>
<h2>${tx("Risks")}</h2><ul><li><p></p></li></ul>`,
  },
  {
    id: "report", label: "Report", swatch: "#2cff7a",
    title: () => tx("Report"),
    html: () => `<h1>${tx("Report")}</h1><p>${today()}</p>
<h2>${tx("Summary")}</h2><p>${tx("The main points in a few sentences.")}</p>
<h2>${tx("Background")}</h2><p></p>
<h2>${tx("Findings")}</h2><p></p>
<h2>${tx("Recommendations")}</h2><ol><li><p></p></li></ol>
<h2>${tx("Next steps")}</h2><p></p>`,
  },
  {
    id: "letter", label: "Letter", swatch: "#ff9a1a",
    title: () => tx("Letter"),
    html: () => `<p>${tx("Your name")}<br>${tx("Your address")}</p><p>${today()}</p><p>${tx("Recipient name")}<br>${tx("Recipient address")}</p>
<p>${tx("Dear {name},", { name: tx("Recipient name") })}</p><p></p><p></p><p>${tx("Sincerely,")}</p><p>${tx("Your name")}</p>`,
  },
  {
    id: "brainstorm", label: "Brainstorm", swatch: "#b02bff",
    title: () => tx("Brainstorm"),
    html: () => `<h1>${tx("Brainstorm")}</h1><p><strong>${tx("Question")}:</strong> </p>
<h2>${tx("Ideas")}</h2><ul><li><p></p></li></ul>
<h2>${tx("Most promising")}</h2><p></p>
<h2>${tx("Questions to answer")}</h2><ul><li><p></p></li></ul>
<h2>${tx("Next steps")}</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  },
];
