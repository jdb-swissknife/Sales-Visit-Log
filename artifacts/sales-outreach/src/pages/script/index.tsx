import { useState } from "react";
import { ChevronLeft, ChevronRight, Clock, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Step {
  id: string;
  label: string;
  time?: string;
  color: string;
  accent: string;
  content: React.ReactNode;
}

const steps: Step[] = [
  {
    id: "framework",
    label: "The Framework",
    color: "border-violet-500",
    accent: "bg-violet-500",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm uppercase tracking-widest font-semibold">Sell outcomes, not features</p>
        <p className="text-lg text-foreground leading-relaxed">
          They don't care about AI, agents, or automation.
        </p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          {["MORE REVENUE", "LESS HEADACHE", "ZERO OVERHEAD"].map((outcome) => (
            <div key={outcome} className="rounded-xl bg-violet-500/10 border border-violet-500/30 p-3 text-center">
              <span className="text-violet-400 font-bold text-xs leading-tight">{outcome}</span>
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-muted/50 border border-border p-4 mt-4">
          <p className="text-sm text-muted-foreground font-medium mb-2">The goal every time:</p>
          <p className="text-foreground font-semibold">Book the audit interview <span className="text-muted-foreground font-normal">OR</span> walk away clean.</p>
          <p className="text-destructive text-sm mt-1 font-medium">No maybes. Ever.</p>
        </div>
      </div>
    ),
  },
  {
    id: "opening",
    label: "Opening",
    time: "10 sec",
    color: "border-sky-500",
    accent: "bg-sky-500",
    content: (
      <div className="space-y-5">
        <p className="text-muted-foreground text-sm italic">Walk in confident. Smile. No-appointment-needed energy.</p>
        <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 p-5">
          <p className="text-foreground text-lg leading-relaxed">
            "Hey, I'm <strong>[NAME]</strong> with MindVault. I work with local service companies like yours. I've only got 2 minutes — can I show you something quick?"
          </p>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-red-400 mb-2">If they say no →</p>
            <p className="text-sm text-foreground leading-relaxed">
              "Totally understand. Here's my card — when you're ready to add $50K+ to your bottom line without hiring anyone, call me."
            </p>
            <p className="text-xs text-muted-foreground mt-2 font-semibold">LEAVE. Don't push.</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-green-400 mb-2">If yes or sure →</p>
            <p className="text-sm text-foreground font-semibold">Move to The Hook.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "hook",
    label: "The Hook",
    time: "20 sec",
    color: "border-amber-500",
    accent: "bg-amber-500",
    content: (
      <div className="space-y-4">
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-5 space-y-4">
          <p className="text-foreground leading-relaxed">
            "Right now you're probably spending hours every week on quotes, follow-ups, scheduling, chasing leads — all the stuff that keeps you busy but doesn't make you money."
          </p>
          <div className="border-t border-amber-500/20 pt-3">
            <p className="text-xs text-amber-400 font-semibold uppercase tracking-wider mb-2">Pause. Let them nod.</p>
            <p className="text-muted-foreground text-sm italic">They ALWAYS agree with this.</p>
          </div>
          <p className="text-foreground leading-relaxed">
            "What if all of that just... <em>handled itself</em>? Your leads get followed up with instantly. Quotes go out the same day. Schedule stays full. And you never have to hire another person to make it happen."
          </p>
          <p className="text-foreground font-semibold text-lg">"That's what we do."</p>
        </div>
      </div>
    ),
  },
  {
    id: "demo",
    label: "The Demo",
    time: "60 sec",
    color: "border-emerald-500",
    accent: "bg-emerald-500",
    content: (
      <div className="space-y-4">
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4">
          <p className="text-foreground font-semibold mb-1">Pull out phone or tablet.</p>
          <p className="text-foreground">"I'll show you real quick." <span className="text-emerald-400 font-semibold">[PLAY DEMO]</span></p>
        </div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Say during demo:</p>
        <div className="space-y-2">
          {[
            "\"This is what YOUR business looks like when it runs itself.\"",
            "\"See this? That's a lead coming in and getting a response in under 60 seconds. At 11pm on a Sunday.\"",
            "\"Your customers get white-glove service 24/7. You sleep.\"",
            "\"These agents learn your business. Every week they find better ways to close leads. Your smartest employee that never stops improving.\""
          ].map((line, i) => (
            <div key={i} className="flex gap-3 items-start rounded-lg bg-muted/40 border border-border p-3">
              <span className="text-emerald-400 font-bold text-sm shrink-0">{i + 1}</span>
              <p className="text-sm text-foreground leading-relaxed">{line}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-bold text-xs uppercase tracking-widest">The Trust Ladder</span>
            <span className="text-xs text-muted-foreground">— key differentiator, weave into demo</span>
          </div>
          <p className="text-sm text-foreground leading-relaxed">
            "And here's the part that really sets us apart — you're always in control. Day one, your agents check with you before they do anything. Every text, every quote, every follow-up — you approve it first."
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            "But here's what happens. After a week or two, you start trusting them. You see the responses they write. They're good. Better than what most employees send. So you bump them up — now they can handle follow-ups on their own. A month later, they're booking appointments without asking. You just get the summary in the morning."
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            "It's like bringing on the best hire you've ever made. Except this one never forgets, never calls in sick, never makes the same mistake twice — and here's the real kicker — they don't just free up YOUR time. They work with EVERY person on your team."
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            "Your sales guy? The agents handle his follow-ups so he can close more. Your office manager? They take the scheduling off her plate so she can focus on customers. Your crews? They get better directions, fewer callbacks, tighter jobs. Every single person in your company gets more productive."
          </p>
          <p className="text-sm text-foreground leading-relaxed">
            "And the longer they're there, the more they learn about how YOUR business runs. Which leads are worth chasing. Which jobs actually make money. Where time gets wasted. It's not just automation — it's a team member that makes your whole team better, every single month. You steer, they work, everyone wins."
          </p>
          <div className="flex gap-2 pt-1">
            {["Always Ask", "Ask Sometimes", "Auto-Approve"].map((stage, i) => (
              <div key={i} className={`flex-1 rounded-lg p-2 text-center text-[10px] font-bold uppercase tracking-wide border ${
                i === 0 ? "bg-muted/60 border-border text-muted-foreground" :
                i === 1 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" :
                "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
              }`}>
                {stage}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-muted/30 border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">After demo:</p>
          <p className="text-sm text-foreground leading-relaxed">
            "So this handles your follow-ups, your scheduling, your customer communication — all the stuff eating your day. But it's bigger than that. You're gaining a team member that works alongside everyone in your company, making each person more productive. And the longer they're there, the better they get. Less overhead, more revenue, and your whole operation gets sharper every month. That's the compounding effect."
          </p>
        </div>
      </div>
    ),
  },
  {
    id: "ask",
    label: "The Ask",
    time: "20 sec",
    color: "border-orange-500",
    accent: "bg-orange-500",
    content: (
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm font-medium">Read the room. Two paths.</p>
        <div className="rounded-xl bg-green-500/10 border border-green-500/30 p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-green-400">Path A — Eyes lit up, asking questions</p>
          <p className="text-sm text-foreground leading-relaxed">
            "Here's what I'd suggest. We do a free 30-minute audit where we look at exactly where your time and money are leaking. No pitch, no pressure — we show you the numbers. If it doesn't make sense, we shake hands and part friends."
          </p>
          <p className="text-foreground font-semibold">"When works better — this week or next?"</p>
          <p className="text-xs text-green-400 font-bold uppercase tracking-wider">Book it. Get name, phone, email. Shake hands. LEAVE.</p>
        </div>
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-400">Path B — Skeptical or guarded</p>
          <p className="text-sm text-foreground leading-relaxed">
            "I get it, sounds too good. First 30 days are free. You don't pay a dime until you see it working in YOUR business. All I need is 30 minutes to show you the numbers."
          </p>
          <p className="text-foreground font-semibold">"Can I grab your card and reach out to schedule?"</p>
          <p className="text-xs text-amber-400 font-bold uppercase tracking-wider">Get card. Follow up within 24 hours.</p>
        </div>
        <div className="rounded-xl bg-muted/30 border border-border p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Path C — Not interested</p>
          <p className="text-sm text-foreground mt-1">"Appreciate your time. Here's my card."</p>
          <p className="text-xs text-muted-foreground font-semibold mt-1 uppercase tracking-wider">LEAVE CLEAN. Don't burn the bridge.</p>
        </div>
      </div>
    ),
  },
  {
    id: "objections",
    label: "Objections",
    color: "border-rose-500",
    accent: "bg-rose-500",
    content: (
      <div className="space-y-3">
        {[
          {
            q: "\"Sounds expensive.\"",
            a: "\"It's less than a part-time hire and works 24/7. First 30 days free. If it doesn't pay for itself, you walk away.\""
          },
          {
            q: "\"I need to think about it.\"",
            a: "\"Totally fair. What specifically do you need to think about?\" [Listen. Address it. Re-ask.]"
          },
          {
            q: "\"My current setup works fine.\"",
            a: "\"Most of our clients said that — until they saw what they were leaving on the table. Our agents find improvements you'd never see yourself. 30 minutes. Free audit. Worst case you get some good ideas.\""
          },
          {
            q: "\"I don't understand the tech.\"",
            a: "\"You don't need to. That's our job. You just run your business. We make the other stuff disappear.\""
          },
          {
            q: "\"We've been burned before.\"",
            a: "\"I hear that a lot. That's why we do the free audit first. No contract, no commitment, until YOU see the value.\""
          },
          {
            q: "\"I don't want AI sending things without me seeing it.\"",
            a: "\"Totally understand. And that's exactly why we built it the way we did. Day one, nothing goes out without your approval. Every text, every email, every quote — you see it first and hit approve or reject. Green button, red button, that's it.\n\nOver time, as you see the quality of what your agents produce, you decide how much autonomy they get. Some clients keep tight control. Others let their agents run almost everything within a month. You set the dial. You're always in control.\""
          },
        ].map((obj, i) => (
          <div key={i} className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-rose-400 font-semibold text-sm">{obj.q}</p>
            <p className="text-foreground text-sm leading-relaxed">{obj.a}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "remember",
    label: "Remember",
    color: "border-primary",
    accent: "bg-primary",
    content: (
      <div className="space-y-3">
        {[
          { num: "1", title: "CONFIDENCE", body: "You're offering them a lifeline, not begging." },
          { num: "2", title: "BREVITY", body: "2 minutes. Say less, listen more." },
          { num: "3", title: "OUTCOMES", body: "More revenue. Less headache. Zero overhead." },
          { num: "4", title: "THE ASK", body: "Book the audit or leave. No maybes." },
          { num: "5", title: "LEAVE CLEAN", body: "Every 'no' is practice for the next 'yes.'" },
        ].map((rule) => (
          <div key={rule.num} className="flex gap-4 items-start rounded-xl bg-primary/10 border border-primary/20 p-4">
            <span className="text-primary font-black text-2xl leading-none shrink-0">{rule.num}</span>
            <div>
              <p className="text-primary font-bold text-sm uppercase tracking-wider">{rule.title}</p>
              <p className="text-foreground mt-0.5 leading-relaxed">{rule.body}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
];

export default function ScriptPage() {
  const [current, setCurrent] = useState(0);
  const step = steps[current];
  const isFirst = current === 0;
  const isLast = current === steps.length - 1;

  return (
    <div className="flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary" />
          Walk-In Sales Script
        </h1>
        <p className="text-muted-foreground mt-1">MindVault · Commission reps · 2 min max</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1.5 mb-4">
        {steps.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setCurrent(i)}
            className={`h-2 rounded-full transition-all duration-200 ${
              i === current ? "w-8 bg-primary" : "w-2 bg-muted hover:bg-muted-foreground/50"
            }`}
            aria-label={s.label}
          />
        ))}
      </div>

      {/* Card */}
      <div className={`flex-1 rounded-2xl border-2 ${step.color} bg-card p-6 flex flex-col min-h-[400px]`}>
        {/* Card header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${step.accent}`} />
            <span className="font-bold text-lg text-foreground">{step.label}</span>
          </div>
          {step.time && (
            <div className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-muted-foreground">{step.time}</span>
            </div>
          )}
        </div>

        {/* Card content */}
        <div className="flex-1 overflow-y-auto">
          {step.content}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-4 pt-2">
        <Button
          variant="outline"
          onClick={() => setCurrent((c) => c - 1)}
          disabled={isFirst}
          className="flex items-center gap-2"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        <span className="text-sm text-muted-foreground font-medium">
          {current + 1} / {steps.length}
        </span>

        <Button
          onClick={() => setCurrent((c) => c + 1)}
          disabled={isLast}
          className="flex items-center gap-2"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
