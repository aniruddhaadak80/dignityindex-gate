"""The deterministic operations.

These are the parts of dignityindex-gate that must never be a model call. Every function is
pure: it reads its arguments, it returns a value, and it touches nothing else. No clock, no
network, no randomness, no filesystem. Time and entropy are arguments, never reads.

Two things live here and nowhere else:

1. ``TRANSITIONS`` — the explicit state graph. A transition absent from this table is not a
   transition. ``advance`` refuses it with a stable code rather than improvising.
2. ``score`` — the dignity index. Six harm classes scored from the *facts* of a declaration
   by integer arithmetic, then combined by a fixed weight table.

A model may summarise a review, explain a refusal, or draft the memo. It may not decide
whether a system ships, because a plausible-but-wrong ethics verdict is unreviewable and
cannot be re-derived six months later.
"""

from __future__ import annotations

from typing import Any, Final, TypedDict

from .protocol import EngineError

# ---------------------------------------------------------------- the state graph

#: Every state a case may occupy. Order is the rail's display order.
STATES: Final[tuple[str, ...]] = (
    "draft",
    "evidenced",
    "contested",
    "remediated",
    "adjudicated",
    "released",
    "blocked",
)

#: The transition table. This is the whole authorisation model of the product.
#:
#: Anything not listed here is refused. That is the entire point: the gate can say no, and
#: the reason is a table row rather than an opinion.
TRANSITIONS: Final[dict[str, tuple[str, ...]]] = {
    "draft": ("evidenced", "blocked"),
    "evidenced": ("contested", "adjudicated", "blocked"),
    "contested": ("remediated", "blocked"),
    "remediated": ("adjudicated", "contested", "blocked"),
    "adjudicated": ("released", "contested", "blocked"),
    "released": ("blocked",),
    "blocked": ("draft",),
}

#: States from which no further progress is possible.
TERMINAL: Final[frozenset[str]] = frozenset({"released"})

# ---------------------------------------------------------------- policy constants

#: A case may not be adjudicated below this index.
ADJUDICATION_FLOOR: Final[int] = 50

#: A case may not be released below this index.
RELEASE_FLOOR: Final[int] = 60

#: Appeal service-level thresholds, in hours. 72h is the good-practice line; 14 days is the
#: outer limit past which contestability is treated as weak rather than absent.
APPEAL_FAST_HOURS: Final[int] = 72
APPEAL_MAX_HOURS: Final[int] = 336

#: Population thresholds that reduce the proportionality score. Named because they are
#: policy, not incidental numbers, and a reviewer needs to see them in one place.
POPULATION_MEDIUM: Final[int] = 10_000
POPULATION_LARGE: Final[int] = 100_000
POPULATION_HUGE: Final[int] = 1_000_000

#: Domains where an automated decision is treated as a dignity harm on its face.
HIGH_IMPACT: Final[frozenset[str]] = frozenset(
    {"hiring", "credit", "healthcare", "education", "benefits", "welfare", "legal", "moderation"}
)

#: Every harm class the index can score.
HARM_CLASSES: Final[tuple[str, ...]] = (
    "autonomy",
    "contestability",
    "proportionality",
    "transparency",
    "data_sovereignty",
    "reversibility",
)

#: Which harm classes a domain must evidence before a case can leave ``draft``.
MANDATORY_BY_DOMAIN: Final[dict[str, tuple[str, ...]]] = {
    "hiring": ("autonomy", "contestability", "transparency"),
    "credit": ("autonomy", "contestability", "proportionality", "data_sovereignty"),
    "healthcare": ("autonomy", "data_sovereignty", "reversibility"),
    "education": ("autonomy", "contestability", "transparency"),
    "benefits": ("autonomy", "contestability", "proportionality"),
    "welfare": ("autonomy", "contestability", "data_sovereignty"),
    "legal": ("autonomy", "contestability", "proportionality", "reversibility"),
    "moderation": ("contestability", "transparency", "reversibility"),
    "recommendation": ("autonomy", "transparency"),
}

#: Fixed integer weights. They sum to 100 so the index reads as a percentage directly.
WEIGHTS: Final[dict[str, int]] = {
    "autonomy": 25,
    "contestability": 20,
    "proportionality": 15,
    "transparency": 15,
    "data_sovereignty": 15,
    "reversibility": 10,
}

#: Domain names the declaration may use.
KNOWN_DOMAINS: Final[tuple[str, ...]] = tuple(sorted(MANDATORY_BY_DOMAIN))


def _clamp(value: int, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, value))


