"""Fresh-process Python executor for dsh-code-runtime-python.

The parent owns the fd-3 protocol. Model code runs in an async function so
``return`` and ``await tools.name(args)`` behave like the TypeScript runtime.
This process is containment, not a security boundary; the product sandbox and
approval policy remain authoritative.
"""

import asyncio
import contextlib
import io
import json
import os
import textwrap
import traceback
from typing import Any

try:
    import resource
except ImportError:
    resource = None  # type: ignore[assignment]

from protocol import PROTOCOL_FD, log_truncation_marker


def send(writer: io.TextIOWrapper, frame: dict[str, Any]) -> None:
    writer.write(json.dumps(frame, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    writer.flush()


class LogWriter(io.TextIOBase):
    def __init__(self, writer: io.TextIOWrapper, limit: int) -> None:
        self.writer = writer
        self.limit = limit
        self.used = 0
        self.truncated = False
        self.pending = ""

    def _emit(self, value: str) -> None:
        if not value or self.truncated:
            return
        encoded = value.encode("utf-8", "replace")
        if self.used + len(encoded) > self.limit:
            send(self.writer, {"type": "log", "text": log_truncation_marker(self.limit), "truncated": True})
            self.truncated = True
            return
        self.used += len(encoded)
        send(self.writer, {"type": "log", "text": value})

    def write(self, value: str) -> int:
        if not value or self.truncated:
            return len(value)
        self.pending += value
        while "\n" in self.pending and not self.truncated:
            line, self.pending = self.pending.split("\n", 1)
            self._emit(line + "\n")
        return len(value)

    def flush(self) -> None:
        pending, self.pending = self.pending, ""
        self._emit(pending)


class Bridge:
    def __init__(self, reader: io.TextIOWrapper, writer: io.TextIOWrapper) -> None:
        self.reader = reader
        self.writer = writer
        self.next_id = 1
        self.pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self.write_lock = asyncio.Lock()

    async def call(self, global_name: str, member: str, args: Any) -> Any:
        call_id = self.next_id
        self.next_id += 1
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.pending[call_id] = future
        async with self.write_lock:
            send(self.writer, {"type": "call", "id": call_id, "global": global_name, "name": member, "args": args})
        try:
            reply = await future
        finally:
            self.pending.pop(call_id, None)
        if reply.get("ok") is True:
            return reply.get("value")
        raise RuntimeError(str(reply.get("message", "binding call failed")))

    async def read_replies(self) -> None:
        while True:
            line = await asyncio.to_thread(self.reader.readline)
            if line == "":
                error = RuntimeError("host closed the Python runtime protocol")
                for future in self.pending.values():
                    if not future.done():
                        future.set_exception(error)
                return
            try:
                frame = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(frame, dict) and frame.get("type") == "reply" and isinstance(frame.get("id"), int):
                future = self.pending.get(frame["id"])
                if future is not None and not future.done():
                    future.set_result(frame)


class Namespace:
    def __init__(self, bridge: Bridge, global_name: str, names: list[str], error_type: type[Exception] | None, member_property: str | None) -> None:
        self.bridge = bridge
        self.global_name = global_name
        self.names = set(names)
        self.error_type = error_type
        self.member_property = member_property

    def __getattr__(self, name: str):
        if name.startswith("__"):
            raise AttributeError(name)
        if name not in self.names:
            async def unknown(_: Any) -> Any:
                return await self.bridge.call(self.global_name, name, _)
            return unknown

        async def invoke(args: Any) -> Any:
            try:
                return await self.bridge.call(self.global_name, name, args)
            except Exception as error:
                if self.error_type is None:
                    raise
                typed = self.error_type(str(error))
                if self.member_property is not None:
                    setattr(typed, self.member_property, name)
                raise typed from error
        return invoke


def apply_limits(boot: dict[str, Any]) -> None:
    if resource is None:
        return
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (int(boot["cpuSeconds"]), int(boot["cpuSeconds"])))
        resource.setrlimit(resource.RLIMIT_AS, (int(boot["addressSpaceBytes"]), int(boot["addressSpaceBytes"])))
    except (AttributeError, OSError, ValueError):
        # Windows and some managed runtimes do not expose POSIX rlimits. The
        # host wall-clock cap still terminates the process on those platforms.
        pass


def make_error_type(descriptor: dict[str, str] | None) -> type[Exception] | None:
    if descriptor is None:
        return None
    return type(descriptor["name"], (Exception,), {})


async def execute(program: str, boot: dict[str, Any], bridge: Bridge, writer: io.TextIOWrapper) -> None:
    globals_ns: dict[str, Any] = {"__name__": "__dsh_main__", "__builtins__": __builtins__}
    for descriptor in boot["namespaces"]:
        error_descriptor = descriptor.get("errorClass")
        error_type = make_error_type(error_descriptor)
        if error_type is not None and error_descriptor is not None:
            globals_ns[error_descriptor["name"]] = error_type
        globals_ns[descriptor["global"]] = Namespace(
            bridge,
            descriptor["global"],
            descriptor["names"],
            error_type,
            None if error_descriptor is None else error_descriptor["memberNameProperty"],
        )
    body = textwrap.indent(program, "    ") or "    pass"
    source = "async def __dsh_main__():\n" + body + "\n"
    try:
        exec(compile(source, "<phoenix-artifact>", "exec"), globals_ns, globals_ns)
        reader_task = asyncio.create_task(bridge.read_replies())
        log = LogWriter(writer, int(boot["maxLogBytes"]))
        try:
            with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                value = await globals_ns["__dsh_main__"]()
            log.flush()
            try:
                json.dumps(value, ensure_ascii=False, allow_nan=False)
            except (TypeError, ValueError, OverflowError):
                send(writer, {"type": "done", "error": {"kind": "invalid-output", "message": "program completion must be lossless JSON"}})
            else:
                send(writer, {"type": "done", "value": value} if value is not None else {"type": "done"})
        finally:
            reader_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reader_task
    except Exception:
        send(writer, {"type": "done", "error": {"kind": "exception", "message": traceback.format_exc()}})


def main() -> None:
    read_fd = os.dup(PROTOCOL_FD)
    reader = os.fdopen(read_fd, "r", encoding="utf-8", buffering=1)
    writer = os.fdopen(PROTOCOL_FD, "w", encoding="utf-8", buffering=1)
    boot = json.loads(reader.readline())
    apply_limits(boot)
    send(writer, {"type": "boot-ack"})
    run = json.loads(reader.readline())
    asyncio.run(execute(str(run["program"]), boot, Bridge(reader, writer), writer))


if __name__ == "__main__":
    main()
