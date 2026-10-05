from __future__ import annotations

from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from dignityindex_gate.analysis import (
    ADJUDICATION_FLOOR,
    RELEASE_FLOOR,
    STATES,
    TRANSITIONS,
    advance,
    board,
    evidenced_classes,
    mandatory_classes,
    matrix,
    parse_declaration,
    score,
    transitions,
)
from dignityindex_gate.protocol import EngineError

REFUSAL_CODES = {
    "TRANSITION_ILLEGAL",
    "MISSING_EVIDENCE",
    "INDEX_BELOW_FLOOR",
    "BLOCKING_FINDINGS",
}


def declaration(  # noqa: PLR0913 - a test fixture builder is clearer with explicit named knobs
    case_id: str = "CASE-0001",
    domain: str = "credit",
    *,
    automated: bool = True,
    human_in_loop: bool = True,
    appealable: bool = True,
    sla: int = 168,
    trains: bool = False,
    proxies: tuple[str, ...] = (),
    specials: tuple[str, ...] = (),
    population: int = 50_000,
    reversible: bool = True,
    monitors: bool = False,
    evidence: tuple[tuple[str, str], ...] = (),
) -> dict[str, Any]:
    return {
        "caseId": case_id,
        "system": "credit-score-v4",
        "domain": domain,
        "decision": {
            "automated": automated,
            "humanInLoop": human_in_loop,
            "appealable": appealable,
            "appealSlaHours": sla,
        },
        "data": {
            "trainsOnPeople": trains,
            "proxies": list(proxies),
            "specialCategories": list(specials),
        },
        "impact": {"populationSize": population, "reversible": reversible, "monitors": monitors},
        "evidence": [{"harmClass": name, "ref": ref} for name, ref in evidence],
    }


FULL_EVIDENCE = (
    ("autonomy", "doc://policy/human-review"),
    ("contestability", "doc://policy/appeal"),
    ("proportionality", "doc://analysis/scale"),
    ("data_sovereignty", "doc://analysis/proxies"),
)


class TestScore:
    def test_index_is_in_range_and_banded(self) -> None:
        verdict = score(declaration(evidence=FULL_EVIDENCE))
        assert 0 <= verdict["index"] <= 100
        assert verdict["band"] in {"clear", "contested-review", "insufficient"}

    def test_weights_sum_to_one_hundred(self) -> None:
        verdict = score(declaration())
        assert sum(component["weight"] for component in verdict["components"]) == 100
        assert {component["harmClass"] for component in verdict["components"]} == {
            "autonomy",
            "contestability",
            "proportionality",
            "transparency",
            "data_sovereignty",
            "reversibility",
        }

    def test_a_fully_evidenced_credit_case_clears_the_release_floor(self) -> None:
        verdict = score(declaration(evidence=FULL_EVIDENCE))
        assert verdict["index"] >= RELEASE_FLOOR
        assert verdict["releasable"] is True
        assert verdict["blocking"] == []

    def test_an_automated_decision_with_no_human_is_blocked(self) -> None:
        verdict = score(declaration(human_in_loop=False, evidence=FULL_EVIDENCE))
        assert "NO_HUMAN_REVIEW" in {finding["code"] for finding in verdict["blocking"]}
        assert verdict["releasable"] is False

    def test_a_high_impact_case_without_an_appeal_is_blocked(self) -> None:
        verdict = score(declaration(appealable=False, evidence=FULL_EVIDENCE))
        assert "NO_APPEAL" in {finding["code"] for finding in verdict["blocking"]}

    def test_a_recommendation_system_without_an_appeal_is_only_advisory(self) -> None:
        verdict = score(declaration(domain="recommendation", appealable=False))
        assert "NO_APPEAL" not in {finding["code"] for finding in verdict["blocking"]}

    def test_an_irreversible_credit_decision_is_blocked(self) -> None:
        verdict = score(declaration(reversible=False, evidence=FULL_EVIDENCE))
        assert "IRREVERSIBLE_HIGH_IMPACT" in {f["code"] for f in verdict["blocking"]}

    def test_an_empty_population_is_blocked(self) -> None:
        verdict = score(declaration(population=0))
        assert "UNSPECIFIED_POPULATION" in {f["code"] for f in verdict["blocking"]}

    def test_special_categories_without_evidence_are_blocked(self) -> None:
        verdict = score(declaration(specials=("health",), evidence=(("autonomy", "doc://a"),)))
        assert "SPECIAL_CATEGORY_UNEVIDENCED" in {f["code"] for f in verdict["blocking"]}

    def test_transparency_tracks_evidenced_mandatory_classes(self) -> None:
        none_evidenced = score(declaration(evidence=()))
        full = score(declaration(evidence=FULL_EVIDENCE))
        by_class = {c["harmClass"]: c["score"] for c in full["components"]}
        assert by_class["transparency"] == 100
        partial = {
            c["harmClass"]: c["score"]
            for c in score(declaration(evidence=(("autonomy", "doc://a"),)))["components"]
        }
        assert 0 < partial["transparency"] < 100
        assert none_evidenced["components"][0]["harmClass"] == "autonomy"

    def test_an_empty_reference_does_not_count_as_evidence(self) -> None:
        assert evidenced_classes(declaration(evidence=(("autonomy", "   "),))) == []

    def test_mandatory_classes_come_from_the_domain(self) -> None:
        assert mandatory_classes(declaration(domain="healthcare")) == [
            "autonomy",
            "data_sovereignty",
            "reversibility",
        ]

    def test_rejects_an_unknown_domain(self) -> None:
        with pytest.raises(EngineError) as caught:
            score(declaration(domain="astrology"))
        assert caught.value.code == "UNKNOWN_DOMAIN"

    def test_rejects_an_unknown_harm_class(self) -> None:
        with pytest.raises(EngineError) as caught:
            score(declaration(evidence=(("vibes", "doc://a"),)))
        assert caught.value.code == "UNKNOWN_HARM_CLASS"

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda d: d.update({"caseId": ""}),
            lambda d: d["decision"].update({"automated": "yes"}),
            lambda d: d["decision"].update({"appealSlaHours": -1}),
            lambda d: d["impact"].update({"populationSize": -5}),
            lambda d: d["data"].update({"proxies": "postcode"}),
            lambda d: d.update({"evidence": "none"}),
        ],
    )
    def test_rejects_malformed_declarations_with_a_code(self, mutate: Any) -> None:
        payload = declaration()
        mutate(payload)
        with pytest.raises(EngineError) as caught:
            score(payload)
        assert caught.value.code == "BAD_SHAPE"

    def test_a_boolean_is_not_accepted_as_an_integer(self) -> None:
        payload = declaration()
        payload["impact"]["populationSize"] = True
        with pytest.raises(EngineError) as caught:
            score(payload)
        assert caught.value.code == "BAD_SHAPE"


