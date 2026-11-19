"""Local stdio MCP endpoint, optional `mcp` dependency.

Host controls MCP authorization. No token/credential/session access. Only two
agent tools: propose a DRAFT, or read an ALREADY-human-approved inbox.
NEVER expose operator resume/stop/approve/delivered as MCP tools.
"""
from .sqlite_store import PhoenixSQLiteStore

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:
    raise SystemExit("Install optional MCP requirements: pip install -r gemini_bridge/requirements-mcp.txt") from exc

store = PhoenixSQLiteStore()
mcp = FastMCP("PhoenixConsentBridgeLocal")


@mcp.tool()
def propose_bridge_draft(sender: str, recipient: str, intent: str, text: str,
                         reply_to: str = "") -> dict:
    """Propose an unapproved, user-labeled message. NEVER sends to a model."""
    try:
        result = store.propose(sender=sender, recipient=recipient, intent=intent, text=text,
                               reply_to=reply_to or None, origin="mcp-agent-proposal")
        return {**result, "requires_human_approval": True}
    except (ValueError, RuntimeError) as exc:
        return {"status": "BLOCKED", "reason": str(exc)}


@mcp.tool()
def read_approved_bridge_inbox(recipient: str) -> dict:
    """Read only messages previously approved by the human operator."""
    try:
        rows = store.approved_inbox(recipient)
        return {"status": "OK", "messages": [row["envelope"] for row in rows]}
    except (ValueError, RuntimeError) as exc:
        return {"status": "BLOCKED", "reason": str(exc), "messages": []}


if __name__ == "__main__":
    mcp.run(transport="stdio")
