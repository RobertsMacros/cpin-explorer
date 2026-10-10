# Windows handover update — 10 October 2026

The private local trial has now run. The original eight-case 4B test passed six cases and failed both evidence-gap controls. A separately authorised stronger-model test covered twelve cases with Qwen3-8B and Mistral-7B reviewing every output. Both matched ten calibration labels, but missed a planted negation and confused two statistical indicators. The reviewer accepted the primary errors. Suitability remains blocked; no expansion is authorised.

An independent program checked all twenty-four completed answers; its 339 adversarial checks passed. This gate verifies structure and supplied evidence correspondence, not semantic truth. Private inputs, separate calibration keys, source objects, prompts, outputs, journals and failures remain outside this repository. Do not publish them or feed calibration labels into a model.

Observed PC: Ryzen 5 3600, approximately 16 GiB RAM, Radeon RX 5700 with 8176 MiB graphics memory. Portable llama.cpp build 11146 is retained locally. Nonmapped Vulkan loading resolved observed memory pressure; two stopped attempts remain preserved.

The owner has authorised downloading Qwen2.5-Coder-14B-Instruct Q4_K_M for future coding work. This does not authorise another CPIN inference trial. Download completion and hash verification must be read from its private receipt. Coding performance is unmeasured.

## Later the same day (Claude Code)

**Reasoning-enabled retry.** At the owner's request the same twelve frozen cases were run once on Qwen3-8B with reasoning enabled, using the frozen prompts with only the reasoning-off switches removed, the same gate unchanged and the key read only after generation. Calibration matched 9/12 (10/12 without reasoning); the structural gate accepted 8/12 (6/12 without). The missed negation and the confusion of two statistical indicators both persisted, and a new abstention error appeared. One wrong answer passed the gate because every quotation in it was exact: the gate checks quotation integrity, not reasoning. Suitability remains blocked. One sampled run per case; not an accuracy estimate.

**Coding weights.** Qwen2.5-Coder-14B Q4_K_M was re-hashed and matches its pinned digest. It did not load with other desktop apps open (two attempts stopped by the available-RAM guard). With them closed it loads; the best measured split was about 28 graphics-card layers at 6.8 tokens per second, and more layers on the card were slower. On eight small generic Python tasks scored by executing held tests it passed 7. Qwen3-8B with reasoning passed 4 of the same 8 at 25–37 tokens per second and gave no answer on the other four, which hit the reasoning cap. These are single runs on small tasks, not a benchmark, and say nothing about CPIN use.

**Related mechanical finding.** The no-model quotation screen skipped near-match alignment for any quotation containing an ellipsis; see branch `claude/quotation-edge-ellipsis`.

The private trial folder sits inside the Codex desktop app's own storage on the Windows PC and would be removed if that app were uninstalled or reset.

Carry CPIN trial task `c68a14fe-62cd-4eb2-b229-934e9ab96c29` and milestone `cpin-local`. Its latest local trial event is `2ebe6398-533f-43de-9c1e-5619210ba54c`, blocked. Use the shared reporting protocol before further work. No source retrieval, public AI flags, deployment or scheduled service was performed by these trials.

The earlier preparation notes below are historical; their statements about unobserved Windows hardware and no completed inference have been superseded by this update.

---

# Bounded local-model trial

The optional `cpin-local` stage has not run a model. On 10 October, the gaming
PC's archived Codex chat was readable, but this Mac chat had no remote command
surface and the available project inventory contained only local Mac projects. Its GPU,
VRAM, RAM and available inference runtime remain unobserved. Cyberpunk settings
are not a hardware measurement. Run the read-only inventory in that Windows
session before selecting or downloading anything:

```powershell
powershell -NoProfile -File scripts/inspect_local_model_hardware.ps1
```

The script has not been executed or validated on Windows. It reports CPU, RAM,
GPU name and, where already installed, NVIDIA's VRAM reading; it omits account
and machine names. Do not estimate large VRAM values from the overflowing CIM
AdapterRAM field. Do not install a runtime, download weights, open a service to
the network or choose a model until hardware and existing runtime are observed.

## Reuse already measured

The completed mechanical snapshot contains 116,125 linked blocks and 104,251
distinct computation groups: 11,874 repeated occurrences. Of those blocks,
93,404 are substantive uses rather than bibliography entries; they have 83,321
distinct groups. Bibliography identity checks remain separate work. The 2026
portion has 13,994 linked occurrences and 13,639 groups.

These are conservative mechanical reuse groups, not a contextual-review count.
Their key retains source receipts and bytes, source pinpoint, claim wording,
preceding/following context, country and section. Report paragraph numbering can
change without destroying reuse. Different source pinpoints, missing evidence,
changed surrounding text and different country context are not automatically
equivalent. Recheck historical applicability per exact edition even when a
comparison can be reused. Near matches are leads only. This measurement does
not promise to reduce every semantic check to 83,321.

## Trial contract

- Eight private cases initially; one model, one run, no automatic retry.
- Use quoted, hash-verified held evidence with source page/paragraph and the
  exact edition, claim, previous/following context, date, population and geography.
- Include faithful uses, unavailable evidence, an ambiguous historical version
  and clearly labelled disposable number/negation mutations. Mutations are test
  copies and never CPIN findings or canonical changes.
- Require `supported`, `possible discrepancy` or `unresolved`, with exact
  evidence quotes and locations. Source gaps must return unresolved. A quotation
  match establishes transcription only, not the truth of the underlying claim.
- Validate every output quotation against the supplied text. Reject invented
  passages, references, confidence percentages and conclusions beyond scope.
- Keep model name, weight digest, licence, quantisation, runtime, prompt/input
  hashes, output, elapsed time and memory/VRAM measurements. Preserve failures.
- A missed calibration error or invented evidence stops expansion. A passing
  eight-case trial is feasibility evidence only, not a measured corpus error rate.
- No paid calls, full-corpus semantic run, scheduled model service, automatic
  public flags or green human ticks. Publication remains separately validated.

Hardware capture, model selection and the actual eight-case run are pending.
The existing source collector and exact-context grouping are reused; no second
inference framework has been added speculatively.
