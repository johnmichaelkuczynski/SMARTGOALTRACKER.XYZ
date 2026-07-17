import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  db,
  projectsTable,
  projectMessagesTable,
  projectDocumentsTable,
} from "@workspace/db";

const router: IRouter = Router();
const MODEL = "gpt-5.4";

// ── Projects CRUD ─────────────────────────────────────────────────────────────

router.get("/projects", async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.userId, userId))
      .orderBy(desc(projectsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Failed to load projects" });
  }
});

router.post("/projects", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  try {
    const [project] = await db
      .insert(projectsTable)
      .values({
        id: randomUUID(),
        userId,
        name: name.trim(),
        description: description?.trim() ?? "",
      })
      .returning();
    res.json(project);
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Failed to create project" });
  }
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [messages, documents] = await Promise.all([
      db
        .select()
        .from(projectMessagesTable)
        .where(eq(projectMessagesTable.projectId, id))
        .orderBy(projectMessagesTable.createdAt),
      db
        .select()
        .from(projectDocumentsTable)
        .where(eq(projectDocumentsTable.projectId, id))
        .orderBy(desc(projectDocumentsTable.createdAt)),
    ]);
    res.json({ project, messages, documents });
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Failed to load project" });
  }
});

router.put("/projects/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  const { name, description } = req.body as { name?: string; description?: string };
  try {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (name?.trim()) patch.name = name.trim();
    if (description !== undefined) patch.description = description.trim();
    const [project] = await db
      .update(projectsTable)
      .set(patch)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
      .returning();
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(project);
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Failed to update project" });
  }
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    await db
      .delete(projectMessagesTable)
      .where(eq(projectMessagesTable.projectId, id));
    await db
      .delete(projectDocumentsTable)
      .where(eq(projectDocumentsTable.projectId, id));
    await db
      .delete(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

// ── AI Chat ───────────────────────────────────────────────────────────────────

router.post("/projects/:id/chat", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "Message is required" });
    return;
  }
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [history, documents] = await Promise.all([
      db
        .select()
        .from(projectMessagesTable)
        .where(eq(projectMessagesTable.projectId, id))
        .orderBy(projectMessagesTable.createdAt),
      db
        .select()
        .from(projectDocumentsTable)
        .where(eq(projectDocumentsTable.projectId, id)),
    ]);

    const [userMsg] = await db
      .insert(projectMessagesTable)
      .values({
        id: randomUUID(),
        projectId: id,
        userId,
        role: "user",
        content: message.trim(),
      })
      .returning();

    const docContext = documents.length
      ? documents
          .map((d) => {
            const body = (d.content || d.extractedText || "").slice(0, 6000);
            return `### DOCUMENT: ${d.name}\n${body || "(no content)"}`;
          })
          .join("\n\n")
      : "";

    const convo = [
      ...history
        .slice(-30)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: message.trim() },
    ];

    const systemPrompt = `You are a strategic advisor and dedicated thinking partner for a specific long-term project. Your job is to help the user achieve real results.

PROJECT: "${project.name}"
${project.description ? `DESCRIPTION: ${project.description}` : ""}
${docContext ? `\nPROJECT DOCUMENTS:\n${docContext}` : ""}

Your approach:
- Give concrete, specific advice tailored to THIS project — never generic platitudes
- Be honest about risks, blockers, and what you observe about the user's approach
- Ask sharp clarifying questions when you need more information
- Help the user break ambiguity into clear next actions
- Notice patterns in how they talk about challenges: avoidance, perfectionism, scope creep, etc.
- Challenge assumptions when warranted — be a thinking partner, not a yes-man
- When asked about psychology or self-insight, be specific and grounded in what they've actually said
- Keep replies tight and actionable; go deep only when the user clearly wants it`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...convo],
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() ??
      "I'm not sure how to respond — try rephrasing.";

    const [aiMsg] = await db
      .insert(projectMessagesTable)
      .values({
        id: randomUUID(),
        projectId: id,
        userId,
        role: "assistant",
        content: reply,
      })
      .returning();

    await db
      .update(projectsTable)
      .set({ updatedAt: new Date() })
      .where(eq(projectsTable.id, id));

    res.json({ userMessage: userMsg, assistantMessage: aiMsg });
  } catch (err) {
    req.log.error({ err }, "Project chat failed");
    res.status(500).json({ error: "Chat failed. Try again." });
  }
});

// ── Documents ─────────────────────────────────────────────────────────────────

router.get("/projects/:id/documents", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const docs = await db
      .select()
      .from(projectDocumentsTable)
      .where(eq(projectDocumentsTable.projectId, id))
      .orderBy(desc(projectDocumentsTable.createdAt));
    res.json(docs);
  } catch (err) {
    req.log.error({ err }, "Failed to list project documents");
    res.status(500).json({ error: "Failed to load documents" });
  }
});

router.post("/projects/:id/documents", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  const {
    name,
    content,
    contentType,
  } = req.body as { name?: string; content?: string; contentType?: string };
  if (!name?.trim() || !content?.trim()) {
    res.status(400).json({ error: "Name and content are required" });
    return;
  }
  try {
    const [project] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [doc] = await db
      .insert(projectDocumentsTable)
      .values({
        id: randomUUID(),
        projectId: id,
        userId,
        name: name.trim(),
        content: content.trim(),
        contentType: contentType ?? "text/plain",
        extractedText: "",
        objectPath: "",
        size: BigInt(content.trim().length) as unknown as number,
      })
      .returning();
    res.json(doc);
  } catch (err) {
    req.log.error({ err }, "Failed to add project document");
    res.status(500).json({ error: "Failed to save document" });
  }
});