class TestTransitions:
    def test_lists_legal_targets_and_names_the_illegal_ones(self) -> None:
        result = transitions({"declaration": declaration(), "state": "draft"})
        assert "evidenced" in result["legal"] or any(
            r["code"] == "MISSING_EVIDENCE" for r in result["refused"]
        )
        illegal = {r["target"] for r in result["refused"] if r["code"] == "TRANSITION_ILLEGAL"}
        assert illegal == set(STATES) - set(TRANSITIONS["draft"])

    def test_legal_and_refused_partition_the_state_space(self) -> None:
        result = transitions(
            {"declaration": declaration(evidence=FULL_EVIDENCE), "state": "adjudicated"}
        )
        covered = set(result["legal"]) | {r["target"] for r in result["refused"]}
        assert covered == set(STATES)

    def test_refuses_to_leave_draft_without_mandatory_evidence(self) -> None:
        result = transitions({"declaration": declaration(evidence=()), "state": "draft"})
        refusal = next(r for r in result["refused"] if r["target"] == "evidenced")
        assert refusal["code"] == "MISSING_EVIDENCE"
        assert "evidenced" not in result["legal"]

    def test_rejects_an_unknown_state(self) -> None:
        with pytest.raises(EngineError) as caught:
            transitions({"declaration": declaration(), "state": "vibes"})
        assert caught.value.code == "UNKNOWN_STATE"


