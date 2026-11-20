import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, LogIn, Video } from "lucide-react";
import { api } from "@/lib/api";
import { useResource, invalidate } from "@/lib/resource";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, Empty, Input, PageHeader, Pulse } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { tx } from "@/i18n";

/** Accepts a code (abc-defg-hij, abcdefghij) or a full meeting link. */
export function parseMeetingCode(raw: string) {
  const m = raw.trim().toLowerCase().match(/([a-z]{3})-?([a-z]{4})-?([a-z]{3})\s*$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
export const meetingLink = (code: string) => `${location.origin}/m/${code}`;

export function MeetingsPage() {
  const navigate = useNavigate();
  const { data, loading } = useResource<any[]>("/meetings");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseMeetingCode(code);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.post("/meetings", { title: title.trim() });
      invalidate("/meetings");
      navigate(`/m/${r.code}`);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const copy = (c: string) => navigator.clipboard.writeText(meetingLink(c)).then(() => toast(tx("Meeting link copied")), () => toast(tx("Code: {c}", { c: c })));

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={tx("Meetings")} subtitle={tx("Video rooms you join with a code. Audio and video go straight between participants.")} />
      <div className="grid gap-4 px-8 md:grid-cols-2">
        <section className="glow-card rounded-xl border border-line p-5">
          <div className="flex items-center gap-2 text-[0.95rem] text-white"><Video size={16} strokeWidth={1.6} /> {tx("New meeting")}</div>
          <p className="mt-1 text-[0.82rem] text-mute">{tx("Start a room now and share its code or link.")}</p>
          <div className="mt-4 flex gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} placeholder={tx("Title (optional)")} aria-label={tx("Meeting title")} />
            <Button variant="primary" loading={busy} onClick={start}>{tx("Start")}</Button>
          </div>
        </section>
        <section className="glow-card rounded-xl border border-line p-5">
          <div className="flex items-center gap-2 text-[0.95rem] text-white"><LogIn size={16} strokeWidth={1.6} /> {tx("Join with a code")}</div>
          <p className="mt-1 text-[0.82rem] text-mute">{tx("Paste a code like")} <span className="font-mono text-white/80">{tx("abc-defg-hij")}</span> {tx("or a meeting link.")}</p>
          <div className="mt-4 flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && parsed && navigate(`/m/${parsed}`)} placeholder={tx("abc-defg-hij")} aria-label={tx("Meeting code")} className="font-mono" />
            <Button disabled={!parsed} onClick={() => parsed && navigate(`/m/${parsed}`)}>{tx("Join")}</Button>
          </div>
          {code && !parsed && <p className="mt-2 text-[0.75rem] text-mute">{tx("Codes have 10 letters, like abc-defg-hij.")}</p>}
        </section>
      </div>
      <div className="px-8 pb-16 pt-10">
        <h2 className="label mb-2">{tx("Recent")}</h2>
        {loading && <Pulse />}
        {data?.length === 0 && <Empty title={tx("No meetings yet")}>{tx("Start one above, or join with a code someone shared with you.")}</Empty>}
        <ul className="divide-y divide-line">
          {data?.map((m) => (
            <li key={m.code} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[0.92rem] text-white">{m.title || tx("Untitled meeting")}</span>
                  {m.live > 0 && !m.ended_at && <Badge tone="ok">{m.live} {tx("in the room")}</Badge>}
                  {m.ended_at && <Badge>{tx("ended")}</Badge>}
                </div>
                <div className="mt-0.5 text-[0.75rem] text-mute"><span className="font-mono">{m.code}</span> · {m.is_host ? tx("you're the host") : tx("hosted by {host_name}", { host_name: m.host_name })} · {timeAgo(m.last_active)}</div>
              </div>
              {!m.ended_at && (
                <>
                  <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => copy(m.code)}>{tx("Link")}</Button>
                  <Button size="sm" onClick={() => navigate(`/m/${m.code}`)}>{m.live > 0 ? tx("Join") : tx("Open")}</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
