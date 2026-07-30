# AI benchmark animation — data sources

Figures used by `tools/ai_benchmark_animation.py`, as published July 2026.

**Caveat that applies to nearly every number here:** most are vendor-reported and
were not independently replicated. GPT-5.6 was benchmarked under gated preview
access, so no independent lab verified those scores. Claude Fable 5's 95.0 on
SWE-bench Verified is single-sourced. SWE-bench Verified, SWE-bench Pro and
Terminal-Bench are different benchmarks and their scores are not interchangeable.

## Sources

- Artificial Analysis — *GPT-5.6 has landed*: Intelligence Index (Fable 5 60,
  Sol 59, Terra 55, Luna 51), Coding Agent Index, cost per task
  (Sol $1.04 / Terra $0.55 / Luna $0.21)
  https://artificialanalysis.ai/articles/gpt-5-6-has-landed
- DataCamp — *Claude Opus 5 vs Fable 5*: SWE-bench Verified 96.0 / 95.0,
  SWE-bench Pro 79.2 / 80.3, ARC-AGI-3 30.2, Terminal-Bench 2.1 Fable 5 88.0
  https://www.datacamp.com/blog/claude-opus-5-vs-claude-fable-5
- anycap.ai — *GPT-5.6 Benchmarks: Sol, Terra & Luna*: SWE-bench Pro
  (Sol 64.6 / Terra 63.4 / Luna 62.7), Terminal-Bench 2.1
  (Sol ultra 91.9 / Sol 88.8 / Terra 87.4 / Luna 84.7), GPQA Diamond
  (Sol 94.6 / Fable 5 92.6 / Luna 92.3), ARC-AGI-3 (Sol 7.78, Opus 4.8 1.5,
  GPT-5.5 0.43)
  https://anycap.ai/page/en-US/ai/gpt-5-6-benchmarks-sol-terra-luna
- LM Council — *AI Model Benchmarks Jul 2026*: SWE-bench Verified
  (Opus 4.7 83.5, GPT-5.5 80.6, Gemini 3.5 Flash 79.3), GPQA Diamond
  (GPT-5.4 Pro 94.6, GPT-5.5 94.0)
  https://lmcouncil.ai/benchmarks
- divkix.me — *Best AI Models July 2026*: Grok 4.5 SWE-bench Pro 64.7,
  cost/task $1.12; Claude Opus 4.8 SWE-bench Pro 69.2, cost/task $8.26
  https://divkix.me/blog/ai-models-compared-2026/
- Gemini 3.1 Pro (SWE-bench 80.6, GPQA Diamond 94.3) and DeepSeek V4-Pro
  (SWE-bench Verified 80.6) per July 2026 comparison coverage
  https://tech-insider.org/chatgpt-vs-claude-vs-deepseek-vs-gemini-2026/

## Known conflicts

- **Fable 5 on Terminal-Bench 2.1** is reported as 88.0 (DataCamp), 84.3
  (divkix) and 83.1 (anycap). The animation uses 88.0.
- **Fable 5 on SWE-bench Pro** is reported as 80.3, 80.4 and 80.0 across
  sources. The animation uses 80.3.

## Design notes

Vendor colours are drawn from the dataviz reference palette's dark-mode
categorical slots. No five-colour subset of that palette clears the all-pairs
CVD gate on a dark surface, so vendors are capped at four coloured groups
(Anthropic, OpenAI, Google, xAI) with the remainder pooled into a neutral
"Other". The passing four-hue subset — blue / yellow / magenta / green — was
selected by running `scripts/validate_palette.js` over every candidate subset.
Every bar also carries a direct name and value label, so identity never rests
on colour alone.