# ---------------------------------------------------------------- input contract


class Decision(TypedDict):
    automated: bool
    humanInLoop: bool
    appealable: bool
    appealSlaHours: int


class Data(TypedDict):
    trainsOnPeople: bool
    proxies: list[str]
    specialCategories: list[str]


class Impact(TypedDict):
    populationSize: int
    reversible: bool
    monitors: bool


class Evidence(TypedDict):
    harmClass: str
    ref: str


class Declaration(TypedDict):
    caseId: str
    system: str
    domain: str
    decision: Decision
    data: Data
    impact: Impact
    evidence: list[Evidence]


class Component(TypedDict):
    harmClass: str
    weight: int
    score: int
    rationale: str


class Finding(TypedDict):
    code: str
    severity: str
    message: str


class Verdict(TypedDict):
    caseId: str
    domain: str
    system: str
    index: int
    band: str
    releasable: bool
    components: list[Component]
    blocking: list[Finding]
    advisory: list[Finding]
    mandatory: list[str]
    evidenced: list[str]


class RefusedEdge(TypedDict):
    target: str
    code: str
    message: str


class TransitionsOutput(TypedDict):
    state: str
    legal: list[str]
    refused: list[RefusedEdge]


class Receipt(TypedDict):
    receiptId: str
    caseId: str
    source: str
    target: str
    index: int
    actor: str
    band: str


class AdvanceOutput(TypedDict):
    ok: bool
    receipt: Receipt | None
    error: RefusedEdge | None


class BoardRow(TypedDict):
    caseId: str
    system: str
    domain: str
    state: str
    index: int
    band: str
    blocking: int
    advisory: int
    releasable: bool
    next: list[str]


class BoardOutput(TypedDict):
    columns: dict[str, list[BoardRow]]
    states: list[str]
    totals: dict[str, int]
    meanIndex: int


class MatrixEdge(TypedDict):
    source: str
    target: str
    legal: bool


class MatrixOutput(TypedDict):
    states: list[str]
    edges: list[MatrixEdge]
    floors: dict[str, int]
    weights: dict[str, int]


# ---------------------------------------------------------------- validation


def _require_dict(payload: Any, field: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f"expected an object with {field!r}")
    return payload


