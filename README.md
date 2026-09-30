# ministat

> I'd used GraphPad Prism and knew how great it was, but I couldn't afford it; besides, my day-to-day data exploration never gets that complicated, and at heart I've always loved lightweight tools, so I simply built my own with AI.

Free, in-browser statistics and scientific graphing. Paste data from Excel, pick a test, and get a report and a publication-ready figure. Nothing is uploaded; everything runs locally.

**Live:** https://jieqianghe.github.io/ministat/

## Tests

- **2 groups:** unpaired t-test (Student's / Welch's), Mann–Whitney U
- **2 groups, paired:** paired t-test, Wilcoxon signed-rank
- **2+ groups:** one-way ANOVA (Tukey, Dunnett, Holm, Bonferroni post-hoc), Kruskal–Wallis (Dunn's post-hoc)

Reports include effect sizes, 95% CIs and normality / equal-variance checks. Figures are bar or box plots with all data points and significance marks, exportable as PNG or SVG.

## Usage

Open `index.html` in a browser. No install or build step is needed.
