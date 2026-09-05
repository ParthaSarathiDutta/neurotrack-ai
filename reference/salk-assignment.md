# Salk AIRC: Research Software Engineer take-home

Center for AI and Research Computing · Salk Institute for Biological Studies
Requisition **RESEA002823** · Research Software Engineer I

This take-home is your opportunity to show how you define,
build, and ship research software with AI coding agents.

---

## The short version

| | |
|---|---|
| **Complete** | at least one of the [three tasks](#the-tasks) |
| **Sent** | Monday, August 31, 2026 |
| **Due** | **Tuesday, September 8, 2026, 9:00 AM Pacific** |
| **Submit** | a GitHub repo link, emailed to **talmo@salk.edu** |
| **Private repo?** | Fine; add **`talmo`** as a collaborator. |
| **After** | approximately ten candidates will be invited to interview |

Use any stack, language, or architecture that gets you to a working product
your user can operate.

If something in here is ambiguous, resolve it however you think best and say so
in your README. Deciding what the request means is part of the job. We will
answer questions about genuine blockers, but product and technical decisions
are yours to make.

---

## The tasks

Each task comes from work requested by people at the Institute.

| | Task | Leans | The one-line version |
|---|---|---|---|
| **1** | [Barnes maze analysis pipeline](tasks/01-barnes-maze.md) | research software | Turn a folder of behavior videos into a spreadsheet a neuroscientist can use in a paper, with no terminal required. |
| **2** | [Animal colony manager](tasks/02-colony-manager.md) | software engineering | Build a phone-friendly system for tracking mice, cages, cleaning, and staff coverage in the vivarium. |
| **3** | [AlphaFold front end](tasks/03-alphafold-frontend.md) | ML infrastructure | Build an approachable interface for a GPU job with a real queue behind it. |

The tasks emphasize different parts of the role and use the same evaluation
criteria. Complete at least one. A strong, deeply developed solution can score
very well on its own. Go beyond the brief when you see a useful opportunity. If
you want to demonstrate versatility, you may complete more than one task. We
will consider the quality and range of everything you submit.

Sample data for Task 1 is in [`data/barnes-maze/`](data/barnes-maze/). Tasks 2
and 3 need no data from us; invent what you need, and make it plausible.

---

## Cross-cutting requirements

These requirements apply to **all three** tasks.

### 1. Usability

This is central to the role. We will evaluate your interface by opening it cold
and trying to complete the task as its intended user.

Design for a scientist who does not want to become a software operator. Assume:

- **They will not open a terminal**, including to start your app.
- **They are not confident with file systems.** "Put the CSV in `./data/raw/`"
  is, for a real fraction of our users, a genuine obstacle.
- **They will not install Python**, or conda, or Docker, or Node.
- **They may use it four times a year** and forget the workflow between uses.
- **They may be using a laptop the lab bought in 2019.** Assume no GPU and no
  admin rights.

A **static, client-side page** is a strong fit for many of these constraints. It
can open in a browser with no installation, server, or account. If the task
requires a backend, prefer a deployed service that the user visits by URL. Keep
the installation and maintenance burden away from the scientist.

### 2. Authentication

**Tasks 2 and 3 need it.** They are shared internal services holding data that
belongs to particular people, so they have to know who you are.

Use **OIDC**, and demonstrate it with **GitHub** as the identity provider.
"Sign in with GitHub" is fine and expected. At Salk this would be Entra ID or
Okta behind the same protocol. We care that you implemented a real OIDC flow and
considered its consequences, not which provider is on the other end.
Authentication must be paired with authorization because different people need
different permissions over the same records. Explain how to obtain the required
credentials in your README, and do not commit secrets.

**Task 1 is exempt.** It is a single-user analysis tool. A static client-side
page needs no account or server, so do not add authentication unless you build a
server-backed version with shared state or stored results.

### 3. It has to run

Your project must run from a cold clone on someone else's machine using only the
instructions in your README.

- Clear, complete, honest setup instructions.
- Pin your dependencies.
- **A live deployment is strongly encouraged.** GitHub Pages, Cloudflare
  Workers/Pages, Fly.io, Vercel, and Modal are all reasonable options. A URL we
  can open proves the project runs and makes it easier to evaluate.
- If some part cannot be deployed publicly, say so and show it working in the
  video below.

**A 2 to 3 minute demo video is required.** Show the intended user completing
the core task from start to finish. Link it from the top of your README. An
unlisted YouTube video, Loom recording, or file in the repo is fine.

The video lets us see the interface in use and provides a fallback if the live
deployment is unavailable. Do not edit out slow or awkward parts of the
workflow.

[Screen Studio](https://screen.studio) is excellent on macOS,
[ScreenToGif](https://www.screentogif.com) on Windows. QuickTime and OBS are
free and completely fine. Polish is not scored.

**Ship it with demo state.** Within about sixty seconds, we should be able to
see the product doing something real without creating an account, entering
data, or hunting for files. Seed it, include fixtures, or add a "load example"
button. An empty app with a working *Add* button does not provide enough to
evaluate.

### 4. Use AI coding agents deliberately

Fluency with agentic coding tools is a stated requirement of this job. Use the
tools you would use in the role. We are evaluating the result and how well you
directed, checked, and extended the agents' work.

The task requirements are a starting point. Strong submissions use the leverage
from these tools to add meaningful depth, polish, or capability.

In your repo, include a short **`AI_NOTES.md`** covering:

- Which tools and models you used, and how you set them up (`CLAUDE.md`,
  subagents, hooks, custom slash commands, MCP servers, or other configuration).
- **Two or three specific moments** where you and the model disagreed, or it
  produced something wrong, or you threw out its approach and did it yourself.
  What was the tell? How did you catch it?
- What you checked before believing it worked.

Keep it under a page. We are interested in your judgment and how you direct the
tools. Session transcripts or `.specstory`-style logs are optional.

**Honesty policy:** generated work is allowed. You must understand and be able
to defend everything you submit. Expect to walk through your code in the
interview and explain your decisions.

### 5. Where the data goes, and what it costs

Include two short paragraphs in your README covering the following topics.

**What leaves the user's machine.** Name anything sent to a third party and
explain the decision. Research data carries real handling constraints — animal
records sit under an IACUC protocol, and plenty of institutional data cannot
leave the building at all — so data handling is part of the design rather than
an afterthought. A hosted vision API may be a reasonable choice if you identify
and justify the tradeoff.

**Keys and cost.** If your submission needs an API key, tell us which one, how
to get it, and roughly what a representative run costs. It must **degrade
gracefully without one** through a demo path, cached results, a mock, or a
similar approach. If the design would cost the Institute money at scale,
estimate that cost.

### 6. Accessibility and devices

Meet these minimum accessibility requirements:

- Keyboard navigable. Nothing essential reachable only by hover or drag.
- Legible contrast. Do not encode meaning in color alone; some users cannot
  distinguish red from green.
- Usable at 200% browser zoom.
- Sensible labels on controls, so a screen reader is not reading `button`.

**Task 2 additionally has to work on a real phone**, in a browser, held in one
hand. Test it on an actual device rather than a resized desktop window. Test
**iOS Safari specifically**, since that is the browser most people in the
vivarium will use.

### 7. Optional agent interface

An **MCP server** or **Claude skill** that lets someone operate your product
through Claude or ChatGPT is one way to stand out. For example: "Pull the
strategy summary for cohort B and put it in a sheet."

---

## Reference

Our [`talmolab/vibes`](https://github.com/talmolab/vibes) repository contains
small, browser-based research tools that may provide useful patterns, especially
for Task 1. Borrow patterns freely, but do not submit a copy of an existing
tool.

---

## What your repo should contain

- **`README.md`:** what it does, who it is for, how to run it, and what you
  chose not to build and why. Put the **demo video link and live URL at the
  top.**
- **A "Known limitations" section**, in the README or its own file. Distinguish
  known defects from deliberately excluded scope. Be specific. For example,
  "hole detection fails when the platform is off-center, see `test51`" is more
  useful than "could be more robust."
- **`AI_NOTES.md`:** as described above.
- **Your `.claude/` directory, `CLAUDE.md`, skills, commands, MCP configs**, if
  you built any. This configuration helps us understand how you used the tools.
  Do not gitignore it.
- **Real commit history.** Do not squash the project into one `initial commit`.
  Preserve the history of how the work developed.
- **The code**, with whatever tests and CI you think the thing warrants.
- **A license.** A permissive license allows us to build on work we find useful.

Do not commit large binaries, secrets, or the sample videos to your own repo.
Link to this repository instead.

---

## How we will evaluate it

We will use the following criteria across every task.

| Dimension | What we are looking for |
|---|---|
| **User alignment and usability** | Can the intended user complete the full workflow without a terminal or your help? Does the product reflect how scientists actually work? |
| **Creativity and ambition** | Did you find useful opportunities beyond the feature list? Do the additions make the product more effective rather than merely larger? |
| **Execution and reliability** | Does it run from a cold clone using the README? Is there a working deployment or a clear demo of the complete workflow? |
| **Engineering quality** | Is the code readable, maintainable, and resilient? Are error handling, tests, git history, and CI appropriate for the project? |
| **AI-assisted development** | Did you use agents effectively and apply sound judgment to their output? Is that leverage visible in the finished product? |
| **Judgment and domain engagement** | Did you understand the scientific or operational problem, make deliberate tradeoffs, and document real limitations? |
| **Motivation and follow-through** | Does the submission show initiative, attention to detail, and a high standard of completion? Depth on one task, meaningful extensions, and strong work across multiple tasks can all demonstrate this. |

An MCP server or agent skill, a live deployment, and other useful work beyond
the brief can strengthen a submission.

A note on what we are *not* scoring: framework choice, test coverage percentage,
line count, commit count, or whether your CSS is fashionable.

---

## Ground rules

- **The work should be yours** in the sense that you directed it, understand it,
  and can defend it. Agents, libraries, Stack Overflow, and your friend who
  knows React are all fine. Handing the brief to another person is not.
- **Do not commit secrets.** If you leak an API key, rotate it and disclose the
  incident in your submission.
- **Accessibility and licensing:** respect the licenses of what you pull in.
- **If a serious issue affects your submission**, such as illness, a family
  emergency, or hardware failure, email us.

## Submitting

Email the repo link to **talmo@salk.edu** by **9:00 AM Pacific on Tuesday,
September 8**. Private repos are fine; add **`talmo`** as a collaborator.

**We will confirm receipt within 24 hours.** If you have not heard back, email
again in case the first message was filtered.

## Questions

Genuine blockers (broken data files, a link that 404s, an accessibility need):
**talmo@salk.edu**. Design questions: make a call and document it.

## Terms

The exercise materials in this repo are provided for the purpose of this hiring
process. You may keep and publish your own submission afterward. See
[`data/barnes-maze/README.md`](data/barnes-maze/README.md) for the origin of the
sample videos.

Good luck. We look forward to reviewing your work.
