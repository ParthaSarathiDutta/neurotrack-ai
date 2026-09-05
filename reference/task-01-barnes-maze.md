# Task 1 — Barnes maze analysis pipeline

**Leans:** research software engineering
**Sample data:** [`data/barnes-maze/`](../data/barnes-maze/)

---

## The ask

> *From: a Salk core facility manager*
>
> Hi — we run the Barnes maze for four or five labs here. Every cohort is about
> 60 videos and right now a rotating student watches all of them with a
> stopwatch and a clicker, then types it into Excel. It takes days, two people
> never quite agree, and last year we found out one student had been counting
> nose-pokes differently from everyone else for a whole semester.
>
> Can you build us something that does it automatically? It needs to spit out a
> spreadsheet with latency and errors per animal. And please, it has to be
> something my students can actually use — the last pipeline someone built us
> was a Python notebook and nobody here can run it.

That is the real request, more or less verbatim in spirit. Build the thing.

---

## Background: what a Barnes maze is

A dry-land spatial memory assay, introduced by Carol Barnes in 1979 as a
"circular platform" task and now one of the standard rodent tests of
hippocampus-dependent spatial learning.

A mouse is placed in the center of a brightly lit, open circular platform ringed
with identical holes. Exactly one hole — the **target** — leads down into a dark
escape box; the rest open onto nothing. Mice dislike bright, open, exposed
spaces, so the animal is motivated to find the escape. Over repeated trials
across days, a mouse that is learning normally goes from wandering to heading
more or less straight to the right hole, using distal visual cues around the
room. Compared to the Morris water maze it is much less stressful for the
animal, which is a large part of why people use it.

The measures that go into papers are roughly:

- **Primary latency** — time until the animal first reaches the target hole.
- **Total latency** — time until it actually enters the escape box.
- **Primary / total errors** — investigations of non-target holes before the
  first target visit, and over the whole trial.
- **Path length and speed**, and time spent in the target quadrant.
- **Search strategy** — the qualitative shape of the search, usually binned into
  **spatial** (direct to target), **serial** (working around the ring hole by
  hole, in order), and **random** (crossing the middle, unsystematic). Strategy
  is often the most sensitive readout in the whole assay, and it is also the one
  most often scored by eye, inconsistently, by whoever is free that week.

Deciding what counts as "investigating a hole" is where scoring goes wrong.
Nose within some distance? Nose over the hole? Head dipped in? Two seconds of
sniffing versus a fly-past at speed? There is no single right answer in the
literature, and different labs use different ones — which is exactly why the
answer needs to be **explicit, visible, and adjustable in your tool** instead of
buried in a constant somewhere.

**References** (located via PubMed):

