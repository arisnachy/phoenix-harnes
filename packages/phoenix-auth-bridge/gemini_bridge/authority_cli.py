"""Human-operated CLI for the ONE SQLite authority (shared with MCP and Tk).

Never automated browser I/O, token harvesting or model invocation.
The CLI is a local operator interface, NOT an authenticated remote RPC endpoint.
"""
from __future__ import annotations

import argparse
import json
import sys

from .sqlite_store import PhoenixSQLiteStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="PHOENIX AUTH BRIDGE", description="Manual relay — SQLite authority")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("status")
    commands.add_parser("stop")
    commands.add_parser("resume")
    draft = commands.add_parser("prepare")
    draft.add_argument("--from", dest="sender", required=True)
    draft.add_argument("--to", dest="recipient", required=True)
    draft.add_argument("--intent", default="general")
    draft.add_argument("--reply-to", dest="reply_to", default=None)
    for name in ("approve", "reject", "delivered", "relay"):
        commands.add_parser(name).add_argument("--id", required=True)
    args = parser.parse_args(argv)

    try:
        store = PhoenixSQLiteStore()
        if args.command == "status":
            # Fetch from SQLite, never authorize from an eventually-consistent snapshot.
            print(json.dumps({"authority": "sqlite_wal", "stop_active": store.is_stopped(),
                "messages": [{"message_id": row["message_id"], "thread_id": row["thread_id"],
                    "turn": row["turn"], "status": row["status"], "sender": row["sender"],
                    "recipient": row["recipient"], "digest": row["digest"]}
                    for row in store.list_recent()], "audit": store.audit()}, ensure_ascii=False, indent=2))
        elif args.command in ("stop", "resume"):
            revoked = store.set_stopped(args.command == "stop", operator=True)
            print(f"{'STOPPED' if args.command == 'stop' else 'RESUMED'}; revoked={revoked}. No automatic sending.")
        elif args.command == "prepare":
            body = sys.stdin.read()
            item = store.propose(sender=args.sender, recipient=args.recipient,
                intent=args.intent, text=body, reply_to=args.reply_to, origin="manual-user-entry")
            print(f"Pending {item['message_id']}; explicit approval required before copying.")
        elif args.command == "approve":
            store.approve(args.id, operator=True)
            print("Approved for manual copying only.")
        elif args.command == "reject":
            store.reject(args.id, operator=True)
            print("Rejected.")
        elif args.command == "delivered":
            store.mark_delivered(args.id, operator=True)
            print("Delivery manually confirmed by user.")
        elif args.command == "relay":
            msg = store.approved_for_manual_copy(args.id)
            print(f"[PHOENIX AUTH BRIDGE · MANUAL RELAY]\n"
                  f"From (unverified label): {msg['sender']}\nTo: {msg['recipient']}\n"
                  f"Thread: {msg['thread_id']}\nTurn: {msg['turn']}/12\n"
                  f"Intent: {msg['intent']}\n\n{msg['payload']['text']}")
        return 0
    except (ValueError, RuntimeError, PermissionError, OSError) as exc:
        print(f"PHOENIX AUTH BRIDGE: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