class TestAdvance:
    def test_accepts_a_transition_present_in_the_table(self) -> None:
        result = advance(
            {
                "declaration": declaration(evidence=FULL_EVIDENCE),
                "from": "draft",
                "to": "evidenced",
                "actor": "reviewer@board",
            }
        )
        assert result["ok"] is True
        assert result["receipt"] is not None
        assert result["receipt"]["source"] == "draft"
        assert result["receipt"]["target"] == "evidenced"

    def test_the_receipt_id_is_a_pure_function_of_the_arguments(self) -> None:
        payload = {
            "declaration": declaration(evidence=FULL_EVIDENCE),
            "from": "draft",
            "to": "evidenced",
            "actor": "reviewer@board",
        }
        first = advance(dict(payload))
        second = advance(dict(payload))
        assert first["receipt"]["receiptId"] == second["receipt"]["receiptId"]

    def test_refuses_a_transition_absent_from_the_table(self) -> None:
        result = advance(
            {
                "declaration": declaration(evidence=FULL_EVIDENCE),
                "from": "draft",
                "to": "released",
                "actor": "reviewer@board",
            }
        )
        assert result["ok"] is False
        assert result["receipt"] is None
        assert result["error"]["code"] == "TRANSITION_ILLEGAL"
        assert "legal targets are" in result["error"]["message"]

    def test_cannot_release_below_the_release_floor(self) -> None:
        """Falls below the floor on the index alone, with no blocking finding, so the refusal
        is specifically the floor rather than a blocking finding."""
        weak = declaration(
            evidence=(), sla=24 * 365, population=5_000_000, monitors=True
        )
        verdict = score(weak)
        assert verdict["blocking"] == []
        assert verdict["index"] < RELEASE_FLOOR
        result = advance(
            {"declaration": weak, "from": "adjudicated", "to": "released", "actor": "chair"}
        )
        assert result["ok"] is False
        assert result["error"]["code"] == "INDEX_BELOW_FLOOR"

    def test_cannot_adjudicate_below_the_adjudication_floor(self) -> None:
        weak = declaration(
            domain="recommendation",
            automated=True,
            human_in_loop=False,
            appealable=False,
            reversible=True,
            evidence=(),
        )
        result = advance(
            {"declaration": weak, "from": "evidenced", "to": "adjudicated", "actor": "chair"}
        )
        assert result["ok"] is False
        assert result["error"]["code"] in {"INDEX_BELOW_FLOOR", "BLOCKING_FINDINGS"}

    def test_a_clean_case_can_be_released(self) -> None:
        result = advance(
            {
                "declaration": declaration(evidence=FULL_EVIDENCE),
                "from": "adjudicated",
                "to": "released",
                "actor": "chair",
            }
        )
        assert result["ok"] is True
        assert result["receipt"]["index"] >= RELEASE_FLOOR

    def test_blocking_findings_stop_adjudication(self) -> None:
        blocked = declaration(human_in_loop=False, evidence=FULL_EVIDENCE)
        result = advance(
            {"declaration": blocked, "from": "evidenced", "to": "adjudicated", "actor": "chair"}
        )
        assert result["ok"] is False
        assert result["error"]["code"] == "BLOCKING_FINDINGS"

    def test_a_blocked_case_can_be_reopened(self) -> None:
        result = advance(
            {
                "declaration": declaration(),
                "from": "blocked",
                "to": "draft",
                "actor": "reviewer@board",
            }
        )
        assert result["ok"] is True

    @pytest.mark.parametrize("state", list(STATES))
    @pytest.mark.parametrize("target", list(STATES))
    def test_never_receipts_a_transition_absent_from_the_table(
        self, state: str, target: str
    ) -> None:
        result = advance(
            {
                "declaration": declaration(evidence=FULL_EVIDENCE),
                "from": state,
                "to": target,
                "actor": "reviewer@board",
            }
        )
        in_table = target in TRANSITIONS[state]
        if not in_table:
            assert result["ok"] is False
            assert result["receipt"] is None
            assert result["error"]["code"] == "TRANSITION_ILLEGAL"


class TestBoard:
    def test_groups_rows_by_state_and_totals_agree(self) -> None:
        cases = [
            {"declaration": declaration("CASE-0001"), "state": "draft"},
            {
                "declaration": declaration("CASE-0002", evidence=FULL_EVIDENCE),
                "state": "released",
            },
        ]
        result = board({"cases": cases})
        assert result["states"] == list(STATES)
        assert result["totals"]["cases"] == 2
        assert result["totals"]["released"] == 1
        assert sum(len(rows) for rows in result["columns"].values()) == 2

    def test_an_empty_board_has_zero_means(self) -> None:
        result = board({"cases": []})
        assert result["totals"]["cases"] == 0
        assert result["meanIndex"] == 0

    def test_rows_carry_only_legal_next_states(self) -> None:
        result = board(
            {"cases": [{"declaration": declaration(evidence=()), "state": "draft"}]}
        )
        row = result["columns"]["draft"][0]
        assert "evidenced" not in row["next"]
        assert set(row["next"]) <= set(TRANSITIONS["draft"])


class TestMatrix:
    def test_every_state_pair_appears_exactly_once(self) -> None:
        result = matrix(None)
        assert len(result["edges"]) == len(STATES) ** 2
        assert result["floors"] == {"adjudication": ADJUDICATION_FLOOR, "release": RELEASE_FLOOR}

    def test_legal_edges_match_the_transition_table(self) -> None:
        result = matrix(None)
        legal = {(e["source"], e["target"]) for e in result["edges"] if e["legal"]}
        assert legal == {(s, t) for s, targets in TRANSITIONS.items() for t in targets}

    def test_every_state_can_be_left(self) -> None:
        for state in STATES:
            assert TRANSITIONS[state], f"{state} is a dead end"


# ---------------------------------------------------------------- property tests