- Barnes CA (1979). Memory deficits associated with senescence: a
  neurophysiological and behavioral study in the rat. *J Comp Physiol Psychol*
  93(1):74–104. [DOI](https://doi.org/10.1037/h0077579) — the original.
- Gawel K, Gibula E, Marszalek-Grabska M, Filarowska J, Kotlinska JH (2019).
  Assessment of spatial learning and memory in the Barnes maze task in
  rodents — methodological consideration. *Naunyn Schmiedebergs Arch Pharmacol*
  392(1):1–18. [DOI](https://doi.org/10.1007/s00210-018-1589-y) —
  open access, and the single best thing to read if you read one. Covers
  protocol variants, the parameters people report, and the confounds.
- Illouz T, Madar R, Okun E (2020). A modified Barnes maze for an accurate
  assessment of spatial learning in mice. *J Neurosci Methods* 334:108579.
  [DOI](https://doi.org/10.1016/j.jneumeth.2020.108579) — good on
  search strategies and why serial search is a nuisance.

You do not need to become a behavioral neuroscientist by Tuesday. Skim enough to
know what the numbers mean, because a tool that computes the right quantity with
the wrong definition is worse than no tool.

---

## What it needs to do

Roughly in the order a user would hit them. All of it should be reachable
without a terminal.

**No authentication required for this task** — unlike the other two. This is a
single-user analysis tool, and a static client-side page with no account and no
server is the ideal shape for it. Do not build a login screen.

### Load videos
Drag and drop, or point at a folder. Multiple videos in a session. Remember
where the user was if they close the tab — losing forty minutes of annotation to
an accidental refresh is the kind of thing that makes people stop using a tool
forever.

### Define ROIs
The user marks the **platform boundary**, the **holes**, and **which hole is the
target**. Twenty holes per video, times sixty videos per cohort, is twelve
hundred of something — so if your answer is twelve hundred clicks, the facility
will go back to the stopwatch. Think hard about this step. It is the first thing
a user touches, it is the most tedious part of the whole job, and how much work
you can take off them here is one of the clearest reads we get on whether you
were designing for them or for yourself.

Real-world coordinates matter too — a platform diameter in centimeters turns
pixels into distances, and path length in pixels is not something anyone can put
in a paper.

### Track the animal
Get the mouse's position over time. This is a computer vision problem and you
have latitude in how you solve it — classical background subtraction, a
segmentation model like SAM, an off-the-shelf pose estimator, something running
in ONNX in the browser, something on a server you deployed. All are legitimate.

What we care about:

- **It works on all three sample videos**, which do not look identical.
- **No GPU is assumed**, and no local install is required of the user.
- **It is honest about uncertainty.** Frames where tracking failed should be
  marked as failed, not silently interpolated into a plausible lie.
- Ideally you distinguish more than a centroid — nose versus body matters when
  the measure is "did it poke its nose in the hole."

Speed matters in the sense that a user will not wait twenty minutes per video
without a progress bar and a reason to trust it.

### Clean up and validate
Gap filling, smoothing, outlier rejection — with the parameters visible and the
effect on the data shown, not applied invisibly. A quality report per video
(what fraction of frames tracked, where the failures cluster) so the user knows
whether to trust the output before they build a figure on it.

### Correct by hand
Non-negotiable. Automated tracking will be wrong somewhere in every cohort, and
a pipeline with no manual override is a pipeline the facility cannot use for
publication. The user needs to scrub to a frame, see the overlay, fix the point
or the event, and have everything downstream update. Frame-accurate seeking is
part of this and is genuinely fiddly in a browser — see the `video-player` vibe.

Corrections must survive a reload, and it should be obvious afterward which
values were automatic and which a human touched.

### Detect events
Hole investigations and escape-box entries, from the trajectory and the ROIs,
with thresholds the user can see and change and immediately see the consequence
of. Investigating a hole and going into it are different events with different
evidence behind them, and how you draw that line is yours to work out and to
defend.

The hard part is not detection, it is that **entering a hole makes the animal
disappear**. Your tracker losing the mouse and the mouse being inside the escape
box look identical to a naive pipeline and mean opposite things.

### Compute the measures
Primary and total latency, primary and total errors, path length, speed, time in
the target quadrant, and a **search strategy classification** per trial with the
reasoning shown. Do not just print a strategy label — show the user why, and let
them override it.

### Visualize, generously
The brief says visualizations galore and means it. Trajectory overlays, path
plots colored by time, occupancy heat maps, a hole-visit raster over the trial,
per-animal learning curves across days, cohort comparisons. This is the part
where a scientist decides whether they trust you, and it is also the part they
will screenshot into a figure — so think about export resolution and about
whether your colors survive being printed in grayscale.

### Export
CSV and XLSX that a person can open in Excel and understand without a legend:
one tidy row per trial for stats, plus the per-event detail. Include the
parameters and tool version used, because in six months someone will ask why two
cohorts disagree and the answer will be a threshold.

Whatever your intermediate representation is, make it a documented, reloadable
file. The facility will want to re-run analysis without re-tracking.

---

## What your demo has to show

Concretely, so there is no ambiguity about the bar:

**All three sample videos, analyzed end to end, in the demo video.** Not one
video and an assurance that the others work. Load them, define the ROIs, track,
correct something by hand, detect the events, and get to numbers — for
`test50`, `test51`, and `test53`.

**A results report and a downloadable CSV, produced live.** By the end of the
recording we want to have watched the spreadsheet come out. Commit the actual
generated outputs for the three clips into your repo as well, so we can read
them without re-running anything: the per-trial summary, the per-event detail,
and whatever report your tool produces.

We are not expecting the numbers to be *right* in any absolute sense — there is
no ground truth in this folder, on purpose, and reasonable pipelines will
disagree. We are looking at whether the whole path holds together on three
videos that were not chosen to be convenient, and whether your tool is honest
about the places it struggled.

---

## What "good" looks like

The bar is not feature count. It is:

- A student who has never seen it can go from a folder of videos to a
  spreadsheet in one sitting, without asking anyone for help.
- The numbers it produces are defensible — the definitions are visible, the
  thresholds adjustable, the failures flagged rather than hidden.
- The second video is faster to process than the first, because the tool learned
  something from the first.
- Someone who disagrees with a result can go find the frame it came from.

Common ways to lose: an impressive model behind an interface only you can
operate; silent interpolation that produces beautiful, wrong trajectories;
hard-coding to `test50.mp4`; and building the analysis but not the correction
step.

## If you have room

Not required, and not worth sacrificing the core for.

- Batch processing across a cohort with a queue and progress.
- Cross-video hole-map reuse and automatic maze registration.
- Inter-rater comparison: two humans score the same video, show the drift.
- Model-assisted labeling — let the user correct a few frames, retrain, improve.
- An MCP server so a scientist can ask Claude for a cohort summary.
- Interop with [SLEAP](https://sleap.ai) `.slp` files, or with DeepLabCut /
  ezTrack / AnyMaze exports, so this drops into existing pipelines.
