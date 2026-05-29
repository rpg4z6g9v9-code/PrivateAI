# Creator Pipeline

Version: 1.0 (2026-05-28)
Status: Phase 1 — Script quality test

The Mac Mini is the local creator workstation. This document defines how to use it
to produce social media videos, YouTube shorts, music, thumbnails, and content packages
without cloud APIs, subscription tools, or autonomous publishing.

Creation = Level 3 (no approval needed).
Publishing = Level 4 (requires explicit approval).

---

## 1. Purpose

Most content creation tools are cloud-dependent, metered, or require account access.
This pipeline uses hardware you already own to do the same work locally:

- Scripts, ideas, captions, prompts → Hermes (local, $0)
- Video assembly, audio processing → Mac Mini + ffmpeg
- Voice generation → local TTS (future)
- Music, thumbnails → local tools (future)
- Review and publish → Pete approves every upload

The goal is a repeatable workflow where one idea becomes a complete content package
ready for human review — without touching cloud APIs or spending tokens on routine tasks.

---

## 2. Current tools

| Tool | Purpose | Status |
|------|---------|--------|
| Hermes (Ollama) | Scripts, ideas, lyrics, captions, prompts | Ready |
| ffmpeg | Video assembly, caption burn-in, audio mix | Available (Mac Mini) |
| macOS `say` | Quick voiceover prototype | Available |
| local TTS (Piper/Coqui) | Quality voiceover generation | Future |
| image generation (local) | Thumbnails, concept art, storyboards | Future |
| music generation (local) | Intro themes, background tracks | Future |

No paid integrations. No account access. No cloud dependencies for creation.

---

## 3. Workflow

Manual first. Automate only after each step is validated.

```
Idea
↓
Hermes → script draft
↓
Pete reviews + edits
↓
Mac Mini → voiceover (local TTS)
↓
Mac Mini → captions (ffmpeg subtitles)
↓
Mac Mini → video assembly (ffmpeg)
↓
Mac Mini → background music (future)
↓
Mac Mini → thumbnail (future)
↓
Pete reviews complete package
↓
Pete uploads (Level 4 — manual approval required)
```

At no point does the pipeline publish, post, or access accounts autonomously.

---

## 4. Phase plan

### Phase 1 — Script quality test
**Goal:** Hermes produces a script Pete would actually publish.
**Tools:** Hermes only.
**Success:** Pete reads the script and says "I'd publish this with light edits."
**Gate:** Do not proceed to Phase 2 until Phase 1 passes.

### Phase 2 — Voiceover test
**Goal:** Mac Mini generates audio from the approved script automatically.
**Tools:** macOS `say` or Piper/Coqui.
**Success:** Audio sounds usable. Timing fits the script.

### Phase 3 — Simple video assembly
**Goal:** Combine voice + background + captions into one video file.
**Tools:** ffmpeg.
**Success:** One complete short video, ready to review.

### Phase 4 — Background music
**Goal:** Add a locally generated music track to the video.
**Tools:** Local music generation tool (TBD).
**Success:** Music fits the mood, doesn't overpower the voice.

### Phase 5 — Thumbnail and image generation
**Goal:** Generate a thumbnail and supporting visuals locally.
**Tools:** Local image generation (TBD).
**Success:** Thumbnail is usable without manual design work.

### Phase 6 — Review package
**Goal:** Complete package (video + thumbnail + captions + description) ready for upload.
**Tools:** All above.
**Success:** Pete can upload directly without additional editing.

---

## 5. Success criteria

For any output to advance to the next phase, it must pass all four:

1. **Would Pete publish it?** If no, refine before proceeding.
2. **Did it save time?** If it took longer than doing it manually, identify the bottleneck.
3. **Did it avoid cloud cost?** All creation steps must be local. Cloud only for optional polish.
4. **Is it reusable?** Scripts, music, and prompts should be assets, not one-offs.

---

## 6. Not yet

These are explicitly out of scope until the pipeline is proven across all 6 phases:

- Auto-upload to YouTube, TikTok, Instagram
- Scheduled posting
- Ad spending or promotion
- Account access of any kind
- Autonomous channel management
- Replying to comments
- Revenue decisions

These are Level 4/5 actions. They require explicit approval gates that do not exist yet.
Do not build them until the creation pipeline is working and trusted.

---

## 7. First experiment

**Task:** Use Hermes to write one 30-second TikTok/YouTube Short script.

**Prompt to use:**
```
Write a 30-second TikTok script.

Topic: Stop paying for cloud AI — run it on your Mac Mini.
Audience: Normal people, not engineers. No jargon.
Hook: Grab attention in the first 3 seconds. Make me want to keep watching.
Message: Running AI locally on a Mac Mini is cheaper and more private than paying for ChatGPT or cloud subscriptions.
Call to action: One simple next step.

Rules:
- Do NOT write this like an AI commercial.
- Do NOT use phrases like "the future of AI", "revolutionary", "mind-blowing", or "personal AI assistant".
- Only mention things that actually exist and work today.
- Write it like you're explaining to a friend why you cancelled your AI subscription.
- Maximum 80 words.
```

**Success criteria:** Read the script. Ask: "Would I post this?" If yes, Phase 1 is done.

---

## Hermes script quality log

| # | Score | Notes |
|---|-------|-------|
| 1 | 6/10 | Mentioned Mac Mini, but too generic — could be any AI app |
| 2 | 4/10 | Full regression into generic AI marketing language |
| 3 | 6.5/10 | Recovering — genre-break prompt starting to work |
| 4 | 7.5/10 | Best yet — "No more paying for someone else's servers" is strong. Still overclaimed (smart home). |
| 5 | — | Next run — use prompt from Section 7 above |
