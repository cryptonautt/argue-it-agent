/**
 * The v1 rubrics (design §4.3.5). Versioned objects are IMMUTABLE once shipped: a challenge snapshot pins
 * `rubric_id@version`, so changing judging criteria means adding `sports@2`, never editing `sports@1`.
 *
 * Category → rubric: sports → sports@1, technology → technology@1, crypto → factual@1,
 * entertainment → subjective@1, gaming → analytical@1.
 */
import type { RubricDef } from "../types";
import { CLARITY_GUIDANCE, CONSISTENCY_GUIDANCE, REBUTTAL_GUIDANCE, criterion } from "./shared";

export const SPORTS_V1: RubricDef = {
  id: "sports",
  version: 1,
  name: "Sports & Football",
  description:
    "For sports debates: verifiable records, stats and results matter most, but numbers only count when " +
    "they are used to make a point. Both sides are judged the same way on the same five criteria.",
  categorySlugs: ["sports"],
  criteria: [
    criterion(
      "evidence",
      "Evidence & accuracy",
      30,
      "How well this side backs its claims with specific, checkable facts: stats, trophies, records, results, " +
        "head-to-head numbers, notable matches. Facts that are widely known count as support even without a link. " +
        "Claims that are likely false lower the score. Context matters (era, league strength, team quality, " +
        "minutes played): raw numbers used without context score lower than the same numbers used fairly. " +
        "Do not reward fan loyalty, popularity, or how famous a player or club is.",
    ),
    criterion(
      "reasoning",
      "Reasoning",
      25,
      "How well the evidence connects to the proposition: does this side explain WHY its facts mean it is " +
        "right? Reward fair comparisons and sound logic; penalise cherry-picking, recency bias presented as " +
        "proof, and conclusions that do not follow from the evidence.",
    ),
    criterion("rebuttal", "Rebuttal", 20, REBUTTAL_GUIDANCE),
    criterion("clarity", "Clarity", 15, CLARITY_GUIDANCE),
    criterion("consistency", "Consistency", 10, CONSISTENCY_GUIDANCE),
  ],
};

export const TECHNOLOGY_V1: RubricDef = {
  id: "technology",
  version: 1,
  name: "Technology",
  description:
    "For tech debates: technical accuracy and sound reasoning about trade-offs matter most. Hype, brand " +
    "loyalty and buzzwords earn nothing on their own.",
  categorySlugs: ["technology"],
  criteria: [
    criterion(
      "evidence",
      "Evidence & technical accuracy",
      30,
      "How accurate and specific this side's technical claims are: specs, benchmarks, documented behaviour, " +
        "real-world examples, costs. Widely known technical facts count without a link. Claims that are likely " +
        "false or outdated lower the score. Brand reputation or marketing language is not evidence.",
    ),
    criterion(
      "reasoning",
      "Reasoning about trade-offs",
      30,
      "How well this side reasons from its facts to the proposition, including honest treatment of trade-offs, " +
        "use cases and limitations. Penalise sweeping generalisations, false dichotomies and conclusions that " +
        "do not follow.",
    ),
    criterion("rebuttal", "Rebuttal", 20, REBUTTAL_GUIDANCE),
    criterion("clarity", "Clarity", 10, CLARITY_GUIDANCE),
    criterion("consistency", "Consistency", 10, CONSISTENCY_GUIDANCE),
  ],
};

export const FACTUAL_V1: RubricDef = {
  id: "factual",
  version: 1,
  name: "Factual claims (crypto)",
  description:
    "For debates that hinge on facts (crypto first): accuracy of claims carries the most weight and likely " +
    "false claims are penalised. Price predictions are treated as opinion, not fact.",
  categorySlugs: ["crypto"],
  criteria: [
    criterion(
      "evidence",
      "Factual accuracy & evidence",
      35,
      "How accurate and well supported this side's factual claims are: how a protocol or token actually works, " +
        "documented events, verifiable on-chain or market facts. Widely known facts count without a link; a " +
        "cited link is a claim about a source, not proof (links are not opened). Claims that are likely false " +
        "lower the score significantly. Price predictions, 'to the moon' claims and promises of returns are " +
        "opinion, not evidence.",
    ),
    criterion(
      "reasoning",
      "Reasoning",
      25,
      "How well this side's facts support the proposition, including risks and counter-examples. Penalise " +
        "hype, appeals to popularity ('everyone is buying it'), and conclusions that do not follow from the facts.",
    ),
    criterion("rebuttal", "Rebuttal", 20, REBUTTAL_GUIDANCE),
    criterion("clarity", "Clarity", 10, CLARITY_GUIDANCE),
    criterion("consistency", "Consistency", 10, CONSISTENCY_GUIDANCE),
  ],
};

export const SUBJECTIVE_V1: RubricDef = {
  id: "subjective",
  version: 1,
  name: "Taste & opinion (entertainment)",
  description:
    "For debates about taste (music, film, TV): there is no 'correct' favourite. The judge scores how well " +
    "each side justifies its view — never which view it personally prefers.",
  categorySlugs: ["entertainment"],
  criteria: [
    criterion(
      "justification",
      "Justification",
      30,
      "How well this side supports its view with specific, relevant reasons and examples: particular songs, " +
        "albums, films, scenes, performances, craft, influence, awards or commercial results used as SUPPORT. " +
        "Taste is not fact: never score a side higher because its preference is more popular or because you " +
        "would agree with it. Awards, streams and box office support a case but do not prove artistic quality.",
    ),
    criterion(
      "coherence",
      "Coherence of the case",
      25,
      "Whether this side sets out a clear standard for 'better' (influence, consistency, skill, impact, " +
        "longevity, or similar) and applies it fairly and consistently to both subjects of the debate.",
    ),
    criterion("rebuttal", "Rebuttal", 20, REBUTTAL_GUIDANCE),
    criterion("clarity", "Clarity", 15, CLARITY_GUIDANCE),
    criterion("consistency", "Consistency", 10, CONSISTENCY_GUIDANCE),
  ],
};

export const ANALYTICAL_V1: RubricDef = {
  id: "analytical",
  version: 1,
  name: "Analysis (gaming)",
  description:
    "For gaming debates: knowledge of mechanics, matchups and results, and the quality of the analysis built " +
    "on them. Fandom for a game, team or console earns nothing on its own.",
  categorySlugs: ["gaming"],
  criteria: [
    criterion(
      "evidence",
      "Game knowledge & evidence",
      25,
      "How accurate and specific this side's claims about the game are: mechanics, stats, patch changes, " +
        "tournament results, sales or player numbers. Widely known facts count without a link; likely false " +
        "claims lower the score.",
    ),
    criterion(
      "reasoning",
      "Analysis",
      30,
      "How well this side analyses the matchup or question: explains why the mechanics, numbers or results " +
        "lead to its conclusion, considers relevant conditions (patch, platform, skill level), and avoids " +
        "hypotheticals presented as fact.",
    ),
    criterion("rebuttal", "Rebuttal", 20, REBUTTAL_GUIDANCE),
    criterion("clarity", "Clarity", 15, CLARITY_GUIDANCE),
    criterion("consistency", "Consistency", 10, CONSISTENCY_GUIDANCE),
  ],
};

/** Every rubric version ever shipped (append-only). */
export const ALL_RUBRICS: readonly RubricDef[] = [SPORTS_V1, TECHNOLOGY_V1, FACTUAL_V1, SUBJECTIVE_V1, ANALYTICAL_V1];
