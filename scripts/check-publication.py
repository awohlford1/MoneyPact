"""Offline publication contract and regression fixtures; no remote calls."""

import unittest

from publication import PublicationError
from publication_contract import check


def main():
    try:
        check()
    except PublicationError as error:
        print("Publication contract failed: " + error.code)
        return 1
    except Exception:
        print("Publication contract unavailable; install pinned requirements and verify repository files")
        return 1
    suite = unittest.defaultTestLoader.discover("scripts", pattern="test_publication.py")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if result.wasSuccessful():
        print("Publication contract and offline regressions passed; live activation is a separate owner gate")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
