"""
Pulls every framework method and field reference out of a javap dump.

Qualified references are emitted as-is. Unqualified ones - a call to an
inherited framework method on `this`, which javap prints without an owner - are
emitted with the enclosing class, so ApiCheck can work out which class really
declares them before deciding whether they matter.
"""
import re
import sys

CLASS_DECL = re.compile(
    r'^(?:public |final |abstract |static |protected |private )*(?:class|interface) ([\w.$]+)')
QUALIFIED = re.compile(
    r'//\s+(?:Interface)?(?:Method|Field)\s+([\w/$]+)\.("?<init>"?|[\w$]+):(\S+)')
UNQUALIFIED = re.compile(
    r'//\s+(?:Interface)?(?:Method|Field)\s+("?<init>"?|[\w$]+):(\S+)\s*$')
FRAMEWORK = ('android/', 'com/android/', 'dalvik/')


def main(javap_path, out_path):
    refs = set()
    current = None
    with open(javap_path) as handle:
        for line in handle:
            stripped = line.strip()
            decl = CLASS_DECL.match(stripped)
            if decl and not stripped.startswith('//'):
                current = decl.group(1)
                continue
            qualified = QUALIFIED.search(line)
            if qualified:
                owner, member, desc = qualified.groups()
                if owner.startswith(FRAMEWORK):
                    refs.add('Q|%s|%s|%s' % (owner, member.strip('"'), desc))
                continue
            unqualified = UNQUALIFIED.search(line)
            if unqualified and current:
                member, desc = unqualified.groups()
                refs.add('U|%s|%s|%s' % (current, member.strip('"'), desc))
    with open(out_path, 'w') as handle:
        handle.write('\n'.join(sorted(refs)) + '\n')
    print('  extracted %d references' % len(refs))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