# A strategy over the helper's KEYWORDS, not its return value: st.builds would hand back a
# finished declaration, which cannot be re-splatted into the helper's parameters.
DECLARATION_KWARGS = st.fixed_dictionaries(
    {
        # A non-blank alphabet, because the engine rejects a whitespace-only caseId and a
        # filtered strategy would starve hypothesis instead of testing the scorer.
        "case_id": st.text(
            alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-", min_size=1, max_size=12
        ),
        "domain": st.sampled_from(["credit", "hiring", "healthcare", "education", "benefits"]),
        "automated": st.booleans(),
        "human_in_loop": st.booleans(),
        "appealable": st.booleans(),
        "sla": st.integers(min_value=0, max_value=20_000),
        "trains": st.booleans(),
        "proxies": st.lists(st.sampled_from(["postcode", "name", "device"]), max_size=3),
        "specials": st.lists(st.sampled_from(["health", "ethnicity"]), max_size=2),
        "population": st.integers(min_value=0, max_value=20_000_000),
        "reversible": st.booleans(),
        "monitors": st.booleans(),
    }
)


class TestProperties:
    @settings(max_examples=60, deadline=None)
    @given(DECLARATION_KWARGS)
    def test_index_is_always_bounded(self, kwargs: dict[str, Any]) -> None:
        assert 0 <= score(declaration(**kwargs))["index"] <= 100

    @settings(max_examples=40, deadline=None)
    @given(DECLARATION_KWARGS)
    def test_scoring_is_deterministic(self, kwargs: dict[str, Any]) -> None:
        payload = declaration(**kwargs)
        assert score(payload) == score(payload)

    @settings(max_examples=40, deadline=None)
    @given(
        DECLARATION_KWARGS,
        st.lists(
            st.tuples(
                st.sampled_from(
                    ["autonomy", "reversibility", "contestability", "transparency"]
                ),
                st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=6),
            ),
            max_size=4,
        ),
    )
    def test_evidence_order_does_not_change_the_index(
        self, kwargs: dict[str, Any], extra: list[tuple[str, str]]
    ) -> None:
        pairs = list(FULL_EVIDENCE) + extra
        forward = declaration(**kwargs, evidence=tuple(pairs))
        backward = declaration(**kwargs, evidence=tuple(reversed(pairs)))
        assert score(forward)["index"] == score(backward)["index"]

    @settings(max_examples=50, deadline=None)
    @given(DECLARATION_KWARGS)
    def test_removing_an_appeal_never_raises_the_index(self, kwargs: dict[str, Any]) -> None:
        """Contestability is one component and nothing else reads appealable."""
        with_appeal = declaration(**{**kwargs, "appealable": True})
        without = declaration(**{**kwargs, "appealable": False})
        assert score(without)["index"] <= score(with_appeal)["index"]

    @settings(max_examples=40, deadline=None)
    @given(DECLARATION_KWARGS, st.sampled_from(STATES), st.sampled_from(STATES))
    def test_advance_never_contradicts_the_table(
        self, kwargs: dict[str, Any], state: str, target: str
    ) -> None:
        result = advance(
            {"declaration": declaration(**kwargs), "from": state, "to": target, "actor": "board"}
        )
        if target not in TRANSITIONS[state]:
            assert result["ok"] is False
        if result["error"] is not None:
            assert result["error"]["code"] in REFUSAL_CODES

    @settings(max_examples=60, deadline=None)
    @given(
        st.integers(min_value=0, max_value=336),
        st.integers(min_value=1, max_value=20_000_000),
    )
    def test_a_released_verdict_implies_no_blocking_findings(
        self, sla: int, population: int
    ) -> None:
        """No assume(): filtering on a rare predicate would starve hypothesis. Instead the
        predicate is guarded by an if, so every example still exercises the scorer."""
        verdict = score(declaration(evidence=FULL_EVIDENCE, sla=sla, population=population))
        if verdict["releasable"]:
            assert verdict["blocking"] == []
            assert verdict["index"] >= RELEASE_FLOOR

    @settings(max_examples=30, deadline=None)
    @given(st.lists(st.tuples(DECLARATION_KWARGS, st.sampled_from(STATES)), max_size=8))
    def test_board_conserves_rows(
        self, cases: list[tuple[dict[str, Any], str]]
    ) -> None:
        payload = [
            {"declaration": declaration(**kwargs), "state": state} for kwargs, state in cases
        ]
        result = board({"cases": payload})
        assert result["totals"]["cases"] == len(cases)
        assert sum(len(rows) for rows in result["columns"].values()) == len(cases)
        for column in result["columns"].values():
            ids = [row["caseId"] for row in column]
            assert ids == sorted(ids)


class TestParseDeclaration:
    def test_returns_the_identifier_untouched(self) -> None:
        parsed = parse_declaration(declaration(case_id="CASE-0042"))
        assert parsed["caseId"] == "CASE-0042"

    def test_raises_for_a_non_object(self) -> None:
        with pytest.raises(EngineError) as caught:
            parse_declaration(["nope"])
        assert caught.value.code == "BAD_SHAPE"