router.delete("/projects/:id/documents/:docId", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id, docId } = req.params;
  try {
    await db
      .delete(projectDocumentsTable)
      .where(
        and(
          eq(projectDocumentsTable.id, docId),
          eq(projectDocumentsTable.projectId, id),
          eq(projectDocumentsTable.userId, userId),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete project document");
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get("/projects/:id/analytics", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const messages = await db
      .select()
      .from(projectMessagesTable)
      .where(eq(projectMessagesTable.projectId, id))
      .orderBy(projectMessagesTable.createdAt);

    const userMessages = messages.filter((m) => m.role === "user");

    const dayMap = new Map<string, number>();
    for (const m of userMessages) {
      const day = new Date(m.createdAt).toISOString().slice(0, 10);
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }
    const activeDaysSorted = [...dayMap.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    let streak = 0;
    let longestStreak = 0;
    let prevDate: Date | null = null;
    for (const [day] of activeDaysSorted) {
      const d = new Date(day);
      if (prevDate) {
        const diff = (d.getTime() - prevDate.getTime()) / 86_400_000;
        streak = diff <= 1 ? streak + 1 : 1;
      } else {
        streak = 1;
      }
      if (streak > longestStreak) longestStreak = streak;
      prevDate = d;
    }

    const now = Date.now();
    const last30 = now - 30 * 24 * 60 * 60 * 1000;
    const recentActiveDays = activeDaysSorted.filter(
      ([day]) => new Date(day).getTime() >= last30,
    ).length;

    const chartData: { label: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      chartData.push({
        label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        count: dayMap.get(key) ?? 0,
      });
    }

    // Weekly chart: last 12 weeks
    const weekData: { label: string; count: number }[] = [];
    for (let w = 11; w >= 0; w--) {
      const weekStart = new Date(now - (w * 7 + 6) * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(now - w * 7 * 24 * 60 * 60 * 1000);
      let count = 0;
      for (const m of userMessages) {
        const t = new Date(m.createdAt).getTime();
        if (t >= weekStart.getTime() && t < weekEnd.getTime()) count++;
      }
      weekData.push({
        label: `W${12 - w}`,
        count,
      });
    }

    res.json({
      totalMessages: userMessages.length,
      activeDays: activeDaysSorted.length,
      currentStreak: streak,
      longestStreak,
      recentActiveDays,
      firstActivity: messages[0]?.createdAt ?? null,
      lastActivity: messages[messages.length - 1]?.createdAt ?? null,
      chartData,
      weekData,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project analytics");
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ── Profile Me ────────────────────────────────────────────────────────────────

router.post("/projects/:id/profile", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { id } = req.params;
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.userId, userId)))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const [messages, documents] = await Promise.all([
      db
        .select()
        .from(projectMessagesTable)
        .where(eq(projectMessagesTable.projectId, id))
        .orderBy(projectMessagesTable.createdAt),
      db
        .select()
        .from(projectDocumentsTable)
        .where(eq(projectDocumentsTable.projectId, id)),
    ]);

    if (messages.length < 3) {
      res.status(400).json({
        error:
          "Need at least 3 messages to generate a profile. Keep the conversation going!",
      });
      return;
    }

    const conversationText = messages
      .map((m) => `${m.role === "user" ? "USER" : "ADVISOR"}: ${m.content}`)
      .join("\n\n")
      .slice(0, 18000);

    const docSummary = documents
      .map((d) => `"${d.name}": ${(d.content || d.extractedText || "").slice(0, 800)}`)
      .join("\n");

    const prompt = `You are a perceptive psychologist and strategist. Based solely on the conversation below, write a detailed psychological profile of the user specifically in relation to their project "${project.name}".

Project description: ${project.description || "(none)"}
${docSummary ? `\nDocuments the user has attached:\n${docSummary}\n` : ""}
Conversation:
${conversationText}

Write a profile covering these sections:

**1. Drive & Motivation**
What genuinely motivates them on this project? What energizes vs. drains them?

**2. Follow-Through Patterns**
How consistent are they? Where do they tend to stall, defer, or avoid?

**3. Decision-Making Style**
Analytical or intuitive? Risk-averse or bold? Do they seek information or trust gut?

**4. Innovation & Creativity**
Do they challenge assumptions? Think in new ways, or default to proven paths?

**5. Risk Profile**
How comfortable are they with uncertainty? What risks do they minimise or overlook?

**6. Blocking Patterns**
What psychological patterns are most likely to derail this specific project?

**7. Strategic Strengths**
What genuine strengths do they bring that they should double down on?

**8. Recommended Focus**
One or two specific behavioural changes that would give this project its best chance.

Be specific, honest, and grounded in what they've actually said. A sharp friend, not a flatterer. No generic advice.`;

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
    });

    const profile =
      completion.choices[0]?.message?.content?.trim() ??
      "Could not generate profile.";
    res.json({ profile });
  } catch (err) {
    req.log.error({ err }, "Profile generation failed");
    res.status(500).json({ error: "Profile generation failed. Try again." });
  }
});

export default router;
