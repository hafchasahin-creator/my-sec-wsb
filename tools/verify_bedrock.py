#!/usr/bin/env python3
"""Cross-check every component/field this add-on uses against Bedrock 1.21.0.

Ground truth comes from Mojang's own published 1.21.0 sample packs plus the
1.21.0 documentation HTML (see tools/fetch_reference.py).  For every
"minecraft:*" component in our behaviour-pack entity files, this reports:

  * components that do not exist in 1.21.0 at all
  * fields that neither the docs nor any vanilla entity ever use

Run with  python3 tools/verify_bedrock.py --reference <dir>

If the reference directory is missing the script exits 0 with a notice, so
CI/offline builds are not blocked by it.
"""
import argparse
import collections
import glob
import html
import json
import os
import re
import sys


def strip_jsonc(text):
    """Vanilla ships // comments and trailing commas in its JSON."""
    out = []
    i, n, in_string = 0, len(text), False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(ch)
        i += 1
    joined = "".join(out)
    return re.sub(r",(\s*[}\]])", r"\1", joined)


def load_jsonc(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        return json.loads(strip_jsonc(handle.read()))


# --------------------------------------------------------------------------
# Reference extraction
# --------------------------------------------------------------------------
def vanilla_component_fields(reference):
    """component id -> set of field names seen anywhere in vanilla entities."""
    fields = collections.defaultdict(set)
    seen = set()
    pattern = os.path.join(reference, "behavior_pack", "entities", "*.json")
    for path in glob.glob(pattern):
        try:
            doc = load_jsonc(path)
        except Exception:
            continue

        def walk(node, parent=None):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key.startswith("minecraft:"):
                        seen.add(key)
                        if isinstance(value, dict):
                            fields[key].update(value.keys())
                        walk(value, key)
                    else:
                        walk(value, parent)
            elif isinstance(node, list):
                for item in node:
                    walk(item, parent)

        walk(doc.get("minecraft:entity", {}))
    return seen, fields


def doc_component_fields(reference):
    """component id -> set of field names named in the 1.21.0 docs."""
    path = os.path.join(reference, "documentation", "Entities.html")
    if not os.path.isfile(path):
        return set(), {}
    with open(path, encoding="utf-8", errors="replace") as handle:
        raw = handle.read()
    text = re.sub(r"<[^>]+>", "\n", raw)
    text = html.unescape(text)
    lines = [line.strip() for line in text.split("\n")]
    lines = [line for line in lines if line]

    known = set()
    fields = collections.defaultdict(set)
    current = None
    for line in lines:
        match = re.fullmatch(r"(minecraft:[a-z_0-9.]+)", line)
        if match:
            current = match.group(1)
            known.add(current)
            continue
        if current and re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9]*", line):
            fields[current].add(line)
    return known, fields


# --------------------------------------------------------------------------
# Our usage
# --------------------------------------------------------------------------
def our_usage(pack_dirs):
    usage = collections.defaultdict(set)
    where = collections.defaultdict(set)
    for pack in pack_dirs:
        for path in glob.glob(os.path.join(pack, "entities", "*.json")):
            doc = load_jsonc(path)

            def walk(node):
                if isinstance(node, dict):
                    for key, value in node.items():
                        if key.startswith("minecraft:"):
                            usage[key]  # touch
                            where[key].add(path)
                            if isinstance(value, dict):
                                usage[key].update(
                                    k for k in value.keys() if not k.startswith("minecraft:")
                                )
                            walk(value)
                        else:
                            walk(value)
                elif isinstance(node, list):
                    for item in node:
                        walk(item)

            walk(doc.get("minecraft:entity", {}))
    return usage, where


# Fields that live inside nested objects and therefore legitimately appear at
# a level the flat scan attributes to the parent component.
NESTED_OK = {
    "minecraft:damage_sensor": {"triggers", "cause", "deals_damage", "damage_multiplier",
                                "on_damage", "on_damage_sound_event", "filters", "event", "target"},
    "minecraft:interact": {"interactions"},
    "minecraft:equippable": {"slots"},
    "minecraft:hurt_on_condition": {"damage_conditions"},
    "minecraft:conditional_bandwidth_optimization": {"default_values", "conditional_values"},
    "minecraft:tameable": {"tame_event", "event", "target"},
    "minecraft:sittable": {"sit_event", "stand_event", "event", "target"},
    "minecraft:despawn": {"despawn_from_distance", "filters"},
    "minecraft:behavior.timer_flag_1": {"on_start", "on_end", "event", "target"},
    "minecraft:behavior.timer_flag_2": {"on_start", "on_end", "event", "target"},
    "minecraft:behavior.timer_flag_3": {"on_start", "on_end", "event", "target"},
    "minecraft:behavior.nearest_attackable_target": {"entity_types"},
    "minecraft:behavior.hurt_by_target": {"entity_types"},
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", default=os.environ.get("BEDROCK_REFERENCE", ""))
    parser.add_argument("--packs", nargs="*", default=["behavior_packs/bodyguard_bp"])
    args = parser.parse_args()

    if not args.reference or not os.path.isdir(args.reference):
        print("verify_bedrock: no 1.21.0 reference tree available - skipping.")
        print("  (run tools/fetch_reference.py to download Mojang's samples)")
        return 0

    vanilla_known, vanilla_fields = vanilla_component_fields(args.reference)
    docs_known, docs_fields = doc_component_fields(args.reference)
    known = vanilla_known | docs_known

    usage, where = our_usage(args.packs)

    problems = []
    for component in sorted(usage):
        if component not in known:
            problems.append(
                "unknown component %s (used in %s)"
                % (component, ", ".join(sorted(where[component])))
            )
            continue
        allowed = vanilla_fields.get(component, set()) | docs_fields.get(component, set())
        allowed |= NESTED_OK.get(component, set())
        for field in sorted(usage[component]):
            if field not in allowed:
                problems.append(
                    "%s: field '%s' not documented and never used by vanilla" % (component, field)
                )

    print(
        "verify_bedrock: checked %d components against %d vanilla + %d documented"
        % (len(usage), len(vanilla_known), len(docs_known))
    )
    if problems:
        print("\nPossible 1.21.0 incompatibilities:", file=sys.stderr)
        for problem in problems:
            print("  - " + problem, file=sys.stderr)
        return 1
    print("verify_bedrock: all components and fields exist in 1.21.0.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
