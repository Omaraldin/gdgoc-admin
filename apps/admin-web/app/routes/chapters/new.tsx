import { useState } from "react";
import { useNavigate, useLoaderData } from "react-router";
import { createChapter, assignLeader, listUsers } from "~/lib/api/admin";
import type { User } from "~/lib/types";

export function meta() {
  return [{ title: "New Chapter | GDGoC Admin" }];
}

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent } from "~/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "~/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "~/lib/utils";

export async function clientLoader() {
  const users = await listUsers();
  return { users };
}

export default function NewChapterPage() {
  const { users } = useLoaderData<typeof clientLoader>() as { users: User[] };
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sinceYear, setSinceYear] = useState("");
  const [leaderCodename, setLeaderCodename] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [leaderOpen, setLeaderOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedSinceYear = sinceYear.trim() === "" ? undefined : Number.parseInt(sinceYear, 10);
      const ch = await createChapter({
        name,
        email,
        code: code.toUpperCase().trim() || undefined,
        since_year: Number.isFinite(parsedSinceYear) ? parsedSinceYear : undefined,
        leader_codename: leaderCodename.trim() || undefined,
      });
      if (leaderId) {
        await assignLeader(ch.id, leaderId);
      }
      navigate(`/chapters/${ch.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-6 text-foreground">New Chapter</h1>
      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-ch-name">Chapter Name *</Label>
              <Input id="new-ch-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-ch-code">Chapter Code</Label>
              <Input
                id="new-ch-code"
                placeholder="e.g. ALGIERS"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">Short uppercase abbreviation used in certificate IDs.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-ch-email">Chapter Email *</Label>
              <Input id="new-ch-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-ch-since-year">Since Year</Label>
              <Input
                id="new-ch-since-year"
                type="number"
                min={1900}
                max={9999}
                value={sinceYear}
                onChange={(e) => setSinceYear(e.target.value)}
                placeholder="e.g. 2020"
              />
              <p className="text-xs text-muted-foreground">Year of the chapter's first season.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-ch-leader-codename">Leader Codename</Label>
              <Input
                id="new-ch-leader-codename"
                value={leaderCodename}
                onChange={(e) => setLeaderCodename(e.target.value.toUpperCase())}
                placeholder="e.g. ABDOU"
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">Codename used for certification ID generation.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Chapter Leader</Label>
              <Popover open={leaderOpen} onOpenChange={setLeaderOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={leaderOpen}
                    className="w-full justify-between font-normal"
                  >
                    {leaderId
                      ? (() => {
                          const u = users.find((u) => u.id === leaderId);
                          return u ? `${u.name} (${u.email})` : "— No leader assigned —";
                        })()
                      : "— No leader assigned —"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search users…" />
                    <CommandList>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value=""
                          onSelect={() => { setLeaderId(""); setLeaderOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", leaderId === "" ? "opacity-100" : "opacity-0")} />
                          — No leader assigned —
                        </CommandItem>
                        {users.map((u) => (
                          <CommandItem
                            key={u.id}
                            value={`${u.name} ${u.email}`}
                            onSelect={() => { setLeaderId(u.id); setLeaderOpen(false); }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", leaderId === u.id ? "opacity-100" : "opacity-0")} />
                            <span>{u.name}</span>
                            <span className="ml-1.5 text-muted-foreground text-xs">{u.email}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "Creating…" : "Create Chapter"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
