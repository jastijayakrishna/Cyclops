# Literature and novelty review

**Retrieved:** 2026-08-24. **Scope:** primary papers, official project pages, official benchmark artifacts, and statistical-method papers relevant to robot-video evaluation, reward modeling, policy ranking, and label-efficient inference. This is a targeted novelty audit, not a formal systematic review.

## Search question

Does prior work already measure how VLM robot-video scores change real robot policy conclusions, and does it use statistically valid bias correction to reduce human-reference labels?

Search concepts included combinations of `RoboArena`, `RoboRewardBench`, robot policy ranking, VLM judge bias, pointwise progress, pairwise preference, reward-model consistency, prediction-powered inference, label efficiency, and simulation-to-real evaluation.

## Closest work

| Work | What it establishes | Consequence for this proposal |
|---|---|---|
| [RoboArena](https://arxiv.org/html/2506.18123) | Real-world robot-policy evaluation with task progress and human preference; equal progress can still admit a clear preference. | The existing metric-disagreement result quantifies a known phenomenon and should not be presented as discovering it. |
| [RoboReward](https://arxiv.org/html/2601.00675) and [released dataset](https://huggingface.co/datasets/teetone/RoboReward) | A 54,135-example robot-video reward dataset, human-verified test references, and broad episode-level VLM evaluation, including a 1,000-item RoboArena subset. | “VLM judges make robot-video errors” is already established. The released per-item predictions make new local inference unnecessary. |
| [HELM RoboReward benchmark](https://crfm.stanford.edu/helm/robo-reward-bench/) | Public prompts, per-item predictions, and results across many model families. | Provides the machine evidence used by the secondary analysis; its model-specific prompts and score scale define the judge contract. |
| [TrustRoboReward](https://arxiv.org/html/2608.08491) | Studies consistency between pointwise scores and pairwise preferences and proposes monotonic correction for reward supervision. | Direct novelty threat to a generic score-versus-preference thesis, but it does not answer matched policy inference or valid label savings. |
| [Robometer](https://robometer.github.io/) | Trajectory-comparison reward modeling, evaluation on RoboRewardBench, and analysis of existing reward-model failure modes. | A generic “build a better reward model” contribution would be crowded; the proposal should remain inference-focused. |
| [WFM-Eval](https://sahilkhose.github.io/wfm-eval-cvpr26/) | Evaluates several VLM judges for robotic world-model outputs, reports model-specific bias, and shows naive ensembling is insufficient. | Reinforces that model agreement is not a substitute for calibrated human-reference inference. |
| [RobotArena Infinity](https://robotarenainf.github.io/) | Automated VLM scoring and human-preference validation for scalable robot-policy evaluation in simulation. | Adjacent evidence that automated ranking can align with humans in another setting; it does not establish real-video PPI coverage. |
| [SureSim](https://arxiv.org/abs/2510.04354) | Applies prediction-powered inference to robot policy evaluation using simulation as the imperfect proxy for real outcomes. | PPI in robotics is not novel. The proposed novelty must be the VLM-video proxy, matched real sessions, and policy-decision distortion. |

## Statistical foundation

- [Prediction-Powered Inference](https://arxiv.org/abs/2301.09633) supplies valid inference when plentiful predictions and fewer labels are available.
- [PPI++](https://arxiv.org/abs/2311.01453) introduces power tuning so poor predictions need not degrade inference.
- [Stratified PPI](https://arxiv.org/abs/2406.04291) targets hybrid human/model evaluation when error varies across observable groups.
- [Active Statistical Inference](https://proceedings.mlr.press/v235/zrnic24a.html) chooses labels to improve inference rather than prediction alone.
- [Regression for the Mean](https://proceedings.mlr.press/v267/eyre25a.html) highlights few-label behavior and the connection between prediction-powered estimation and regression adjustment.
- [Prediction-Powered Ranking](https://arxiv.org/abs/2402.17826) extends the framework to ranking problems, but not this matched robot-policy/video contract.
- [MultiPPI](https://arxiv.org/abs/2603.27414) combines several predictors rather than committing to one proxy, narrowing the novelty available to generic evaluator routing.
- [AM-PPI](https://arxiv.org/abs/2605.08429) addresses adaptive multi-predictor prediction-powered inference, so adaptive proxy choice alone is not a sufficient doctoral claim.
- [Prediction-Powered E-Values](https://proceedings.mlr.press/v267/csillag25a.html) provides anytime-valid evidence under prediction assistance, raising the bar for sequential variants.
- [Reliable Algorithm Selection](https://proceedings.mlr.press/v267/fannjiang25a.html) studies statistically reliable selection among algorithms; a policy-ranking contribution therefore needs structure specific to clustered robot-evaluation graphs.

## Novelty conclusion

The broad thesis “automatic judges are biased and progress differs from preference” is not novel enough. The executable contribution is a conservative, split-sample certificate that either uses fixed PPI after every prespecified gate passes or returns the exact human-only procedure. That is a credible research baseline, but the surrounding literature makes it insufficient as a stand-alone doctoral novelty claim.

The defensible PhD candidate contribution is:

> Cross-fitted selective proxy-assisted inference for a clustered policy-comparison graph, with simultaneous coverage after evaluator selection and a high-probability no-harm bound relative to a frozen human-only procedure, evaluated under heterogeneous camera, task, site, and rater-reference shift.

The targeted search found no work directly establishing that combined guarantee for clustered robot-policy video evaluation. This supports a proposal-level gap; it does not prove universal priority, establish the theorem, or justify the phrase “first-ever.” An independent systematic search should be completed before publication.

## Implications for claims

- Describe the human metric finding as replication plus quantitative decision analysis.
- Describe VLM error relative to the benchmark reference, not absolute error against gold.
- Present the released-prediction results as exploratory secondary analysis because the test artifacts were examined during method selection.
- Treat fixed PPI behind a separated gate as the executable baseline. A doctoral claim requires a valid cross-fitted or otherwise selection-aware graph procedure, not merely adaptive tuning.
- Treat a negative label-saving result as publishable evidence about judge suitability, not as a failed thesis.
