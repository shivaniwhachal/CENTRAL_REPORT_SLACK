"""5:30 PM VINI Accounts Alert.

Not the 6:00 AM Central Daily VINI report. Different job, different sheet,
and a dark table. Channel #vini-cs-team (C0BPY9U15U5). The morning sender
does not call this module. See docs/VINI-ACCOUNTS-ALERT.md.
"""


def main() -> int:
    print(
        "This is the 5:30 PM VINI Accounts Alert, not the Central Daily VINI report. "
        "It does not post from this command."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