def _bool(obj: dict[str, Any], key: str, field: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise EngineError("BAD_SHAPE", f"{field}.{key} must be a boolean")
    return value


def _int(obj: dict[str, Any], key: str, field: str) -> int:
    value = obj.get(key)
    # bool is a subclass of int; a boolean here is a schema bug, not a count.
    if isinstance(value, bool) or not isinstance(value, int):
        raise EngineError("BAD_SHAPE", f"{field}.{key} must be an integer")
    return value


def _str(obj: dict[str, Any], key: str, field: str) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not value.strip():
        raise EngineError("BAD_SHAPE", f"{field}.{key} must be a non-empty string")
    return value


def _str_list(obj: dict[str, Any], key: str, field: str) -> list[str]:
    value = obj.get(key)
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise EngineError("BAD_SHAPE", f"{field}.{key} must be an array of strings")
    return value


def parse_declaration(payload: Any) -> Declaration:
    """Validate a declaration and return it typed. Every failure names the exact field."""
    root = _require_dict(payload, "declaration")
    case_id = _str(root, "caseId", "declaration")
    system = _str(root, "system", "declaration")
    domain = _str(root, "domain", "declaration")
    if domain not in MANDATORY_BY_DOMAIN:
        raise EngineError(
            "UNKNOWN_DOMAIN",
            f"domain {domain!r} is not in the policy; known: {', '.join(KNOWN_DOMAINS)}",
        )

    decision_raw = _require_dict(root.get("decision"), "declaration.decision")
    data_raw = _require_dict(root.get("data"), "declaration.data")
    impact_raw = _require_dict(root.get("impact"), "declaration.impact")

    evidence_raw = root.get("evidence")
    if not isinstance(evidence_raw, list):
        raise EngineError("BAD_SHAPE", "declaration.evidence must be an array")
    evidence: list[Evidence] = []
    for index, item in enumerate(evidence_raw):
        entry = _require_dict(item, f"declaration.evidence[{index}]")
        harm_class = _str(entry, "harmClass", f"declaration.evidence[{index}]")
        if harm_class not in HARM_CLASSES:
            raise EngineError(
                "UNKNOWN_HARM_CLASS",
                f"evidence[{index}].harmClass {harm_class!r} is not one of {', '.join(HARM_CLASSES)}",
            )
        ref = entry.get("ref")
        if not isinstance(ref, str):
            raise EngineError("BAD_SHAPE", f"declaration.evidence[{index}].ref must be a string")
        evidence.append({"harmClass": harm_class, "ref": ref})

    decision = Decision(
        automated=_bool(decision_raw, "automated", "declaration.decision"),
        humanInLoop=_bool(decision_raw, "humanInLoop", "declaration.decision"),
        appealable=_bool(decision_raw, "appealable", "declaration.decision"),
        appealSlaHours=_int(decision_raw, "appealSlaHours", "declaration.decision"),
    )
    if decision["appealSlaHours"] < 0:
        raise EngineError("BAD_SHAPE", "declaration.decision.appealSlaHours must not be negative")

    data = Data(
        trainsOnPeople=_bool(data_raw, "trainsOnPeople", "declaration.data"),
        proxies=_str_list(data_raw, "proxies", "declaration.data"),
        specialCategories=_str_list(data_raw, "specialCategories", "declaration.data"),
    )
    impact = Impact(
        populationSize=_int(impact_raw, "populationSize", "declaration.impact"),
        reversible=_bool(impact_raw, "reversible", "declaration.impact"),
        monitors=_bool(impact_raw, "monitors", "declaration.impact"),
    )
    if impact["populationSize"] < 0:
        raise EngineError("BAD_SHAPE", "declaration.impact.populationSize must not be negative")

    return Declaration(
        caseId=case_id,
        system=system,
        domain=domain,
        decision=decision,
        data=data,
        impact=impact,
        evidence=evidence,
    )


# ---------------------------------------------------------------- the six components


def _score_autonomy(declaration: Declaration) -> tuple[int, str]:
    decision = declaration["decision"]
    if not decision["automated"]:
        return 90, "a person decides; the system only assembles the file"
    if not decision["humanInLoop"]:
        return 0, "the decision is automated and no human reviews it"
    base = 50
    if decision["appealable"]:
        base += 20
        return base, "automated, human-reviewed, and contestable"
    return base, "automated and human-reviewed, but not contestable"


def _score_contestability(declaration: Declaration) -> tuple[int, str]:
    decision = declaration["decision"]
    if not decision["appealable"]:
        return 0, "there is no appeal route for a person affected by the outcome"
    sla = decision["appealSlaHours"]
    if sla <= APPEAL_FAST_HOURS:
        return 100, f"appealable within {sla}h"
    if sla <= APPEAL_MAX_HOURS:
        return 70, f"appealable within {sla}h (longer than the {APPEAL_FAST_HOURS}h good-practice line)"
    return 40, f"appealable within {sla}h (longer than {APPEAL_MAX_HOURS // 24} days)"


def _score_proportionality(declaration: Declaration) -> tuple[int, str]:
    impact = declaration["impact"]
    score = 100
    size = impact["populationSize"]
    if size > POPULATION_HUGE:
        score -= 60
    elif size > POPULATION_LARGE:
        score -= 35
    elif size > POPULATION_MEDIUM:
        score -= 15
    if impact["monitors"]:
        score -= 25
    score = _clamp(score)
    return score, f"affects {size} people; continuous monitoring: {impact['monitors']}"


def mandatory_classes(declaration: Declaration) -> list[str]:
    return list(MANDATORY_BY_DOMAIN[declaration["domain"]])


def evidenced_classes(declaration: Declaration) -> list[str]:
    """A mandatory class counts as evidenced only with a non-empty reference."""
    seen: set[str] = set()
    for item in declaration["evidence"]:
        if item["ref"].strip():
            seen.add(item["harmClass"])
    return sorted(seen & set(mandatory_classes(declaration)))


def _missing_mandatory(declaration: Declaration) -> list[str]:
    have = set(evidenced_classes(declaration))
    return [name for name in mandatory_classes(declaration) if name not in have]


def _score_transparency(declaration: Declaration) -> tuple[int, str]:
    required = mandatory_classes(declaration)
    if not required:
        return 100, "no mandatory harm classes for this domain"
    have = len(evidenced_classes(declaration))
    score = _clamp(100 * have // len(required))
    return score, f"{have}/{len(required)} mandatory harm classes carry an evidence reference"


def _score_data_sovereignty(declaration: Declaration) -> tuple[int, str]:
    data = declaration["data"]
    score = 100
    if data["trainsOnPeople"]:
        score -= 30
    specials = len(data["specialCategories"])
    score -= min(50, specials * 25)
    proxies = len(data["proxies"])
    score -= min(40, proxies * 20)
    score = _clamp(score)
    detail = f"trains on people: {data['trainsOnPeople']}"
    if specials:
        detail += f"; special categories: {specials}"
    if proxies:
        detail += f"; proxy variables: {proxies}"
    return score, detail


def _score_reversibility(declaration: Declaration) -> tuple[int, str]:
    if declaration["impact"]["reversible"]:
        return 100, "a decision can be undone"
    return 0, "a decision cannot be undone"


_COMPONENTS: Final[tuple[tuple[str, Any], ...]] = (
    ("autonomy", _score_autonomy),
    ("contestability", _score_contestability),
    ("proportionality", _score_proportionality),
    ("transparency", _score_transparency),
    ("data_sovereignty", _score_data_sovereignty),
    ("reversibility", _score_reversibility),
)


# ---------------------------------------------------------------- findings


def blocking_findings(declaration: Declaration) -> list[Finding]:
    """Findings that make release impossible until the declaration changes."""
    findings: list[Finding] = []
    decision = declaration["decision"]
    impact = declaration["impact"]
    domain = declaration["domain"]
    high_impact = domain in HIGH_IMPACT

    if decision["automated"] and not decision["humanInLoop"]:
        findings.append(
            Finding(
                code="NO_HUMAN_REVIEW",
                severity="blocking",
                message="the decision is automated and no human reviews it before it takes effect",
            )
        )

    if high_impact and not decision["appealable"]:
        findings.append(
            Finding(
                code="NO_APPEAL",
                severity="blocking",
                message=f"{domain} decisions require an appeal route for the person affected",
            )
        )

    if high_impact and not impact["reversible"]:
        findings.append(
            Finding(
                code="IRREVERSIBLE_HIGH_IMPACT",
                severity="blocking",
                message=f"a {domain} decision that cannot be undone cannot be released",
            )
        )

    if impact["populationSize"] <= 0:
        findings.append(
            Finding(
                code="UNSPECIFIED_POPULATION",
                severity="blocking",
                message="populationSize must be a positive number of people",
            )
        )

    evidenced = set(evidenced_classes(declaration))
    for special in declaration["data"]["specialCategories"]:
        if "data_sovereignty" not in evidenced:
            findings.append(
                Finding(
                    code="SPECIAL_CATEGORY_UNEVIDENCED",
                    severity="blocking",
                    message=(
                        f"special category {special!r} is declared but data_sovereignty "
                        "carries no evidence reference"
                    ),
                )
            )
            break

    return findings


def advisory_findings(declaration: Declaration) -> list[Finding]:
    """Findings worth recording that do not by themselves prevent release."""
    findings: list[Finding] = []
    decision = declaration["decision"]

    if decision["appealable"] and decision["appealSlaHours"] > APPEAL_MAX_HOURS:
        findings.append(
            Finding(
                code="SLOW_APPEAL",
                severity="advisory",
                message=(
                    f"appeal SLA is {decision['appealSlaHours']}h; "
                    f"{APPEAL_MAX_HOURS // 24} days is the outer good-practice line"
                ),
            )
        )

    if declaration["data"]["proxies"]:
        findings.append(
            Finding(
                code="PROXY_VARIABLES",
                severity="advisory",
                message=(
                    f"{len(declaration['data']['proxies'])} proxy variable(s) declared: "
                    + ", ".join(sorted(declaration["data"]["proxies"]))
                ),
            )
        )

    if declaration["impact"]["monitors"]:
        findings.append(
            Finding(
                code="CONTINUOUS_MONITORING",
                severity="advisory",
                message="the system keeps observing people after the decision",
            )
        )

    missing = _missing_mandatory(declaration)
    if missing:
        findings.append(
            Finding(
                code="EVIDENCE_INCOMPLETE",
                severity="advisory",
                message="mandatory harm classes still lacking an evidence reference: "
                + ", ".join(missing),
            )
        )

    return findings


# ---------------------------------------------------------------- the index


def band_for(index: int) -> str:
    if index >= RELEASE_FLOOR:
        return "clear"
    if index >= ADJUDICATION_FLOOR:
        return "contested-review"
    return "insufficient"


def score(payload: Any) -> Verdict:
    """Compute the dignity index and every finding from a declaration's facts alone."""
    declaration = parse_declaration(payload)

    components: list[Component] = []
    weighted = 0
    for name, scorer in _COMPONENTS:
        value, rationale = scorer(declaration)
        weight = WEIGHTS[name]
        components.append(
            Component(
                harmClass=name,
                weight=weight,
                score=value,
                rationale=rationale,
            )
        )
        weighted += value * weight

    total_weight = sum(WEIGHTS.values())
    index = _clamp(weighted // total_weight)
    blocking = blocking_findings(declaration)
    advisory = advisory_findings(declaration)

    return Verdict(
        caseId=declaration["caseId"],
        domain=declaration["domain"],
        system=declaration["system"],
        index=index,
        band=band_for(index),
        releasable=index >= RELEASE_FLOOR and not blocking,
        components=components,
        blocking=blocking,
        advisory=advisory,
        mandatory=mandatory_classes(declaration),
        evidenced=evidenced_classes(declaration),
    )


# ---------------------------------------------------------------- the state machine

#: The index floor a transition target requires, or None when the target has no floor.
FLOORS_BY_TARGET: Final[dict[str, int]] = {
    "adjudicated": ADJUDICATION_FLOOR,
    "released": RELEASE_FLOOR,
}


def _guard_evidence(
    declaration: Declaration, state: str, target: str
) -> RefusedEdge | None:
    """draft -> evidenced requires a reference for every mandatory harm class."""
    if state != "draft" or target != "evidenced":
        return None
    missing = _missing_mandatory(declaration)
    if not missing:
        return None
    return RefusedEdge(
        target=target,
        code="MISSING_EVIDENCE",
        message="mandatory harm classes without an evidence reference: " + ", ".join(missing),
    )


def _guard_floor(target: str, verdict: Verdict) -> RefusedEdge | None:
    """A target with a floor refuses anything below it."""
    floor = FLOORS_BY_TARGET.get(target)
    if floor is None or verdict["index"] >= floor:
        return None
    return RefusedEdge(
        target=target,
        code="INDEX_BELOW_FLOOR",
        message=f"index {verdict['index']} is below the {target} floor of {floor}",
    )


def _guard_blocking(
    target: str, verdict: Verdict, *, at_release: bool
) -> RefusedEdge | None:
    """A floor-gated target also refuses while a blocking finding is open."""
    if target not in FLOORS_BY_TARGET or not verdict["blocking"]:
        return None
    codes = ", ".join(sorted({finding["code"] for finding in verdict["blocking"]}))
    message = (
        f"blocking findings remain: {codes}"
        if at_release
        else f"blocking findings must be cleared first: {codes}"
    )
    return RefusedEdge(target=target, code="BLOCKING_FINDINGS", message=message)


def _guard(
    declaration: Declaration, state: str, target: str, verdict: Verdict
) -> RefusedEdge | None:
    """Return a refusal when a guard fails, or None when the transition may proceed.

    Three guards, checked in a fixed order so the refusal a caller sees is deterministic:
    evidence, then the index floor, then blocking findings.
    """
    for guard in (
        _guard_evidence(declaration, state, target),
        _guard_floor(target, verdict),
        _guard_blocking(target, verdict, at_release=target == "released"),
    ):
        if guard is not None:
            return guard
    return None


def transitions(payload: Any) -> TransitionsOutput:
    """List every legal and every refused transition out of ``state``."""
    root = _require_dict(payload, "case")
    state = _str(root, "state", "case")
    if state not in TRANSITIONS:
        raise EngineError(
            "UNKNOWN_STATE", f"state {state!r} is not in the table; known: {', '.join(STATES)}"
        )
    verdict = score(root.get("declaration"))
    declaration = parse_declaration(root.get("declaration"))

    legal: list[str] = []
    refused: list[RefusedEdge] = []
    for target in TRANSITIONS[state]:
        guard = _guard(declaration, state, target, verdict)
        if guard is None:
            legal.append(target)
        else:
            refused.append(guard)

    # Every other state is refused as absent from the table. Naming them is the point.
    for candidate in STATES:
        if candidate in TRANSITIONS[state]:
            continue
        refused.append(
            RefusedEdge(
                target=candidate,
                code="TRANSITION_ILLEGAL",
                message=f"the transition table has no edge {state} -> {candidate}",
            )
        )

    return TransitionsOutput(state=state, legal=legal, refused=refused)


def advance(payload: Any) -> AdvanceOutput:
    """Apply one transition, or refuse it with a stable code.

    The receipt id is a pure function of the arguments — no clock, no counter, no randomness —
    so replaying the same adjudication yields the same receipt.
    """
    root = _require_dict(payload, "advance")
    state = _str(root, "from", "advance")
    target = _str(root, "to", "advance")
    actor = _str(root, "actor", "advance")
    if state not in TRANSITIONS:
        raise EngineError(
            "UNKNOWN_STATE", f"state {state!r} is not in the table; known: {', '.join(STATES)}"
        )
    if target not in STATES:
        raise EngineError(
            "UNKNOWN_STATE", f"state {target!r} is not in the table; known: {', '.join(STATES)}"
        )

    declaration = parse_declaration(root.get("declaration"))
    verdict = score(declaration)

    if target not in TRANSITIONS[state]:
        return AdvanceOutput(
            ok=False,
            receipt=None,
            error=RefusedEdge(
                target=target,
                code="TRANSITION_ILLEGAL",
                message=(
                    f"the transition table has no edge {state} -> {target}; "
                    f"legal targets are {', '.join(TRANSITIONS[state])}"
                ),
            ),
        )

    guard = _guard(declaration, state, target, verdict)
    if guard is not None:
        return AdvanceOutput(ok=False, receipt=None, error=guard)

    # TypedDict cannot declare a field named "from" or "to" as attributes, so the receipt uses
    # source/target. They mean exactly the same thing.
    receipt: Receipt = {
        "receiptId": f"{declaration['caseId']}|{state}->{target}|{verdict['index']}|{actor}",
        "caseId": declaration["caseId"],
        "source": state,
        "target": target,
        "index": verdict["index"],
        "actor": actor,
        "band": verdict["band"],
    }
    return AdvanceOutput(ok=True, receipt=receipt, error=None)


# ---------------------------------------------------------------- aggregate views


def board(payload: Any) -> BoardOutput:
    """One row per case, grouped by state, for the review board."""
    root = _require_dict(payload, "board")
    cases = root.get("cases")
    if not isinstance(cases, list):
        raise EngineError("BAD_SHAPE", "board.cases must be an array")

    rows: list[BoardRow] = []
    for index, item in enumerate(cases):
        entry = _require_dict(item, f"board.cases[{index}]")
        declaration = parse_declaration(entry.get("declaration"))
        state = _str(entry, "state", f"board.cases[{index}]")
        if state not in TRANSITIONS:
            raise EngineError("UNKNOWN_STATE", f"board.cases[{index}].state {state!r} is unknown")
        verdict = score(declaration)
        legal: list[str] = []
        for target in TRANSITIONS[state]:
            if _guard(declaration, state, target, verdict) is None:
                legal.append(target)
        rows.append(
            BoardRow(
                caseId=declaration["caseId"],
                system=declaration["system"],
                domain=declaration["domain"],
                state=state,
                index=verdict["index"],
                band=verdict["band"],
                blocking=len(verdict["blocking"]),
                advisory=len(verdict["advisory"]),
                releasable=verdict["releasable"],
                next=legal,
            )
        )

    columns: dict[str, list[BoardRow]] = {state: [] for state in STATES}
    for row in rows:
        columns[row["state"]].append(row)
    for column in columns.values():
        column.sort(key=lambda entry: entry["caseId"])

    totals = {
        "cases": len(rows),
        "released": len(columns["released"]),
        "blocked": len(columns["blocked"]),
        "withBlockingFindings": sum(1 for r in rows if r["blocking"] > 0),
    }
    mean_index = sum(r["index"] for r in rows) // len(rows) if rows else 0

    return BoardOutput(
        columns=columns,
        states=list(STATES),
        totals=totals,
        meanIndex=mean_index,
    )


def matrix(_: Any) -> MatrixOutput:
    """The transition table itself, both legal and illegal edges, for the rail."""
    edges: list[MatrixEdge] = []
    for source in STATES:
        for target in STATES:
            edge: MatrixEdge = {
                "source": source,
                "target": target,
                "legal": target in TRANSITIONS[source],
            }
            edges.append(edge)
    return MatrixOutput(
        states=list(STATES),
        edges=edges,
        floors={"adjudication": ADJUDICATION_FLOOR, "release": RELEASE_FLOOR},
        weights=dict(sorted(WEIGHTS.items())),
    )


OPERATIONS: Final[dict[str, Any]] = {
    "score": score,
    "transitions": transitions,
    "advance": advance,
    "board": board,
    "matrix": matrix,
}


def analyse(op: str, payload: Any) -> Any:
    handler = OPERATIONS.get(op)
    if handler is None:
        known = ", ".join(sorted(OPERATIONS))
        raise EngineError("UNKNOWN_OP", f"unknown op {op!r}; available: {known}")
    return handler(payload)
