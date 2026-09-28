# ministat

Free, in-browser statistics and scientific graphing — paste data from Excel, pick a test, get a report and a publication-ready figure. Nothing is uploaded; everything runs locally in your browser.

**Live:** https://jieqianghe.github.io/ministat/

## Features

| | Test | Details |
|---|---|---|
| 2 groups, independent | Unpaired t-test | Student's or Welch's (default); 95% CI of the difference; Cohen's d, Hedges' g |
| | Mann–Whitney U | **Exact** p for n < 50 without ties, otherwise normal approximation (tie + continuity corrected); rank-biserial r |
| 2 groups, paired (matched rows) | Paired t-test | 95% CI of mean difference; Cohen's d<sub>z</sub> |
| | Wilcoxon signed-rank | Exact p for n < 50 without ties/zeros; matched-pairs rank-biserial r |
| 2+ groups | One-way ANOVA | η², ω²; post-hoc **Tukey HSD**, **Dunnett** (vs. first group), **Holm**, **Bonferroni**, with simultaneous 95% CIs; compact letter display |
| | Kruskal–Wallis | ε²; **Dunn's** post-hoc (Holm / Bonferroni); compact letter display |

Every report also includes **assumption checks**: Shapiro–Wilk normality per group (or on the paired differences) and the Brown–Forsythe test for equal variances, with a hint when a non-parametric test or Welch's correction would be more appropriate.

**Figures:** bar + error bars (SD / SEM / 95% CI) or box plots, with every data point overlaid (deterministic jitter, so exports are reproducible; paired data are drawn as connected pairs), significance brackets, per-group stars (Dunnett) or letters. Export PNG (5× resolution) or SVG at the size shown on screen.

**Data entry:** spreadsheet-style grid — paste blocks from Excel/Sheets, Enter / arrow-key navigation, undo/redo (⌘/Ctrl+Z), auto-save to the browser, `.jgz` session files, TSV/CSV import (delimiter auto-detected, quoted cells supported). Ambiguous numbers such as `1,5` are flagged instead of being silently misread, with a one-click decimal-comma fix.

## Methods

Everything lives in a single file, [`index.html`](index.html): the page, its styles, and the code (the statistics are in the `Stats` module at the top of the script, built on [jStat](https://github.com/jstat/jstat)).

- Studentized range (Tukey) and Dunnett's multivariate-t probabilities are computed by numerical integration (Gauss–Legendre over the χ scale, trapezoid over the normal); Dunnett uses the one-factor correlation structure ρ<sub>ij</sub> = λ<sub>i</sub>λ<sub>j</sub>, which is exact for many-to-one comparisons with unequal n.
- Shapiro–Wilk follows Royston (1995), algorithm AS R94 — the same as R's `shapiro.test`.
- Exact Mann–Whitney and Wilcoxon distributions are enumerated with generating functions.
- Results were validated against SciPy (e.g. Tukey p-values agree to ~1e-13, Shapiro–Wilk to ~1e-9).

## Running locally

No build step and no dependencies to install — open `index.html` in a browser (or serve the folder with any static server). jStat and Plotly (cartesian bundle) load from jsDelivr with pinned versions and Subresource Integrity hashes.
