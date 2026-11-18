import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, LogIn, Video } from "lucide-react";
import { api } from "@/lib/api";
import { useResource, invalidate } from "@/lib/resource";
import { toast, toastError } from "@/state/ui";
import { Badge, Button, Empty, Input, PageHeader, Pulse } from "@/components/ui";
import { timeAgo } from "@/lib/format";

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
  const copy = (c: string) => navigator.clipboard.writeText(meetingLink(c)).then(() => toast("Meeting link copied"), () => toast(`Code: ${c}`));

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Meetings" subtitle="Video rooms you join with a code. Audio and video go straight between participants." />
      <div className="grid gap-4 px-8 md:grid-cols-2">
        <section className="rounded-xl border border-line p-5">
          <div className="flex items-center gap-2 text-[0.95rem] text-white"><Video size={16} strokeWidth={1.6} /> New meeting</div>
          <p className="mt-1 text-[0.82rem] text-mute">Start a room now and share its code or link.</p>
          <div className="mt-4 flex gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} placeholder="Title (optional)" aria-label="Meeting title" />
            <Button variant="primary" loading={busy} onClick={start}>Start</Button>
          </div>
        </section>
        <section className="rounded-xl border border-line p-5">
          <div className="flex items-center gap-2 text-[0.95rem] text-white"><LogIn size={16} strokeWidth={1.6} /> Join with a code</div>
          <p className="mt-1 text-[0.82rem] text-mute">Paste a code like <span className="font-mono text-white/80">abc-defg-hij</span> or a meeting link.</p>
          <div className="mt-4 flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && parsed && navigate(`/m/${parsed}`)} placeholder="abc-defg-hij" aria-label="Meeting code" className="font-mono" />
            <Button disabled={!parsed} onClick={() => parsed && navigate(`/m/${parsed}`)}>Join</Button>
          </div>
          {code && !parsed && <p className="mt-2 text-[0.75rem] text-mute">Codes have 10 letters, like abc-defg-hij.</p>}
        </section>
      </div>
      <div className="px-8 pb-16 pt-10">
        <h2 className="label mb-2">Recent</h2>
        {loading && <Pulse />}
        {data?.length === 0 && <Empty title="No meetings yet">Start one above, or join with a code someone shared with you.</Empty>}
        <ul className="divide-y divide-line">
          {data?.map((m) => (
            <li key={m.code} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[0.92rem] text-white">{m.title || "Untitled meeting"}</span>
                  {m.live > 0 && !m.ended_at && <Badge tone="ok">{m.live} in the room</Badge>}
                  {m.ended_at && <Badge>ended</Badge>}
                </div>
                <div className="mt-0.5 text-[0.75rem] text-mute"><span className="font-mono">{m.code}</span> · {m.is_host ? "you're the host" : `hosted by ${m.host_name}`} · {timeAgo(m.last_active)}</div>
              </div>
              {!m.ended_at && (
                <>
                  <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => copy(m.code)}>Link</Button>
                  <Button size="sm" onClick={() => navigate(`/m/${m.code}`)}>{m.live > 0 ? "Join" : "Open"}</Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
