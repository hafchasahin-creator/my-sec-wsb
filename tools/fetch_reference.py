#!/usr/bin/env python3
"""Download Mojang's published Bedrock 1.21.0 sample packs.

tools/verify_bedrock.py and tools/build.py use this tree as ground truth for
"does this component/field/sound actually exist in 1.21.0".  Both work without
it - they just check less - so this is optional.

Usage:
    python3 tools/fetch_reference.py [--dest .bedrock-reference]
    BEDROCK_REFERENCE=.bedrock-reference python3 tools/build.py
"""

import argparse
import os
import subprocess
import sys

TAG = "v1.21.0.3"  # the sample pack tag for the 1.21.0 release
REPO = "https://github.com/Mojang/bedrock-samples.git"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dest", default=".bedrock-reference")
    args = parser.parse_args()

    if os.path.isdir(os.path.join(args.dest, "behavior_pack")):
        print("Reference already present at %s" % args.dest)
        print('Use it with:  BEDROCK_REFERENCE=%s python3 tools/build.py' % args.dest)
        return 0

    print("Cloning %s at %s into %s ..." % (REPO, TAG, args.dest))
    try:
        subprocess.check_call(
            ["git", "clone", "--depth", "1", "--branch", TAG, "--single-branch", REPO, args.dest]
        )
    except (subprocess.CalledProcessError, OSError) as exc:
        print("Could not fetch the reference tree: %s" % exc, file=sys.stderr)
        print("The build still works without it, with fewer checks.", file=sys.stderr)
        return 1

    print("\nDone. Now run:")
    print("  BEDROCK_REFERENCE=%s python3 tools/build.py" % args.dest)
    print("  BEDROCK_REFERENCE=%s python3 tools/verify_bedrock.py" % args.dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
