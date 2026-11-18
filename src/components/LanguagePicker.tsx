import { Globe } from "lucide-react";
import { LANGUAGES, language, setLanguage, tx } from "@/i18n";
import { cx } from "@/components/ui";

/** A compact language switch for signed-out pages. Signed in, the choice lives in Settings → Language. */
export function LanguagePicker({ className }: { className?: string }) {
  return (
    <label className={cx("relative inline-flex items-center gap-1.5 text-[0.76rem] text-mute hover:text-white", className)}>
      <Globe size={13} aria-hidden />
      <select aria-label={tx("Language")} value={language()} onChange={(e) => { setLanguage(e.target.value); location.reload(); }}
        className="cursor-pointer appearance-none bg-transparent pr-1 outline-none">
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} className="bg-ink-2 text-white">{l.native}</option>)}
      </select>
    </label>
  );
}
