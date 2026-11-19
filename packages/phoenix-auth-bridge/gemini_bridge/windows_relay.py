"""Windows Tk operator station. Never observes or drives browser windows."""
from __future__ import annotations
import tkinter as tk
from tkinter import ttk, messagebox
from .sqlite_store import PhoenixSQLiteStore


class OperatorWindow:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("PHOENIX AUTH BRIDGE — Operator only")
        root.geometry("1060x700")
        self.store = PhoenixSQLiteStore()
        self.status = tk.StringVar()
        self.sender = tk.StringVar(value="chatgpt")
        self.recipient = tk.StringVar(value="gemini")
        self.intent = tk.StringVar(value="proposal")
        self.reply_to = tk.StringVar()
        self._build()
        self.refresh()

    def _build(self):
        top = ttk.Frame(self.root, padding=12)
        top.pack(fill="x")
        ttk.Label(top, textvariable=self.status, font=("Segoe UI", 12, "bold")).pack(side="left")
        ttk.Button(top, text="🛑 STOP + revoke", command=lambda: self._operator_action("stop")).pack(side="right", padx=4)
        ttk.Button(top, text="Resume local", command=lambda: self._operator_action("resume")).pack(side="right", padx=4)
        ttk.Button(top, text="Refresh", command=self.refresh).pack(side="right", padx=4)

        input_row = ttk.Frame(self.root, padding=12)
        input_row.pack(fill="x")
        for col, (label, var, choices) in enumerate([
            ("Declared sender", self.sender, ("chatgpt", "gemini", "arisnachy")),
            ("Recipient", self.recipient, ("chatgpt", "gemini", "arisnachy")),
            ("Intent", self.intent, ("proposal", "code_review", "research", "verdict", "general")),
        ]):
            f = ttk.Frame(input_row)
            f.grid(row=0, column=col, padx=8, sticky="ew")
            ttk.Label(f, text=label).pack(anchor="w")
            ttk.Combobox(f, textvariable=var, values=choices, state="readonly", width=20).pack(fill="x")
        input_row.columnconfigure(0, weight=1)
        input_row.columnconfigure(1, weight=1)
        input_row.columnconfigure(2, weight=1)
        ttk.Label(input_row, text="Reply to message ID (blank for new thread)").grid(row=1, column=0, columnspan=3, sticky="w", pady=(8,0))
        ttk.Entry(input_row, textvariable=self.reply_to).grid(row=2, column=0, columnspan=3, sticky="ew")
        self.draft = tk.Text(self.root, height=5, wrap="word")
        self.draft.pack(fill="x", padx=12)
        ttk.Button(self.root, text="Queue human-entered draft (never sends)", command=self._queue).pack(anchor="e", padx=12, pady=8)

        fields = ("turn", "sender", "recipient", "status", "origin", "message_id", "thread_id")
        self.tree = ttk.Treeview(self.root, columns=fields, show="headings", height=11)
        for field in fields:
            self.tree.heading(field, text=field)
            self.tree.column(field, width=105 if field not in ("message_id", "thread_id") else 240)
        self.tree.pack(fill="both", expand=True, padx=12, pady=4)
        actions = ttk.Frame(self.root, padding=12)
        actions.pack(fill="x")
        for title, fn in [
            ("Preview draft", self._preview),
            ("Approve", lambda: self._operator_action("approve")),
            ("Reject", lambda: self._operator_action("reject")),
            ("Copy approved", self._copy),
            ("Confirm manual delivery", lambda: self._operator_action("delivered")),
        ]:
            ttk.Button(actions, text=title, command=fn).pack(side="left", padx=4)

    def _selected(self):
        selection = self.tree.selection()
        if not selection:
            raise ValueError("Select a message first")
        return self.tree.item(selection[0], "values")[5]

    def _operator_action(self, action):
        try:
            if action == "stop":
                revoked = self.store.set_stopped(True, operator=True)
                # Best-effort local clipboard clear; cannot recall previously pasted text.
                self.root.clipboard_clear()
                messagebox.showinfo("STOP", f"Stopped. Revoked {revoked} undelivered drafts.")
            elif action == "resume":
                self.store.set_stopped(False, operator=True)
            elif action == "approve":
                self.store.approve(self._selected(), operator=True)
            elif action == "reject":
                self.store.reject(self._selected(), operator=True)
            elif action == "delivered":
                if not messagebox.askyesno("Manual delivery", "Did you paste AND send this yourself in the official app?"):
                    return
                self.store.mark_delivered(self._selected(), operator=True)
            self.refresh()
        except Exception as exc:
            messagebox.showerror("Blocked", str(exc))

    def _queue(self):
        try:
            self.store.propose(sender=self.sender.get(), recipient=self.recipient.get(),
                               intent=self.intent.get(), text=self.draft.get("1.0", "end-1c"),
                               reply_to=self.reply_to.get().strip() or None,
                               origin="manual-user-entry")
            self.draft.delete("1.0", "end")
            self.refresh()
        except Exception as exc:
            messagebox.showerror("Invalid draft", str(exc))

    def _preview(self):
        try:
            row = self.store.get_message(self._selected())
            if not row:
                raise ValueError("Unknown message")
            self._show_text("Draft preview (untrusted content)", row["envelope"]["payload"]["text"])
        except Exception as exc:
            messagebox.showerror("Preview blocked", str(exc))

    def _show_text(self, title, value):
        window = tk.Toplevel(self.root)
        window.title(title)
        window.geometry("850x450")
        text = tk.Text(window, wrap="word")
        text.pack(fill="both", expand=True)
        text.insert("1.0", value)
        text.configure(state="disabled")

    def _copy(self):
        try:
            m = self.store.approved_for_manual_copy(self._selected())
            text = (f"[PHOENIX AUTH BRIDGE | MANUAL | {m['message_id']}]\n"
                    f"User-declared sender: {m['sender']} -> {m['recipient']}\n"
                    f"Turn {m['turn']}/12 | Intent: {m['intent']}\n\n{m['payload']['text']}")
            if not messagebox.askyesno("Copy manually", "Copy the APPROVED text to clipboard? You must paste and send it yourself."):
                return
            self.root.clipboard_clear()
            self.root.clipboard_append(text)
            self.root.update()
            messagebox.showinfo("Copied", "You now control where to paste/send it. No automatic sending occurred.")
        except Exception as exc:
            messagebox.showerror("Copy blocked", str(exc))

    def refresh(self):
        stopped = self.store.is_stopped()
        self.status.set("🛑 STOPPED (default)" if stopped else "Supervised manual relay ACTIVE")
        for item in self.tree.get_children():
            self.tree.delete(item)
        for row in self.store.list_recent():
            m = row["envelope"]
            self.tree.insert("", "end", values=(m["turn"], m["sender"], m["recipient"], row["status"],
                                                  m["origin"], m["message_id"], m["thread_id"]))


def main():
    root = tk.Tk()
    OperatorWindow(root)
    root.mainloop()


if __name__ == "__main__":
    main()
