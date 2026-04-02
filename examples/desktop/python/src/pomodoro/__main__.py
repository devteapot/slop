"""Entry point for the Pomodoro timer app."""

from __future__ import annotations

import asyncio
import atexit
import os
import sys
import threading

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from pomodoro.pomodoro import PomodoroTimer
from pomodoro.provider import (
    setup_provider,
    write_discovery,
    update_discovery,
    cleanup_discovery,
    DEFAULT_SOCK,
)
from slop_ai.transports.unix import listen as listen_unix


def main() -> None:
    timer = PomodoroTimer()
    timer.load()

    slop = setup_provider(timer)

    socket_path = os.environ.get("POMODORO_SOCK", DEFAULT_SOCK)

    # Start SLOP socket in a background thread with its own asyncio event loop
    loop: asyncio.AbstractEventLoop | None = None

    def run_slop() -> None:
        nonlocal loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def _serve() -> None:
            server = await listen_unix(slop, socket_path)
            try:
                await asyncio.Event().wait()
            finally:
                server.close()
                await server.wait_closed()

        loop.run_until_complete(_serve())

    slop_thread = threading.Thread(target=run_slop, daemon=True)
    slop_thread.start()

    # Write discovery file
    write_discovery(timer, socket_path)

    # Clean up on exit
    atexit.register(cleanup_discovery)

    # Start Qt app
    app = QApplication(sys.argv)

    from pomodoro.app import PomodoroWindow

    window = PomodoroWindow(timer)
    window.show()

    # 1-second tick timer
    tick_timer = QTimer()
    tick_count = [0]  # mutable counter for discovery updates

    def on_tick() -> None:
        if timer.phase.value != "idle" and not timer.paused:
            timer.tick()
        slop.refresh()
        window.update_ui()

        # Update discovery file every 10 seconds (not every tick)
        tick_count[0] += 1
        if tick_count[0] % 10 == 0:
            update_discovery(timer, socket_path)

    tick_timer.timeout.connect(on_tick)
    tick_timer.start(1000)

    print(f"pomodoro: listening on {socket_path}", flush=True)
    print(f"pomodoro: {len(timer.sessions)} sessions loaded", flush=True)

    ret = app.exec()

    # Cleanup
    cleanup_discovery()
    slop.stop()
    sys.exit(ret)


if __name__ == "__main__":
    main()
